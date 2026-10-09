// timers.timeline: every scheduled event of the region on one canvas, from
// now to the chosen range ahead; hovering a name or a block shows the
// event's card.

import { registerWidget } from "../../widgets.js";
import { dayWord, isRunning, localClock, nextOccurrence, occurrences, regionEvents } from "../../engine/timers.js";
import { countdown } from "../../engine/planner.js";
import { adoptShared, currentRegion, esc, kindOf, regionOptions, schedule, setRegion, sharedField, watch } from "./feed.js";
import { hideHover, placeHover, showHover } from "./hovercard.js";
import { eventHoverHtml } from "./eventinfo.js";

const RANGES = [1, 2, 4, 6, 8, 12, 24, 48];
const HOUR = 3600 * 1000;

let probe = null;
function rgb(token) {
  if (!probe) {
    probe = document.createElement("span");
    probe.style.display = "none";
  }
  if (!probe.isConnected) document.body.appendChild(probe);
  probe.style.color = `var(${token})`;
  const parts = (getComputedStyle(probe).color.match(/[\d.]+/g) || ["0", "0", "0"]).map(Number);
  return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
}
const paint = (c, alpha = 1) => `rgba(${c.r}, ${c.g}, ${c.b}, ${Math.round(c.a * alpha * 1000) / 1000})`;

function buildRows(events, region, now, hours) {
  const end = new Date(now.getTime() + hours * HOUR);
  return events.map((event) => {
    const found = occurrences(event, region, new Date(now.getTime() - HOUR), end, now)
      .filter((o) => o.end > now || (o.end.getTime() === o.start.getTime() && o.start >= now));
    let empty = "";
    if (!found.length) {
      const next = nextOccurrence(event, region, now);
      if (next) empty = `Next ${dayWord(next.start, now)} ${localClock(next.start)} · in ${countdown(next.start - now)}`;
    }
    return { event, occurrences: found, empty };
  });
}

function fit(ctx, text, max) {
  if (ctx.measureText(text).width <= max) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(cut + "…").width > max) cut = cut.slice(0, -1);
  return cut + "…";
}

