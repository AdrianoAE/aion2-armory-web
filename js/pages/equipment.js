// Equipment page: equip sets, slot paperdoll, item picker, the inline
// Equipment Item panel, Stat Values, Quick Select, the Property
// Priority editor, EQ Priority and Build Compare.

import { bp, save } from "../state.js";
import * as D from "./equipment_data.js";
import {
  ARMOR_CATEGORIES, BELT_CATEGORY, DEFENSE_STAT_ID, HP_STAT_ID, SCALING_STAT_ID, RUNE_PVE_ITEM_ID, RUNE_PVP_ITEM_ID,
  estimateArmorBonus, estimateArmorExceedBonus, estimateEnchantBonus, estimateExceedBonus, gearscorePush, runeEnchantBonus,
} from "../engine/enchant.js";
import {
  DEFAULT_STAT_PRIORITY_BY_CATEGORY, STAT_PRIORITY_GEAR_TYPES, STAT_PRIORITY_MAX_ENTRIES, STAT_PRIORITY_ROLES,
  mergeStatPriorityProfiles, pickPrioritySubstats,
} from "../engine/substats.js";
import * as transfer from "../engine/transfer.js";
import { arcanaLordPointsByLord, linkedSkillBuildName, loadArcanaData } from "./arcana.js";
import { geniusStatTotals, linkedGeniusBuildName } from "./genius.js";
import { loadPantheonData, pantheonLordTotals } from "./pantheon.js";
import { currentBoardStatTotals, prepare as prepareDaevanion, variantData } from "./daevanion.js";
import { arcanaScore, daevanionScore } from "../engine/stats.js";
import { passiveSkillStatTotals, ready as skillsReady } from "../engine/skills.js";

const { T, escapeHtml: h, formatNumber: fmt } = D;

let main = null;
let unsubscribe = null;
let picker = null;
const ui = {
  view: "normal", slot: null, statMode: "pve", statTab: "main", onlySelected: false, substatsTab: "substats", sections: {},
  pickOrder: {}, compare: { a: null, b: null, category: "main" }, editor: null, message: "",
};

// --- state -------------------------------------------------------------------
const className = () => String(bp().character_class || "Gladiator");
const classKey = () => className().toLowerCase();
const emptyBuild = () => ({ equipped: {}, substats: {}, enchant: {}, philosopher_stone: {}, priority: {}, priority_progress: {} });

function buildsOf(key) {
  const p = bp();
  p.equip_builds_data[key] = p.equip_builds_data[key] || {};
  if (!Object.keys(p.equip_builds_data[key]).length) p.equip_builds_data[key].Default = emptyBuild();
  return p.equip_builds_data[key];
}
function normalizeBuild(b) {
  for (const key of ["equipped", "substats", "enchant", "philosopher_stone", "priority", "priority_progress", "manastones"]) if (!b[key] || typeof b[key] !== "object") b[key] = {};
  return b;
}
function build() {
  const p = bp();
  const builds = buildsOf(classKey());
  if (!(p.current_build_name in builds)) p.current_build_name = Object.keys(builds)[0];
  return normalizeBuild(builds[p.current_build_name]);
}
function activeGearTypes() {
  const p = bp();
  if (!Array.isArray(p.active_gear_types)) p.active_gear_types = ["PvE", "Neutral"];
  return p.active_gear_types;
}
const profiles = () => mergeStatPriorityProfiles(bp().stat_priority_profiles);
const slotLabel = (slotId) => D.SLOT_LABELS[slotId] || slotId;
const classSkills = (type) => (D.data.skillsByClass[D.skillsClassKey(className())] || []).filter((s) => s.type === type);
const detailOf = (item) => (item && item.id ? D.detailCache.get(item.id) || null : null);
const substatsOf = (b, slot) => new Set(b.substats[slot] || []);
function setSubstats(b, slot, set) { b.substats[slot] = [...set].sort((x, y) => x - y); }

function skillOptionsFor(detail) {
  if (!detail || !Number(detail.subSkillCountMax || 0)) return [];
  return classSkills(D.ACTIVE_SUBSKILL_SLOT_CATEGORIES.has(detail.categoryName) ? "active" : "passive");
}
function effectiveCap(detail, slot, b) {
  const count = Number((detail && detail.subStatCount) || 0);
  return count ? count + (b.philosopher_stone[slot] ? 1 : 0) : 0;
}

// --- icons -----------------------------------------------------------------
function iconHtml(item, size = "", extraClass = "", faded = false) {
  const grade = item && item.grade;
  const cls = `eq-icon ${size} ${grade && D.GRADE_COLORS[grade] ? "grade-" + grade : "grade-none"} ${extraClass}`;
  const img = item && item.image ? `<img src="${h(item.image)}" alt="" loading="lazy"${faded ? ' class="faded"' : ""}>` : "";
  return `<span class="${cls}">${img}</span>`;
}
function placeholderHtml(slotId) {
  const name = D.SLOT_PLACEHOLDER[slotId];
  if (name) return `<img class="eq-placeholder" src="assets/slot_placeholders/equipment/${name}.png" alt="">`;
  const rep = D.SYNTHETIC_SLOT_PLACEHOLDER_ITEM[slotId];
  return rep ? iconHtml(rep, "", "", true) : "";
}

// --- page --------------------------------------------------------------------
export function mount(el) {
  main = el;
  if (!document.querySelector('link[href$="css/equipment.css"]')) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "css/equipment.css";
    document.head.appendChild(link);
  }
  ui.view = "normal"; ui.slot = null; ui.editor = null; ui.message = "";
  main.innerHTML = `<div class="muted">${T.loading_details}</div>`;
  main.addEventListener("click", onClick);
  main.addEventListener("change", onChange);
  main.addEventListener("input", onInput);
  document.addEventListener("keydown", onKeydown);
  unsubscribe = D.onDetailReady(onDetailReady);
  ready().then(() => { if (main !== el) return; D.requestDetails(build().equipped); draw(); });
}

export function unmount() {
  closePicker();
  for (const dialog of document.querySelectorAll("dialog.eq-dialog")) dialog.remove();
  if (main) {
    main.removeEventListener("click", onClick);
    main.removeEventListener("change", onChange);
    main.removeEventListener("input", onInput);
  }
  document.removeEventListener("keydown", onKeydown);
  if (unsubscribe) unsubscribe();
  unsubscribe = null;
  main = null;
}

function onDetailReady(itemId) {
  if (!main) return;
  const b = build();
  const equippedIds = new Set(Object.values(b.equipped).map((it) => it && it.id));
  if (ui.view === "compare") {
    const builds = buildsOf(classKey());
    for (const name of [ui.compare.a, ui.compare.b]) for (const it of Object.values((builds[name] || {}).equipped || {})) equippedIds.add(it && it.id);
  }
  if (equippedIds.has(itemId)) draw();
}

function draw() {
  if (!main || !D.data.loaded) return;
  let html = `<div class="eq">`;
  if (ui.view !== "priority") html += topBar();
  if (ui.message) html += `<div class="card eq-message row"><span class="grow">${h(ui.message)}</span><button class="icon" data-action="message-close">✕</button></div>`;
  html += `<div class="eq-view">${{ compare: comparePage, priority: priorityPage, editor: editorPage }[ui.view]?.() ?? normalPage()}</div></div>`;
  main.innerHTML = html;
}

function topBar() {
  const p = bp();
  const builds = buildsOf(classKey());
  const b = build();
  const options = (names, current) => names.map((n) => `<option value="${h(n)}"${n === current ? " selected" : ""}>${h(n)}</option>`).join("");
  const skillBuilds = Object.keys((p.skill_builds_data || {})[classKey()] || {}) || [];
  const daevaBuilds = Object.keys((p.daevanion_builds_data || {})[classKey()] || {}) || [];
  const geniusBuilds = Object.keys(p.genius_builds_data || {}) || [];
  const linked = (list, current, fallback) => (list.includes(current) ? current : list.includes(fallback) ? fallback : list[0]);
  const skillList = skillBuilds.length ? skillBuilds : ["Default"];
  const daevaList = daevaBuilds.length ? daevaBuilds : ["Default"];
  const geniusList = geniusBuilds.length ? geniusBuilds : ["Default"];
  const types = activeGearTypes();
  return `<div class="eq-topbar">
    <div class="row eq-header">
      <select data-action="set-switch">${options(Object.keys(builds), p.current_build_name)}</select>
      <button data-action="compare-open" title="${T.build_compare_tooltip}">⇄ ${T.build_compare}</button>
      <button class="icon" data-action="set-add" title="${T.add_set}">＋</button>
      <button class="icon" data-action="set-duplicate" title="${T.duplicate_set}">⧉</button>
      <button class="icon" data-action="set-rename" title="${T.rename_set}">✎</button>
      <button class="icon" data-action="set-delete" title="${T.delete_set}"${Object.keys(builds).length > 1 ? "" : " disabled"}>✕</button>
      <span class="grow"></span>
      ${["PvP", "PvE", "Neutral"].map((k) => `<button data-action="gear-type" data-key="${k}"${types.includes(k) ? ' class="active"' : ""}>${k}</button>`).join("")}
      <span class="eq-label" style="margin-left:12px">${T.quick_select}</span>
      <button data-action="quick-gear">${T.equipment}</button>
      <button data-action="quick-stat"${Object.keys(b.equipped).length ? "" : " hidden"}>${T.properties}</button>
      <button class="icon" data-action="editor-open" title="${T.editor_title}">⚙</button>
    </div>
    <div class="row eq-settings">
      <span class="eq-label">${h(T.bp_title(p.current_build_name))}</span>
      <span class="eq-label">${T.bp_skill}</span><select data-action="link-skill">${options(skillList, linked(skillList, b.linked_skill_build, p.current_skill_build_name))}</select>
      <span class="eq-label">${T.bp_daevanion}</span><select data-action="link-daevanion">${options(daevaList, linked(daevaList, b.linked_daevanion_build, p.current_daevanion_build_name))}</select>
      <span class="eq-label">${T.bp_genius}</span><select data-action="link-genius">${options(geniusList, linked(geniusList, b.linked_genius_build, p.current_genius_build_name))}</select>
    </div>
  </div>`;
}

