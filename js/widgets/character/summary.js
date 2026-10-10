import { characterWidget, className, escapeHtml, kindChipsHtml, loadPage, ODYLE_MAX, odyleLevel, progressOf, targetOf } from "./common.js";
import { bp } from "../../state.js";

let gearScoreOf = null;

function loadGearScore() {
  if (!gearScoreOf) {
    gearScoreOf = loadPage("equipment").then(async (mod) => { await mod.ready(); return mod.gearScore; });
    gearScoreOf.catch(() => { gearScoreOf = null; });
  }
  return gearScoreOf;
}

function itemLevelHtml(target) {
  const synced = (bp().official_characters || {})[target.entry && target.entry.key];
  if (!synced || !Number(synced.itemLevel)) return "";
  return `<div class="cw-ilvl" title="Item level in game, from aion2.plaync.com · last sync ${escapeHtml(new Date(synced.importedAt).toLocaleString())}"><span class="muted">Item level</span> <b>${Number(synced.itemLevel).toLocaleString()}</b></div>`;
}

function odyleHtml(energy) {
  if (energy == null) return '<div class="cw-odyle muted small">Odyle not tracked yet</div>';
  const percent = Math.max(0, Math.min(100, (energy / ODYLE_MAX) * 100));
  return `<div class="cw-odyle ${odyleLevel(energy)}" title="Odyle energy ${energy} of ${ODYLE_MAX}">
      <span class="cw-odyle-label">Odyle</span><b>${energy}/${ODYLE_MAX}</b>
      <span class="cw-odyle-bar"><i style="width:${percent.toFixed(1)}%"></i></span></div>`;
}

characterWidget({
  id: "character.summary",
  title: "Character",
  description: "Class, name, Build and preset, Odyle energy, checklist progress and GearScore.",
  accent: "accent",
  defaultSize: { cols: 1, rows: "auto" },
  page: null,
  live: true,
  fill(box, target, ctx) {
    const progress = progressOf(target.name, ctx.now) || { odyle: null, kinds: [] };
    const build = target.build && target.preset && target.build !== target.preset ? `${target.build} · ${target.preset}` : target.preset || target.build || "";
    box.classList.add(`class-${target.cls}`);
    box.innerHTML = `<div class="cw-id">
        <img class="cw-class-icon" src="assets/class_icons/${escapeHtml(target.cls)}.png" alt="" title="${escapeHtml(className(target.cls))}">
        <div class="cw-id-text"><div class="cw-name">${escapeHtml(target.name || "Unnamed")}</div>
          <div class="cw-build muted small" title="Build · Preset">${escapeHtml(className(target.cls))}${build ? ` · ${escapeHtml(build)}` : ""}</div></div>
        ${itemLevelHtml(target)}<div class="cw-gs" title="GearScore calculated from this preset"><span class="muted">GS</span> <b class="cw-gs-value">…</b></div>
      </div>
      ${odyleHtml(progress.odyle)}
      ${progress.kinds.length ? `<div class="cw-chips">${kindChipsHtml(progress.kinds)}</div>` : ""}`;
    box.afterAttach = () => loadGearScore().then(
      (gearScore) => { box.querySelector(".cw-gs-value").textContent = Math.round(gearScore(target.cls, target.preset) || 0).toLocaleString(); },
      () => box.querySelector(".cw-gs").remove(),
    );
  },
  compact(el, ctx) {
    const target = targetOf(ctx.settings);
    if (!target || target.missing) { el.innerHTML = '<span class="muted small">No character</span>'; return; }
    const progress = progressOf(target.name, ctx.now) || { odyle: null, kinds: [] };
    const parts = [`<b class="cw-compact-name">${escapeHtml(target.name || "Unnamed")}</b>`];
    if (progress.odyle != null) parts.push(`<span class="cw-compact-odyle ${odyleLevel(progress.odyle)}">Odyle ${progress.odyle}/${ODYLE_MAX}</span>`);
    const daily = progress.kinds.find((k) => k.kind === "daily");
    if (daily) parts.push(`<span class="${daily.done >= daily.total ? "cw-done" : "cw-kind-daily"}">Daily ${daily.done}/${daily.total}</span>`);
    el.innerHTML = `<div class="cw-compact class-${target.cls}"><img class="cw-class-icon" src="assets/class_icons/${escapeHtml(target.cls)}.png" alt="">${parts.join('<span class="muted"> · </span>')}</div>`;
  },
});
