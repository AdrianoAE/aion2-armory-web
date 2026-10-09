// Alert rules as pure functions over plain data (settings, feeds, the
// checklist), so Node tests cover them without a browser.

import { ODYLE_MAX, ODYLE_PER_TICK, SHOP_SPECIAL_TASK, durationText, isTaskDone, nextOdyleTick, nextReset, odyleEnergy } from "../../engine/planner.js";
import { occurrences } from "../../engine/timers.js";
import { bossStatuses } from "../../engine/fieldboss.js";

const MINUTE = 60000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const ODYLE_TICK_MS = 3 * HOUR;

export const GRACE_MS = 10 * MINUTE;
export const FIRED_TTL_MS = 2 * DAY;
export const SNOOZE_MS = 15 * MINUTE;
export const HORIZON_MS = DAY;
export const BOSS_TOLERANCE_MS = 15 * MINUTE;
export const REPEATS = [["none", "Once"], ["daily", "Daily"], ["weekly", "Weekly"]];

export const ALERT_DEFAULTS = {
  enabled: true,
  sound: "chime",
  customSoundUrl: "",
  leadMinutes: 5,
  browser: false,
  browserAlways: false,
  timers: false,
  timerEvents: [],
  trackedBosses: true,
  customEvents: [],
  odyle: { enabled: true, percent: 90 },
  weekly: { enabled: true, hoursBefore: 12 },
};

export const SOURCE_STYLE = {
  timer: { accent: "--warn", route: "timers", label: "Event" },
  boss: { accent: "--elyos", route: "timers", label: "Field boss" },
  custom: { accent: "--accent-2", route: "settings", label: "Custom" },
  odyle: { accent: "--info", route: "checklist", label: "Odyle" },
  weekly: { accent: "--weekly", route: "checklist", label: "Weekly" },
};

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isBlank = (value) => value === "" || value === null || value === undefined;
const clampNumber = (value, lo, hi, fallback) => {
  const n = Number(value);
  return isBlank(value) || !Number.isFinite(n) ? fallback : Math.min(hi, Math.max(lo, n));
};
const ms = (date) => (date instanceof Date ? date.getTime() : Number(date));

export function normalizeCustomEvent(raw, index = 0) {
  const event = isObject(raw) ? raw : {};
  const lead = clampNumber(event.leadMinutes, 0, 1440, null);
  const at = isBlank(event.at) ? NaN : new Date(event.at).getTime();
  return {
    id: String(event.id || `ev${index + 1}`),
    name: String(event.name || "").trim() || "Custom event",
    at: Number.isNaN(at) ? null : new Date(at).toISOString(),
    repeat: REPEATS.some(([value]) => value === event.repeat) ? event.repeat : "none",
    leadMinutes: lead === null ? null : Math.round(lead),
  };
}

export function mergeAlertSettings(raw) {
  const src = isObject(raw) ? raw : {};
  const d = ALERT_DEFAULTS;
  const bool = (value, fallback) => (typeof value === "boolean" ? value : fallback);
  const odyle = isObject(src.odyle) ? src.odyle : {};
  const weekly = isObject(src.weekly) ? src.weekly : {};
  return {
    enabled: bool(src.enabled, d.enabled),
    sound: ["chime", "bell", "alarm", "custom"].includes(src.sound) ? src.sound : d.sound,
    customSoundUrl: typeof src.customSoundUrl === "string" ? src.customSoundUrl : d.customSoundUrl,
    leadMinutes: Math.round(clampNumber(src.leadMinutes, 0, 1440, d.leadMinutes)),
    browser: bool(src.browser, d.browser),
    browserAlways: bool(src.browserAlways, d.browserAlways),
    timers: bool(src.timers, d.timers),
    timerEvents: Array.isArray(src.timerEvents) ? src.timerEvents.map(String) : [],
    trackedBosses: bool(src.trackedBosses, d.trackedBosses),
    customEvents: (Array.isArray(src.customEvents) ? src.customEvents : []).map(normalizeCustomEvent),
    odyle: { enabled: bool(odyle.enabled, d.odyle.enabled), percent: Math.round(clampNumber(odyle.percent, 1, 100, d.odyle.percent)) },
    weekly: { enabled: bool(weekly.enabled, d.weekly.enabled), hoursBefore: clampNumber(weekly.hoursBefore, 0, 168, d.weekly.hoursBefore) },
  };
}

