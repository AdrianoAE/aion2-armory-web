// Push notifications while the site is closed: the browser subscribes with the
// relay Worker's VAPID key, this module uploads the next 24 h of alerts, and the
// Worker's cron pushes each one at its minute; sw.js shows it.

import { prefs, setPref } from "./ui.js";
import { DEFAULT_RELAY } from "./engine/official.js";
import { GRACE_MS, alertText } from "./widgets/alerts/core.js";
import { alertSettings, onAlerts, sourcesLoaded, upcomingAlerts } from "./notify.js";

const MINUTE = 60000;
const HORIZON_MS = 24 * 60 * MINUTE;
const MAX_ENTRIES = 200;
const SYNC_DEBOUNCE_MS = 2000;
const SYNC_EVERY_MS = 15 * MINUTE;
const NEAR_MS = 3 * 60 * MINUTE;
const RESEND_CHANGED_MS = 60 * MINUTE;
const RESEND_SAME_MS = 6 * 60 * MINUTE;
const SYNC_KEY = "aion2-armory-push-sync";

export const NO_PUSH_RELAY = "The relay set under Official site has no push routes: push notifications need the Armory relay Worker (docs/relay-worker.js).";

export class PushError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const statusListeners = new Set();

export function onPushStatus(fn) {
  statusListeners.add(fn);
  return () => statusListeners.delete(fn);
}

function statusChanged() {
  for (const fn of [...statusListeners]) {
    try { fn(); } catch (err) { console.error(err); }
  }
}

export function pushSupported() {
  return typeof window !== "undefined" && window.isSecureContext !== false && "serviceWorker" in navigator
    && "PushManager" in window && typeof Notification !== "undefined";
}

export function pushSettings() {
  const state = (prefs().alerts || {}).push;
  return state && typeof state === "object" ? state : { enabled: false };
}

export function relayOrigin(relay = (prefs().official || {}).relay) {
  try {
    const url = new URL(String(relay || "").trim() || DEFAULT_RELAY);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch (e) { return null; }
}

function readSync() {
  try {
    const value = JSON.parse(localStorage.getItem(SYNC_KEY) || "{}");
    return value && typeof value === "object" ? value : {};
  } catch (e) { return {}; }
}

function writeSync(value) {
  try { localStorage.setItem(SYNC_KEY, JSON.stringify(value)); } catch (e) { /* storage blocked: the next sync uploads again */ }
  statusChanged();
}

function b64urlBytes(text) {
  const b64 = String(text).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0));
}

