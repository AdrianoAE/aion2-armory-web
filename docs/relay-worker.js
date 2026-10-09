// Aion 2 Armory relay: a Cloudflare Worker (free tier) that lets the Armory
// read aion2.plaync.com's character pages, which send no CORS headers.
// Deploy it (see "Official import" in docs/ARCHITECTURE.md), then set
// https://<name>.<account>.workers.dev/?url= as the relay in Settings.
//
// Only the character API and the character search are forwarded; anything
// else gets 403, so the worker cannot be used as an open proxy.
//
// Push notifications (/push/*) are optional: they need a KV namespace bound
// as PUSH, a cron trigger "* * * * *" and the secrets VAPID_PUBLIC_KEY,
// VAPID_PRIVATE_KEY and VAPID_SUBJECT. Without them /push/* answers 501.

const ALLOWED = [
  "https://aion2.plaync.com/api/character/",
  "https://aion2.plaync.com/api/gameconst/item",
  "https://aion2.plaync.com/en-us/api/gameconst/item",
  "https://api-search.plaync.com/aion2global/search/",
];

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Referer": "https://aion2.plaync.com/en-us/characters/index",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Max-Age": "86400",
};

function reply(body, status, extra = {}) {
  return new Response(body, { status, headers: { ...CORS, "Content-Type": "application/json; charset=utf-8", ...extra } });
}

// Web Push, kept identical to docs/webpush.js (tests/webpush.test.mjs checks).

const enc = new TextEncoder();

function b64urlEncode(bytes) {
  let text = "";
  for (const byte of new Uint8Array(bytes)) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(text) {
  const b64 = String(text).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function concatBytes(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8));
}

function p256Jwk(publicRaw, privateRaw) {
  const jwk = { kty: "EC", crv: "P-256", x: b64urlEncode(publicRaw.slice(1, 33)), y: b64urlEncode(publicRaw.slice(33, 65)), ext: true };
  if (privateRaw) jwk.d = b64urlEncode(privateRaw);
  return jwk;
}