function normalPage() {
  return `<div class="eq-columns">
    <div class="eq-col"><h2>${T.equipment}</h2>${slotSections(D.LEFT_SECTIONS)}</div>
    <div class="eq-center">${ui.slot ? itemPanel() : statValues()}</div>
    <div class="eq-col eq-col-right"><h2>${T.jewelry}</h2>${slotSections(D.RIGHT_SECTIONS)}
      <div class="eq-priority-row"><button class="eq-priority-btn" data-action="priority-open">${T.eq_priority}</button></div></div>
  </div>`;
}

function slotSections(sections) {
  const b = build();
  return sections.map(([title, slots]) => `<div class="eq-section-label">${title}</div><div class="eq-slot-grid">${slots.map((slotId) => {
    const item = b.equipped[slotId];
    const level = item ? b.enchant[slotId] || 0 : 0;
    const title = item ? h(item.name || "") : h(T.slot_empty_tooltip(slotLabel(slotId)));
    return `<div class="eq-slot-cell"><button class="eq-slot${ui.slot === slotId ? " selected" : ""}" data-action="slot-select" data-slot="${slotId}" title="${title}">
      ${item ? iconHtml(item, "slot") : placeholderHtml(slotId)}</button>
      <div class="eq-slot-enchant" data-enchant-label="${slotId}">${level ? "+" + level : ""}</div></div>`;
  }).join("")}</div>`).join("");
}

// --- stat values -------------------------------------------------------------
function statRows(rows, columns, totals, sources, none = "—") {
  return `<div class="eq-stat-grid cols-${columns}">${rows.map(([name, sid]) => {
    if (!sid) return `<div class="eq-stat-cell"><span>${name}</span><span>${none}</span></div>`;
    const value = totals[sid] || 0;
    const suffix = D.PERCENT_STAT_IDS.has(sid) ? "%" : "";
    return `<div class="eq-stat-cell" title="${h(sourceTooltip(sid, value, suffix, sources))}"><span>${name}</span><span>${fmt(value)}${suffix}</span></div>`;
  }).join("")}</div>`;
}

function sourceTooltip(sid, value, suffix, s, effect = []) {
  const byGroup = {};
  for (const [slotId, v] of Object.entries(s.bySlot[sid] || {})) {
    if (!v) continue;
    const key = D.SLOT_TO_GROUP_LABEL[slotId] || slotLabel(slotId);
    byGroup[key] = (byGroup[key] || 0) + v;
  }
  const lines = Object.entries(byGroup).filter(([, v]) => v).map(([k, v]) => `${k}: ${fmt(v)}${suffix}`);
  if (s.wings[sid]) lines.push(`${T.stat_source_wings}: ${fmt(s.wings[sid])}${suffix}`);
  for (const [name, v] of Object.entries(s.byAttr[sid] || {})) if (v) lines.push(`${name}: ${fmt(v)}${suffix}`);
  for (const [name, v] of Object.entries(s.byLord[sid] || {})) if (v) lines.push(`${name}: ${fmt(v)}${suffix}`);
  for (const [name, v] of Object.entries(s.byLabel[sid] || {})) if (v) lines.push(`${name}: ${fmt(v)}${suffix}`);
  if (lines.length > 1) lines.push(`${T.stat_total}: ${fmt(value)}${suffix}`);
  const parts = [];
  if (lines.length) parts.push(`${T.stat_source}\n${lines.join("\n")}`);
  if (effect.length) parts.push(`${T.stat_effect}\n${effect.join("\n")}`);
  return parts.join("\n\n");
}

function statValues() {
  const b = build();
  const s = D.fullBuildTotals(b, statExtras(bp().current_build_name));
  const totals = s.totals;
  const gearParts = gearScoreParts(classKey(), bp().current_build_name) || { items: 0, daevanion: 0, arcana: 0, total: 0 };
  const gearscore = gearParts.total;
  const iconPanel = `<div class="eq-icon-panel">${D.STAT_ICON_ROWS.map((row) => `<div class="eq-icon-row">${row.map(([name, key, sid]) => {
    const value = totals[sid] || 0;
    let feeds = [];
    if (sid in D.ATTRIBUTE_STAT_IDS) feeds = D.ATTRIBUTE_STAT_IDS[sid].map((id) => `${D.STAT_ID_DISPLAY_NAME[id] || id}: ${fmt(value * D.ATTRIBUTE_RATE)}%`);
    else if (sid in D.LORD_POINTS_ID_TO_LORD) feeds = (D.ARCANA_LORD_STAT_IDS[D.LORD_POINTS_ID_TO_LORD[sid]] || []).map((id) => `${D.STAT_ID_DISPLAY_NAME[id] || id}: ${fmt(value * D.ARCANA_LORD_RATE)}%`);
    return `<div class="eq-icon-cell" title="${h(sourceTooltip(sid, value, "", s, feeds))}"><img src="assets/stat_icons/stat_${key}.png" alt=""><div class="name">${name}</div><div class="value">${fmt(value)}</div></div>`;
  }).join("")}</div>`).join("")}</div>`;

  const tabs = [["main", T.main_stats], ["sub", T.sub_stats], ["utility", T.utility], ["genius", T.genius]];
  let body = "";
  if (ui.statTab === "main") {
    const pvp = ui.statMode === "pvp";
    body = `<div class="row eq-mode-row"><span class="eq-section-label">${T.main_stats}</span><span class="grow"></span>
        <button data-action="stat-mode" data-mode="pve"${pvp ? "" : ' class="active"'}>PvE</button><button data-action="stat-mode" data-mode="pvp"${pvp ? ' class="active"' : ""}>PvP</button></div>
      ${statRows(D.MAIN_STAT_ROWS, 4, totals, s)}
      <div class="eq-section-label">${T.movement}</div>${statRows(D.MOVEMENT_STAT_ROWS, 4, totals, s)}
      <div class="eq-section-label">${pvp ? T.pvp_stats : T.pve_stats}</div>${statRows(pvp ? D.PVP_MODE_STAT_ROWS : D.PVE_MODE_STAT_ROWS, 4, totals, s)}
      ${pvp ? `<div class="eq-section-label">${T.status_chance}</div>${statRows(D.STATUS_CHANCE_STAT_ROWS, 3, totals, s)}
      <div class="eq-section-label">${T.status_resist}</div>${statRows(D.STATUS_RESIST_STAT_ROWS, 3, totals, s)}` : ""}`;
  } else if (ui.statTab === "sub") {
    body = `<div class="eq-section-label">${T.sub_stats}</div>${statRows(D.SUB_STAT_ROWS, 4, totals, s)}
      <div class="eq-section-label">${T.offense}</div>${statRows(D.OFFENSE_STAT_ROWS, 3, totals, s)}
      <div class="eq-section-label">${T.defense}</div>${statRows(D.DEFENSE_STAT_ROWS, 2, totals, s)}`;
  } else if (ui.statTab === "utility") {
    body = statRows(D.UTILITY_RECOVERY_STAT_ROWS, 2, totals, s);
  } else {
    body = statRows(D.GENIUS_BOARD_STAT_ROWS, 2, totals, s);
  }
  return `<div class="eq-stats">
    <h2>${T.stat_values}</h2>
    <div class="eq-gearscore" data-gearscore title="${h(gearScoreTitle(gearParts))}">GearScore: ${fmt(gearscore)}</div>
    ${iconPanel}
    <div class="eq-tabs">${tabs.map(([key, label]) => `<button data-action="stat-tab" data-tab="${key}"${ui.statTab === key ? ' class="active"' : ""}>${label}</button>`).join("")}</div>
    <div class="eq-tab-body card">${body}</div>
    <div class="eq-note">${T.stat_sum_note}</div>
  </div>`;
}

// --- equipment item panel ----------------------------------------------------
function itemPanel() {
  const b = build();
  const slotId = ui.slot;
  const item = b.equipped[slotId];
  return `<div class="eq-item-panel">
    <div class="row eq-item-head">
      <button class="icon" data-action="item-back" title="${T.back_to_stats}">←</button>
      ${item ? iconHtml(item, "small") : '<span class="eq-icon small grade-none empty"></span>'}
      <button class="eq-item-combo grow" data-action="item-combo">${item ? h(item.name || "") : h(T.choose_x(slotLabel(slotId)))}</button>
      <button class="icon" data-action="item-clear" title="${T.clear_slot}">✕</button>
    </div>
    <div class="eq-detail">${item ? detailWidget(b, slotId, item) : ""}</div>
  </div>`;
}

function enchantRange(detail) {
  const normalMax = Number(detail.maxEnchantLevel || 0);
  return [normalMax, normalMax + Number(detail.maxExceedEnchantLevel || 0)];
}

