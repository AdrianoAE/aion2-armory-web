import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createDecipheriv, createECDH, createPublicKey, generateKeyPairSync, hkdfSync, verify } from "node:crypto";
import { b64urlDecode, b64urlEncode, encryptPayload, pushRequest, vapidJwt } from "../docs/webpush.js";
import worker from "../docs/relay-worker.js";

const RFC8291 = {
  plaintext: "When I grow up, I want to be a watermelon",
  asPublic: "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  uaPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  expected: "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};

// An independent RFC 8291 decryption on node:crypto, playing the browser.
function decrypt(body, uaPrivate, uaPublic, auth) {
  const buf = Buffer.from(body);
  const salt = buf.subarray(0, 16);
  const rs = buf.readUInt32BE(16);
  const idlen = buf[20];
  const asPublic = buf.subarray(21, 21 + idlen);
  const cipher = buf.subarray(21 + idlen);
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(Buffer.from(uaPrivate, "base64url"));
  const secret = ecdh.computeSecret(asPublic);
  const info = Buffer.concat([Buffer.from("WebPush: info\0"), Buffer.from(uaPublic, "base64url"), asPublic]);
  const ikm = Buffer.from(hkdfSync("sha256", secret, Buffer.from(auth, "base64url"), info, 32));
  const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(cipher.subarray(cipher.length - 16));
  const plain = Buffer.concat([decipher.update(cipher.subarray(0, cipher.length - 16)), decipher.final()]);
  assert.equal(plain[plain.length - 1], 2, "last-record padding delimiter");
  return { rs, text: plain.subarray(0, plain.length - 1).toString("utf8") };
}

function browserKeys() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return {
    privateKey: ecdh.getPrivateKey("base64url"),
    p256dh: ecdh.getPublicKey("base64url"),
    auth: b64urlEncode(crypto.getRandomValues(new Uint8Array(16))),
  };
}

function vapidKeys() {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = privateKey.export({ format: "jwk" });
  const pub = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]);
  return { publicKey: pub.toString("base64url"), privateKey: jwk.d, jwk };
}

test("encryption matches the RFC 8291 Appendix A vector", async () => {
  const body = await encryptPayload(RFC8291.plaintext, { p256dh: RFC8291.uaPublic, auth: RFC8291.auth },
    { local: { publicKey: RFC8291.asPublic, privateKey: RFC8291.asPrivate }, salt: RFC8291.salt });
  assert.equal(b64urlEncode(body), RFC8291.expected);
  const { rs, text } = decrypt(b64urlDecode(RFC8291.expected), RFC8291.uaPrivate, RFC8291.uaPublic, RFC8291.auth);
  assert.equal(rs, 4096);
  assert.equal(text, RFC8291.plaintext);
});

test("a fresh encryption decrypts with the browser's keys", async () => {
  const ua = browserKeys();
  const a = await encryptPayload("{\"title\":\"x\"}", ua);
  const b = await encryptPayload("{\"title\":\"x\"}", ua);
  assert.notDeepEqual(a, b, "salt and key pair are fresh per message");
  assert.equal(decrypt(a, ua.privateKey, ua.p256dh, ua.auth).text, "{\"title\":\"x\"}");
});

test("the VAPID JWT is ES256 over the push service origin", async () => {
  const keys = vapidKeys();
  const now = Date.UTC(2026, 9, 9, 12);
  const jwt = await vapidJwt("https://fcm.googleapis.com", "mailto:armory@example.com", keys.publicKey, keys.privateKey, now);
  const [h, c, s] = jwt.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(h, "base64url")), { typ: "JWT", alg: "ES256" });
  assert.deepEqual(JSON.parse(Buffer.from(c, "base64url")), { aud: "https://fcm.googleapis.com", exp: now / 1000 + 12 * 3600, sub: "mailto:armory@example.com" });
  const pub = createPublicKey({ key: { kty: "EC", crv: "P-256", x: keys.jwk.x, y: keys.jwk.y }, format: "jwk" });
  assert.ok(verify("sha256", Buffer.from(`${h}.${c}`), { key: pub, dsaEncoding: "ieee-p1363" }, Buffer.from(s, "base64url")));
});

