// timers.countdowns: live countdowns for the events the player picks, the
// Spacetime Rift by default. Pinned, it is one line per event.

import { registerWidget } from "../../widgets.js";
import { dayWord, isRunning, localClock, nextOccurrence, regionEvents } from "../../engine/timers.js";
import { adoptShared, currentRegion, esc, kindOf, loadSchedule, openSettings, regionOptions, schedule, sharedField, until, watch } from "./feed.js";
import { hoverable } from "./hovercard.js";
import { eventHoverHtml } from "./eventinfo.js";

const DAY = 24 * 3600 * 1000;

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

function cardHtml(p) {
  const kind = kindOf(p.event);
  return `<div class="tm-cd${p.running ? " running" : ""}" data-event="${esc(p.event.id)}" style="--kind: var(${kind.accent})">
    <span class="tm-cd-icon" aria-hidden="true">${esc(p.event.icon || "")}</span>
    <div class="tm-cd-main"><span class="tm-cd-name">${esc(p.event.name)}</span><span class="tm-cd-sub">${esc(p.label)}</span></div>
    <span class="tm-cd-time">${until(p.at, { pre: p.running ? `${p.verb} ` : "", done: "now" })}</span>
  </div>`;
}

function lineHtml(p) {
  const kind = kindOf(p.event);
  return `<span class="tm-compact-item" data-event="${esc(p.event.id)}" style="--kind: var(${kind.accent})">${p.running ? `<span class="tm-running">${esc(p.label)}</span> ` : ""}<b>${esc(p.event.icon ? `${p.event.icon} ` : "")}${esc(p.event.name)}</b> ${esc(p.verb)} ${until(p.at, { done: "now" })}${p.running ? "" : ` <span class="muted">· ${esc(p.label)}</span>`}</span>`;
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
  el.innerHTML = compact
    ? `<div class="tm-compact-row">${phases.map(lineHtml).join("")}</div>`
    : `<div class="tm-cd-list">${phases.map(cardHtml).join("")}</div>`;
  const unhover = hoverable(el, "[data-event]", (target) => {
    const p = phases.find((x) => x.event.id === target.dataset.event);
    return p ? eventHoverHtml(p.event, region, new Date()) : "";
  });
  const unschedule = refreshAtNextChange(ctx, phases);
  return () => { unwatch(); unhover(); unschedule(); };
}

registerWidget({
  id: "timers.countdowns",
  title: "Event countdowns",
  group: "Timers",
  description: "Live countdowns for the events you pick, such as the Spacetime Rift portal; pin it to keep them in view.",
  accent: "portals",
  defaultSize: { cols: 2, rows: "auto" },
  live: true,
  settings: [
    sharedField("region", { label: "Region", type: "select", options: regionOptions }),
    { key: "events", label: "Events", type: "multiselect", options: eventOptions, default: ["rift"] },
  ],
  render(el, ctx) {
    return show(el, ctx, { compact: false });
  },
  compact(el, ctx) {
    return show(el, ctx, { compact: true });
  },
});