function draw(canvas, rows, now, hours) {
  const width = Math.max(320, canvas.parentElement.clientWidth || 900);
  const LABEL = Math.round(Math.min(200, Math.max(130, width * 0.22)));
  const ROW = 26, TOP = 34, BOTTOM = 6, RIGHT = 10;
  const height = TOP + rows.length * ROW + BOTTOM;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const font = getComputedStyle(document.documentElement).getPropertyValue("--font").trim() || "sans-serif";
  const C = { grid: rgb("--grid-line"), border: rgb("--border"), muted: rgb("--muted"), fg: rgb("--fg"), accent: rgb("--accent"), track: rgb("--track") };
  const span = hours * HOUR;
  const x = (t) => LABEL + ((t - now) / span) * (width - LABEL - RIGHT);

  const tickMin = hours <= 2 ? 15 : hours <= 6 ? 30 : 60;
  const labelMin = hours <= 2 ? 30 : hours <= 8 ? 60 : hours <= 12 ? 120 : hours <= 24 ? 180 : 360;
  const first = new Date(now);
  first.setSeconds(0, 0);
  first.setMinutes(Math.ceil((first.getMinutes() + 1) / tickMin) * tickMin);
  ctx.font = `11px ${font}`;
  for (let t = first.getTime(); t <= now.getTime() + span; t += tickMin * 60000) {
    const at = new Date(t);
    const px = Math.round(x(t)) + 0.5;
    const midnight = at.getHours() === 0 && at.getMinutes() === 0;
    const labelled = (at.getHours() * 60 + at.getMinutes()) % labelMin === 0;
    ctx.strokeStyle = paint(labelled ? C.border : C.grid);
    ctx.setLineDash(midnight ? [4, 3] : []);
    ctx.beginPath(); ctx.moveTo(px, TOP - 6); ctx.lineTo(px, height - BOTTOM); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = paint(C.muted);
    ctx.textAlign = "center";
    if (labelled && px - LABEL > 40) ctx.fillText(localClock(at), px, 12);
    if (midnight) { ctx.textAlign = "left"; ctx.fillText(dayWord(at, now), px + 4, 25); }
  }

  rows.forEach((row, i) => {
    const top = TOP + i * ROW;
    const kind = rgb(kindOf(row.event).accent);
    ctx.fillStyle = paint(C.track);
    ctx.fillRect(LABEL, top + 3, width - LABEL - RIGHT, ROW - 6);
    ctx.fillStyle = paint(kind);
    ctx.fillRect(4, top + 7, 3, ROW - 14);
    ctx.fillStyle = paint(C.fg);
    ctx.font = `600 12px ${font}`;
    ctx.textAlign = "left";
    ctx.fillText(fit(ctx, `${row.event.icon ? row.event.icon + " " : ""}${row.event.name}`, LABEL - 22), 14, top + ROW / 2 + 4);
    if (!row.occurrences.length) {
      ctx.fillStyle = paint(C.muted);
      ctx.font = `11px ${font}`;
      ctx.fillText(fit(ctx, row.empty, width - LABEL - RIGHT - 16), LABEL + 8, top + ROW / 2 + 4);
      return;
    }
    for (const o of row.occurrences) {
      const x0 = Math.max(LABEL, x(o.start));
      const x1 = Math.min(width - RIGHT, x(o.end));
      if (o.end.getTime() === o.start.getTime()) {
        ctx.strokeStyle = paint(kind);
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 3]);
        ctx.beginPath(); ctx.moveTo(x0, top + 3); ctx.lineTo(x0, top + ROW - 3); ctx.stroke();
        ctx.setLineDash([]);
        ctx.lineWidth = 1;
        ctx.fillStyle = paint(kind);
        ctx.beginPath(); ctx.moveTo(x0, top + 5); ctx.lineTo(x0 + 4, top + 9); ctx.lineTo(x0, top + 13); ctx.lineTo(x0 - 4, top + 9); ctx.closePath(); ctx.fill();
        continue;
      }
      const running = isRunning(o, now);
      ctx.fillStyle = paint(kind, running ? 0.95 : 0.38);
      ctx.fillRect(x0, top + 6, Math.max(5, x1 - x0), ROW - 12);
      if (o.portalEnd) {
        const xp = Math.min(width - RIGHT, x(o.portalEnd));
        if (xp > x0) {
          ctx.fillStyle = paint(kind, running ? 1 : 0.7);
          ctx.fillRect(x0, top + 6, Math.max(3, xp - x0), ROW - 12);
        }
      }
      if (running) {
        ctx.strokeStyle = paint(C.fg, 0.5);
        ctx.strokeRect(x0 + 0.5, top + 6.5, Math.max(5, x1 - x0) - 1, ROW - 13);
      }
    }
  });

  ctx.strokeStyle = paint(C.accent);
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(LABEL, TOP - 6); ctx.lineTo(LABEL, height - BOTTOM); ctx.stroke();
  ctx.lineWidth = 1;
  ctx.fillStyle = paint(C.accent);
  ctx.textAlign = "left";
  ctx.font = `700 11px ${font}`;
  ctx.fillText("Now", LABEL + 4, 12);
  return { LABEL, ROW, TOP, RIGHT, width, x };
}

function legendHtml(region, data) {
  return `<div class="tm-hc">
    <div class="tm-hc-head"><b>Reading the timeline</b></div>
    <div class="tm-hc-desc">Each row is an event, coloured by its kind. A solid block is running now, a pale block is coming up; the Rift's
      first 10 minutes (portal open) are drawn stronger. A dashed line with a diamond is a reset or a one-off moment.
      Hover a name or a block for its details. Times are in your local time zone.</div>
    ${region.note ? `<div class="tm-hc-rule">${esc(region.note)}</div>` : ""}
    <div class="tm-hc-rule muted">Schedule from shugo.gg, updated ${esc(data.updatedAt || "?")}.</div>
  </div>`;
}