test("push requests carry the RFC 8030/8292 headers", async () => {
  const keys = vapidKeys();
  const ua = browserKeys();
  const request = await pushRequest({ endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: ua }, { title: "t" },
    { publicKey: keys.publicKey, privateKey: keys.privateKey, subject: "mailto:armory@example.com" });
  assert.equal(request.headers.TTL, "3600");
  assert.equal(request.headers.Urgency, "high");
  assert.equal(request.headers["Content-Encoding"], "aes128gcm");
  assert.match(request.headers.Authorization, new RegExp(`^vapid t=[\\w-]+\\.[\\w-]+\\.[\\w-]+, k=${keys.publicKey}$`));
  assert.deepEqual(JSON.parse(decrypt(request.body, ua.privateKey, ua.p256dh, ua.auth).text), { title: "t" });
});

test("the Worker carries the same web push code as docs/webpush.js", () => {
  const lib = readFileSync(new URL("../docs/webpush.js", import.meta.url), "utf8");
  const workerSource = readFileSync(new URL("../docs/relay-worker.js", import.meta.url), "utf8");
  const block = lib.slice(lib.indexOf("const enc = "), lib.indexOf("export {")).trim();
  assert.ok(block.length > 2000);
  assert.ok(workerSource.includes(block), "docs/relay-worker.js drifted from docs/webpush.js");
});

class FakeKV {
  constructor() { this.data = new Map(); this.ops = { get: 0, put: 0, delete: 0, list: 0 }; }
  async get(key, type) {
    this.ops.get += 1;
    const value = this.data.has(key) ? this.data.get(key) : null;
    return value !== null && type === "json" ? JSON.parse(value) : value;
  }
  async put(key, value) { this.ops.put += 1; this.data.set(key, String(value)); }
  async delete(key) { this.ops.delete += 1; this.data.delete(key); }
  async list({ prefix = "", cursor } = {}) {
    this.ops.list += 1;
    const names = [...this.data.keys()].filter((k) => k.startsWith(prefix)).sort();
    const start = cursor ? Number(cursor) : 0;
    const page = names.slice(start, start + 2);
    const done = start + 2 >= names.length;
    return { keys: page.map((name) => ({ name })), list_complete: done, cursor: done ? undefined : String(start + 2) };
  }
}

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function pushService(status = 201) {
  const sent = [];
  globalThis.fetch = async (url, init) => {
    sent.push({ url: String(url), init });
    return new Response(null, { status: typeof status === "function" ? status(sent.length) : status });
  };
  return sent;
}

function env() {
  const keys = vapidKeys();
  return { PUSH: new FakeKV(), VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey, VAPID_SUBJECT: "mailto:armory@example.com" };
}

const BASE = "https://relay.example.workers.dev";
const call = (e, method, path, body) => worker.fetch(new Request(BASE + path, body === undefined ? { method } : { method, body: JSON.stringify(body) }), e);
const iso = (ms) => new Date(ms).toISOString();

function subscription(ua, n = 1) {
  return { endpoint: `https://fcm.googleapis.com/fcm/send/device-${n}`, expirationTime: null, keys: { p256dh: ua.p256dh, auth: ua.auth } };
}

test("the Worker serves its key, CORS and leaves the relay routes alone", async () => {
  const e = env();
  const key = await call(e, "GET", "/push/key");
  assert.equal(key.status, 200);
  assert.equal(key.headers.get("Access-Control-Allow-Origin"), "*");
  assert.deepEqual(await key.json(), { publicKey: e.VAPID_PUBLIC_KEY });
  const preflight = await call(e, "OPTIONS", "/push/subscribe");
  assert.equal(preflight.status, 204);
  assert.match(preflight.headers.get("Access-Control-Allow-Methods"), /POST/);
  assert.equal((await call({}, "GET", "/push/key")).status, 501);
  assert.equal((await call(e, "PUT", "/push/subscribe", {})).status, 404);
  assert.equal((await call(e, "GET", "/")).status, 400);
  assert.equal((await call(e, "POST", "/?url=x", {})).status, 405);
  assert.equal((await call(e, "GET", "/?url=" + encodeURIComponent("https://example.com/"))).status, 403);
});

