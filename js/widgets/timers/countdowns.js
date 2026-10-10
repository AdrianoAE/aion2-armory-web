// timers.countdowns: live countdowns for the events the player picks, the
// Spacetime Rift by default. Pinned, it is one line per event. The timeline's
// pin buttons add one copy per event, titled with the event's name. Each
// event can also show a strip of its upcoming times.

import { areaItem, pinItem, registerWidget, removeItem } from "../../widgets.js";
import { dayWord, isRunning, localClock, nextOccurrence, occurrences, regionEvents } from "../../engine/timers.js";
import { adoptShared, currentRegion, esc, kindOf, loadSchedule, openSettings, regionOptions, schedule, sharedField, until, watch } from "./feed.js";
import { hoverable } from "./hovercard.js";
import { eventHoverHtml } from "./eventinfo.js";

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const RANGES = [2, 4, 6, 8, 12, 24];
const STRIP_REDRAW_MS = 30 * 1000;

const eventPinId = (eventId) => `timers.countdowns#event-${eventId}`;
const pinnedTitle = (settings) => (Array.isArray(settings.events) && settings.events.length === 1 && settings.titleOf === settings.events[0] ? settings.title : "");

export function isEventPinned(areaId, eventId) {
  return !!areaItem(areaId, eventPinId(eventId));
}

export function toggleEventPin(areaId, event) {
  if (removeItem(areaId, eventPinId(event.id))) return false;
  pinItem(areaId, eventPinId(event.id), { settings: { events: [event.id], title: event.name, titleOf: event.id } });
  return true;
}

function eventOptions() {
  return loadSchedule().then((data) => data.events.map((e) => [e.id, `${e.icon ? e.icon + " " : ""}${e.name}`]));
}

function phaseOf(event, region, now) {
  const occurrence = nextOccurrence(event, region, now);
  if (!occurrence) return null;
  const instant = occurrence.end.getTime() === occurrence.start.getTime();
  if (!instant && isRunning(occurrence, now)) {
    if (occurrence.portalEnd && now < occurrence.portalEnd) return { event, running: true, label: "Portal open", verb: "closes in", at: occurrence.portalEnd };
    return { event, running: true, label: "Running", verb: "ends in", at: occurrence.end };
  }
  return { event, running: false, label: `${dayWord(occurrence.start, now)} ${localClock(occurrence.start)}`, verb: "in", at: occurrence.start };
}

function chosenPhases(ctx) {
  const data = schedule();
  const region = currentRegion();
  if (!data || !region) return null;
  const chosen = new Set(Array.isArray(ctx.settings.events) ? ctx.settings.events : []);
  const phases = regionEvents(data.events, region, ctx.now)
    .filter((e) => chosen.has(e.id))
    .map((e) => phaseOf(e, region, ctx.now))
    .filter(Boolean)
    .sort((a, b) => b.running - a.running || a.at - b.at);
  return { data, region, chosen, phases };
}

function refreshAtNextChange(ctx, phases) {
  const soonest = Math.min(...phases.map((p) => p.at.getTime()));
  const wait = soonest - Date.now() + 500;
  if (!Number.isFinite(wait) || wait > DAY) return () => {};
  const timer = setTimeout(() => ctx.refresh(), Math.max(500, wait));
  return () => clearTimeout(timer);
}

const pct = (fraction) => `${Math.round(Math.min(1, Math.max(0, fraction)) * 10000) / 100}%`;

function stripHtml(event, region, now, hours) {
  const span = hours * HOUR;
  const end = new Date(now.getTime() + span);
  const at = (date) => (date - now) / span;
  const blocks = occurrences(event, region, new Date(now.getTime() - HOUR), end, now).map((o) => {
    if (o.end.getTime() === o.start.getTime()) return o.start >= now ? `<span class="tm-strip-mark" style="left: ${pct(at(o.start))}"></span>` : "";
    if (o.end <= now) return "";
    const left = Math.max(0, at(o.start));
    const block = `<span class="tm-strip-block${isRunning(o, now) ? " running" : ""}" style="left: ${pct(left)}; width: ${pct(Math.min(1, at(o.end)) - left)}"></span>`;
    const portal = o.portalEnd && o.portalEnd > now ? `<span class="tm-strip-portal" style="left: ${pct(left)}; width: ${pct(Math.min(1, at(o.portalEnd)) - left)}"></span>` : "";
    return block + portal;
  }).join("");
  const step = (hours <= 4 ? 1 : hours <= 8 ? 2 : hours <= 12 ? 3 : 6) * HOUR;
  const first = new Date(now);
  first.setMinutes(0, 0, 0);
  let tick = first.getTime() + HOUR;
  while (new Date(tick).getHours() % (step / HOUR)) tick += HOUR;
  const lines = [];
  const labels = [];
  for (; tick < end.getTime(); tick += step) {
    const fraction = at(new Date(tick));
    if (fraction <= 0.06 || fraction >= 0.94) continue;
    lines.push(`<span class="tm-strip-tick" style="left: ${pct(fraction)}"></span>`);
    labels.push(`<span style="left: ${pct(fraction)}">${esc(localClock(new Date(tick)))}</span>`);
  }
  return `<span class="tm-strip" role="img" aria-label="${esc(event.name)} over the next ${hours} hours">
    <span class="tm-strip-track">${lines.join("")}${blocks}</span>
    <span class="tm-strip-labels">${labels.join("")}</span></span>`;
}