registerWidget({
  id: "timers.timeline",
  title: "Event timeline",
  group: "Timers",
  description: "Every event of your region on one timeline, from now to up to 48 hours ahead.",
  accent: "warn",
  defaultSize: { cols: 4, rows: 2 },
  live: true,
  settings: [
    sharedField("region", { label: "Region", type: "select", options: regionOptions }),
    { key: "hours", label: "Range", type: "select", options: RANGES.map((h) => [h, `${h} h`]), default: 24 },
  ],
  render(el, ctx) {
    adoptShared(ctx, ["region"]);
    const unwatch = watch(ctx);
    const data = schedule();
    const region = currentRegion();
    if (!data || !region) {
      el.innerHTML = '<div class="muted small">Loading the schedule…</div>';
      return unwatch;
    }
    const hours = RANGES.includes(Number(ctx.settings.hours)) ? Number(ctx.settings.hours) : 24;
    const now = ctx.now;
    const rows = buildRows(regionEvents(data.events, region, now), region, now, hours);
    el.innerHTML = `<div class="tm-toolbar">
        <label>Region <select data-region>${data.regions.map((r) => `<option value="${esc(r.id)}" ${r.id === region.id ? "selected" : ""}>${esc(r.label)}</option>`).join("")}</select></label>
        <label>Range <select data-hours>${RANGES.map((h) => `<option value="${h}" ${h === hours ? "selected" : ""}>${h} h</option>`).join("")}</select></label>
        <span class="grow"></span>
        <span class="tm-legend" tabindex="0" data-legend>How to read this</span>
      </div>
      <div class="tm-canvas-wrap"><canvas class="tm-timeline" role="img" aria-label="Event timeline for the next ${hours} hours"></canvas></div>`;
    const canvas = el.querySelector("canvas");
    let geom = draw(canvas, rows, now, hours);
    const owner = {};

    el.querySelector("[data-region]").addEventListener("change", (e) => { e.target.blur(); setRegion(e.target.value); ctx.refresh(); });
    el.querySelector("[data-hours]").addEventListener("change", (e) => ctx.setSetting("hours", Number(e.target.value)));
    const legend = el.querySelector("[data-legend]");
    const showLegend = (e) => {
      const r = legend.getBoundingClientRect();
      showHover(legendHtml(region, data), e && e.clientX != null ? e.clientX : r.left, e && e.clientY != null ? e.clientY : r.bottom, owner);
    };
    legend.addEventListener("pointerenter", showLegend);
    legend.addEventListener("focus", () => showLegend(null));
    legend.addEventListener("pointerleave", () => hideHover(owner));
    legend.addEventListener("blur", () => hideHover(owner));

    let hovered = null;
    const onMove = (e) => {
      const rect = canvas.getBoundingClientRect();
      const px = e.clientX - rect.left, py = e.clientY - rect.top;
      const row = rows[Math.floor((py - geom.TOP) / geom.ROW)];
      let hit = null;
      if (row && py >= geom.TOP) {
        if (px < geom.LABEL) hit = { row, occurrence: null };
        else {
          const occurrence = row.occurrences.find((o) => geom.x(o.start) - 5 <= px && px <= Math.max(geom.x(o.end), geom.x(o.start) + 6) + 5);
          if (occurrence) hit = { row, occurrence };
        }
      }
      canvas.style.cursor = hit ? "help" : "";
      if (!hit) { hovered = null; hideHover(owner); return; }
      const key = `${hit.row.event.id}:${hit.occurrence ? hit.occurrence.start.getTime() : "name"}`;
      if (key !== hovered) {
        hovered = key;
        showHover(eventHoverHtml(hit.row.event, region, new Date(), hit.occurrence), e.clientX, e.clientY, owner);
      } else placeHover(e.clientX, e.clientY);
    };
    const onLeave = () => { hovered = null; hideHover(owner); };
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerleave", onLeave);

    let lastWidth = canvas.parentElement.clientWidth;
    let frame = 0;
    const redraw = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { if (canvas.isConnected) geom = draw(canvas, rows, now, hours); });
    };
    const resize = new ResizeObserver(() => {
      const w = canvas.parentElement && canvas.parentElement.clientWidth;
      if (w && w !== lastWidth) { lastWidth = w; redraw(); }
    });
    resize.observe(canvas.parentElement);
    window.addEventListener("themechange", redraw);

    return () => {
      unwatch();
      resize.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("themechange", redraw);
      hideHover(owner);
    };
  },
});