function sameKey(buffer, publicKey) {
  if (!buffer) return false;
  const a = new Uint8Array(buffer);
  const b = b64urlBytes(publicKey);
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

const keyCache = new Map();

async function relayKey(origin) {
  if (!keyCache.has(origin)) {
    const lookup = (async () => {
      let response;
      try { response = await fetch(`${origin}/push/key`, { cache: "no-store" }); } catch (e) { throw new PushError("unreachable", "The relay did not answer."); }
      const data = response.ok ? await response.json().catch(() => null) : null;
      if (!data || typeof data.publicKey !== "string") throw new PushError("missing", NO_PUSH_RELAY);
      return data.publicKey;
    })();
    keyCache.set(origin, lookup);
    lookup.catch(() => keyCache.delete(origin));
  }
  return keyCache.get(origin);
}

async function relayCall(origin, method, path, body) {
  const response = await fetch(origin + path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new PushError(response.status === 404 ? "unknown" : "relay", data.error || `The relay answered ${response.status}.`);
  return data;
}

async function currentSubscription() {
  if (!pushSupported()) return null;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    return registration ? await registration.pushManager.getSubscription() : null;
  } catch (e) { return null; }
}

// upcomingAlerts(now) holds only the next occurrence of each event, so the
// day is sampled again just after each occurrence's grace window ends.
export function buildSchedule(now = new Date(), horizon = HORIZON_MS) {
  if (!alertSettings().enabled) return [];
  const start = now.getTime();
  const end = start + horizon;
  const base = location.origin + location.pathname;
  const entries = new Map();
  for (let t = start, guard = 0; t < end && guard < 500; guard += 1) {
    let next = Infinity;
    for (const alert of upcomingAlerts(new Date(t))) {
      const after = alert.at.getTime() + GRACE_MS + 1000;
      if (after > t && after < next) next = after;
      const fireAt = Math.max(alert.fireAt.getTime(), alert.snoozedUntil ? alert.snoozedUntil.getTime() : 0);
      if (fireAt <= start || fireAt > end || entries.has(alert.key)) continue;
      const text = alertText(alert, new Date(fireAt));
      entries.set(alert.key, { key: alert.key, at: new Date(fireAt).toISOString(), title: text.title, body: text.body, url: `${base}#${alert.route || ""}` });
    }
    t = next;
  }
  return [...entries.values()].sort((a, b) => a.at.localeCompare(b.at) || a.key.localeCompare(b.key)).slice(0, MAX_ENTRIES);
}

const signature = (entry) => `${entry.at}|${entry.title}|${entry.body}|${entry.url}`;

const sameEntries = (entries, schedule) => schedule.length === Object.keys(entries).length && schedule.every((e) => entries[e.key] === signature(e));

function nearChanged(entries, near, now) {
  const fresh = Object.fromEntries(near.map((e) => [e.key, signature(e)]));
  const isNear = (sig) => { const at = Date.parse(sig.split("|", 1)[0]); return at > now && at <= now + NEAR_MS; };
  return near.some((e) => entries[e.key] !== fresh[e.key]) || Object.entries(entries).some(([k, v]) => isNear(v) && fresh[k] !== v);
}

async function upload(force) {
  const state = pushSettings();
  if (!state.enabled || !state.relay) return { ok: false, skipped: "off" };
  if (alertSettings().enabled && !sourcesLoaded()) return { ok: false, skipped: "loading" };
  const subscription = await currentSubscription();
  if (!subscription) {
    writeSync({ ...readSync(), error: "The browser dropped the push subscription; turn push notifications off and on again.", errorAt: Date.now() });
    return { ok: false, error: "no subscription" };
  }
  if (subscription.endpoint !== state.endpoint) {
    if (state.endpoint) relayCall(state.relay, "DELETE", "/push/subscribe", { endpoint: state.endpoint }).catch(() => {});
    setPref("alerts.push", { ...state, endpoint: subscription.endpoint });
  }
  const now = Date.now();
  const last = readSync();
  const age = now - (last.at || 0);
  const current = !force && !last.error && last.entries && last.endpoint === subscription.endpoint;
  // Every upload is a KV write (the free plan allows 1,000 a day) and a full
  // day costs ~100 ms to build, so between hourly uploads only the next few
  // hours are checked for changes.
  if (current && age < RESEND_CHANGED_MS && !nearChanged(last.entries, buildSchedule(new Date(now), NEAR_MS), now)) {
    return { ok: true, unchanged: true, count: last.count };
  }
  const schedule = buildSchedule(new Date(now));
  if (current && age < RESEND_SAME_MS && sameEntries(last.entries, schedule)) return { ok: true, unchanged: true, count: schedule.length };
  try {
    const data = await relayCall(state.relay, "POST", "/push/subscribe", { subscription: subscription.toJSON(), schedule });
    const count = typeof data.count === "number" ? data.count : schedule.length;
    writeSync({ at: now, endpoint: subscription.endpoint, count, entries: Object.fromEntries(schedule.map((e) => [e.key, signature(e)])) });
    return { ok: true, count };
  } catch (err) {
    writeSync({ ...last, error: err.message, errorAt: now });
    return { ok: false, error: err.message };
  }
}

let timer = null;
let waiting = [];
let forceNext = false;
let chain = Promise.resolve();

export function syncSchedule({ immediate = false, force = false } = {}) {
  return new Promise((resolve) => {
    waiting.push(resolve);
    forceNext = forceNext || force;
    clearTimeout(timer);
    timer = setTimeout(() => {
      const resolvers = waiting;
      const forced = forceNext;
      waiting = [];
      forceNext = false;
      chain = chain.then(() => upload(forced)).catch((err) => ({ ok: false, error: err.message }))
        .then((result) => { resolvers.forEach((done) => done(result)); return result; });
    }, immediate ? 0 : SYNC_DEBOUNCE_MS);
  });
}

export async function enablePush() {
  if (!pushSupported()) throw new PushError("unsupported", "This browser cannot receive push notifications.");
  const origin = relayOrigin();
  if (!origin) throw new PushError("missing", NO_PUSH_RELAY);
  const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  if (permission !== "granted") {
    throw new PushError("denied", permission === "denied" ? "Notifications are blocked for this site; allow them in the browser's site settings." : "Notifications were not allowed.");
  }
  const publicKey = await relayKey(origin);
  await navigator.serviceWorker.register(new URL("sw.js", document.baseURI));
  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (subscription && !sameKey(subscription.options && subscription.options.applicationServerKey, publicKey)) {
    await subscription.unsubscribe().catch(() => {});
    subscription = null;
  }
  if (!subscription) subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlBytes(publicKey) });
  setPref("alerts.push", { enabled: true, endpoint: subscription.endpoint, relay: origin });
  const result = await syncSchedule({ immediate: true, force: true });
  statusChanged();
  if (!result.ok && result.error) throw new PushError("relay", result.error);
  return result;
}

