// Timers: tracked field bosses, bosses within the hour, the event
// timeline and one card per event. Feeds come from the `data` branch the
// feeds workflow publishes (see .github/workflows/feeds.yml).

import { bp, save } from "../state.js";
import { DEFAULT_REGION, eventSchedule, hms, isRunning, localClock, nextOccurrence, occurrences, scheduleSummary, spanText, dayWord } from "../engine/timers.js";
import { SERVERS, bossStatuses, dropsYellowArtwork, isSoon, serverLabel, timeLeft } from "../engine/fieldboss.js";
import { escapeHtml } from "../app.js";
import { countdown } from "../engine/planner.js";

const FEED_BASE = "https://raw.githubusercontent.com/AdrianoAE/aion2-armory-web/data/";
const RANGES = [12, 24, 48];

let root = null;
let tick = null;
let feed = null;          // shugo schedule feed
let bosses = [];          // bundled boss table
let bossFeed = null;      // kill feed for the chosen server
let bossFeedAt = null;
let bossFeedFailed = false;
let hours = 24;
let showAll = false;
let lastMinute = -1;

async function loadStatic() {
  if (!feed) {
    feed = await (await fetch("data/shugo_timers.json")).json();
    try {
      const fresh = await (await fetch(FEED_BASE + "shugo_timers.json", { cache: "no-store" })).json();
      if (fresh.regions && fresh.events && (fresh.updatedAt || "") >= (feed.updatedAt || "")) feed = fresh;
    } catch (e) { /* bundled copy stays */ }
  }
  if (!bosses.length) bosses = (await (await fetch("data/field_bosses.json")).json()).bosses;
}

async function loadBossFeed() {
  const server = bp().fieldboss_server;
  try {
    const data = await (await fetch(`${FEED_BASE}feeds/${server}.json`, { cache: "no-store" })).json();
    if (!data.ok) throw new Error("feed not ok");
    bossFeed = data;
    bossFeedAt = new Date((data.mirroredAt || data.now) * 1000);
    bossFeedFailed = false;
  } catch (e) {
    bossFeedFailed = true;
  }
  draw();
}

function region() {
  return feed.regions.find((r) => r.id === bp().timers_region) || feed.regions[0];
}

function statusText(status, now) {
  if (!status.known) return "No data";
  const text = status.up ? "Spawned" : `Time left ${hms(timeLeft(status, now))}`;
  return text + (status.estimated ? " (est.)" : "");
}

function isMarkedDone(status) {
  const stamp = bp().fieldboss_done[status.boss.id];
  if (!stamp) return false;
  const doneAt = new Date(stamp);
  return !(status.known && status.since && status.since > doneAt);
}

function artworkTooltip(artwork) {
  const lines = [`<b>${escapeHtml(artwork.name)}</b>`, `${escapeHtml(artwork.grade)} · ${artwork.chance || 0}%`];
  if (artwork.effects && artwork.effects.length) {
    lines.push("<b>Pantheon effect</b>");
    for (const [name, value] of artwork.effects) lines.push(`${escapeHtml(name)}: +${escapeHtml(value)}`);
  }
  return lines.join("<br>");
}

function bossCard(status, now, tracked) {
  const boss = status.boss;
  const art = boss.artwork;
  const done = tracked && isMarkedDone(status);
  return `<div class="card boss${done ? " dim" : ""}">
    <img class="portrait" src="assets/field_bosses/${boss.image}" alt="">
    <div class="grow text"><div class="name"><b>${escapeHtml(boss.name)}</b></div><div class="muted small">${escapeHtml(boss.zone)} · Lv ${boss.level} · ${boss.faction === "asmo" ? "Asmo" : "Elyos"}</div></div>
    ${art ? `<img class="artwork" src="assets/field_bosses/${art.image}" alt="" data-tip="${escapeHtml(artworkTooltip(art))}">` : ""}
    <div class="state${status.up ? " up" : ""}" data-boss="${boss.id}">${statusText(status, now)}</div>
    ${tracked ? `<label class="row small"><input type="checkbox" data-done="${boss.id}" ${done ? "checked" : ""}> Done</label>` : ""}
  </div>`;
}

function timelineRows(events, reg, now) {
  const end = new Date(now.getTime() + hours * 3600000);
  return events.map((event) => {
    let found = occurrences(event, reg, new Date(now.getTime() - 3600000), end, now).filter((o) => o.end > now || o.end.getTime() === o.start.getTime());
    let empty = "";
    if (!found.length) {
      const nxt = nextOccurrence(event, reg, now);
      if (nxt) empty = `Next ${dayWord(nxt.start, now)} ${localClock(nxt.start)} · in ${countdown(nxt.start - now)}`;
    }
    return { name: event.name, occurrences: found, isReset: event.kind === "reset", empty };
  });
}

