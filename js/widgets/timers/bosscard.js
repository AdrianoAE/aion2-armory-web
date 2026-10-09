// Boss cards, the live-feed line and the map dialog, shared by the tracked
// bosses and the boss list.

import { bp, save } from "../../state.js";
import { durationText } from "../../engine/planner.js";
import { factionLabel, isMarkedDone, serverLabel } from "../../engine/fieldboss.js";
import { bossById, esc, feedStatus, fetchFeed, openSettings, serverId, until } from "./feed.js";
import { hoverable } from "./hovercard.js";

const IMG = "assets/field_bosses/";
const MAPS = "assets/field_boss_maps/";

export const factionClass = (boss) => (boss.faction === "asmo" ? "asmo" : "elyos");

export function isDone(status) {
  return isMarkedDone(status, (bp().fieldboss_done || {})[status.boss.id]);
}

export function stateHtml(status) {
  if (!status.known) return '<span class="tm-state none">No data</span>';
  const est = status.estimated ? ' <span class="tm-est" title="Estimated from the respawn cycle">est.</span>' : "";
  if (status.up) return `<span class="tm-state up">Spawned${est}</span>`;
  if (!status.nextSpawn) return '<span class="tm-state none">Unknown</span>';
  return `<span class="tm-state wait">${until(status.nextSpawn, { done: "Due now" })}${est}</span>`;
}

export function bossCardHtml(status, { tracked = false, showDone = false } = {}) {
  const boss = status.boss;
  const faction = factionClass(boss);
  const done = showDone && isDone(status);
  const art = boss.artwork;
  const map = boss.map
    ? `<button type="button" class="tm-map-btn" data-map="${esc(boss.id)}" title="Show where ${esc(boss.name)} spawns">Map</button>`
    : `<a class="tm-map-btn" href="${esc(boss.page)}" target="_blank" rel="noopener" title="Open the boss page on wikily.gg">Map</a>`;
  return `<div class="tm-boss faction-${faction}${done ? " done" : ""}${status.up ? " up" : ""}" data-boss="${esc(boss.id)}">
    ${boss.image ? `<img class="tm-portrait" src="${IMG}${esc(boss.image)}" alt="" loading="lazy">` : '<span class="tm-portrait"></span>'}
    <div class="tm-boss-main">
      <div class="tm-boss-name" title="${esc(boss.name)}">${esc(boss.name)}</div>
      <div class="tm-boss-meta">${esc(boss.zone)} · Lv ${esc(boss.level)} · every ${esc(durationText((boss.cycle_minutes || 0) * 60000))}</div>
      <div class="tm-boss-tags"><span class="tag ${faction}">${factionLabel(boss.faction)}</span>${art ? `<span class="tag warn">Artwork ${esc(art.grade || "")}</span>` : ""}${done ? '<span class="tag success">Done</span>' : ""}</div>
    </div>
    ${art && art.image ? `<img class="tm-artwork" src="${IMG}${esc(art.image)}" alt="${esc(art.name)}" data-artwork="${esc(boss.id)}" tabindex="0">` : ""}
    <div class="tm-boss-side">
      ${stateHtml(status)}
      <div class="tm-boss-actions">
        ${showDone ? `<label class="tm-done" title="Killed it: the mark clears by itself when the boss spawns again"><input type="checkbox" data-done="${esc(boss.id)}" ${done ? "checked" : ""}> Done</label>` : ""}
        <button type="button" class="tm-track" data-track="${esc(boss.id)}" aria-pressed="${tracked}" title="${tracked ? "Stop tracking" : "Track this boss"}">${tracked ? "★" : "☆"}</button>
        ${map}
      </div>
    </div>
  </div>`;
}

export function feedLineHtml(server, now) {
  const { state, age, failed } = feedStatus(server, now);
  let level = "fresh";
  let text;
  if (!state.data) {
    level = failed ? "stale" : "fresh";
    text = failed ? "Live feed unavailable" : "Loading the live feed…";
  } else {
    level = age.level;
    text = `Live feed updated ${age.text}${age.level === "stale" ? ": the mirror is stale" : ""}${failed ? " · the last refresh failed" : ""}`;
  }
  return `<div class="tm-feed tm-feed-${level}" title="Kill times from aion2timers.com, mirrored to this site every few minutes by a scheduled GitHub job. GitHub runs it on a best-effort basis, often late.">
    <span class="tm-feed-dot" aria-hidden="true"></span><span class="tm-feed-text">${esc(text)}</span><span class="tm-feed-server">${esc(serverLabel(server))}</span>
    <button type="button" class="link" data-refresh ${state.pending ? "disabled" : ""}>${state.pending ? "Refreshing…" : "Refresh"}</button>
  </div>`;
}