function cardHtml(p, strip) {
  const kind = kindOf(p.event);
  return `<div class="tm-cd${p.running ? " running" : ""}" data-event="${esc(p.event.id)}" style="--kind: var(${kind.accent})">
    <span class="tm-cd-icon" aria-hidden="true">${esc(p.event.icon || "")}</span>
    <div class="tm-cd-main"><span class="tm-cd-name">${esc(p.event.name)}</span><span class="tm-cd-sub">${esc(p.label)}</span></div>
    <span class="tm-cd-time">${until(p.at, { pre: p.running ? `${p.verb} ` : "", done: "now" })}</span>
    ${strip ? `<div class="tm-cd-strip">${strip}</div>` : ""}
  </div>`;
}

function lineHtml(p, { named = true, strip = "" } = {}) {
  const kind = kindOf(p.event);
  const name = named ? `${p.event.icon ? `${p.event.icon} ` : ""}${p.event.name}` : "";
  return `<span class="tm-compact-item" data-event="${esc(p.event.id)}" style="--kind: var(${kind.accent})">${p.running ? `<span class="tm-running">${esc(p.label)}</span> ` : ""}${name ? `<b>${esc(name)}</b> ` : ""}${esc(p.verb)} ${until(p.at, { done: "now" })}${p.running ? "" : ` <span class="muted">· ${esc(p.label)}</span>`}${strip}</span>`;
}

function show(el, ctx, { compact }) {
  adoptShared(ctx, ["region"]);
  const unwatch = watch(ctx);
  const state = chosenPhases(ctx);
  if (!state) {
    el.innerHTML = '<div class="muted small">Loading the schedule…</div>';
    return unwatch;
  }
  const { region, chosen, phases } = state;
  if (!phases.length) {
    el.innerHTML = `<div class="tm-empty">${chosen.size ? "None of the chosen events is scheduled in this region." : "No events chosen yet."} <button type="button" class="link" data-choose>Choose events</button></div>`;
    el.querySelector("[data-choose]").addEventListener("click", () => openSettings(el));
    return unwatch;
  }
  const named = !pinnedTitle(ctx.settings);
  ctx.setAccent(!named && phases.length === 1 ? kindOf(phases[0].event).accent : null);
  const hours = RANGES.includes(Number(ctx.settings.hours)) ? Number(ctx.settings.hours) : 6;
  const withStrip = ctx.settings.display !== "countdown";
  const fill = () => {
    const now = new Date();
    const strip = (p) => (withStrip ? stripHtml(p.event, region, now, hours) : "");
    el.innerHTML = compact
      ? `<div class="tm-compact-row">${phases.map((p) => lineHtml(p, { named, strip: strip(p) })).join("")}</div>`
      : `<div class="tm-cd-list">${phases.map((p) => cardHtml(p, strip(p))).join("")}</div>`;
  };
  fill();
  const redraw = withStrip ? setInterval(fill, STRIP_REDRAW_MS) : 0;
  const unhover = hoverable(el, "[data-event]", (target) => {
    const p = phases.find((x) => x.event.id === target.dataset.event);
    return p ? eventHoverHtml(p.event, region, new Date()) : "";
  });
  const unschedule = refreshAtNextChange(ctx, phases);
  return () => { unwatch(); unhover(); unschedule(); clearInterval(redraw); };
}

registerWidget({
  id: "timers.countdowns",
  title: "Event countdowns",
  group: "Timers",
  description: "Live countdowns for the events you pick, such as the Spacetime Rift portal; pin it to keep them in view.",
  accent: "portals",
  defaultSize: { cols: 2, rows: "auto" },
  live: true,
  titleFor: pinnedTitle,
  removeOnUnpin: (item) => item.id.startsWith(eventPinId("")),
  settings: [
    sharedField("region", { label: "Region", type: "select", options: regionOptions }),
    { key: "events", label: "Events", type: "multiselect", options: eventOptions, default: ["rift"] },
    { key: "display", label: "Show", type: "select", options: [["timeline", "Timeline and countdown"], ["countdown", "Countdown only"]], default: "timeline" },
    { key: "hours", label: "Timeline range", type: "select", options: RANGES.map((h) => [h, `${h} h`]), default: 6 },
  ],
  render(el, ctx) {
    return show(el, ctx, { compact: false });
  },
  compact(el, ctx) {
    return show(el, ctx, { compact: true });
  },
});