function drawTimeline(canvas, rows, now) {
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth || 900;
  const LABEL = 200, ROW = 36, TOP = 30, BOTTOM = 8, RIGHT = 12;
  const height = TOP + rows.length * ROW + BOTTOM;
  canvas.width = width * dpr; canvas.height = height * dpr; canvas.style.height = height + "px";
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  const css = getComputedStyle(document.documentElement);
  const color = (name) => css.getPropertyValue(name).trim();
  const x = (date) => LABEL + ((date - now) / (hours * 3600000)) * (width - LABEL - RIGHT);
  ctx.font = "11px " + color("--font");
  const step = hours >= 48 ? 6 : hours >= 24 ? 3 : 1;
  const first = new Date(now); first.setMinutes(0, 0, 0); first.setHours(first.getHours() + 1);
  for (let t = new Date(first); t <= new Date(now.getTime() + hours * 3600000); t.setHours(t.getHours() + 1)) {
    const px = x(t);
    const labelled = t.getHours() % step === 0;
    ctx.strokeStyle = labelled ? color("--border") : "rgba(59,72,99,0.35)";
    ctx.setLineDash(t.getHours() === 0 ? [4, 3] : []);
    ctx.beginPath(); ctx.moveTo(px, TOP - 6); ctx.lineTo(px, height - BOTTOM); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = color("--muted");
    ctx.textAlign = "center";
    if (labelled) ctx.fillText(localClock(t), px, 12);
    if (t.getHours() === 0) { ctx.textAlign = "left"; ctx.fillText("Tomorrow", px + 4, TOP - 8); }
  }
  ctx.strokeStyle = color("--accent"); ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(LABEL, TOP - 6); ctx.lineTo(LABEL, height - BOTTOM); ctx.stroke();
  ctx.lineWidth = 1; ctx.fillStyle = color("--accent"); ctx.textAlign = "left"; ctx.font = "bold 11px " + color("--font");
  ctx.fillText("Now", LABEL + 4, 12);
  rows.forEach((row, i) => {
    const top = TOP + i * ROW;
    ctx.fillStyle = "rgba(28,39,64,0.5)";
    ctx.fillRect(LABEL, top + 5, width - LABEL - RIGHT, ROW - 10);
    ctx.fillStyle = color("--fg"); ctx.font = "bold 12px " + color("--font"); ctx.textAlign = "left";
    ctx.fillText(row.name.length > 26 ? row.name.slice(0, 25) + "…" : row.name, 8, top + ROW / 2 + 4);
    if (!row.occurrences.length) {
      ctx.fillStyle = color("--muted"); ctx.font = "11px " + color("--font");
      ctx.fillText(row.empty, LABEL + 8, top + ROW / 2 + 4);
      return;
    }
    for (const o of row.occurrences) {
      const x0 = Math.max(LABEL, x(o.start)), x1 = Math.min(width - RIGHT, x(o.end));
      if (row.isReset) {
        ctx.strokeStyle = color("--warn"); ctx.setLineDash([4, 3]); ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x0, top + 5); ctx.lineTo(x0, top + ROW - 5); ctx.stroke();
        ctx.setLineDash([]); ctx.lineWidth = 1;
        continue;
      }
      ctx.fillStyle = isRunning(o, now) ? color("--accent") : "rgba(148,163,184,0.45)";
      ctx.fillRect(x0, top + 8, Math.max(6, x1 - x0), ROW - 16);
      if (o.portalEnd) {
        ctx.fillStyle = color("--secondary");
        ctx.fillRect(x0, top + 8, Math.max(4, Math.min(width - RIGHT, x(o.portalEnd)) - x0), ROW - 16);
      }
    }
  });
  canvas.dataset.rows = JSON.stringify(rows.map((r) => ({ name: r.name, spans: r.occurrences.map((o) => [o.start.getTime(), o.end.getTime()]) })));
  canvas.dataset.geom = JSON.stringify({ LABEL, ROW, TOP, width, RIGHT, now: now.getTime(), hours });
}

function eventCard(event, reg, now) {
  const nxt = nextOccurrence(event, reg, now);
  const big = !nxt ? "—" : isRunning(nxt, now) ? `Running, ends in ${hms(nxt.end - now)}` : hms(nxt.start - now);
  const small = !nxt ? "No upcoming time" : isRunning(nxt, now) ? "" : spanText(nxt, now);
  const upcoming = occurrences(event, reg, new Date(now.getTime() - 7200000), new Date(now.getTime() + 8 * 86400000), now).filter((o) => o.end > now || o.end.getTime() === o.start.getTime()).slice(0, 3);
  return `<div class="card event stack" data-event="${event.id}">
    <div><b>${escapeHtml(event.name)}</b></div>
    <div class="muted small">${String(event.kind || "").toUpperCase()} · ${escapeHtml(scheduleSummary(eventSchedule(event, reg.id), reg))}</div>
    <div class="row"><span class="accent small">NEXT IN</span><span class="next">${big}</span><span class="muted small next-small">${small}</span></div>
    ${upcoming.length ? `<div class="chips">${upcoming.map((o) => `<span>${spanText(o, now)}</span>`).join("")}</div>` : ""}
    <div class="muted small">${escapeHtml(event.description || "")}</div>
  </div>`;
}