function artworkHtml(boss) {
  const art = boss.artwork;
  if (!art) return "";
  const effects = art.effects || [];
  return `<div class="tm-hc tm-hc-art">
    <div class="tm-hc-head">${art.image ? `<img src="${IMG}${esc(art.image)}" alt="">` : ""}<div><b>${esc(art.name)}</b><div class="muted small">${esc(art.grade)} · ${esc(art.chance || 0)}% drop from ${esc(boss.name)}</div></div></div>
    ${effects.length ? `<div class="tm-hc-sub">Pantheon effect</div><div class="tm-effects">${effects.map(([name, value]) => `<span>${esc(name)}</span><b>+${esc(value)}</b>`).join("")}</div>` : '<div class="muted small">No Pantheon effect listed.</div>'}
  </div>`;
}

function regionName(file) {
  const name = String(file || "").replace(/^region_/, "").replace(/\.\w+$/, "").replace(/-/g, " ");
  return name.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function openMap(boss) {
  const faction = factionClass(boss);
  const region = boss.map_region ? regionName(boss.map_region) : "";
  const dialog = document.createElement("dialog");
  dialog.className = `tm-map-dialog faction-${faction}`;
  dialog.setAttribute("aria-label", `Map: ${boss.name}`);
  const pins = (boss.map_points || []).map(([x, y]) => `<span class="tm-map-pin" style="left:${(x * 100).toFixed(2)}%;top:${(y * 100).toFixed(2)}%"></span>`).join("");
  dialog.innerHTML = `<div class="tm-map-head">
      <span class="tag ${faction}">${factionLabel(boss.faction)}</span>
      <h2>${esc(boss.name)}</h2>
      <span class="muted small">${esc(boss.zone)}</span>
      <span class="grow"></span>
      <a class="small" href="${esc(boss.page)}" target="_blank" rel="noopener">Boss page on wikily.gg</a>
      <button type="button" data-close autofocus>Close</button>
    </div>
    ${boss.map ? `<figure class="tm-map-close"><img src="${MAPS}${esc(boss.map)}" alt="Map around the spawn point of ${esc(boss.name)}"><figcaption>The ringed marker is the spawn point in ${esc(boss.zone)}.</figcaption></figure>` : ""}
    <div class="tm-map-lower">
      ${boss.map_region ? `<figure class="tm-map-region"><div class="tm-map-frame"><img src="${MAPS}${esc(boss.map_region)}" alt="Map of ${esc(region)}">${pins}</div><figcaption>${esc(region)}</figcaption></figure>` : ""}
      <dl class="tm-map-facts">
        <dt>Zone</dt><dd>${esc(boss.zone)}${region ? ` · ${esc(region)}` : ""}</dd>
        <dt>Level</dt><dd>${esc(boss.level)} · ${esc(boss.grade || "")}</dd>
        <dt>Respawn</dt><dd>every ${esc(durationText((boss.cycle_minutes || 0) * 60000))}</dd>
        ${boss.artwork ? `<dt>Artwork</dt><dd>${esc(boss.artwork.name)} (${esc(boss.artwork.grade)}, ${esc(boss.artwork.chance || 0)}%)</dd>` : ""}
      </dl>
    </div>`;
  document.body.appendChild(dialog);
  dialog.addEventListener("close", () => dialog.remove());
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog || e.target.closest("[data-close]")) dialog.close();
  });
  dialog.showModal();
  return dialog;
}

export function wireBosses(el) {
  const onClick = (e) => {
    const map = e.target.closest("[data-map]");
    if (map) {
      const boss = bossById(map.dataset.map);
      if (boss) openMap(boss);
      return;
    }
    const track = e.target.closest("[data-track]");
    if (track) {
      const p = bp();
      const id = track.dataset.track;
      const list = p.fieldboss_tracked || [];
      p.fieldboss_tracked = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
      save();
      return;
    }
    const refresh = e.target.closest("[data-refresh]");
    if (refresh) {
      refresh.disabled = true;
      refresh.textContent = "Refreshing…";
      fetchFeed(serverId(), { force: true });
      return;
    }
    if (e.target.closest("[data-choose]")) openSettings(el);
  };
  const onChange = (e) => {
    const box = e.target.closest("[data-done]");
    if (!box) return;
    const p = bp();
    p.fieldboss_done = p.fieldboss_done || {};
    if (box.checked) p.fieldboss_done[box.dataset.done] = new Date().toISOString();
    else delete p.fieldboss_done[box.dataset.done];
    box.blur();
    save();
  };
  el.addEventListener("click", onClick);
  el.addEventListener("change", onChange);
  const stopHover = hoverable(el, "[data-artwork]", (target) => {
    const boss = bossById(target.dataset.artwork);
    return boss ? artworkHtml(boss) : "";
  });
  return () => {
    el.removeEventListener("click", onClick);
    el.removeEventListener("change", onChange);
    stopHover();
  };
}
