// Web Push without libraries: RFC 8291 payload encryption (aes128gcm) and
// RFC 8292 VAPID (ES256 JWT), on crypto.subtle only. docs/relay-worker.js
// carries the same functions inline (a Worker pasted in the dashboard is one
// file); tests/webpush.test.mjs checks both copies match.

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

export { b64urlDecode, b64urlEncode, encryptPayload, pushRequest, sendPush, vapidJwt };
