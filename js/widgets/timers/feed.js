// Shared data for the timers widgets: the event schedule, the boss table,
// the per-server kill feeds (mirrored to the data branch by
// .github/workflows/feeds.yml), the shared region / server choices and one
// ticker that keeps feeds fresh and countdowns moving while any timers
// widget is on screen.

import { bp, save } from "../../state.js";
import { prefs, setPref } from "../../ui.js";
import { DEFAULT_REGION, hms } from "../../engine/timers.js";
import { DEFAULT_SERVER, SERVERS, feedAge } from "../../engine/fieldboss.js";
import { durationText } from "../../engine/planner.js";

export const FEED_BASE = "https://raw.githubusercontent.com/AdrianoAE/aion2-armory-web/data/";
const FEED_EVERY_MS = 60 * 1000;
const RETRY_MS = 20 * 1000;

const esc = (text) => String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export { esc };

let scheduleData = null;
let schedulePromise = null;
let bossList = null;
let bossPromise = null;

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.json();
}

export function loadSchedule() {
  if (!schedulePromise) {
    schedulePromise = (async () => {
      let data = await fetchJson("data/shugo_timers.json");
      try {
        const fresh = await fetchJson(FEED_BASE + "shugo_timers.json", { cache: "no-store" });
        if (fresh.regions && fresh.events && (fresh.updatedAt || "") >= (data.updatedAt || "")) data = fresh;
      } catch (e) { /* the bundled copy stays */ }
      scheduleData = data;
      notify();
      return data;
    })().catch((err) => { schedulePromise = null; throw err; });
  }
  return schedulePromise;
}

export function schedule() {
  return scheduleData;
}

export function loadBosses() {
  if (!bossPromise) {
    bossPromise = fetchJson("data/field_bosses.json").then((data) => {
      bossList = data.bosses || [];
      notify();
      return bossList;
    }).catch((err) => { bossPromise = null; throw err; });
  }
  return bossPromise;
}

export function bosses() {
  return bossList;
}

export function bossById(id) {
  return (bossList || []).find((b) => b.id === id) || null;
}

export function regionId() {
  return prefs().timers.region || bp().timers_region || DEFAULT_REGION;
}

export function currentRegion() {
  if (!scheduleData) return null;
  return scheduleData.regions.find((r) => r.id === regionId()) || scheduleData.regions.find((r) => r.id === DEFAULT_REGION) || scheduleData.regions[0];
}

export function setRegion(id) {
  if (id && id !== prefs().timers.region) setPref("timers.region", id);
}

const SERVER_IDS = new Set(SERVERS.flatMap(([, list]) => list.map(([id]) => id)));

export function serverId() {
  const id = bp().fieldboss_server;
  return SERVER_IDS.has(id) ? id : DEFAULT_SERVER;
}

// Settings the widgets show in their popup but keep somewhere shared: the
// profile (server, Artwork filter, tracked bosses) or the timers
// preferences (region). The field default reads the shared value; a value
// picked in the popup lands in the widget's own settings first and is moved
// to its shared home here.
export const SHARED = {
  region: { get: () => regionId(), set: (v) => setRegion(v), profile: false },
  server: { get: () => serverId(), set: (v) => { bp().fieldboss_server = v; }, profile: true },
  onlyArtwork: { get: () => !!bp().fieldboss_only_artwork, set: (v) => { bp().fieldboss_only_artwork = !!v; }, profile: true },
  tracked: { get: () => [...(bp().fieldboss_tracked || [])], set: (v) => { bp().fieldboss_tracked = Array.isArray(v) ? v : []; }, profile: true },
};

export function sharedField(key, field) {
  const binding = SHARED[key];
  return Object.defineProperty({ ...field, key }, "default", { get: binding.get, enumerable: true });
}

function storedItem(areaId, widgetId) {
  const area = (prefs().areas || {})[areaId];
  return area && Array.isArray(area.items) ? area.items.find((i) => i && i.id === widgetId) : null;
}

export function adoptShared(ctx, keys) {
  const item = storedItem(ctx.areaId, ctx.widgetId);
  const overrides = (item && item.settings) || {};
  const moved = keys.filter((key) => Object.prototype.hasOwnProperty.call(overrides, key));
  if (!moved.length) return;
  let profileChanged = false;
  for (const key of moved) {
    const value = overrides[key];
    if (value === undefined) continue;
    if (JSON.stringify(value) !== JSON.stringify(SHARED[key].get())) {
      SHARED[key].set(value);
      if (SHARED[key].profile) profileChanged = true;
    }
  }
  queueMicrotask(() => {
    const area = (prefs().areas || {})[ctx.areaId];
    if (area && Array.isArray(area.items)) {
      const items = area.items.map((i) => {
        if (!i || i.id !== ctx.widgetId || !i.settings) return i;
        const settings = { ...i.settings };
        for (const key of moved) delete settings[key];
        return { ...i, settings };
      });
      setPref(`areas.${ctx.areaId}`, { ...area, items });
    }
    if (profileChanged) save();
    ctx.refresh();
  });
}

const feeds = new Map();

