// Alerts: timed events, tracked bosses, custom events, Odyle and the weekly
// shop reminder. A ticker runs while the page is open and fires each alert
// once (sound, toast, browser notification). The rules live in
// widgets/alerts/core.js; this module feeds them and does the DOM side.

import { prefs, setPref } from "./ui.js";
import { bp, characters, plannerCharacterNamed } from "./state.js";
import { DEFAULT_REGION } from "./engine/timers.js";
import { DEFAULT_SERVER } from "./engine/fieldboss.js";
import {
  ALERT_DEFAULTS, SNOOZE_MS, alertText, collectAlerts, dueAlerts, forgetFired, markFired, mergeAlertSettings,
  odyleSummary, pruneFired, pruneSnoozed, upcomingList,
} from "./widgets/alerts/core.js";
import "./widgets/alerts/upcoming.js";
import "./widgets/alerts/custom.js";
import "./push.js";

export { ALERT_DEFAULTS };

const FEED_BASE = "https://raw.githubusercontent.com/AdrianoAE/aion2-armory-web/data/";
const FIRED_KEY = "aion2-armory-alerts-fired";
const SNOOZED_KEY = "aion2-armory-alerts-snoozed";
const TICK_MS = 15000;
const TOAST_MS = 20000;
const MAX_TOASTS = 5;
const SCHEDULE_TTL = 30 * 60000;
const BOSS_FEED_TTL = 60000;