test("subscribe stores a cleaned schedule and refuses unknown push services", async () => {
  const e = env();
  const ua = browserKeys();
  const now = Date.now();
  const schedule = [
    ...Array.from({ length: 230 }, (_, i) => ({ key: `custom:e${i}@1`, at: iso(now + (i + 1) * 60000), title: `Event ${i}`, body: "Starts in 5 min", url: "https://x.github.io/aion2-armory-web/#settings" })),
    { key: "old", at: iso(now - 10 * 60000), title: "Too old" },
    { key: "bad-date", at: "soon", title: "?" },
    { key: "bad-url", at: iso(now + 30000), title: "Odd link", url: "javascript:alert(1)" },
  ];
  const res = await call(e, "POST", "/push/subscribe", { subscription: subscription(ua), schedule });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, count: 200 });
  const [subKey] = [...e.PUSH.data.keys()].filter((k) => k.startsWith("sub:"));
  assert.match(subKey, /^sub:[0-9a-f]{64}$/);
  const record = JSON.parse(e.PUSH.data.get(subKey));
  assert.equal(record.schedule.length, 200);
  assert.equal(record.schedule[0].key, "bad-url");
  assert.equal(record.schedule[0].url, "");
  assert.ok(!record.schedule.some((s) => s.key === "old" || s.key === "bad-date"));
  assert.deepEqual(JSON.parse(e.PUSH.data.get("index")), [subKey.slice(4)]);

  await call(e, "POST", "/push/subscribe", { subscription: subscription(ua), schedule: [{ key: "k", at: iso(now + 60000), title: "Only" }] });
  assert.equal(JSON.parse(e.PUSH.data.get(subKey)).schedule.length, 1, "a new upload replaces the schedule");

  const evil = { ...subscription(ua), endpoint: "https://evil.example.com/collect" };
  assert.equal((await call(e, "POST", "/push/subscribe", { subscription: evil, schedule: [] })).status, 400);
  assert.equal((await call(e, "POST", "/push/subscribe", { subscription: { ...subscription(ua), keys: { p256dh: "AA", auth: ua.auth } } })).status, 400);

  assert.equal((await call(e, "DELETE", "/push/subscribe", { endpoint: subscription(ua).endpoint })).status, 200);
  assert.equal(e.PUSH.data.has(subKey), false);
  assert.deepEqual(JSON.parse(e.PUSH.data.get("index")), []);
});

test("the cron sends due entries once, encrypted for the subscriber", async () => {
  const e = env();
  const ua = browserKeys();
  const now = Date.now();
  await call(e, "POST", "/push/subscribe", {
    subscription: subscription(ua),
    schedule: [
      { key: "boss:b1@1", at: iso(now - 30000), title: "Kromede", body: "Spawns in 5 min", url: "https://x.github.io/aion2-armory-web/#timers" },
      { key: "custom:e1@2", at: iso(now - 100000), title: "Siege", body: "Starts in 5 min", url: "" },
      { key: "later", at: iso(now + 10 * 60000), title: "Later" },
    ],
  });
  const sent = pushService(201);
  const minute = Date.UTC(2026, 9, 9, 12, 7);
  await worker.scheduled({ scheduledTime: minute, cron: "* * * * *" }, e);
  assert.equal(sent.length, 2);
  const payloads = sent.map((s) => JSON.parse(decrypt(new Uint8Array(s.init.body), ua.privateKey, ua.p256dh, ua.auth).text));
  assert.deepEqual(payloads.find((p) => p.tag === "boss:b1@1"), { title: "Kromede", body: "Spawns in 5 min", url: "https://x.github.io/aion2-armory-web/#timers", tag: "boss:b1@1" });
  assert.ok(payloads.some((p) => p.tag === "custom:e1@2" && p.title === "Siege"));
  assert.equal(sent[0].url, "https://fcm.googleapis.com/fcm/send/device-1");
  assert.equal(sent[0].init.headers.TTL, "3600");
  assert.equal(sent[0].init.headers.Urgency, "high");
  assert.equal(e.PUSH.ops.list, 0, "no KV list outside the hourly reconcile");

  await worker.scheduled({ scheduledTime: minute + 60000, cron: "* * * * *" }, e);
  assert.equal(sent.length, 2, "sent entries are not repeated");

  const id = [...e.PUSH.data.keys()].find((k) => k.startsWith("sent:")).slice(5);
  const sentMarks = JSON.parse(e.PUSH.data.get(`sent:${id}`));
  sentMarks["ancient"] = now - 3 * 86400000;
  e.PUSH.data.set(`sent:${id}`, JSON.stringify(sentMarks));
  await call(e, "POST", "/push/subscribe", { subscription: subscription(ua), schedule: [{ key: "fresh", at: iso(Date.now() - 1000), title: "Fresh" }] });
  await worker.scheduled({ scheduledTime: minute + 120000, cron: "* * * * *" }, e);
  assert.equal(sent.length, 3);
  const marks = JSON.parse(e.PUSH.data.get(`sent:${id}`));
  assert.ok(marks.fresh && marks["boss:b1@1"] && !marks.ancient, "two-day prune");
});