export function fireKey(source, id, at) {
  return `${source}:${id}@${ms(at)}`;
}

export function makeAlert({ source, id, title, at, leadMs = 0, fireAt = null, expiresAt, tolerance = 0, ...extra }) {
  const style = SOURCE_STYLE[source] || {};
  const atMs = ms(at);
  return {
    key: fireKey(source, id, atMs),
    group: `${source}:${id}`,
    source,
    id,
    title,
    at: new Date(atMs),
    fireAt: new Date(fireAt === null ? atMs - leadMs : ms(fireAt)),
    expiresAt: expiresAt === null ? null : new Date(expiresAt === undefined ? atMs + GRACE_MS : ms(expiresAt)),
    tolerance,
    accent: style.accent,
    route: style.route,
    ...extra,
  };
}

function addLocalDays(date, days) {
  const out = new Date(date);
  out.setDate(out.getDate() + days);
  return out;
}

// The first occurrence still inside its grace window, or null. Repeats keep
// the local wall clock, so a daily 20:00 stays 20:00 across DST changes.
export function customOccurrence(event, now, grace = GRACE_MS) {
  if (!event || !event.at) return null;
  const first = new Date(event.at);
  if (Number.isNaN(first.getTime())) return null;
  const earliest = ms(now) - grace;
  const step = event.repeat === "daily" ? 1 : event.repeat === "weekly" ? 7 : 0;
  if (first.getTime() >= earliest) return first;
  if (!step) return null;
  const skip = Math.max(0, Math.floor((earliest - first.getTime()) / (step * DAY)) - 1);
  let next = addLocalDays(first, skip * step);
  while (next.getTime() < earliest) next = addLocalDays(next, step);
  return next;
}

export function leadMsOf(event, settings) {
  const own = event && event.leadMinutes;
  return (isBlank(own) ? settings.leadMinutes : Number(own)) * MINUTE;
}

export function customAlerts(settings, now) {
  const out = [];
  for (const event of settings.customEvents) {
    const at = customOccurrence(event, now);
    if (!at) continue;
    out.push(makeAlert({ source: "custom", id: event.id, title: event.name, at, leadMs: leadMsOf(event, settings), repeat: event.repeat }));
  }
  return out;
}

export function timerAlerts(feed, region, settings, now) {
  if (!feed || !region || !Array.isArray(feed.events)) return [];
  const leadMs = settings.leadMinutes * MINUTE;
  const from = new Date(ms(now) - GRACE_MS);
  const to = new Date(ms(now) + leadMs + HORIZON_MS + HOUR);
  const only = new Set(settings.timerEvents || []);
  const out = [];
  for (const event of feed.events) {
    if (only.size && !only.has(event.id)) continue;
    const next = occurrences(event, region, from, to, now).find((o) => o.start >= from);
    if (!next) continue;
    out.push(makeAlert({ source: "timer", id: event.id, title: event.name, at: next.start, leadMs, kind: event.kind || "" }));
  }
  return out;
}

// A spawn time keeps its alert even once the feed calls the boss up, so a
// zero lead still fires; estimated spawns drift, hence the tolerance.
export function bossAlerts(bosses, bossFeed, trackedIds, settings, now) {
  if (!Array.isArray(bosses) || !bossFeed) return [];
  const tracked = new Set(trackedIds || []);
  const leadMs = settings.leadMinutes * MINUTE;
  return bossStatuses(bosses.filter((b) => tracked.has(b.id)), bossFeed, now)
    .filter((s) => s.known && s.nextSpawn)
    .map((s) => makeAlert({
      source: "boss",
      id: s.boss.id,
      title: s.boss.name,
      at: s.nextSpawn,
      leadMs,
      tolerance: BOSS_TOLERANCE_MS,
      zone: s.boss.zone || "",
      estimated: s.estimated,
      accent: s.boss.faction === "asmo" ? "--asmos" : "--elyos",
    }));
}