function detailWidget(b, slotId, item) {
  const detail = detailOf(item);
  if (detail === undefined || detail === null) {
    if (detail === undefined) D.requestDetail(item.id);
    return `<div class="eq-detail-top">${iconHtml(item, "big")}<div class="eq-detail-info"><div class="eq-detail-header">${h(item.name || "")}</div><div class="muted">${detail === null ? "—" : T.loading_details}</div></div></div>`;
  }
  const gradeName = detail.gradeName || detail.grade || "";
  const subHeader = [gradeName, detail.categoryName || ""].filter(Boolean).join(" · ");
  const sockets = [];
  if (detail.magicStoneSlotCount) sockets.push(`${detail.magicStoneSlotCount} Manastone`);
  if (detail.godStoneSlotCount) sockets.push(`${detail.godStoneSlotCount} Godstone`);
  const info = [];
  if (detail.equipLevel) info.push(`${T.required_level}: ${detail.equipLevel}`);
  if (sockets.length) info.push(sockets.join(" / "));
  info.push(`${T.source}: ${(detail.sources || []).length ? detail.sources.join(", ") : T.unknown}`);
  info.push(`${T.tradable}: ${detail.tradable ? T.yes : T.no}`);
  const enchantable = Boolean(detail.enchantable);
  const [, maxEnchant] = enchantRange(detail);
  const level = Math.min(b.enchant[slotId] || 0, Math.max(maxEnchant, 0));
  const ticks = Array.from({ length: maxEnchant + 1 }, (_, i) => `<option value="${i}"></option>`).join("");
  return `<div class="eq-detail-top">
      <div class="eq-detail-iconcol">${iconHtml(item, "big")}<div class="eq-detail-name">${h(item.name || "")}</div></div>
      <div class="eq-detail-info">
        <div class="eq-detail-header">${h(detail.name || item.name || "")}<br><span class="sub">${h(subHeader)}</span></div>
        <div class="eq-detail-lines">${info.map(h).join("<br>")}</div>
        ${enchantable ? `<div class="row eq-enchant-row"><span>${T.simulate_enchant}</span><span class="grow"></span><span class="eq-enchant-value" data-enchant-value>+${level}</span></div>
        <input type="range" class="eq-enchant-slider" min="0" max="${Math.max(maxEnchant, 0)}" value="${level}" step="1" list="eq-enchant-ticks" data-action="enchant"><datalist id="eq-enchant-ticks">${ticks}</datalist>` : ""}
      </div>
    </div>
    <div class="eq-detail-stats" data-detail-stats>${detailStatsHtml(b, slotId, item, detail)}</div>
    ${substatsHtml(b, slotId, item, detail)}
    ${enchantable ? `<div class="eq-note">${T.enchant_note}</div>` : ""}`;
}

function detailStatsHtml(b, slotId, item, detail) {
  const level = b.enchant[slotId] || 0;
  const gradeName = detail.gradeName || detail.grade || "";
  const [normalMax] = enchantRange(detail);
  const category = detail.categoryName || "";
  const isArmor = ARMOR_CATEGORIES.has(category) || category === BELT_CATEGORY;
  let bonusMap, exceed;
  if (category === "Rune") {
    bonusMap = runeEnchantBonus(detail.id, level);
    exceed = { attack: 0, attack_pct: 0, defense: 0 };
  } else if (isArmor) {
    const [def, hp] = estimateArmorBonus(level, gradeName, normalMax, category);
    bonusMap = { [DEFENSE_STAT_ID]: def, [HP_STAT_ID]: hp };
    exceed = estimateArmorExceedBonus(level, normalMax);
  } else {
    bonusMap = { [SCALING_STAT_ID]: estimateEnchantBonus(level, gradeName, normalMax, category) };
    exceed = estimateExceedBonus(level, normalMax, category);
  }
  const mainLine = (stat) => {
    const name = stat.name || "", value = stat.value ?? "", min = stat.minValue;
    const bonus = bonusMap[stat.id] || 0;
    if (bonus) return min ? `${name}: ${min} ~ ${value} (+${fmt(bonus)})` : `${name}: ${value} (+${fmt(bonus)})`;
    if (min && min !== value) return `${name}: ${min} ~ ${value}`;
    return `${name}: ${value}`;
  };
  const lines = [];
  const mainStats = detail.mainStats || [];
  const orange = (text) => `<span class="warn">${h(text)}</span>`;
  if (mainStats.length) {
    if (detail.level) {
      const push = gearscorePush(level, normalMax);
      lines.push(`<b>GearScore: ${fmt(detail.level)}${push ? ` (+${fmt(push)})` : ""}</b>`);
    }
    lines.push(`<b>${T.main_stats}</b>`);
    lines.push(...mainStats.map((s) => h(mainLine(s))));
    if (isArmor) {
      if (exceed.defense) lines.push(orange(`Defense: +${fmt(exceed.defense)}`));
      if (exceed.hp) lines.push(orange(`HP: +${fmt(exceed.hp)}`));
      if (exceed.defense_pct) lines.push(orange(`Defense increase: +${fmt(exceed.defense_pct)}%`));
      if (exceed.hp_pct) lines.push(orange(`HP increase: +${fmt(exceed.hp_pct)}%`));
    } else if (exceed.attack || exceed.attack_pct || exceed.defense) {
      const ranged = mainStats.find((s) => s.id === SCALING_STAT_ID);
      const rangedName = ranged ? ranged.name || "Attack" : "Attack";
      if (exceed.attack) lines.push(orange(`${rangedName}: +${fmt(exceed.attack)}`));
      if (exceed.defense) lines.push(orange(`Defense: +${fmt(exceed.defense)}`));
      if (exceed.attack_pct) lines.push(orange(`${rangedName} increase: +${fmt(exceed.attack_pct)}%`));
    }
  } else if (category === "Wings Equip") {
    const equipLines = D.data.wingsEquipLines[D.stripWingsRaceSuffix(detail.name || item.name || "")] || [];
    const owned = D.data.wingsStats[String(detail.id || item.id || "")] || {};
    if (equipLines.length) { lines.push("<b>Equip Effect</b>"); lines.push(...equipLines.map(h)); }
    if (Object.keys(owned).length) {
      lines.push("<b>Owned Effect</b>");
      for (const [sid, v] of Object.entries(owned)) lines.push(h(`${D.WINGS_STAT_DISPLAY[sid] || sid}: ${fmt(v)}${D.WINGS_STAT_IS_PERCENT.has(sid) ? "%" : ""}`));
    }
    if (!equipLines.length && !Object.keys(owned).length) lines.push("<i>No stat data available for this item.</i>");
  }
  const set = detail.set;
  if (set && set.bonuses && set.bonuses.length) {
    lines.push(`<b>${h(T.set_effect(set.name || T.set_effect_fallback))}</b>`);
    for (const tier of [...set.bonuses].sort((x, y) => (x.degree || 0) - (y.degree || 0))) {
      if (!(tier.descriptions || []).length) continue;
      lines.push(`<span class="accent">(${h(tier.degree)})</span> ${h(tier.descriptions.join(", "))}`);
    }
  }
  return lines.join("<br>");
}

function substatsHtml(b, slotId, item, detail) {
  const subStats = detail.subStats || [];
  const count = Number(detail.subStatCount || 0);
  const skills = skillOptionsFor(detail);
  const skillType = D.ACTIVE_SUBSKILL_SLOT_CATEGORIES.has(detail.categoryName) ? "active" : "passive";
  const selected = substatsOf(b, slotId);
  const stoneVisible = count > 0 && ["Unique", "Epic"].includes(detail.grade || "");
  if (!subStats.length && !skills.length) return "";
  const cap = effectiveCap(detail, slotId, b);
  const atCap = selected.size >= cap;
  const row = (idx, text) => `<button class="eq-substat-row${selected.has(idx) ? " checked" : ""}" data-action="substat-toggle" data-index="${idx}"${atCap && !selected.has(idx) ? " disabled" : ""}><span class="check">✓</span><span>${h(text)}</span></button>`;
  const subLine = (s) => (s.minValue && s.minValue !== s.value ? `${s.name}: ${s.minValue} ~ ${s.value}` : `${s.name}: ${s.value}`);
  const section = (key, badge, bucket, entries) => {
    if (!entries.length) return "";
    if (!(key in ui.sections)) ui.sections[key] = !["active_skills", "passive_skills"].includes(key);
    const open = ui.sections[key];
    return `<button class="eq-section-head bucket-${bucket}" data-action="section-toggle" data-key="${key}">${open ? "▾" : "▸"} ${badge} (${entries.length})</button>
      <div class="eq-section-grid"${open ? "" : " hidden"}>${entries.map(([i, text]) => row(i, text)).join("")}</div>`;
  };
  const buckets = { offensive: [], defensive: [], pvp: [] };
  subStats.forEach((s, i) => { if (!ui.onlySelected || selected.has(i)) buckets[D.classifyStat(s.id)].push([i, subLine(s)]); });
  const visibleSkills = skills.map((s, pos) => [subStats.length + pos, s.name || ""]).filter(([i]) => !ui.onlySelected || selected.has(i));
  const statsSection = section("offensive", T.badge_offensive, "offensive", buckets.offensive) + section("defensive", T.badge_defensive, "defensive", buckets.defensive) + section("pvp", T.badge_pvp, "pvp", buckets.pvp);
  const skillSection = visibleSkills.length ? section(skillType === "active" ? "active_skills" : "passive_skills", skillType === "active" ? T.badge_active : T.badge_passive, "skills", visibleSkills) : "";
  const showTab0 = subStats.length > 0 || (ui.onlySelected && skills.length > 0);
  const showTab1 = skills.length > 0 && !ui.onlySelected;
  const tab = showTab1 && ui.substatsTab === "skills" ? "skills" : "substats";
  const hint = count ? T.slot_hint(count, subStats.length + skills.length) : "";
  const note = b.philosopher_stone[slotId] ? T.stone_note : "";
  const status = count ? (atCap ? `<span class="ok">${h(T.all_selected(selected.size, cap, note))}</span>` : `<span class="muted">${h(T.selected_count(selected.size, cap, note))}</span>`) : "";
  return `<div class="eq-substats-header">${T.possible_substats(hint)}</div>
    <div class="row eq-subtabs">
      ${showTab0 ? `<button data-action="substats-tab" data-tab="substats"${tab === "substats" ? ' class="active"' : ""}>${T.substats_tab}</button>` : ""}
      ${showTab1 ? `<button data-action="substats-tab" data-tab="skills"${tab === "skills" ? ' class="active"' : ""}>${T.skills_tab}</button>` : ""}
      <span class="grow"></span><label class="row small"><input type="checkbox" data-action="only-selected"${ui.onlySelected ? " checked" : ""}> ${T.show_selected_only}</label>
    </div>
    <div class="eq-substats-body">${tab === "skills" ? skillSection : statsSection + (ui.onlySelected ? skillSection : "")}</div>
    ${stoneVisible ? `<button class="eq-philo${b.philosopher_stone[slotId] ? " active" : ""}" data-action="philo-toggle" title="${h(T.philo_tooltip)}">${T.use_philo}</button>` : ""}
    <div class="eq-substats-status">${status}</div>`;
}