export function feedState(server) {
  if (!feeds.has(server)) feeds.set(server, { data: null, mirroredAt: null, fetchedAt: 0, failedAt: 0, error: null, pending: null });
  return feeds.get(server);
}

export function bossFeed(server) {
  return feedState(server).data;
}

export function fetchFeed(server, { force = false } = {}) {
  const state = feedState(server);
  if (state.pending) return state.pending;
  const minute = Math.floor(Date.now() / (force ? 1000 : 60000));
  state.pending = fetchJson(`${FEED_BASE}feeds/${server}.json?m=${minute}`, { cache: "no-store" })
    .then((data) => {
      if (!data || !data.ok) throw new Error("the feed reported an error");
      const before = state.mirroredAt && state.mirroredAt.getTime();
      state.data = data;
      state.mirroredAt = new Date((data.mirroredAt || data.now) * 1000);
      state.error = null;
      state.fetchedAt = Date.now();
      return before !== state.mirroredAt.getTime() || !!state.failedAt;
    })
    .catch((err) => {
      const first = !state.error;
      state.error = err && err.message ? err.message : String(err);
      state.failedAt = Date.now();
      state.fetchedAt = Date.now();
      return first;
    })
    .then((changed) => {
      if (state.error === null) state.failedAt = 0;
      state.pending = null;
      if (changed || force) notify();
      return state;
    });
  return state.pending;
}

export function feedStatus(server, now) {
  const state = feedState(server);
  return { state, age: feedAge(state.mirroredAt, now), loading: !!state.pending && !state.data, failed: !!state.error };
}

const watchers = new Map();
let ticker = null;
let ticks = 0;

function notify() {
  const refreshers = new Map();
  for (const w of watchers.values()) if (!refreshers.has(w.areaId)) refreshers.set(w.areaId, w.refresh);
  for (const refresh of refreshers.values()) {
    try { refresh(); } catch (err) { console.error(err); }
  }
}

function wantedServers() {
  return new Set([...watchers.values()].filter((w) => w.feed).map(() => serverId()));
}

function pollFeeds() {
  const now = Date.now();
  for (const server of wantedServers()) {
    const state = feedState(server);
    const wait = state.error ? RETRY_MS : FEED_EVERY_MS;
    if (!state.pending && now - state.fetchedAt >= wait) fetchFeed(server);
  }
}

const FORMATS = {
  hms: (ms) => hms(ms),
  dur: (ms) => durationText(ms),
};

export function updateCountdowns(root = document) {
  const now = Date.now();
  for (const el of root.querySelectorAll("[data-tm-until]")) {
    const left = Number(el.dataset.tmUntil) - now;
    const text = left <= 0 && el.dataset.tmDone ? el.dataset.tmDone : `${el.dataset.tmPre || ""}${(FORMATS[el.dataset.tmFormat] || FORMATS.hms)(left)}${el.dataset.tmPost || ""}`;
    if (el.textContent !== text) el.textContent = text;
  }
}

function tick() {
  if (!watchers.size) { clearInterval(ticker); ticker = null; return; }
  updateCountdowns();
  ticks += 1;
  if (ticks % 5 === 0) pollFeeds();
}

// Called from every timers widget render; the returned function goes in the
// widget's cleanup.
export function watch(ctx, { feed = false } = {}) {
  const key = Symbol(ctx.widgetId);
  watchers.set(key, { areaId: ctx.areaId, refresh: ctx.refresh, feed });
  if (!ticker) ticker = setInterval(tick, 1000);
  loadSchedule().catch((err) => console.error(err));
  loadBosses().catch((err) => console.error(err));
  if (feed) {
    const state = feedState(serverId());
    if (!state.pending && !state.fetchedAt) fetchFeed(serverId());
  }
  return () => watchers.delete(key);
}

export function until(date, { format = "hms", pre = "", post = "", done = "" } = {}) {
  const at = date instanceof Date ? date.getTime() : Number(date);
  const left = at - Date.now();
  const text = left <= 0 && done ? done : `${pre}${(FORMATS[format] || FORMATS.hms)(left)}${post}`;
  return `<span class="tm-until" data-tm-until="${at}" data-tm-format="${format}"${pre ? ` data-tm-pre="${esc(pre)}"` : ""}${post ? ` data-tm-post="${esc(post)}"` : ""}${done ? ` data-tm-done="${esc(done)}"` : ""}>${esc(text)}</span>`;
}

export const KINDS = {
  pvp: { label: "PvP", accent: "--portals" },
  event: { label: "Event", accent: "--success" },
  abyss: { label: "Abyss", accent: "--secondary" },
  boss: { label: "Boss", accent: "--danger" },
  reset: { label: "Reset", accent: "--warn" },
  milestone: { label: "Milestone", accent: "--info" },
};

export function kindOf(event) {
  return KINDS[event.kind] || { label: String(event.kind || "Event"), accent: "--accent" };
}

export function regionOptions() {
  return loadSchedule().then((data) => data.regions.map((r) => [r.id, r.label]));
}

export function openSettings(el) {
  const host = el.closest(".wa-card, .wa-pin");
  const gear = host && host.querySelector('.wa-tools [data-act="settings"]');
  if (gear) gear.click();
}
