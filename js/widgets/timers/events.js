// timers.events: one compact card per scheduled event, soonest first, with
// a live countdown; the details are in the hover card.

import { registerWidget } from "../../widgets.js";
import { isRunning, nextOccurrence, regionEvents, spanText } from "../../engine/timers.js";
import { adoptShared, currentRegion, esc, kindOf, regionOptions, schedule, sharedField, until, watch } from "./feed.js";
import { hoverable } from "./hovercard.js";
import { eventHoverHtml } from "./eventinfo.js";

function upcoming(ctx) {
  const data = schedule();
  const region = currentRegion();
  if (!data || !region) return null;
  const now = ctx.now;
  const list = regionEvents(data.events, region, now)
    .filter((e) => ctx.settings.showResets !== false || e.kind !== "reset")
    .map((event) => ({ event, next: nextOccurrence(event, region, now) }))
    .filter((e) => e.next);
  const key = (e) => (isRunning(e.next, now) ? -1 : e.next.start - now);
  return { region, now, list: list.sort((a, b) => key(a) - key(b)) };
}

function when(next, now) {
  if (isRunning(next, now)) return `<span class="tm-running">Running</span> ${until(next.end, { pre: "ends in ", done: "ended" })}`;
  return until(next.start, { pre: "in ", done: "starting" });
}

registerWidget({
  id: "timers.events",
  title: "Upcoming events",
  group: "Timers",
  description: "The next time of every event with a live countdown; hover one for its details.",
  accent: "info",
  defaultSize: { cols: 2, rows: 2 },
  live: true,
  settings: [
    sharedField("region", { label: "Region", type: "select", options: regionOptions }),
    { key: "showResets", label: "Show the daily and weekly resets", type: "checkbox", default: true },
  ],
  render(el, ctx) {
    adoptShared(ctx, ["region"]);
    const unwatch = watch(ctx);
    const state = upcoming(ctx);
    if (!state) {
      el.innerHTML = '<div class="muted small">Loading the schedule…</div>';
      return unwatch;
    }
    const { region, now, list } = state;
    el.innerHTML = list.length ? `<div class="tm-events">${list.map(({ event, next }) => {
      const kind = kindOf(event);
      return `<div class="tm-event${isRunning(next, now) ? " running" : ""}" data-event="${esc(event.id)}" style="--kind: var(${kind.accent})" tabindex="0">
        <span class="tm-event-icon" aria-hidden="true">${esc(event.icon || "")}</span>
        <span class="tm-event-text"><span class="tm-event-name">${esc(event.name)}</span><span class="tm-event-time">${esc(spanText(next, now))}</span></span>
        <span class="tm-event-when">${when(next, now)}</span>
      </div>`;
    }).join("")}</div>` : '<div class="muted small">Nothing scheduled for this region.</div>';
    const byId = new Map(list.map((e) => [e.event.id, e.event]));
    const stopHover = hoverable(el, "[data-event]", (target) => {
      const event = byId.get(target.dataset.event);
      return event ? eventHoverHtml(event, region, new Date()) : "";
    });
    return () => { unwatch(); stopHover(); };
  },
  compact(el, ctx) {
    const unwatch = watch(ctx);
    const state = upcoming(ctx);
    if (!state) { el.innerHTML = '<span class="muted small">Loading…</span>'; return unwatch; }
    const { region, now, list } = state;
    el.innerHTML = `<div class="tm-compact-row">${list.slice(0, 4).map(({ event, next }) =>
      `<span class="tm-compact-item" data-event="${esc(event.id)}" style="--kind: var(${kindOf(event).accent})"><b>${esc(event.icon || "")} ${esc(event.name)}</b> ${when(next, now)}</span>`).join("")}</div>`;
    const byId = new Map(list.map((e) => [e.event.id, e.event]));
    const stopHover = hoverable(el, "[data-event]", (target) => {
      const event = byId.get(target.dataset.event);
      return event ? eventHoverHtml(event, region, new Date()) : "";
    });
    return () => { unwatch(); stopHover(); };
  },
});