// --- item picker -------------------------------------------------------------
function closePicker() {
  if (!picker) return;
  picker.el.remove();
  document.removeEventListener("mousedown", picker.outside, true);
  picker = null;
}

function openPicker({ anchor, categories, onChosen, equippedIds = null, priorityIds = null }) {
  closePicker();
  const isWings = categories.length === 1 && categories[0] === "Wings Equip";
  const raceSuffix = { Elyos: " (Elyos)", Asmodae: " (Asmodae)" }[bp().character_race || "Elyos"];
  let items = D.data.items.filter((it) => categories.includes(it.categoryName));
  if (isWings && raceSuffix) items = items.filter((it) => (it.name || "").endsWith(raceSuffix));
  const state = { query: "", grade: "All", view: isWings ? "row" : "block", sortKey: "name", asc: true, equippedOnly: false, favoritesOnly: false };
  const el = document.createElement("div");
  el.className = "eq-picker";
  const counts = {};
  for (const it of items) if (it.grade) counts[it.grade] = (counts[it.grade] || 0) + 1;
  el.innerHTML = `<div class="row">
      <input type="text" class="grow" data-p="search" placeholder="${T.search}">
      <select data-p="grade"><option value="All">${T.all} (${items.length})</option>${D.RARITY_ORDER.filter((g) => counts[g]).map((g) => `<option value="${g}" style="color:${D.GRADE_COLORS[g]}">${g} (${counts[g]})</option>`).join("")}</select>
      <button data-p="view" data-view="block">${T.view_block}</button><button data-p="view" data-view="row">${T.view_row}</button>
    </div>
    <div class="row eq-picker-sort"><span class="eq-label">${T.sort_by}</span>${[["name", "Name"], ["grade", T.rarity], ["type", "Type"]].map(([k, l]) => `<button data-p="sort" data-key="${k}">${l}</button>`).join("")}</div>
    ${equippedIds && equippedIds.size ? `<label class="row small"><input type="checkbox" data-p="equipped"> ${T.only_equipped}</label>` : ""}
    ${priorityIds && priorityIds.size ? `<label class="row small"><input type="checkbox" data-p="favorites"> ${T.only_favorites}</label>` : ""}
    <div class="eq-picker-list"></div>`;
  document.body.appendChild(el);
  const rect = anchor.getBoundingClientRect();
  const width = 412;
  el.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`;
  el.style.top = `${Math.min(rect.bottom + 4, window.innerHeight - 200)}px`;
  el.style.maxHeight = `${Math.max(320, window.innerHeight - Math.min(rect.bottom + 4, window.innerHeight - 200) - 12)}px`;

  const list = el.querySelector(".eq-picker-list");
  const render = () => {
    const q = state.query.trim().toLowerCase();
    const types = activeGearTypes();
    let matched = items.filter((it) => (!q || (it.name || "").toLowerCase().includes(q))
      && (state.grade === "All" || it.grade === state.grade)
      && (!types.length || types.includes(D.gearTypeOf(it)))
      && (!state.equippedOnly || equippedIds.has(it.id))
      && (!state.favoritesOnly || priorityIds.has(it.id)));
    const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
    const keyOf = { grade: (it) => [D.RARITY_RANK[it.grade] ?? 99, it.name || ""], type: (it) => [it.categoryName || "", it.name || ""], name: (it) => [it.name || ""] }[state.sortKey];
    matched.sort((a, b) => { const ka = keyOf(a), kb = keyOf(b); for (let i = 0; i < ka.length; i++) { const c = cmp(ka[i], kb[i]); if (c) return c; } return 0; });
    if (!state.asc) matched.reverse();
    for (const btn of el.querySelectorAll('[data-p="sort"]')) {
      const key = btn.dataset.key;
      btn.classList.toggle("active", key === state.sortKey);
      btn.textContent = { name: "Name", grade: T.rarity, type: "Type" }[key] + (key === state.sortKey ? (state.asc ? " ▲" : " ▼") : "");
    }
    for (const btn of el.querySelectorAll('[data-p="view"]')) btn.classList.toggle("active", btn.dataset.view === state.view);
    const level = (it) => { const row = D.data.index[String(it.id)]; return row && row[1] ? T.level_prefix(row[1]) : ""; };
    if (state.view === "block") {
      list.className = "eq-picker-list block";
      list.innerHTML = matched.map((it) => `<button class="eq-tile" data-id="${it.id}" title="${h(it.name || "")}">
        ${priorityIds && priorityIds.size ? `<span class="eq-tile-star"${priorityIds.has(it.id) ? "" : " hidden"} title="${T.on_priority}">★</span>` : ""}
        ${iconHtml(it)}<span class="eq-tile-name" style="color:${D.GRADE_COLORS[it.grade] || "var(--fg)"}">${h(D.shortName(it.name || "", 16))}</span>
        <span class="eq-tile-level">${level(it)}</span></button>`).join("");
    } else {
      list.className = "eq-picker-list rows";
      list.innerHTML = `<table><thead><tr><th></th><th>${T.col_name}</th><th>${T.rarity}</th></tr></thead><tbody>${matched.map((it) => `<tr data-id="${it.id}">
        <td>${iconHtml(it, "tiny")}</td><td>${h(it.name || "")}</td><td style="color:${D.GRADE_COLORS[it.grade] || "inherit"}">${h(it.grade || "")}</td></tr>`).join("")}</tbody></table>`;
    }
  };
  el.addEventListener("input", (e) => { if (e.target.dataset.p === "search") { state.query = e.target.value; render(); } });
  el.addEventListener("change", (e) => {
    const p = e.target.dataset.p;
    if (p === "grade") state.grade = e.target.value;
    else if (p === "equipped") state.equippedOnly = e.target.checked;
    else if (p === "favorites") state.favoritesOnly = e.target.checked;
    else return;
    render();
  });
  el.addEventListener("click", (e) => {
    const sort = e.target.closest('[data-p="sort"]');
    if (sort) { if (sort.dataset.key === state.sortKey) state.asc = !state.asc; else { state.sortKey = sort.dataset.key; state.asc = true; } render(); return; }
    const view = e.target.closest('[data-p="view"]');
    if (view) { state.view = view.dataset.view; render(); return; }
    const chosen = e.target.closest("[data-id]");
    if (chosen) {
      const item = D.data.itemsById[Number(chosen.dataset.id)];
      closePicker();
      if (item) onChosen(item);
    }
  });
  const outside = (e) => { if (!el.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) closePicker(); };
  document.addEventListener("mousedown", outside, true);
  picker = { el, outside };
  render();
  el.querySelector('[data-p="search"]').focus();
}

function pickForSlot(slotId, anchor) {
  let categories = D.SLOT_CATEGORIES[slotId] || [];
  if (slotId === "MainHand" && D.CLASS_WEAPON_CATEGORY[className()]) categories = [D.CLASS_WEAPON_CATEGORY[className()]];
  const b = build();
  const priorityIds = new Set(Object.values(b.priority).flat().filter(Boolean).map((it) => it.id));
  openPicker({ anchor, categories, priorityIds, onChosen: (item) => { equipItem(slotId, item); save(); draw(); } });
}

function equipItem(slotId, item) {
  const b = build();
  b.equipped[slotId] = item;
  delete b.substats[slotId];
  delete b.enchant[slotId];
  D.requestDetail(item.id);
  ui.pickOrder[slotId] = [];
  ui.slot = slotId;
}

function clearSlot(slotId) {
  const b = build();
  delete b.equipped[slotId];
  delete b.substats[slotId];
  delete b.enchant[slotId];
  delete b.philosopher_stone[slotId];
}

// --- quick select ------------------------------------------------------------
let transferIndex = null;
async function ensureTransferIndex() {
  if (transferIndex) return transferIndex;
  const payload = await D.loadRecipes();
  const recipes = transfer.normalizeRecipes(payload);
  const outputIndex = transfer.buildRecipeOutputIndex(recipes);
  transferIndex = transfer.buildTransferSourceIndex(recipes, D.data.itemsById, outputIndex);
  return transferIndex;
}

function slotGroupRows(groups, { enabledSlots = null, withEnchant = false, defaultEnchant = 0 } = {}) {
  return groups.map(([key, label, slots]) => {
    const groupEnabled = !enabledSlots || slots.some((s) => enabledSlots.has(s));
    return `<div class="eq-group">
      <div class="row"><label class="row"><input type="checkbox" data-q="group" data-group="${key}"${groupEnabled ? " checked" : " disabled"}> ${label}</label><span class="grow"></span>
        <button class="small" data-q="manual" data-group="${key}">${T.manual_select}</button></div>
      <div class="eq-group-slots" data-group-panel="${key}" hidden>${slots.map((slotId) => {
    const on = !enabledSlots || enabledSlots.has(slotId);
    return `<div class="row"><label class="row grow"><input type="checkbox" data-q="slot" data-group="${key}" data-slot="${slotId}"${on ? " checked" : " disabled"}${on ? "" : ` title="${T.slot_empty_hint}"`}> ${D.QUICK_GEAR_SLOT_LABELS[slotId] || slotId}</label>
        ${withEnchant ? `<input type="number" min="0" max="30" value="${defaultEnchant}" data-q="slot-enchant" data-slot="${slotId}" title="${T.default_enchant_slot}">` : ""}</div>`;
  }).join("")}</div></div>`;
  }).join("");
}

function wireGroupRows(dialog) {
  dialog.addEventListener("click", (e) => {
    const manual = e.target.closest('[data-q="manual"]');
    if (manual) { const panel = dialog.querySelector(`[data-group-panel="${manual.dataset.group}"]`); panel.hidden = !panel.hidden; }
  });
  dialog.addEventListener("change", (e) => {
    if (e.target.dataset.q === "group") {
      for (const box of dialog.querySelectorAll(`[data-q="slot"][data-group="${e.target.dataset.group}"]`)) if (!box.disabled) box.checked = e.target.checked;
    }
  });
}

function showDialog(html, className = "eq-dialog") {
  const dialog = document.createElement("dialog");
  dialog.className = className;
  dialog.innerHTML = html;
  document.body.appendChild(dialog);
  dialog.addEventListener("close", () => dialog.remove());
  dialog.addEventListener("click", (e) => { if (e.target.dataset.q === "cancel") dialog.close(); });
  dialog.showModal();
  return dialog;
}

async function openQuickGear() {
  const sourceIndex = await ensureTransferIndex();
  const allowed = new Set(activeGearTypes().flatMap((k) => D.GEAR_TYPE_TO_QUICK_SELECT_TAGS[k] || []));
  let tags = [...new Set([...Object.keys(D.data.dungeonSets), "Crafting"])];
  if (activeGearTypes().length) tags = tags.filter((t) => allowed.has(t));
  tags.sort();
  const st = { race: bp().character_race || "Elyos", tag: tags[0] || "", grade: "All", prefix: null, enchant: 0, maxEnchant: 0 };
  const tierGrade = (prefix) => (prefix && D.data.nameToItem[`${prefix} Ring`] ? D.data.nameToItem[`${prefix} Ring`].grade : null);
  const resolve = (slotId, prefix) => {
    const typeWord = slotId === "MainHand" ? D.CLASS_WEAPON_CATEGORY[className()] : D.QUICK_GEAR_SLOT_WORDS[slotId];
    if (!typeWord) return null;
    const override = D.CRAFTING_WEAPON_NAMES[prefix];
    if (override) return override[typeWord] ? D.data.nameToItem[override[typeWord]] || null : null;
    return D.data.nameToItem[`${prefix} ${typeWord}`] || null;
  };
  const tierOptions = () => {
    const entries = [];
    if (st.tag === "Crafting") {
      const root = D.RACE_TIER_ROOT[st.race];
      if (root) for (const tier of transfer.orderedTierChain(`${root} Boots`, "Boots", sourceIndex)) {
        const grade = tierGrade(tier);
        if (st.grade === "All" || grade === st.grade) entries.push([tier, tier, grade]);
      }
      const epic = D.RACE_EPIC_TIER_ROOT[st.race];
      if (epic) for (const tier of [epic, `Splendent ${epic}`]) {
        const grade = tierGrade(tier);
        if (grade && (st.grade === "All" || grade === st.grade)) entries.push([tier, tier, grade]);
      }
    }
    const craftedCount = entries.length;
    let infoByRoot = D.data.dungeonSets[st.tag] || {};
    if (st.tag === "Abyss Gear") {
      const prefix = D.ABYSS_GEAR_RACE_PREFIX[st.race];
      infoByRoot = Object.fromEntries(Object.entries(infoByRoot).filter(([root]) => prefix && root.startsWith(prefix + " ")));
    }
    const roots = Object.keys(infoByRoot).filter((r) => st.grade === "All" || infoByRoot[r].grade === st.grade).sort((a, b) => (infoByRoot[b].gearscore || 0) - (infoByRoot[a].gearscore || 0));
    for (const root of roots) entries.push([root, `${root} (${infoByRoot[root].gearscore})`, infoByRoot[root].grade]);
    return [entries, craftedCount];
  };
  const dialog = showDialog(`<h2>${T.quick_equip_title}</h2>
    <div class="row"><div class="stack"><span class="eq-label">${T.race}</span><select data-q="race">${D.AION2_RACES.map((r) => `<option${r === st.race ? " selected" : ""}>${r}</option>`).join("")}</select></div>
      <div class="stack grow"><span class="eq-label">${T.gear_type_filter}</span><select data-q="tag">${tags.map((t) => `<option${t === st.tag ? " selected" : ""}>${h(t)}</option>`).join("")}</select></div></div>
    <div class="row"><span class="eq-label">${T.rarity}</span><button data-q="grade" data-grade="All" class="active">${T.all}</button>${D.RARITY_ORDER.map((g) => `<button class="eq-grade-btn grade-${g}" data-q="grade" data-grade="${g}">${g}</button>`).join("")}</div>
    <div class="stack"><span class="eq-label">${T.item_set}</span><select data-q="tier"></select></div>
    <div class="row"><span class="eq-label">${T.default_enchant}</span><span class="grow"></span><span class="eq-enchant-value" data-q="enchant-value">+0</span></div>
    <input type="range" class="eq-enchant-slider" min="0" max="0" value="0" data-q="enchant">
    <div class="eq-label">${T.included_slots}</div>
    ${slotGroupRows(D.QUICK_GEAR_CATEGORY_GROUPS, { withEnchant: true })}
    <div class="eq-note" data-q="status"></div>
    <div class="row"><button data-q="cancel">${T.cancel}</button><span class="grow"></span><button class="active" data-q="apply">${T.equip}</button></div>`);
  wireGroupRows(dialog);
  const tierSelect = dialog.querySelector('[data-q="tier"]');
  const status = dialog.querySelector('[data-q="status"]');
  const slider = dialog.querySelector('[data-q="enchant"]');
  const setEnchant = (value) => {
    st.enchant = value;
    slider.value = value;
    dialog.querySelector('[data-q="enchant-value"]').textContent = `+${value}`;
    for (const spin of dialog.querySelectorAll('[data-q="slot-enchant"]')) spin.value = value;
  };
  const onTierSelected = () => {
    st.prefix = tierSelect.value || null;
    const grade = tierSelect.selectedOptions[0] ? tierSelect.selectedOptions[0].dataset.grade : "";
    let maxEnchant = 0;
    for (const slotId of D.ENCHANT_REFERENCE_SLOTS) {
      const ref = st.prefix ? resolve(slotId, st.prefix) : null;
      const row = ref && D.data.index[String(ref.id)];
      if (row) { maxEnchant = row[2] + row[3]; break; }
    }
    st.maxEnchant = maxEnchant;
    slider.max = Math.max(maxEnchant, 0);
    setEnchant(Math.min(D.QUICK_GEAR_ENCHANT_DEFAULTS[grade] || 0, maxEnchant));
  };
  const rebuildTiers = () => {
    const [entries, craftedCount] = tierOptions();
    tierSelect.innerHTML = entries.map(([prefix, label, grade]) => `<option value="${h(prefix)}" data-grade="${grade || ""}" style="color:${D.GRADE_COLORS[grade] || "inherit"}">${h(label)}</option>`).join("");
    tierSelect.disabled = !entries.length;
    if (craftedCount) tierSelect.selectedIndex = craftedCount - 1;
    status.textContent = entries.length ? "" : T.no_entries(st.tag, st.grade);
    onTierSelected();
  };
  dialog.addEventListener("change", (e) => {
    const q = e.target.dataset.q;
    if (q === "race") { st.race = e.target.value; rebuildTiers(); }
    else if (q === "tag") { st.tag = e.target.value; rebuildTiers(); }
    else if (q === "tier") onTierSelected();
  });
  dialog.addEventListener("input", (e) => { if (e.target.dataset.q === "enchant") setEnchant(Number(e.target.value)); });
  dialog.addEventListener("click", (e) => {
    const gradeBtn = e.target.closest('[data-q="grade"]');
    if (gradeBtn) {
      st.grade = gradeBtn.dataset.grade;
      for (const btn of dialog.querySelectorAll('[data-q="grade"]')) btn.classList.toggle("active", btn === gradeBtn);
      rebuildTiers();
      return;
    }
    if (e.target.dataset.q !== "apply") return;
    if (!st.prefix) { status.textContent = T.choose_set_first; return; }
    const resultSlots = {}, resultEnchant = {}, missing = [];
    for (const box of dialog.querySelectorAll('[data-q="slot"]:checked')) {
      const slotId = box.dataset.slot;
      const item = resolve(slotId, st.prefix);
      if (item) { resultSlots[slotId] = item; resultEnchant[slotId] = Number(dialog.querySelector(`[data-q="slot-enchant"][data-slot="${slotId}"]`).value) || 0; }
      else missing.push(slotId);
    }
    if (!Object.keys(resultSlots).length) { status.textContent = T.no_matching; return; }
    const isPvp = activeGearTypes().includes("PvP");
    const amulet = D.data.items.find((it) => it.name === (isPvp ? "Fierce Battle Amulet" : "Revelation Amulet") && it.grade === "Unique");
    if (amulet) { resultSlots.Amulet = amulet; resultEnchant.Amulet = 10; }
    const primary = D.data.itemsById[isPvp ? RUNE_PVP_ITEM_ID : RUNE_PVE_ITEM_ID], secondary = D.data.itemsById[isPvp ? RUNE_PVE_ITEM_ID : RUNE_PVP_ITEM_ID];
    if (primary) { resultSlots.Rune1 = primary; resultEnchant.Rune1 = 5; }
    if (secondary) { resultSlots.Rune2 = secondary; resultEnchant.Rune2 = 5; }
    const b = build();
    const selected = ui.slot;
    for (const [slotId, item] of Object.entries(resultSlots)) {
      equipItem(slotId, item);
      if (resultEnchant[slotId]) b.enchant[slotId] = resultEnchant[slotId];
    }
    ui.slot = selected;
    dialog.close();
    ui.message = missing.length ? `${T.quick_select_result}: ${T.quick_equipped_result(Object.keys(resultSlots).length, missing.join(", "))}` : "";
    save();
    draw();
  });
  rebuildTiers();
}

function openQuickStat() {
  const b = build();
  const equippedSlots = new Set(Object.keys(b.equipped));
  const st = { gearType: "PvE", role: "Angreifer" };
  const dialog = showDialog(`<h2>${T.quick_stats_title}</h2>
    <div class="eq-label">${T.gear_mode}</div><div class="row">${STAT_PRIORITY_GEAR_TYPES.map((g) => `<button data-q="gear" data-key="${g}"${g === st.gearType ? ' class="active"' : ""}>${g}</button>`).join("")}</div>
    <div class="eq-label">${T.role}</div><div class="row">${STAT_PRIORITY_ROLES.map((r) => `<button class="eq-role${r === st.role ? " active" : ""}" style="--role:${D.ROLE_COLORS[r]}" data-q="role" data-key="${r}">${D.ROLE_LABELS[r]}</button>`).join("")}</div>
    <div class="eq-label">${T.auto_substats_for}</div>
    ${slotGroupRows(D.QUICK_GEAR_CATEGORY_GROUPS, { enabledSlots: equippedSlots })}
    <div class="row"><button data-q="cancel">${T.cancel}</button><span class="grow"></span><button class="active" data-q="apply">${T.apply}</button></div>`);
  wireGroupRows(dialog);
  dialog.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-q]");
    if (!btn) return;
    if (btn.dataset.q === "gear" || btn.dataset.q === "role") {
      st[btn.dataset.q === "gear" ? "gearType" : "role"] = btn.dataset.key;
      for (const other of dialog.querySelectorAll(`[data-q="${btn.dataset.q}"]`)) other.classList.toggle("active", other === btn);
    } else if (btn.dataset.q === "apply") {
      const targets = new Set([...dialog.querySelectorAll('[data-q="slot"]:checked')].map((box) => box.dataset.slot));
      dialog.close();
      ui.message = applyQuickSubstats(targets, st.gearType, st.role);
      save();
      draw();
    }
  });
}

function applyQuickSubstats(targetSlots, gearType = "PvE", role = "Angreifer") {
  if (!targetSlots.size) return "";
  const b = build();
  const profile = (profiles()[gearType] || {})[role] || {};
  const applied = [], pending = [];
  for (const slotId of targetSlots) {
    const item = b.equipped[slotId];
    if (!item) continue;
    const detail = D.detailCache.get(item.id);
    if (!detail) { D.requestDetail(item.id); pending.push(slotId); continue; }
    const subStats = detail.subStats || [];
    let count = Number(detail.subStatCount || 0);
    if (!count) continue;
    if (b.philosopher_stone[slotId]) count += 1;
    const candidates = [...subStats, ...skillOptionsFor(detail)];
    const category = D.SLOT_TO_STAT_CATEGORY[slotId];
    const chosen = pickPrioritySubstats(candidates, count, category ? profile[category] || [] : []);
    if (chosen.size) { setSubstats(b, slotId, chosen); ui.pickOrder[slotId] = [...chosen]; applied.push(slotId); }
  }
  const parts = [];
  if (applied.length) parts.push(T.substats_auto_set(applied.join(", ")));
  if (pending.length) parts.push(T.details_not_loaded(pending.join(", ")));
  return parts.join(" ");
}

// --- property priority editor ------------------------------------------------
function skillPriorityNames() {
  const p = bp();
  const b = build();
  const skillBuilds = (p.skill_builds_data || {})[classKey()] || {};
  const linked = b.linked_skill_build in skillBuilds ? b.linked_skill_build : p.current_skill_build_name in skillBuilds ? p.current_skill_build_name : Object.keys(skillBuilds)[0];
  const priority = ((skillBuilds[linked] || {}).priority) || {};
  const all = D.data.skillsByClass[D.skillsClassKey(className())] || [];
  const result = { active: [], passive: [] };
  for (const type of Object.keys(result)) {
    for (const sid of priority[type] || []) {
      const skill = sid != null && all.find((s) => String(s.id) === String(sid));
      if (skill && skill.name) result[type].push(skill.name);
    }
  }
  return result;
}

function openEditor() {
  const data = profiles();
  ui.editor = { data, snapshot: JSON.stringify(data), gearType: STAT_PRIORITY_GEAR_TYPES[0], role: STAT_PRIORITY_ROLES[0], group: 0, categoryTab: {}, saved: false, skillNames: skillPriorityNames() };
  ui.view = "editor";
  draw();
}

function editorPage() {
  const ed = ui.editor;
  const [, , categoryKeys] = D.STAT_PRIORITY_GROUPS[ed.group];
  const categoryLabel = Object.fromEntries(D.STAT_PRIORITY_CATEGORIES.map(([key, label]) => [key, label]));
  const current = categoryKeys.includes(ed.categoryTab[ed.group]) ? ed.categoryTab[ed.group] : categoryKeys[0];
  const selections = ed.data[ed.gearType][ed.role][current] || [];
  const skillOptions = [];
  const skillColor = {};
  for (const type of D.STAT_PRIORITY_CATEGORY_SKILL_TYPES[current] || []) {
    for (const name of ed.skillNames[type] || []) if (!skillOptions.includes(name)) { skillOptions.push(name); skillColor[name] = `var(--skill-${type})`; }
  }
  const pool = D.data.statPriorityOptions[current] || [];
  const guide = (D.STAT_PRIORITY_CATEGORY_ORDER_OVERRIDE[current] || []).filter((n) => pool.includes(n));
  const placed = new Set([...skillOptions, ...guide]);
  const options = [...skillOptions, ...guide, ...pool.filter((n) => !placed.has(n))];
  const ranks = Array.from({ length: STAT_PRIORITY_MAX_ENTRIES }, (_, i) => {
    const others = new Set(selections.filter((_, j) => j !== i && selections[j]));
    const value = selections[i] || "";
    return `<div class="row"><span class="eq-rank">${i + 1}.</span><select class="grow" data-action="editor-rank" data-index="${i}"><option value="">${T.empty_option}</option>
      ${options.filter((n) => !others.has(n)).map((n) => `<option value="${h(n)}"${n === value ? " selected" : ""}${skillColor[n] ? ` style="color:${skillColor[n]}"` : ""}>${h(n)}</option>`).join("")}</select></div>`;
  }).join("");
  return `<div class="eq-page-head row"><button class="icon" data-action="editor-cancel" title="${T.back}">←</button><h2 class="grow">${T.editor_title}</h2><button class="icon" data-action="editor-cancel" title="${T.close}">✕</button></div>
    <div class="eq-label">${T.gear_mode}</div><div class="row">${STAT_PRIORITY_GEAR_TYPES.map((g) => `<button data-action="editor-gear" data-key="${g}"${g === ed.gearType ? ' class="active"' : ""}>${g}</button>`).join("")}</div>
    <div class="eq-label">${T.role}</div><div class="row">${STAT_PRIORITY_ROLES.map((r) => `<button class="eq-role${r === ed.role ? " active" : ""}" style="--role:${D.ROLE_COLORS[r]}" data-action="editor-role" data-key="${r}">${D.ROLE_LABELS[r]}</button>`).join("")}</div>
    <div class="row" style="margin-top:8px">${D.STAT_PRIORITY_GROUPS.map(([, label], i) => `<button data-action="editor-group" data-index="${i}"${i === ed.group ? ' class="active"' : ""}>${label}</button>`).join("")}</div>
    ${categoryKeys.length > 1 ? `<div class="eq-tabs">${categoryKeys.map((key) => `<button data-action="editor-category" data-key="${key}"${key === current ? ' class="active"' : ""}>${categoryLabel[key]}</button>`).join("")}</div>` : ""}
    <div class="card stack eq-ranks">${ranks}</div>
    <div class="row"><button data-action="editor-reset">${T.reset_default}</button><span class="grow"></span><span class="ok"${ed.saved ? "" : " hidden"}>${T.saved}</span><button data-action="editor-cancel">${T.cancel}</button><button class="active" data-action="editor-save">${T.save}</button></div>`;
}

function editorCurrentCategory() {
  const ed = ui.editor;
  const [, , categoryKeys] = D.STAT_PRIORITY_GROUPS[ed.group];
  return categoryKeys.includes(ed.categoryTab[ed.group]) ? ed.categoryTab[ed.group] : categoryKeys[0];
}

// --- EQ priority page --------------------------------------------------------
function priorityPage() {
  const b = build();
  const columns = D.EQUIP_PRIORITY_SECTIONS.map(([key, label]) => {
    const items = (b.priority[key] && b.priority[key].length) ? b.priority[key] : [null];
    const tiles = items.map((item, i) => `${i ? '<span class="eq-arrow">→</span>' : ""}<div class="eq-prio-slot"><button class="eq-prio-tile" data-action="priority-slot" data-section="${key}" data-index="${i}">${item ? iconHtml(item, "slot") : ""}</button>
      <div class="eq-prio-name" title="${h(item ? item.name || "" : T.choose_item)}">${h(item ? D.shortName(item.name || "", 11) : T.choose_item)}</div></div>`).join("");
    const add = items.length < D.EQUIP_PRIORITY_MAX_ITEMS ? `<span class="eq-arrow">→</span><button class="eq-prio-add" data-action="priority-add" data-section="${key}"${items[items.length - 1] ? "" : " disabled"}>＋</button>` : "";
    return `<div class="eq-prio-section"><div class="eq-section-label">${label}</div><div class="eq-prio-row">${tiles}${add}</div></div>`;
  }).join("");
  return `<div class="eq-page-head row"><button class="icon" data-action="priority-close" title="${T.back}">←</button><h2 class="grow">${T.eq_priority}</h2><button class="icon" data-action="priority-close" title="${T.close}">✕</button></div>
    <div class="muted">${T.equip_priority_hint}</div><div class="eq-prio-grid">${columns}</div>`;
}

// --- build compare -----------------------------------------------------------
function openCompare() {
  const builds = buildsOf(classKey());
  const names = Object.keys(builds);
  ui.compare.a = bp().current_build_name;
  ui.compare.b = names.find((n) => n !== ui.compare.a) || ui.compare.a;
  ui.view = "compare";
  for (const name of [ui.compare.a, ui.compare.b]) D.requestDetails((builds[name] || {}).equipped);
  draw();
}

function comparePage() {
  const builds = buildsOf(classKey());
  const names = Object.keys(builds);
  const stateA = normalizeBuild(builds[ui.compare.a] || emptyBuild()), stateB = normalizeBuild(builds[ui.compare.b] || emptyBuild());
  const gsA = gearScore(classKey(), ui.compare.a), gsB = gearScore(classKey(), ui.compare.b);
  const delta = gsB - gsA;
  const totalsA = D.fullBuildTotals(stateA, statExtras(ui.compare.a)).totals, totalsB = D.fullBuildTotals(stateB, statExtras(ui.compare.b)).totals;
  const rows = D.STAT_COMPARE_CATEGORIES.find(([key]) => key === ui.compare.category)[2];
  const valueCells = (a, b, suffix) => {
    const fa = fmt(a), fb = fmt(b);
    if (fa === fb) return `<span>${fa}${suffix}</span><span>${fb}${suffix}</span>`;
    const d = b - a;
    return `<span class="${a > b ? "better" : "worse"}">${fa}${suffix}</span><span class="${a > b ? "worse" : "better"}">${fb}${suffix} <small class="${d > 0 ? "ok" : "danger"}">(${d > 0 ? "+" : ""}${fmt(d)}${suffix})</small></span>`;
  };
  const select = (key, current) => `<select data-action="compare-build" data-which="${key}">${names.map((n) => `<option${n === current ? " selected" : ""}>${h(n)}</option>`).join("")}</select>`;
  return `<div class="eq-page-head row"><button class="icon" data-action="compare-close" title="${T.back}">←</button><h2 class="grow">${T.build_compare_title}</h2><button class="icon" data-action="compare-close" title="${T.close}">✕</button></div>
    <div class="row eq-compare-pickers"><div class="stack grow"><span class="eq-label">${T.compare_a}</span>${select("a", ui.compare.a)}</div><div class="stack grow"><span class="eq-label">${T.compare_b}</span>${select("b", ui.compare.b)}</div></div>
    <div class="card row eq-compare-gs"><span class="grow">${fmt(gsA)}</span><span class="muted">VS</span><span class="grow">${fmt(gsB)}${delta ? ` <small class="${delta > 0 ? "ok" : "danger"}">(${delta > 0 ? "+" : ""}${fmt(delta)})</small>` : ""}</span></div>
    <div class="eq-tabs">${D.STAT_COMPARE_CATEGORIES.map(([key, label]) => `<button data-action="compare-category" data-key="${key}"${key === ui.compare.category ? ' class="active"' : ""}>${label}</button>`).join("")}</div>
    <div class="card eq-compare-table">
      <div class="eq-compare-row head"><span></span><span>${h(ui.compare.a)}</span><span>${h(ui.compare.b)}</span></div>
      ${rows.map(([name, sid]) => `<div class="eq-compare-row"><span>${name}</span>${sid ? valueCells(totalsA[sid] || 0, totalsB[sid] || 0, D.PERCENT_STAT_IDS.has(sid) ? "%" : "") : "<span>—</span><span>—</span>"}</div>`).join("")}
    </div>`;
}

// --- events ------------------------------------------------------------------
function onKeydown(e) { if (e.key === "Escape" && picker) closePicker(); }

function onClick(e) {
  const target = e.target.closest("[data-action]");
  if (!target || !main.contains(target)) return;
  closePicker();
  const action = target.dataset.action;
  const p = bp();
  const b = build();
  const builds = buildsOf(classKey());
  switch (action) {
    case "message-close": ui.message = ""; draw(); return;
    case "compare-open": openCompare(); return;
    case "compare-close": ui.view = "normal"; draw(); return;
    case "compare-category": ui.compare.category = target.dataset.key; draw(); return;
    case "set-add": {
      const name = (prompt(`${T.new_set} — ${T.name_colon}`, "") || "").trim();
      if (!name || name in builds) return;
      builds[name] = emptyBuild();
      p.current_build_name = name; ui.slot = null; save(); draw(); return;
    }
    case "set-duplicate": {
      const source = p.current_build_name;
      const name = (prompt(`${T.duplicate_set_title} — ${T.name_colon}`, T.duplicate_default(source)) || "").trim();
      if (!name || name in builds) return;
      const src = builds[source];
      builds[name] = {
        ...emptyBuild(), equipped: { ...src.equipped }, substats: Object.fromEntries(Object.entries(src.substats).map(([k, v]) => [k, [...v]])),
        enchant: { ...src.enchant }, philosopher_stone: { ...(src.philosopher_stone || {}) }, linked_skill_build: src.linked_skill_build,
        linked_genius_build: src.linked_genius_build, linked_daevanion_build: src.linked_daevanion_build, character_name: src.character_name,
      };
      p.current_build_name = name; ui.slot = null; save(); draw(); return;
    }
    case "set-rename": {
      const old = p.current_build_name;
      const name = (prompt(`${T.rename_set_title} — ${T.name_colon}`, old) || "").trim();
      if (!name || name === old || name in builds) return;
      const renamed = {};
      for (const [k, v] of Object.entries(builds)) renamed[k === old ? name : k] = v;
      p.equip_builds_data[classKey()] = renamed;
      p.current_build_name = name; save(); draw(); return;
    }
    case "set-delete": {
      if (Object.keys(builds).length <= 1) return;
      const name = p.current_build_name;
      if (!confirm(T.delete_text(name))) return;
      delete builds[name];
      p.current_build_name = Object.keys(builds)[0]; ui.slot = null; save(); draw(); return;
    }
    case "gear-type": {
      const key = target.dataset.key;
      const types = activeGearTypes();
      const on = !types.includes(key);
      p.active_gear_types = ["PvE", "PvP", "Neutral"].filter((k) => (k === key ? on : types.includes(k))).sort();
      if (on && (key === "PvP" || key === "PvE")) ui.statMode = key.toLowerCase();
      save(); draw(); return;
    }
    case "quick-gear": openQuickGear(); return;
    case "quick-stat": openQuickStat(); return;
    case "editor-open": openEditor(); return;
    case "slot-select": ui.slot = target.dataset.slot; ui.onlySelected = false; draw(); return;
    case "priority-open": ui.view = "priority"; draw(); return;
    case "priority-close": ui.view = "normal"; draw(); return;
    case "priority-slot": {
      const section = target.dataset.section, index = Number(target.dataset.index);
      let categories = D.EQUIP_PRIORITY_SECTIONS.find(([key]) => key === section)[2];
      if (section === "weapon" && D.CLASS_WEAPON_CATEGORY[className()]) categories = [D.CLASS_WEAPON_CATEGORY[className()]];
      const equippedIds = new Set(Object.values(b.equipped).filter(Boolean).map((it) => it.id));
      openPicker({ anchor: target, categories, equippedIds, onChosen: (item) => {
        if (!b.priority[section] || !b.priority[section].length) b.priority[section] = [null];
        b.priority[section][index] = item; save(); draw();
      } });
      return;
    }
    case "priority-add": {
      const section = target.dataset.section;
      if (!b.priority[section] || !b.priority[section].length) b.priority[section] = [null];
      if (b.priority[section].length >= D.EQUIP_PRIORITY_MAX_ITEMS) return;
      b.priority[section].push(null); save(); draw(); return;
    }
    case "item-back": ui.slot = null; draw(); return;
    case "item-combo": pickForSlot(ui.slot, target); return;
    case "item-clear": clearSlot(ui.slot); save(); draw(); return;
    case "substat-toggle": {
      const slot = ui.slot, index = Number(target.dataset.index);
      const detail = detailOf(b.equipped[slot]);
      const selected = substatsOf(b, slot);
      const order = ui.pickOrder[slot] || (ui.pickOrder[slot] = [...selected]);
      if (selected.has(index)) { selected.delete(index); ui.pickOrder[slot] = order.filter((i) => i !== index); }
      else { if (selected.size >= effectiveCap(detail, slot, b)) return; selected.add(index); ui.pickOrder[slot] = [...order.filter((i) => i !== index), index]; }
      setSubstats(b, slot, selected); save(); draw(); return;
    }
    case "section-toggle": ui.sections[target.dataset.key] = !ui.sections[target.dataset.key]; draw(); return;
    case "substats-tab": ui.substatsTab = target.dataset.tab; draw(); return;
    case "philo-toggle": {
      const slot = ui.slot;
      const active = !b.philosopher_stone[slot];
      if (active) b.philosopher_stone[slot] = true; else delete b.philosopher_stone[slot];
      if (!active) {
        const cap = effectiveCap(detailOf(b.equipped[slot]), slot, b);
        const selected = substatsOf(b, slot);
        const order = ui.pickOrder[slot] || [...selected];
        while (selected.size > cap && order.length) selected.delete(order.pop());
        while (selected.size > cap) selected.delete(Math.max(...selected));
        ui.pickOrder[slot] = order; setSubstats(b, slot, selected);
      }
      save(); draw(); return;
    }
    case "stat-tab": ui.statTab = target.dataset.tab; draw(); return;
    case "stat-mode": ui.statMode = target.dataset.mode; draw(); return;
    case "editor-gear": case "editor-role": {
      const ed = ui.editor;
      if (action === "editor-gear") ed.gearType = target.dataset.key; else ed.role = target.dataset.key;
      draw(); return;
    }
    case "editor-group": ui.editor.group = Number(target.dataset.index); draw(); return;
    case "editor-category": ui.editor.categoryTab[ui.editor.group] = target.dataset.key; draw(); return;
    case "editor-reset": {
      const ed = ui.editor;
      if (!confirm(T.reset_text(ed.gearType, D.ROLE_LABELS[ed.role]))) return;
      ed.data[ed.gearType][ed.role] = Object.fromEntries(Object.entries(DEFAULT_STAT_PRIORITY_BY_CATEGORY).map(([k, v]) => [k, [...v]]));
      draw(); return;
    }
    case "editor-cancel": {
      const ed = ui.editor;
      if (JSON.stringify(ed.data) !== ed.snapshot && !confirm(T.unsaved_text)) return;
      ui.editor = null; ui.view = "normal"; draw(); return;
    }
    case "editor-save": {
      const ed = ui.editor;
      p.stat_priority_profiles = JSON.parse(JSON.stringify(ed.data));
      ed.snapshot = JSON.stringify(ed.data); ed.saved = true; save(); draw();
      setTimeout(() => { if (ui.editor === ed) { ed.saved = false; if (ui.view === "editor") draw(); } }, 2000);
      return;
    }
    default:
  }
}

function onChange(e) {
  const target = e.target.closest("[data-action]");
  if (!target || !main.contains(target)) return;
  const action = target.dataset.action;
  const p = bp();
  const b = build();
  switch (action) {
    case "set-switch": p.current_build_name = target.value; ui.slot = null; D.requestDetails(build().equipped); save(); draw(); return;
    case "link-skill": b.linked_skill_build = target.value; p.current_skill_build_name = target.value; save(); draw(); return;
    case "link-daevanion": b.linked_daevanion_build = target.value; p.current_daevanion_build_name = target.value; save(); draw(); return;
    case "link-genius": b.linked_genius_build = target.value; save(); draw(); return;
    case "only-selected": ui.onlySelected = target.checked; draw(); return;
    case "enchant": b.enchant[ui.slot] = Number(target.value); save(); draw(); return;
    case "compare-build": ui.compare[target.dataset.which] = target.value; D.requestDetails((buildsOf(classKey())[target.value] || {}).equipped); draw(); return;
    case "editor-rank": {
      const ed = ui.editor;
      const category = editorCurrentCategory();
      const values = [...main.querySelectorAll('[data-action="editor-rank"]')].map((s) => s.value).filter(Boolean);
      ed.data[ed.gearType][ed.role][category] = values;
      draw(); return;
    }
    default:
  }
}

// Live slider feedback without rebuilding the slider mid-drag.
function onInput(e) {
  const target = e.target;
  if (target.dataset.action !== "enchant" || !ui.slot) return;
  const b = build();
  const level = Number(target.value);
  b.enchant[ui.slot] = level;
  const item = b.equipped[ui.slot];
  const detail = detailOf(item);
  const valueEl = main.querySelector("[data-enchant-value]");
  if (valueEl) valueEl.textContent = `+${level}`;
  const statsEl = main.querySelector("[data-detail-stats]");
  if (statsEl && detail) statsEl.innerHTML = detailStatsHtml(b, ui.slot, item, detail);
  const label = main.querySelector(`[data-enchant-label="${ui.slot}"]`);
  if (label) label.textContent = level ? `+${level}` : "";
}

// --- exports for the Characters page -------------------------------------------
export const ready = () => Promise.all([D.loadData(), loadArcanaData(), loadPantheonData(), skillsReady(), prepareDaevanion(bp().character_class)]);

// Non-gear Stat Info sources of one equip set.
function statExtras(setName) {
  const cls = classKey();
  const skillBuild = linkedSkillBuildName(cls, setName);
  let daevanion = {};
  try { daevanion = currentBoardStatTotals(); } catch (err) { console.warn("Daevanion stats unavailable:", err.message); }
  return {
    lordPoints: [
      { source: T.stat_source_arcana, points: arcanaLordPointsByLord(cls, skillBuild) },
      { source: T.stat_source_pantheon, points: pantheonLordTotals() },
    ],
    sources: [[T.stat_source_genius, geniusStatTotals(linkedGeniusBuildName(cls, setName))], [T.stat_source_daevanion, daevanion],
      [T.stat_source_passive, passiveSkillStatTotals(bp(), cls, skillBuild)]],
  };
}

// Gear Score as the game counts it: items, enchant, manastones, the Build's
// Daevanion points and the preset's Arcana cards.
export function gearScoreParts(classKey, setName) {
  const cls = String(classKey).toLowerCase();
  const b = ((bp().equip_builds_data || {})[cls] || {})[setName];
  if (!b) return null;
  normalizeBuild(b);
  const items = D.buildGearscore(b);
  const variant = variantData();
  const set = ((bp().daevanion_builds_data || {})[cls] || {})[b.linked_daevanion_build] || {};
  const daevanion = variant ? daevanionScore(set, variant.node_by_id) : 0;
  const skillBuild = ((bp().skill_builds_data || {})[cls] || {})[linkedSkillBuildName(cls, setName)] || {};
  const arcana = arcanaScore(skillBuild.arcana_cards);
  return { items, daevanion, arcana, total: items + daevanion + arcana };
}

export function gearScore(classKey, setName) {
  const parts = gearScoreParts(classKey, setName);
  return parts ? parts.total : 0;
}

function gearScoreTitle(parts) {
  return `Items, enchant and manastones ${fmt(parts.items)} · Daevanion points ${fmt(parts.daevanion)} · Arcana cards ${fmt(parts.arcana)}`;
}

export function equipmentSummaryHtml(classKey, setName) {
  const b = ((bp().equip_builds_data || {})[String(classKey).toLowerCase()] || {})[setName];
  if (!b) return "";
  normalizeBuild(b);
  const slots = [...D.LEFT_SECTIONS, ...D.RIGHT_SECTIONS].flatMap(([, ids]) => ids);
  const cells = slots.map((slotId) => {
    const item = b.equipped[slotId];
    const level = item ? b.enchant[slotId] || 0 : 0;
    return `<span class="eq-summary-slot" title="${h(item ? item.name || "" : T.slot_empty_tooltip(slotLabel(slotId)))}">${item ? iconHtml(item, "small") : placeholderHtml(slotId)}${level ? `<span class="eq-summary-enchant">+${level}</span>` : ""}</span>`;
  }).join("");
  const parts = gearScoreParts(classKey, setName);
  return `<div class="eq-summary"><div class="eq-summary-slots">${cells}</div><div class="eq-gearscore" title="${h(gearScoreTitle(parts))}">GearScore: ${fmt(parts.total)}</div></div>`;
}
