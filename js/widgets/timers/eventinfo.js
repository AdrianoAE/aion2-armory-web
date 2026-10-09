// The hover card for one scheduled event, shared by the timeline and the
// event list.

import { eventSchedule, isRunning, scheduleSummary, spanText, upcomingOccurrences, hms } from "../../engine/timers.js";
import { esc, kindOf } from "./feed.js";

export function eventStatus(occurrence, now) {
  if (!occurrence) return "No upcoming time";
  if (isRunning(occurrence, now)) return `Running, ends in ${hms(occurrence.end - now)}`;
  return `Starts in ${hms(occurrence.start - now)}`;
}

export function eventHoverHtml(event, region, now, hovered = null) {
  const kind = kindOf(event);
  const upcoming = upcomingOccurrences(event, region, now, 4);
  const next = upcoming[0] || null;
  const rule = scheduleSummary(eventSchedule(event, region.id), region);
  const isHoveredNext = hovered && next && hovered.start.getTime() === next.start.getTime();
  return `<div class="tm-hc" style="--kind: var(${kind.accent})">
    <div class="tm-hc-head"><span class="tm-hc-icon" aria-hidden="true">${esc(event.icon || "")}</span><b>${esc(event.name)}</b><span class="tag" style="--tag: var(${kind.accent})">${esc(kind.label)}</span></div>
    ${event.description ? `<div class="tm-hc-desc">${esc(event.description)}</div>` : ""}
    ${hovered && !isHoveredNext ? `<div class="tm-hc-line"><span class="muted">This one</span> ${esc(spanText(hovered, now))}</div>` : ""}
    <div class="tm-hc-line"><span class="muted">Next</span> ${next ? `${esc(spanText(next, now))} · <b>${esc(eventStatus(next, now))}</b>` : "No upcoming time"}</div>
    ${upcoming.length > 1 ? `<div class="tm-chips">${upcoming.slice(1).map((o) => `<span>${esc(spanText(o, now))}</span>`).join("")}</div>` : ""}
    <div class="tm-hc-rule"><span class="muted">${esc(region.label)}:</span> ${esc(rule)} <span class="muted">· times shown in your local time</span></div>
  </div>`;
}