async function importEcdhPrivate(publicB64, privateB64) {
  return crypto.subtle.importKey("jwk", p256Jwk(b64urlDecode(publicB64), b64urlDecode(privateB64)), { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
}

// `local` and `salt` are for the RFC 8291 test vector; a real send uses a
// fresh key pair and salt per message.
async function encryptPayload(plaintext, subscriptionKeys, { local = null, salt = null } = {}) {
  const uaPublic = b64urlDecode(subscriptionKeys.p256dh);
  const authSecret = b64urlDecode(subscriptionKeys.auth);
  let asPrivate, asPublic;
  if (local) {
    asPrivate = await importEcdhPrivate(local.publicKey, local.privateKey);
    asPublic = b64urlDecode(local.publicKey);
  } else {
    const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
    asPrivate = pair.privateKey;
    asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  }
  const saltBytes = salt ? b64urlDecode(salt) : crypto.getRandomValues(new Uint8Array(16));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, asPrivate, 256));
  const ikm = await hkdf(authSecret, ecdhSecret, concatBytes(enc.encode("WebPush: info\0"), uaPublic, asPublic), 32);
  const cek = await hkdf(saltBytes, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(saltBytes, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const body = typeof plaintext === "string" ? enc.encode(plaintext) : new Uint8Array(plaintext);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, concatBytes(body, new Uint8Array([2]))));
  const header = new Uint8Array(21);
  header.set(saltBytes, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  return concatBytes(header, asPublic, cipher);
}

async function vapidJwt(audience, subject, publicB64, privateB64, now = Date.now()) {
  const key = await crypto.subtle.importKey("jwk", p256Jwk(b64urlDecode(publicB64), b64urlDecode(privateB64)), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const header = b64urlEncode(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64urlEncode(enc.encode(JSON.stringify({ aud: audience, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })));
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${header}.${claims}`));
  return `${header}.${claims}.${b64urlEncode(signature)}`;
}

async function pushRequest(subscription, payload, vapid, { ttl = 3600, urgency = "high" } = {}) {
  const endpoint = new URL(subscription.endpoint);
  const jwt = await vapidJwt(endpoint.origin, vapid.subject, vapid.publicKey, vapid.privateKey);
  return {
    url: endpoint.href,
    method: "POST",
    headers: {
      "Authorization": `vapid t=${jwt}, k=${vapid.publicKey}`,
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      "TTL": String(ttl),
      "Urgency": urgency,
    },
    body: await encryptPayload(JSON.stringify(payload), subscription.keys),
  };
}

async function sendPush(subscription, payload, vapid) {
  const request = await pushRequest(subscription, payload, vapid);
  return fetch(request.url, { method: request.method, headers: request.headers, body: request.body });
}

// Chrome (FCM), Edge (WNS), Firefox and Safari push services; any other
// endpoint is refused so the Worker cannot be made to POST to arbitrary URLs.
const PUSH_HOSTS = [".googleapis.com", ".mozilla.com", ".notify.windows.com", ".push.apple.com"];
const SEND_WINDOW_MS = 2 * 60000;
const SENT_TTL_MS = 2 * 86400000;
const MAX_AHEAD_MS = 7 * 86400000;
const MAX_SCHEDULE = 200;
const MAX_BODY_BYTES = 128 * 1024;
const SUBSCRIBER_TTL_S = 30 * 86400;
// The cron reads this one key instead of listing sub:* every minute: the free
// plan allows 1,000 KV lists a day and the cron runs 1,440 times.
const INDEX_KEY = "index";
const PUSH_ROUTES = new Set(["GET /push/key", "POST /push/subscribe", "DELETE /push/subscribe", "POST /push/test"]);

const json = (data, status = 200) => reply(JSON.stringify(data), status);
const clip = (value, max) => String(value ?? "").slice(0, max);
const gone = (response) => response.status === 404 || response.status === 410;

function pushConfigured(env) {
  return Boolean(env.PUSH && env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
}

function vapidOf(env) {
  return { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT || "mailto:armory@example.com" };
}

async function subscriberId(endpoint) {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(endpoint));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function pushEndpoint(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && PUSH_HOSTS.some((suffix) => url.hostname.endsWith(suffix)) ? url.href : null;
  } catch (e) { return null; }
}

function cleanSubscription(raw) {
  const endpoint = raw && pushEndpoint(raw.endpoint);
  const keys = raw && raw.keys;
  if (!endpoint || !keys || typeof keys.p256dh !== "string" || typeof keys.auth !== "string") return null;
  try {
    if (b64urlDecode(keys.p256dh).length !== 65 || b64urlDecode(keys.auth).length !== 16) return null;
  } catch (e) { return null; }
  return { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}

function cleanUrl(value) {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && url.href.length <= 500 ? url.href : "";
  } catch (e) { return ""; }
}

function cleanSchedule(raw, now) {
  const byKey = new Map();
  for (const entry of Array.isArray(raw) ? raw : []) {
    if (!entry || typeof entry !== "object") continue;
    const at = Date.parse(entry.at);
    const key = clip(entry.key, 200);
    if (!key || !Number.isFinite(at) || at < now - SEND_WINDOW_MS || at > now + MAX_AHEAD_MS) continue;
    byKey.set(key, { key, at: new Date(at).toISOString(), title: clip(entry.title, 120) || "Aion 2 Armory", body: clip(entry.body, 300), url: cleanUrl(entry.url) });
  }
  return [...byKey.values()].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).slice(0, MAX_SCHEDULE);
}

async function readJson(request) {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new Error("The request body is too large.");
  try { return JSON.parse(text || "{}"); } catch (e) { throw new Error("The request body is not JSON."); }
}

async function readIndex(env) {
  const ids = await env.PUSH.get(INDEX_KEY, "json");
  return Array.isArray(ids) ? ids : [];
}

async function addToIndex(env, id) {
  const ids = await readIndex(env);
  if (!ids.includes(id)) await env.PUSH.put(INDEX_KEY, JSON.stringify([...ids, id]));
}

async function removeSubscriber(env, id) {
  await Promise.all([env.PUSH.delete(`sub:${id}`), env.PUSH.delete(`sent:${id}`)]);
  const ids = await readIndex(env);
  if (ids.includes(id)) await env.PUSH.put(INDEX_KEY, JSON.stringify(ids.filter((x) => x !== id)));
}

async function listSubscriberIds(env) {
  const ids = [];
  let cursor;
  do {
    const page = await env.PUSH.list({ prefix: "sub:", cursor });
    ids.push(...page.keys.map((k) => k.name.slice(4)));
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return ids;
}

// Records expire a month after their last upload and two uploads can race on
// the index, so once an hour the index is rebuilt from the stored records.
async function reconcileIndex(env, ids) {
  const stored = await listSubscriberIds(env);
  if (stored.length !== ids.length || stored.some((id) => !ids.includes(id))) await env.PUSH.put(INDEX_KEY, JSON.stringify(stored));
  return stored;
}

async function subscribe(env, body, now) {
  const subscription = cleanSubscription(body.subscription);
  if (!subscription) return json({ error: "The subscription is missing or not from a known push service." }, 400);
  const schedule = cleanSchedule(body.schedule, now);
  const id = await subscriberId(subscription.endpoint);
  await env.PUSH.put(`sub:${id}`, JSON.stringify({ subscription, schedule, updatedAt: new Date(now).toISOString() }), { expirationTtl: SUBSCRIBER_TTL_S });
  await addToIndex(env, id);
  return json({ ok: true, count: schedule.length });
}

async function unsubscribe(env, body) {
  const endpoint = pushEndpoint(body.endpoint);
  if (!endpoint) return json({ error: "Add the subscription endpoint." }, 400);
  await removeSubscriber(env, await subscriberId(endpoint));
  return json({ ok: true });
}

async function sendTest(env, body) {
  const endpoint = pushEndpoint(body.endpoint);
  if (!endpoint) return json({ error: "Add the subscription endpoint." }, 400);
  const id = await subscriberId(endpoint);
  const record = await env.PUSH.get(`sub:${id}`, "json");
  if (!record) return json({ error: "This browser is not subscribed on the relay; turn push off and on again." }, 404);
  let response;
  try {
    response = await sendPush(record.subscription, { title: "Aion 2 Armory: push works", body: "Alerts arrive like this even with the Armory closed.", url: "", tag: "armory-push-test" }, vapidOf(env));
  } catch (err) {
    return json({ error: `The push service did not answer: ${err.message}` }, 502);
  }
  if (gone(response)) {
    await removeSubscriber(env, id);
    return json({ error: "The push service no longer knows this browser; turn push off and on again." }, 410);
  }
  if (!response.ok) return json({ error: `The push service answered ${response.status}.` }, 502);
  return json({ ok: true });
}

async function handlePush(request, env, path) {
  const route = `${request.method} ${path}`;
  if (!PUSH_ROUTES.has(route)) return json({ error: "Unknown push route." }, 404);
  if (!pushConfigured(env)) return json({ error: "Push is not set up on this relay." }, 501);
  if (route === "GET /push/key") return json({ publicKey: env.VAPID_PUBLIC_KEY });
  let body;
  try { body = await readJson(request); } catch (err) { return json({ error: err.message }, 400); }
  if (!body || typeof body !== "object") return json({ error: "The request body is not an object." }, 400);
  if (route === "POST /push/subscribe") return subscribe(env, body, Date.now());
  if (route === "DELETE /push/subscribe") return unsubscribe(env, body);
  return sendTest(env, body);
}

function pruneSent(sent, now) {
  for (const [key, at] of Object.entries(sent)) if (!(at > now - SENT_TTL_MS)) delete sent[key];
  return sent;
}

async function deliver(env, id, now, vapid) {
  const record = await env.PUSH.get(`sub:${id}`, "json");
  if (!record || !Array.isArray(record.schedule)) return 0;
  const due = record.schedule.filter((entry) => {
    const at = Date.parse(entry.at);
    return at <= now && at > now - SEND_WINDOW_MS;
  });
  if (!due.length) return 0;
  // Separate from sub:<id> so a schedule upload never overwrites sent marks
  // and the cron never writes back a schedule older than the upload.
  const sentKey = `sent:${id}`;
  const sent = pruneSent((await env.PUSH.get(sentKey, "json")) || {}, now);
  let count = 0;
  for (const entry of due) {
    if (sent[entry.key]) continue;
    const response = await sendPush(record.subscription, { title: entry.title, body: entry.body, url: entry.url, tag: entry.key }, vapid);
    if (gone(response)) { await removeSubscriber(env, id); return count; }
    if (response.ok) { sent[entry.key] = now; count += 1; }
    else console.error(`push ${id.slice(0, 8)}: ${response.status} ${await response.text()}`);
  }
  if (count) await env.PUSH.put(sentKey, JSON.stringify(sent), { expirationTtl: SENT_TTL_MS / 1000 });
  return count;
}

async function runSchedule(env, now, reconcile) {
  let ids = await readIndex(env);
  if (reconcile) ids = await reconcileIndex(env, ids);
  const vapid = vapidOf(env);
  let sent = 0;
  for (const id of ids) {
    try { sent += await deliver(env, id, now, vapid); } catch (err) { console.error(`push ${id.slice(0, 8)}: ${err.message}`); }
  }
  return sent;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    const path = new URL(request.url).pathname;
    if (path.startsWith("/push/")) return handlePush(request, env || {}, path);
    if (request.method !== "GET") return reply(JSON.stringify({ error: "Only GET is relayed." }), 405);

    const target = new URL(request.url).searchParams.get("url");
    if (!target) return reply(JSON.stringify({ error: "Add ?url=<encoded aion2.plaync.com API URL>." }), 400);
    let url;
    try { url = new URL(target); } catch (e) { return reply(JSON.stringify({ error: "The url parameter is not a URL." }), 400); }
    if (!ALLOWED.some((prefix) => url.href.startsWith(prefix))) return reply(JSON.stringify({ error: "Only the Aion 2 character API is relayed." }), 403);

    let upstream;
    try {
      upstream = await fetch(url.href, { headers: BROWSER_HEADERS, cf: { cacheTtl: 0 } });
    } catch (err) {
      return reply(JSON.stringify({ error: `aion2.plaync.com did not answer: ${err.message}` }), 502);
    }
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        ...CORS,
        "Content-Type": upstream.headers.get("Content-Type") || "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  },

  async scheduled(controller, env) {
    if (!pushConfigured(env)) return;
    await runSchedule(env, Date.now(), new Date(controller.scheduledTime).getUTCMinutes() === 0);
  },
};