export async function disablePush() {
  const state = pushSettings();
  const subscription = await currentSubscription();
  const endpoint = (subscription && subscription.endpoint) || state.endpoint;
  const origin = state.relay || relayOrigin();
  if (endpoint && origin) await relayCall(origin, "DELETE", "/push/subscribe", { endpoint }).catch(() => {});
  if (subscription) await subscription.unsubscribe().catch(() => {});
  setPref("alerts.push", { enabled: false });
  try { localStorage.removeItem(SYNC_KEY); } catch (e) { /* nothing stored */ }
  statusChanged();
}

export async function sendTestPush() {
  const state = pushSettings();
  if (!state.enabled || !state.endpoint || !state.relay) throw new PushError("off", "Turn push notifications on first.");
  try {
    await relayCall(state.relay, "POST", "/push/test", { endpoint: state.endpoint });
  } catch (err) {
    if (err.code !== "unknown") throw err;
    await syncSchedule({ immediate: true, force: true });
    await relayCall(state.relay, "POST", "/push/test", { endpoint: pushSettings().endpoint });
  }
  return true;
}

export async function pushStatus() {
  const state = pushSettings();
  const supported = pushSupported();
  const origin = state.enabled && state.relay ? state.relay : relayOrigin();
  const status = {
    supported,
    permission: typeof Notification === "undefined" ? "unsupported" : Notification.permission,
    enabled: Boolean(state.enabled),
    subscribed: Boolean(await currentSubscription()),
    endpoint: state.endpoint || null,
    relay: origin,
    relayChanged: Boolean(state.enabled && state.relay && state.relay !== relayOrigin()),
    relayPush: "missing",
    lastSync: readSync(),
  };
  if (origin) {
    try { await relayKey(origin); status.relayPush = "ok"; } catch (err) { status.relayPush = err.code === "missing" ? "missing" : "unreachable"; }
  }
  return status;
}

function openFromWorker(event) {
  if (!event.data || event.data.type !== "armory-open") return;
  try {
    const url = new URL(event.data.url);
    if (url.hash) location.hash = url.hash;
  } catch (e) { /* not a URL: stay on the current page */ }
}

// notify.js imports this module and this one imports notify.js, so nothing
// here may call into notify.js before both have finished loading.
function start() {
  if (pushSupported()) {
    navigator.serviceWorker.addEventListener("message", openFromWorker);
    try { navigator.serviceWorker.startMessages(); } catch (e) { /* older browsers start the queue themselves */ }
  }
  onAlerts(() => { if (pushSettings().enabled) syncSchedule(); });
  setInterval(() => { if (pushSettings().enabled) syncSchedule(); }, SYNC_EVERY_MS);
  if (pushSettings().enabled) syncSchedule();
}

if (typeof window !== "undefined") setTimeout(start, 0);