export function draw() {
  if (!root || !feed) return;
  const now = new Date();
  const p = bp();
  const reg = region();
  const events = feed.events.filter((e) => eventSchedule(e, reg.id));
  const trackedIds = new Set(p.fieldboss_tracked || []);
  let pool = bosses;
  if (p.fieldboss_only_artwork) pool = pool.filter(dropsYellowArtwork);
  const tracked = bossStatuses(bosses.filter((b) => trackedIds.has(b.id)), bossFeed, now).sort((a, b) => isMarkedDone(a) - isMarkedDone(b));
  const every = bossStatuses(pool.filter((b) => !trackedIds.has(b.id)), bossFeed, now);
  const soon = every.filter((s) => isSoon(s, now));
  const shown = showAll ? every : soon;
  const feedStatus = bossFeed ? `Live feed mirrored ${localClock(bossFeedAt)} · aion2timers.com (AbyssLogs meter kills)${bossFeedFailed ? " · refresh failed" : ""}` : bossFeedFailed ? "Live feed unavailable" : "Loading the live feed…";
  root.innerHTML = `
    <div class="row" style="margin-bottom:6px"><h1>Timers</h1><span class="accent small">Feed updated ${escapeHtml(feed.updatedAt || "?")} · shugo.gg</span><span class="grow"></span>
      <label class="small muted">Region <select id="region">${feed.regions.map((r) => `<option value="${r.id}" ${r.id === reg.id ? "selected" : ""}>${escapeHtml(r.label)}</option>`).join("")}</select></label>
      <label class="small muted">Server <select id="server">${SERVERS.map(([name, list]) => `<optgroup label="${name}">${list.map(([id, label]) => `<option value="${id}" ${id === p.fieldboss_server ? "selected" : ""}>${label}</option>`).join("")}</optgroup>`).join("")}</select></label>
      <label class="small muted row"><input type="checkbox" id="artwork-only" ${p.fieldboss_only_artwork ? "checked" : ""}> Only yellow Artwork bosses</label>
      ${RANGES.map((h) => `<button data-hours="${h}" class="${h === hours ? "active" : ""}">${h}h</button>`).join("")}
      <button id="refresh">Refresh</button></div>
    <div class="legend" style="margin-bottom:10px">Blocks: running in the accent colour, upcoming in grey, the Rift's portal window in purple; a dashed line is a reset. Times are your local time zone; hover a block for its times.</div>
    <div class="row" style="margin-bottom:6px"><h3>Tracked bosses</h3><button id="select-bosses">Select bosses…</button></div>
    ${tracked.length ? `<div class="grid bosses" style="margin-bottom:12px">${tracked.map((s) => bossCard(s, now, true)).join("")}</div>` : '<div class="muted small" style="margin-bottom:12px">No bosses tracked yet.</div>'}
    <div class="row" style="margin-bottom:6px"><h3>Field bosses within 1 hour · ${escapeHtml(serverLabel(p.fieldboss_server))}</h3><button id="show-all" class="${showAll ? "active" : ""}">Show all (${every.length})</button><span class="grow"></span><span class="muted small">${feedStatus}</span></div>
    ${shown.length ? `<div class="grid bosses" style="margin-bottom:14px">${shown.map((s) => bossCard(s, now, false)).join("")}</div>` : `<div class="muted small" style="margin-bottom:14px">${bossFeed ? "Nothing spawned or spawning within the hour." : ""}</div>`}
    <canvas id="timeline"></canvas>
    <div class="grid cols-3" style="margin-top:12px">${events.map((e) => eventCard(e, reg, now)).join("")}</div>
    <div id="tooltip" class="tooltip" hidden></div>`;
  drawTimeline(root.querySelector("#timeline"), timelineRows(events, reg, now), now);
  root.querySelector("#region").addEventListener("change", (e) => { p.timers_region = e.target.value; save(); draw(); });
  root.querySelector("#server").addEventListener("change", (e) => { p.fieldboss_server = e.target.value; save(); bossFeed = null; draw(); loadBossFeed(); });
  root.querySelector("#artwork-only").addEventListener("change", (e) => { p.fieldboss_only_artwork = e.target.checked; save(); draw(); });
  root.querySelectorAll("[data-hours]").forEach((b) => b.addEventListener("click", () => { hours = Number(b.dataset.hours); draw(); }));
  root.querySelector("#refresh").addEventListener("click", loadBossFeed);
  root.querySelector("#show-all").addEventListener("click", () => { showAll = !showAll; draw(); });
  root.querySelector("#select-bosses").addEventListener("click", selectBosses);
  root.querySelectorAll("[data-done]").forEach((box) => box.addEventListener("change", (e) => {
    if (e.target.checked) p.fieldboss_done[e.target.dataset.done] = new Date().toISOString(); else delete p.fieldboss_done[e.target.dataset.done];
    save(); draw();
  }));
  const tip = root.querySelector("#tooltip");
  root.querySelectorAll("[data-tip]").forEach((img) => {
    img.addEventListener("mouseenter", (e) => { tip.innerHTML = img.dataset.tip; tip.hidden = false; place(e); });
    img.addEventListener("mousemove", place);
    img.addEventListener("mouseleave", () => { tip.hidden = true; });
  });
  const canvas = root.querySelector("#timeline");
  canvas.addEventListener("mousemove", (e) => {
    const rect = canvas.getBoundingClientRect();
    const g = JSON.parse(canvas.dataset.geom); const rows = JSON.parse(canvas.dataset.rows);
    const i = Math.floor((e.clientY - rect.top - g.TOP) / g.ROW);
    const px = e.clientX - rect.left;
    const toX = (t) => g.LABEL + ((t - g.now) / (g.hours * 3600000)) * (g.width - g.LABEL - g.RIGHT);
    const row = rows[i];
    const hit = row && row.spans.find(([s, en]) => toX(s) - 4 <= px && px <= Math.max(toX(en), toX(s) + 6) + 4);
    if (!hit) { tip.hidden = true; return; }
    tip.innerHTML = `<b>${escapeHtml(row.name)}</b><br>${spanText({ start: new Date(hit[0]), end: new Date(hit[1]) }, new Date())}`;
    tip.hidden = false; place(e);
  });
  canvas.addEventListener("mouseleave", () => { tip.hidden = true; });
  function place(e) { tip.style.left = Math.min(window.innerWidth - 330, e.clientX + 14) + "px"; tip.style.top = (e.clientY + 14) + "px"; }
  lastMinute = now.getMinutes();
}