// When the energy first reaches `target`; `since` when it already has.
export function odyleReachAt(value, since, target) {
  const start = new Date(since);
  if (Number(value) >= target) return start;
  if (target > ODYLE_MAX) return null;
  const ticks = Math.ceil((target - Number(value)) / ODYLE_PER_TICK);
  return new Date(nextOdyleTick(start).getTime() + (ticks - 1) * ODYLE_TICK_MS);
}

export function odyleTarget(percent) {
  return Math.min(ODYLE_MAX, Math.ceil((ODYLE_MAX * percent) / 100));
}

export function odyleAlerts(characters, odyleMap, settings) {
  const target = odyleTarget(settings.odyle.percent);
  const out = [];
  for (const character of characters || []) {
    const entry = (odyleMap || {})[character.id];
    if (!entry || isBlank(entry.since)) continue;
    const value = Number(entry.value) || 0;
    const at = odyleReachAt(value, entry.since, target);
    if (!at || Number.isNaN(at.getTime())) continue;
    out.push(makeAlert({
      source: "odyle",
      id: character.id,
      title: `${character.name} Odyle`,
      at,
      expiresAt: null,
      character: character.name,
      value,
      since: new Date(entry.since),
      target,
      capAt: odyleReachAt(value, entry.since, ODYLE_MAX),
    }));
  }
  return out;
}

// scopes: [{ scope: "server" | "character", id, name }]
export function shopSpecialPending(planner, scopes, now) {
  const names = [];
  for (const { scope, id, name } of scopes || []) {
    const task = ((planner.tasks || {})[scope] || []).find((t) => t.name === SHOP_SPECIAL_TASK);
    if (task && !isTaskDone(planner, id, task, now)) names.push(name);
  }
  return names;
}

export function weeklyAlert(planner, scopes, settings, now) {
  if (!planner) return null;
  const reset = nextReset("weekly", now);
  const pending = shopSpecialPending(planner, scopes, now);
  if (!pending.length) return null;
  return makeAlert({
    source: "weekly",
    id: "shop-special",
    title: "Weekly reset",
    at: reset,
    fireAt: reset.getTime() - settings.weekly.hoursBefore * HOUR,
    expiresAt: reset,
    pending,
  });
}

export function collectAlerts({ settings, now, schedule = null, region = null, bosses = null, bossFeed = null, tracked = [], planner = null, characters = [], scopes = [] }) {
  if (!settings.enabled) return [];
  const out = [];
  if (settings.timers) out.push(...timerAlerts(schedule, region, settings, now));
  if (settings.trackedBosses) out.push(...bossAlerts(bosses, bossFeed, tracked, settings, now));
  out.push(...customAlerts(settings, now));
  if (settings.odyle.enabled && planner) out.push(...odyleAlerts(characters, planner.odyle, settings));
  if (settings.weekly.enabled) {
    const weekly = weeklyAlert(planner, scopes, settings, now);
    if (weekly) out.push(weekly);
  }
  return out;
}

const sameOccurrence = (entry, alert) => entry && entry.group === alert.group && Math.abs(entry.at - alert.at.getTime()) <= alert.tolerance;

export function isFired(fired, alert) {
  if (!fired) return false;
  if (fired[alert.key]) return true;
  return alert.tolerance > 0 && Object.values(fired).some((entry) => sameOccurrence(entry, alert));
}

export function markFired(fired, alert, now) {
  fired[alert.key] = { group: alert.group, at: alert.at.getTime(), fired: ms(now) };
  return fired;
}

export function forgetFired(fired, alert) {
  for (const [key, entry] of Object.entries(fired)) {
    if (key === alert.key || (alert.tolerance > 0 && sameOccurrence(entry, alert))) delete fired[key];
  }
  return fired;
}