export const BELL_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/></svg>`;

const sources = { schedule: null, scheduleAt: 0, bosses: null, bossFeed: null, bossServer: null, bossFeedAt: 0 };
const listeners = new Set();

export function alertSettings() {
  return mergeAlertSettings(prefs().alerts);
}

export function saveAlertSettings(patch) {
  setPref("alerts", { ...alertSettings(), ...patch, push: (prefs().alerts || {}).push });
  changed();
}

export function onAlerts(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function changed() {
  for (const fn of [...listeners]) {
    try { fn(); } catch (err) { console.error(err); }
  }
}

function readStore(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch (e) { return {}; }
}

function writeStore(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage blocked: alerts may repeat after a reload */ }
}

let audio = null;

// Browsers keep audio muted until the visitor has interacted with the page;
// creating the context earlier only logs a warning and stays suspended.
function hasUserGesture() {
  return !navigator.userActivation || navigator.userActivation.hasBeenActive;
}

function audioContext() {
  const Ctor = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
  if (!Ctor) return null;
  if (!audio) {
    if (!hasUserGesture()) return null;
    try { audio = new Ctor(); } catch (e) { return null; }
  }
  if (audio.state === "suspended") audio.resume().catch(() => {});
  return audio;
}

function tone(ctx, out, { freq, at, length, type = "sine", peak = 0.2, attack = 0.012 }) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(peak, at + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
  osc.connect(gain).connect(out);
  osc.start(at);
  osc.stop(at + length + 0.05);
}

export const SOUNDS = {
  chime: {
    label: "Chime",
    play(ctx, out, t) {
      tone(ctx, out, { freq: 659.25, at: t, length: 0.9, peak: 0.18 });
      tone(ctx, out, { freq: 987.77, at: t + 0.16, length: 1.1, peak: 0.16 });
      tone(ctx, out, { freq: 1318.5, at: t + 0.32, length: 1.3, peak: 0.08 });
    },
  },
  bell: {
    label: "Bell",
    play(ctx, out, t) {
      for (const [ratio, peak, length] of [[1, 0.2, 2.4], [2, 0.08, 1.8], [2.76, 0.07, 1.3], [5.4, 0.03, 0.7]]) {
        tone(ctx, out, { freq: 523.25 * ratio, at: t, length, peak, attack: 0.005 });
        tone(ctx, out, { freq: 523.25 * ratio, at: t + 0.9, length: length * 0.8, peak: peak * 0.6, attack: 0.005 });
      }
    },
  },
  alarm: {
    label: "Alarm",
    play(ctx, out, t) {
      for (let i = 0; i < 3; i++) {
        tone(ctx, out, { freq: 880, at: t + i * 0.45, length: 0.16, type: "triangle", peak: 0.22, attack: 0.008 });
        tone(ctx, out, { freq: 1174.7, at: t + i * 0.45 + 0.18, length: 0.18, type: "triangle", peak: 0.22, attack: 0.008 });
      }
    },
  },
};

export const RICKROLL_CHANCE = 0.05;

// [frequency in Hz, length in sixteenths], 0 Hz is a rest.
const NEVER_GONNA_GIVE_YOU_UP = [
  [311.13, 1], [349.23, 1], [415.3, 1], [349.23, 1], [523.25, 3], [523.25, 3], [466.16, 6],
  [311.13, 1], [349.23, 1], [415.3, 1], [349.23, 1], [466.16, 3], [466.16, 3], [415.3, 3], [392, 1], [349.23, 2],
  [311.13, 1], [349.23, 1], [415.3, 1], [349.23, 1], [415.3, 4], [466.16, 2], [392, 3], [349.23, 1], [311.13, 4],
  [0, 2], [311.13, 2], [466.16, 4], [415.3, 8],
];

const RICKROLL = {
  play(ctx, out, t) {
    const sixteenth = 60 / 114 / 4;
    let at = t;
    for (const [freq, steps] of NEVER_GONNA_GIVE_YOU_UP) {
      const length = steps * sixteenth;
      if (freq) {
        tone(ctx, out, { freq, at, length: length * 0.95, type: "triangle", peak: 0.2, attack: 0.008 });
        tone(ctx, out, { freq, at, length: length * 0.95, type: "square", peak: 0.035, attack: 0.008 });
      }
      at += length;
    }
  },
};

async function playSynth(synth) {
  const ctx = audioContext();
  if (!ctx) return false;
  try {
    if (ctx.state === "suspended") await Promise.race([ctx.resume(), new Promise((resolve) => setTimeout(resolve, 300))]);
    if (ctx.state !== "running") return false;
    const out = ctx.createGain();
    out.gain.value = 0.9;
    out.connect(ctx.destination);
    synth.play(ctx, out, ctx.currentTime + 0.02);
    return true;
  } catch (e) { return false; }
}

export async function playSound(nameOrUrl) {
  const name = nameOrUrl === undefined ? alertSettings().sound : nameOrUrl;
  const url = name === "custom" ? alertSettings().customSoundUrl : SOUNDS[name] ? null : name;
  if (url) {
    if (!hasUserGesture()) return false;
    try { await new Audio(url).play(); return true; } catch (e) { return playSound("chime"); }
  }
  return playSynth(SOUNDS[name] || SOUNDS.chime);
}

export function playAlertSound(nameOrUrl, roll = Math.random()) {
  return roll < RICKROLL_CHANCE ? playSynth(RICKROLL) : playSound(nameOrUrl);
}

function unlockAudio() {
  const ctx = audioContext();
  if (ctx && ctx.state !== "suspended") {
    window.removeEventListener("pointerdown", unlockAudio, true);
    window.removeEventListener("keydown", unlockAudio, true);
  }
}

function regionId() {
  return (prefs().timers || {}).region || bp().timers_region || DEFAULT_REGION;
}

function bossServer() {
  return bp().fieldboss_server || DEFAULT_SERVER;
}

function trackedBosses() {
  return bp().fieldboss_tracked || [];
}

// The timers widgets share one feed cache; when that module is missing or
// fails to load, alerts fetch the same files themselves.
async function sharedFeed() {
  try { return await import("./widgets/timers/feed.js"); } catch (e) { return null; }
}

const has = (module, name) => Boolean(module && typeof module[name] === "function");

async function fetchJson(url, fresh = false) {
  const response = await fetch(url, fresh ? { cache: "no-store" } : undefined);
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.json();
}

async function loadSchedule(shared) {
  if (has(shared, "loadSchedule")) return shared.loadSchedule();
  let feed = await fetchJson("data/shugo_timers.json");
  try {
    const fresh = await fetchJson(FEED_BASE + "shugo_timers.json", true);
    if (fresh.regions && fresh.events && (fresh.updatedAt || "") >= (feed.updatedAt || "")) feed = fresh;
  } catch (e) { /* bundled copy stays */ }
  return feed;
}

async function loadBosses(shared) {
  if (has(shared, "loadBosses")) return shared.loadBosses();
  return (await fetchJson("data/field_bosses.json")).bosses;
}

async function loadBossFeed(shared, server) {
  if (has(shared, "fetchFeed")) {
    const state = await shared.fetchFeed(server);
    if (state && state.data && state.data.kills) return state.data;
    throw new Error((state && state.error) || "boss feed unavailable");
  }
  const data = await fetchJson(`${FEED_BASE}feeds/${server}.json`, true);
  if (!data.ok) throw new Error("boss feed not ok");
  return data;
}

export async function refreshSources(now = new Date(), force = false) {
  const settings = alertSettings();
  if (!settings.enabled) return;
  const wantsSchedule = settings.timers && (force || !sources.schedule || now - sources.scheduleAt > SCHEDULE_TTL);
  const server = bossServer();
  const wantsBosses = settings.trackedBosses && trackedBosses().length > 0;
  const wantsBossFeed = wantsBosses && (force || sources.bossServer !== server || now - sources.bossFeedAt > BOSS_FEED_TTL);
  if (!wantsSchedule && !wantsBossFeed) return;
  const shared = await sharedFeed();
  const jobs = [];
  if (wantsSchedule) {
    jobs.push(loadSchedule(shared).then((feed) => { sources.schedule = feed; sources.scheduleAt = now.getTime(); }).catch(() => {}));
  }
  if (wantsBossFeed) {
    sources.bossFeedAt = now.getTime();
    if (!sources.bosses) jobs.push(loadBosses(shared).then((list) => { sources.bosses = list; }).catch(() => {}));
    jobs.push(loadBossFeed(shared, server).then((feed) => { sources.bossFeed = feed; sources.bossServer = server; }).catch(() => {
      if (sources.bossServer !== server) { sources.bossFeed = null; sources.bossServer = server; }
    }));
  }
  await Promise.all(jobs);
  changed();
}

function rosterPlannerCharacters() {
  const seen = new Set();
  const out = [];
  for (const entry of characters()) {
    const character = entry.name && plannerCharacterNamed(entry.name);
    if (!character || seen.has(character.id)) continue;
    seen.add(character.id);
    out.push({ id: character.id, name: character.name });
  }
  return out;
}

export function currentAlerts(now = new Date(), settings = alertSettings()) {
  const p = bp();
  const planner = p.planner;
  const roster = rosterPlannerCharacters();
  const server = (planner.servers || [])[0];
  const scopes = [
    ...(server ? [{ scope: "server", id: server.id, name: server.name || "Server" }] : []),
    ...roster.map((c) => ({ scope: "character", id: c.id, name: c.name })),
  ];
  const schedule = sources.schedule;
  const region = schedule && (schedule.regions.find((r) => r.id === regionId()) || schedule.regions[0]);
  return collectAlerts({
    settings, now, schedule, region,
    bosses: sources.bosses, bossFeed: sources.bossServer === bossServer() ? sources.bossFeed : null, tracked: trackedBosses(),
    planner, characters: roster, scopes,
  });
}

export function trackedBossCount() {
  return trackedBosses().length;
}

export async function eventList() {
  if (!sources.schedule) {
    try { sources.schedule = await loadSchedule(await sharedFeed()); sources.scheduleAt = Date.now(); } catch (e) { return []; }
  }
  const region = sources.schedule.regions.find((r) => r.id === regionId()) || sources.schedule.regions[0];
  return sources.schedule.events.filter((e) => (e.schedules || {})[region.id]).map((e) => ({ id: e.id, name: e.name }));
}

export function newCustomEvent(fields = {}) {
  const at = new Date(Date.now() + 3600000);
  at.setMinutes(0, 0, 0);
  const id = "ev" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  return { id, name: "New event", at: at.toISOString(), repeat: "none", leadMinutes: null, ...fields };
}

export function upcomingAlerts(now = new Date()) {
  const fired = pruneFired(readStore(FIRED_KEY), now);
  const snoozed = pruneSnoozed(readStore(SNOOZED_KEY), now);
  return upcomingList(currentAlerts(now), now, fired, snoozed).map((a) => ({ ...a, text: alertText(a, now) }));
}

export function sourcesLoaded() {
  const settings = alertSettings();
  return (!settings.timers || Boolean(sources.schedule)) && (!settings.trackedBosses || !trackedBosses().length || sources.bossFeedAt > 0);
}

export function snoozeAlert(alert, now = new Date()) {
  const snoozed = pruneSnoozed(readStore(SNOOZED_KEY), now);
  snoozed[alert.key] = now.getTime() + SNOOZE_MS;
  writeStore(SNOOZED_KEY, snoozed);
  writeStore(FIRED_KEY, forgetFired(readStore(FIRED_KEY), { ...alert, at: new Date(alert.at) }));
  changed();
}

export function unsnoozeAlert(alert) {
  const snoozed = readStore(SNOOZED_KEY);
  delete snoozed[alert.key];
  writeStore(SNOOZED_KEY, snoozed);
  changed();
}

const escapeHtml = (text) => String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function toastHost() {
  let host = document.querySelector(".al-toasts");
  if (!host) {
    host = document.createElement("div");
    host.className = "al-toasts";
    host.setAttribute("aria-live", "polite");
    document.body.appendChild(host);
  }
  return host;
}

export function showToast({ title, body, accent = "--accent", route = null, alerts = [] }) {
  if (typeof document === "undefined") return null;
  const el = document.createElement("div");
  el.className = "al-toast";
  el.setAttribute("role", "status");
  el.style.setProperty("--al-accent", `var(${accent})`);
  el.innerHTML = `<span class="al-toast-icon">${BELL_ICON}</span>
    <div class="al-toast-text"><b>${escapeHtml(title)}</b><div class="al-toast-body">${escapeHtml(body)}</div>
      ${alerts.length ? `<div class="al-toast-actions"><button type="button" class="link" data-snooze>Snooze 15 min</button>${route ? `<button type="button" class="link" data-open>Open</button>` : ""}</div>` : ""}</div>
    <button type="button" class="al-toast-close" aria-label="Dismiss" title="Dismiss">×</button>`;
  let timer = null;
  const dismiss = () => {
    clearTimeout(timer);
    el.classList.add("leaving");
    setTimeout(() => el.remove(), 180);
  };
  const arm = () => { clearTimeout(timer); timer = setTimeout(dismiss, TOAST_MS); };
  const open = () => { if (route) location.hash = route; dismiss(); };
  el.addEventListener("mouseenter", () => clearTimeout(timer));
  el.addEventListener("mouseleave", arm);
  el.addEventListener("click", (e) => {
    if (e.target.closest(".al-toast-close")) { dismiss(); return; }
    if (e.target.closest("[data-snooze]")) { alerts.forEach((a) => snoozeAlert(a)); dismiss(); return; }
    open();
  });
  if (route) el.classList.add("clickable");
  const host = toastHost();
  host.appendChild(el);
  while (host.children.length > MAX_TOASTS) host.firstElementChild.remove();
  arm();
  return el;
}

function browserNotify(settings, { title, body, route, tag }) {
  if (!settings.browser || typeof Notification === "undefined" || Notification.permission !== "granted") return;
  if (!document.hidden && !settings.browserAlways) return;
  try {
    const n = new Notification(title, { body, tag, icon: "assets/class_icons/gladiator.png" });
    n.onclick = () => { window.focus(); if (route) location.hash = route; n.close(); };
  } catch (e) { /* some browsers only allow notifications from a service worker */ }
}

export function notificationState() {
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission;
}

export async function requestNotifications() {
  if (typeof Notification === "undefined") return "unsupported";
  if (Notification.permission === "default") {
    try { await Notification.requestPermission(); } catch (e) { /* older callback-only API */ }
  }
  return Notification.permission;
}

function present(settings, due, now) {
  const odyle = due.filter((a) => a.source === "odyle");
  const messages = due.filter((a) => a.source !== "odyle").map((a) => ({ ...alertText(a, now), accent: a.accent, route: a.route, alerts: [a], tag: a.key }));
  if (odyle.length > 1) messages.push({ ...odyleSummary(odyle, now), accent: odyle[0].accent, route: odyle[0].route, alerts: odyle, tag: "odyle" });
  else if (odyle.length) messages.push({ ...alertText(odyle[0], now), accent: odyle[0].accent, route: odyle[0].route, alerts: odyle, tag: odyle[0].key });
  for (const message of messages) {
    showToast(message);
    browserNotify(settings, message);
  }
  if (messages.length) playAlertSound(settings.sound);
}

let started = false;
let running = null;

export function fireDue(now = new Date()) {
  const settings = alertSettings();
  if (!settings.enabled) return [];
  const fired = pruneFired(readStore(FIRED_KEY), now);
  const snoozed = pruneSnoozed(readStore(SNOOZED_KEY), now);
  const due = dueAlerts(currentAlerts(now, settings), now, fired, snoozed);
  for (const alert of due) markFired(fired, alert, now);
  writeStore(FIRED_KEY, fired);
  writeStore(SNOOZED_KEY, snoozed);
  if (due.length) {
    present(settings, due, now);
    changed();
  }
  return due;
}

export function tickAlerts(now = new Date()) {
  if (running) return running;
  running = (async () => {
    try {
      await refreshSources(now);
      return fireDue(now).map((a) => a.key);
    } catch (err) {
      console.error(err);
      return [];
    } finally {
      running = null;
    }
  })();
  return running;
}

export function scheduleAlerts() {
  if (started || typeof window === "undefined" || typeof document === "undefined") return;
  started = true;
  setInterval(() => tickAlerts(), TICK_MS);
  setTimeout(() => tickAlerts(), 1500);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) tickAlerts(); });
  window.addEventListener("pointerdown", unlockAudio, true);
  window.addEventListener("keydown", unlockAudio, true);
  window.__armoryAlertsTick = () => tickAlerts();
}

export { renderAlertSettings } from "./widgets/alerts/settings.js";

scheduleAlerts();