function selectBosses() {
  const p = bp();
  const dialog = document.createElement("dialog");
  const list = ["elyos", "asmo"].map((faction) => `<h3>${faction === "asmo" ? "Asmo" : "Elyos"}</h3>` + bosses.filter((b) => b.faction === faction).map((b) =>
    `<label class="row small"><input type="checkbox" value="${b.id}" ${(p.fieldboss_tracked || []).includes(b.id) ? "checked" : ""}> ${escapeHtml(b.name)} · ${escapeHtml(b.zone)} · ${Math.floor(b.cycle_minutes / 60)}h${b.artwork ? ` · Artwork (${b.artwork.grade})` : ""}</label>`).join("")).join("");
  dialog.innerHTML = `<form method="dialog" class="stack"><h2>Tracked bosses</h2><div class="muted small">Tick the bosses to keep on top. Mark each one done after you kill it; the mark clears by itself when the boss spawns again.</div><div class="list">${list}</div><div class="row"><span class="grow"></span><button value="ok">Select</button><button value="cancel">Cancel</button></div></form>`;
  document.body.appendChild(dialog);
  dialog.addEventListener("close", () => {
    if (dialog.returnValue === "ok") {
      p.fieldboss_tracked = [...dialog.querySelectorAll("input:checked")].map((i) => i.value);
      save(); draw();
    }
    dialog.remove();
  });
  dialog.showModal();
}

function onTick() {
  if (!root || !feed) return;
  const now = new Date();
  if (now.getMinutes() !== lastMinute) {
    draw();
    if (!bossFeedAt || now - bossFeedAt > 60000) loadBossFeed();
    return;
  }
  const reg = region();
  for (const el of root.querySelectorAll("[data-event]")) {
    const event = feed.events.find((e) => e.id === el.dataset.event);
    const nxt = nextOccurrence(event, reg, now);
    el.querySelector(".next").textContent = !nxt ? "—" : isRunning(nxt, now) ? `Running, ends in ${hms(nxt.end - now)}` : hms(nxt.start - now);
  }
  const statuses = bossStatuses(bosses, bossFeed, now);
  for (const el of root.querySelectorAll("[data-boss]")) {
    const status = statuses.find((s) => s.boss.id === el.dataset.boss);
    if (status && status.known && !status.up) el.textContent = statusText(status, now);
  }
}

export async function mount(main) {
  root = main;
  main.innerHTML = '<div class="muted">Loading…</div>';
  await loadStatic();
  draw();
  loadBossFeed();
  tick = setInterval(onTick, 1000);
}

export function unmount() {
  clearInterval(tick);
  root = null;
}