test("a failing push is retried inside the window; 410 removes the subscriber", async () => {
  const e = env();
  const ua = browserKeys();
  await call(e, "POST", "/push/subscribe", { subscription: subscription(ua), schedule: [{ key: "a", at: iso(Date.now() - 5000), title: "A" }] });
  const sent = pushService((n) => (n === 1 ? 503 : 201));
  const minute = Date.UTC(2026, 9, 9, 12, 7);
  await worker.scheduled({ scheduledTime: minute }, e);
  await worker.scheduled({ scheduledTime: minute + 60000 }, e);
  assert.equal(sent.length, 2);
  await worker.scheduled({ scheduledTime: minute + 120000 }, e);
  assert.equal(sent.length, 2);

  await call(e, "POST", "/push/subscribe", { subscription: subscription(ua), schedule: [{ key: "b", at: iso(Date.now() - 5000), title: "B" }] });
  pushService(410);
  await worker.scheduled({ scheduledTime: minute + 180000 }, e);
  assert.deepEqual([...e.PUSH.data.keys()].filter((k) => k !== "index"), []);
  assert.deepEqual(JSON.parse(e.PUSH.data.get("index")), []);
});

test("the hourly run rebuilds the index from a paginated list", async () => {
  const e = env();
  const subs = [1, 2, 3, 4, 5].map((n) => ({ ua: browserKeys(), n }));
  for (const { ua, n } of subs) await call(e, "POST", "/push/subscribe", { subscription: subscription(ua, n), schedule: [{ key: `k${n}`, at: iso(Date.now() - 5000), title: `T${n}` }] });
  e.PUSH.data.set("index", JSON.stringify([]));
  const sent = pushService(201);
  await worker.scheduled({ scheduledTime: Date.UTC(2026, 9, 9, 12, 7) }, e);
  assert.equal(sent.length, 0, "the index is the source between reconciles");
  await worker.scheduled({ scheduledTime: Date.UTC(2026, 9, 9, 13, 0) }, e);
  assert.equal(sent.length, 5);
  assert.equal(JSON.parse(e.PUSH.data.get("index")).length, 5);
  assert.equal(e.PUSH.ops.list, 3);
});

test("the test route pushes to a stored subscriber", async () => {
  const e = env();
  const ua = browserKeys();
  const sub = subscription(ua);
  assert.equal((await call(e, "POST", "/push/test", { endpoint: sub.endpoint })).status, 404);
  await call(e, "POST", "/push/subscribe", { subscription: sub, schedule: [] });
  const sent = pushService(201);
  const res = await call(e, "POST", "/push/test", { endpoint: sub.endpoint });
  assert.deepEqual(await res.json(), { ok: true });
  const payload = JSON.parse(decrypt(new Uint8Array(sent[0].init.body), ua.privateKey, ua.p256dh, ua.auth).text);
  assert.equal(payload.title, "Aion 2 Armory: push works");
  pushService(410);
  assert.equal((await call(e, "POST", "/push/test", { endpoint: sub.endpoint })).status, 410);
});