export function pruneFired(fired, now, ttl = FIRED_TTL_MS) {
  for (const [key, entry] of Object.entries(fired || {})) {
    if (!entry || !(entry.fired > ms(now) - ttl)) delete fired[key];
  }
  return fired;
}

export function pruneSnoozed(snoozed, now) {
  for (const [key, until] of Object.entries(snoozed || {})) {
    if (!(until + DAY > ms(now))) delete snoozed[key];
  }
  return snoozed;
}

export function effectiveFireAt(alert, snoozed) {
  const until = (snoozed || {})[alert.key];
  return until ? Math.max(alert.fireAt.getTime(), until) : alert.fireAt.getTime();
}

export function isExpired(alert, now, snoozed) {
  if (alert.expiresAt === null) return false;
  const until = (snoozed || {})[alert.key];
  return ms(now) >= Math.max(alert.expiresAt.getTime(), until ? until + GRACE_MS : 0);
}

export function dueAlerts(alerts, now, fired = {}, snoozed = {}) {
  return alerts.filter((a) => effectiveFireAt(a, snoozed) <= ms(now) && !isExpired(a, now, snoozed) && !isFired(fired, a));
}

export function upcomingList(alerts, now, fired = {}, snoozed = {}, horizon = HORIZON_MS) {
  const t = ms(now);
  return alerts
    .filter((a) => !isExpired(a, now, snoozed) && effectiveFireAt(a, snoozed) <= t + horizon)
    .map((a) => {
      const fireAt = effectiveFireAt(a, snoozed);
      const status = fireAt > t ? (snoozed[a.key] ? "snoozed" : "pending") : isFired(fired, a) ? "fired" : "due";
      return { ...a, status, snoozedUntil: snoozed[a.key] ? new Date(snoozed[a.key]) : null };
    })
    .sort((a, b) => a.at - b.at || a.title.localeCompare(b.title));
}

export function relativeText(at, now) {
  const delta = ms(at) - ms(now);
  if (Math.abs(delta) < 30000) return "now";
  return delta > 0 ? `in ${durationText(delta)}` : `${durationText(-delta)} ago`;
}

function clock(date) {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

export function alertText(alert, now) {
  const when = relativeText(alert.at, now);
  const future = when !== "now" && alert.at.getTime() > ms(now);
  const past = when !== "now" && !future;
  switch (alert.source) {
    case "timer":
      return { title: alert.title, body: future ? `Starts ${when} · ${clock(alert.at)}` : past ? `Started ${when}` : "Starting now" };
    case "boss":
      return { title: alert.title, body: `${future ? `Spawns ${when}` : past ? `Spawned ${when}` : "Spawning now"}${alert.zone ? ` · ${alert.zone}` : ""}${alert.estimated ? " (est.)" : ""}` };
    case "custom":
      return { title: alert.title, body: future ? `Starts ${when} · ${clock(alert.at)}` : past ? `Started ${when}` : `Now · ${clock(alert.at)}` };
    case "odyle": {
      const energy = odyleEnergy(alert.value, alert.since, now);
      const cap = alert.capAt && alert.capAt.getTime() > ms(now) ? ` (full ${relativeText(alert.capAt, now)})` : " (full)";
      return { title: "Odyle energy", body: `${alert.character} Odyle at ${energy}/${ODYLE_MAX} — spend it before the cap${cap}` };
    }
    case "weekly":
      return { title: alert.title, body: `Weekly resets in ${durationText(alert.at.getTime() - ms(now))} — ${SHOP_SPECIAL_TASK} not done for: ${alert.pending.join(", ")}` };
    default:
      return { title: alert.title, body: when };
  }
}

export function odyleSummary(alerts, now) {
  const parts = alerts.map((a) => `${a.character} ${odyleEnergy(a.value, a.since, now)}/${ODYLE_MAX}`);
  return { title: "Odyle energy", body: `${parts.join(", ")} — spend it before the cap` };
}
