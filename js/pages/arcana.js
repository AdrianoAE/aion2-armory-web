// Arcana: the Information tab (Set banners + the 10 card types), the Sets
// tab (the 5 real Lord card slots of the current skill build, grade pills,
// per-slot skill picking), the Arcana Calculator and the "Arcana Types"
// footer. Desktop: _build_arcana_tab, _ArcanaCardButton, _ArcanaSetBanner,
// ArcanaCardTooltip, ArcanaThemeChoiceDialog, ArcanaResultsDialog,
// ArcanaApplyTargetDialog, ArcanaSkillSlotDialog, ArcanaCardThemeDialog.

import { bp, save } from "../state.js";
import * as A from "../engine/arcana.js";

export const CARD_TYPES = ["Chalice", "Parchment", "Compass", "Bell", "Mirror", "Scales", "Key", "Hourglass", "Dice", "Lantern"];
export const THEME_ORDER = ["Vigor", "Magic", "Frenzy", "Purity", "Punishment", "Protection", "Indomitability"];
export const THEME_COLORS = {
  Vigor: "#facc15", Magic: "#22d3ee", Frenzy: "#f97316", Purity: "#a78bfa",
  Punishment: "#ef4444", Protection: "#4ade80", Indomitability: "#f472b6",
};
const CATEGORY_COLORS = { pve: "#4ade80", pvp: "#fb7185", offense: "#f59e0b", defence: "#38bdf8", cure: "#a855f7" };
const CATEGORY_DEEP = { pve: "#14532d", pvp: "#4c0519", offense: "#78350f", defence: "#0c4a6e", cure: "#4c1d95" };
export const LORD_EFFECTS = {
  Time: "Combat Speed / Smite Resist",
  Freedom: "Accuracy / Evasion",
  Destruction: "Attack Increase / Perfect Resist",
  Illusion: "Cooldown Reduction / Endurance Penetration",
  Destiny: "MP Increase / Endurance",
  Wisdom: "MP Cost / Smite",
  Justice: "Defense Increase / Perfect Chance",
  Life: "HP Increase / Regeneration",
  Death: "Critical Hit Increase / Regeneration Penetration",
  Space: "Move Speed / Block Increase",
};
export const SET_BONUSES = {
  Vigor: { setName: "Primal Vigor", "2pc": "+60 PvE Attack bei HP ≥70%", "4pc": "+150 PvE Attack bei HP ≥70%" },
  Magic: { setName: "Magic Armor", "2pc": "Erstattet 1.500 MP bei MP ≤20% (30s Cooldown)", "4pc": "+1.000 PvE Defense bei MP ≥50%" },
  Frenzy: { setName: "Frenzy", "2pc": "+50 PvE Attack", "4pc": "+5% Boss Damage Boost, +10% Boss Damage Tolerance bei HP ≤70%" },
  Purity: { setName: "Pure Blood", "2pc": "+500 PvE Defense", "4pc": "+5% Critical Damage Boost, +1.000 Defense bei HP ≤70%" },
  Punishment: { setName: "Punishing Overture", "2pc": "+5% Boss Damage Tolerance", "4pc": "+60 PvE Attack, +10% PvE Damage Boost bei HP ≥70%" },
  Protection: { setName: "Protected Soul", "2pc": "+5% Restoration", "4pc": "+5% Weapon Damage Boost, Schutzschild (10.000 Schaden, 5s) bei HP ≤30% (2min Cooldown)" },
  Indomitability: { setName: "Indomitable Dedication", "2pc": "+5% Weapon Damage Tolerance", "4pc": "+5% Critical Damage Tolerance, +50% PvP Damage Tolerance für 5s bei Stun/Knockdown/Airborne/Grab/Frost/Fear" },
};
const THEME_CATEGORY = { Vigor: "pve", Punishment: "pve", Frenzy: "offense", Magic: "defence", Purity: "defence", Protection: "cure", Indomitability: "pvp" };
const BANNER_TRANSFORM = { "Primal Vigor": [1.0, 0.5, 0.5], "Magic Armor": [1.2, 0.2, 0.5] };
const SEASON_GROUPS = [
  ["vigor_magic", "Vigor / Magic", ["Magic", "Vigor"]],
  ["frenzy_purity", "Frenzy / Purity", ["Frenzy", "Purity"]],
  ["pun_pro_indom", "Punishment / Protection / Indomitability", ["Punishment", "Protection", "Indomitability"]],
];
const FUTURE_SEASONS_ENABLED = false;
const MIN_COVERAGE_PERCENT = 70;
export const GRADE_COLORS = { Common: "#94a3b8", Rare: "#4ade80", Unique: "#facc15", Epic: "#f59e0b", Legend: "#38bdf8" };
const RARITY_RANK = { Common: 0, Rare: 1, Legend: 2, Unique: 3, Epic: 4 };
export const SKILL_TYPE_COLORS = { active: "#22d3ee", passive: "#a855f7", stigma: "#facc15" };
const CLASS_ALIASES = { spiritmaster: "elementalist" };
const SKILL_LAYOUT_ROWS = 5;
const DEFAULT_SKILL_BAR_KEYS = ["1", "2", "3", "4", "R", "X", "@mouse_forward", "@mouse_back", "Q", "E", "@mouse_left", "@mouse_right"];

// core/translations.py, en
const T = {
  information: "Information", sets: "Sets", noSets: "No Sets", empty: "Empty", notAvailable: "Not available",
  randomSubstats: "+ Random Substats", active: "Active", passive: "Passive", types: "ARCANA TYPES",
  setBonus: (name) => `${name} — Set Bonus`, bonus2: (t) => `2-piece: ${t}`, bonus4: (t) => `4-piece: ${t}`,
  search: "Search…", clearSlot: "Clear slot", select: "Select", cancel: "Cancel", apply: "Apply", close: "Close",
  chooseSkill: "Choose Skill", chooseSet: "Choose Set", calculator: "Arcana Calculator",
  themeTitle: "Choose Card Sets", themeHint: "For each Lord card type, pick whether you're running the Magic or Vigor version this season.",
  seasonSet: "Season Set", seasonLocked: "Coming in a future season", resultsTitle: "Arcana Combinations",
  combination: (n) => `Combination ${n}`, covered: (name, c, w) => `${name}: ${c} / ${w}`,
  noCombination: "No combination of your available card types can reach any of your wished skill levels.",
  tooManyWishes: "No combination covers at least 70% of your wishlist — you've likely selected too many skills. Reduce a few purple wishes and try again.",
  applyCombination: "Use this combination",
  leftoverHeader: "Every card always levels up fully (its slots don't stop just because your wish is met) — here's what happens to the rest of its levels:",
  leftoverLine: (type, need, total, filler, skills) => `${type} — ${need} / ${total} used for your wish → ${filler} more, best case on: ${skills}`,
  leftoverSkill: (name, value) => `${name} +${value}`,
  leftoverAll: "whichever skill ranks highest on your Priority List (any skill on the card is possible)",
  overwriteTitle: "Overwrite Sets?", overwriteHint: "This build already has Arcana cards assigned. Replace them with this combination's cards?",
  targetTitle: "Apply to which build?", targetHint: "Which build should this combination's cards be written into?",
  applyCurrent: (name) => `Apply to current build (${name})`, applyOther: "Or pick a different build:", applyNew: "Create new build…",
  reason: {
    arm_arcana_reason_no_card: () => "No available Arcana card can boost this skill for your class.",
    arm_arcana_reason_not_enough_slots: (k) => `Even if every eligible slot went only to this skill, the max possible would be +${k.max}.`,
    arm_arcana_reason_competing_wishes: () => "Achievable in principle — this combination spent the matching slots on your other wishes instead.",
  },
  addBuild: "Add new build", duplicateBuild: "Duplicate current build", renameBuild: "Rename current build", deleteBuild: "Delete current build",
  newBuild: "New Build", renameTitle: "Rename Build", duplicateTitle: "Duplicate Build", nameColon: "Name:",
  deleteConfirm: (name) => `Really delete "${name}"? This cannot be undone.`, duplicateDefault: (name) => `${name} (Copy)`,
};

const esc = (text) => String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const shortName = (name, max) => ((name || "").length <= max ? name || "" : (name || "").slice(0, max - 1).trimEnd() + "…");

// ---- data ------------------------------------------------------------------

let data = null;

export async function loadArcanaData() {
  if (data) return data;
  const [info, classSkillsRaw, skillsRaw] = await Promise.all([
    fetch("data/arcana_info.json").then((r) => r.json()),
    fetch("data/arcana_class_skills.json").then((r) => r.json()),
    fetch("data/skills_all.json").then((r) => r.json()),
  ]);
  const themeMap = {};
  for (const theme of THEME_ORDER) {
    themeMap[theme] = {};
    for (const ct of CARD_TYPES) {
      const entries = info.arcana.filter((a) => a.theme === theme && a.cardType === ct);
      if (!entries.length) continue;
      const grades = [...new Set(entries.map((a) => a.grade))].sort((a, b) => (RARITY_RANK[a] ?? 99) - (RARITY_RANK[b] ?? 99));
      themeMap[theme][ct] = { iconFile: entries[0].iconFile, lord: entries[0].empyreanLord, mainStat: entries[0].mainStat, grades };
    }
  }
  const defaultIcon = {};
  for (const ct of CARD_TYPES) {
    for (const theme of ["Vigor", "Punishment"]) {
      const entry = themeMap[theme][ct];
      if (entry) { defaultIcon[ct] = entry.iconFile; break; }
    }
  }
  const classSkills = {};
  for (const [cardType, grades] of Object.entries(classSkillsRaw)) {
    classSkills[cardType] = grades.Unique || Object.values(grades)[0] || {};
  }
  const skills = {};
  for (const s of skillsRaw.skills) skills[s.id] = s;
  data = { themeMap, defaultIcon, classSkills, skills };
  return data;
}

export function skillsClassKey(classKey) {
  const key = (classKey || "").trim().toLowerCase();
  return CLASS_ALIASES[key] || key;
}

function iconUrl(iconFile) { return iconFile ? `assets/arcana_icons/${iconFile}` : ""; }
function skillIcon(skill) { return skill && skill.iconFile ? `assets/skill_icons/${skill.iconFile}` : ""; }
function bannerImage(setName) { return `assets/Arcana_Set_background/${setName.replace(/ /g, "_")}.png`; }

// ---- skill builds (shared with the Skill Planner) ---------------------------

function emptySkillLayout() {
  const keys = {};
  DEFAULT_SKILL_BAR_KEYS.forEach((key, col) => { keys[`${SKILL_LAYOUT_ROWS - 1},${col}`] = key; });
  return { slots: {}, keys, macro: [] };
}

export function emptySkillBuild() {
  return { priority: { active: [null], passive: [null], stigma: [null] }, arcana_cards: {}, layout: emptySkillLayout() };
}

export function skillBuildsFor(classKey) {
  const p = bp();
  if (!p.skill_builds_data) p.skill_builds_data = {};
  if (!p.skill_builds_data[classKey]) p.skill_builds_data[classKey] = { Default: emptySkillBuild() };
  return p.skill_builds_data[classKey];
}

export function currentSkillBuildName(classKey) {
  const builds = skillBuildsFor(classKey);
  const p = bp();
  if (p.current_skill_build_name in builds) return p.current_skill_build_name;
  return Object.keys(builds)[0];
}

// _linked_skill_build_name_for: the skill/arcana build an equip set counts.
export function linkedSkillBuildName(classKey, equipSetName) {
  const builds = (bp().skill_builds_data || {})[classKey] || {};
  const equip = ((bp().equip_builds_data || {})[classKey] || {})[equipSetName] || {};
  if (equip.linked_skill_build in builds) return equip.linked_skill_build;
  if (bp().current_skill_build_name in builds) return bp().current_skill_build_name;
  return Object.keys(builds)[0] || "Default";
}

function classKey() { return (bp().character_class || "").toLowerCase(); }

function usableAndPools() {
  const usable = A.usableLordTypes(data.themeMap, A.ACTIVE_THEMES);
  const key = skillsClassKey(classKey());
  const pools = {};
  for (const ct of usable) pools[ct] = (data.classSkills[ct] || {})[key] || [];
  return [usable, pools];
}

function classPool(ct) { return (data.classSkills[ct] || {})[skillsClassKey(classKey())] || []; }

function skillTypeById() {
  const map = {};
  for (const [id, s] of Object.entries(data.skills)) map[id] = s.type;
  return map;
}

function skillName(sid, pools) {
  if (data.skills[sid]) return data.skills[sid].name;
  for (const pool of Object.values(pools || {})) {
    const hit = pool.find((s) => s.id === sid);
    if (hit) return hit.name;
  }
  return sid;
}

// _skill_priority_rank: active then passive priority-list positions.
function priorityRank(build) {
  const rank = {};
  let i = 0;
  for (const type of ["active", "passive"]) {
    for (const sid of (build.priority || {})[type] || []) {
      if (sid !== null && sid !== undefined && !(sid in rank)) { rank[sid] = i; i += 1; }
    }
  }
  return rank;
}

// ---- exports for other pages ----------------------------------------------

// {lord: points} of a skill build's assigned cards (the Arcana share of
// _arcana_lord_stat_totals_detailed). Requires loadArcanaData() first.
export function arcanaLordPointsByLord(classKeyArg, buildName) {
  const out = {};
  if (!data) return out;
  const build = ((bp().skill_builds_data || {})[classKeyArg] || {})[buildName] || {};
  for (const [ct, card] of Object.entries(build.arcana_cards || {})) {
    const result = A.cardLordPoints(card, data.themeMap, ct);
    if (result) out[result[0]] = (out[result[0]] || 0) + result[1];
  }
  return out;
}

// {stat_id: percent} derived from combined Lord points, LORD_RATE per point.
export function lordDerivedStats(pointsByLord) {
  const totals = {};
  for (const [lord, points] of Object.entries(pointsByLord || {})) {
    if (!points) continue;
    for (const statId of A.LORD_STAT_IDS[lord] || []) totals[statId] = (totals[statId] || 0) + points * A.LORD_RATE;
  }
  return totals;
}

export function arcanaSkillBonus(classKeyArg, buildName) {
  const build = ((bp().skill_builds_data || {})[classKeyArg] || {})[buildName] || {};
  return A.cardSkillBonus(build.arcana_cards);
}

// Compact HTML of a skill build's 5 card slots, for summaries elsewhere.
export function arcanaSummaryHtml(classKeyArg, buildName) {
  if (!data) return "";
  const build = ((bp().skill_builds_data || {})[classKeyArg] || {})[buildName] || {};
  const cards = build.arcana_cards || {};
  const usable = A.usableLordTypes(data.themeMap, A.ACTIVE_THEMES);
  const pools = data.classSkills;
  const rows = usable.map((ct) => {
    const card = cards[ct];
    const entry = card && card.theme ? (data.themeMap[card.theme] || {})[ct] : null;
    const icon = iconUrl(entry ? entry.iconFile : data.defaultIcon[ct]);
    if (!entry) {
      return `<div class="arcana-summary-row"><img src="${icon}" alt=""><b>${ct}</b><span class="muted">${T.empty}</span></div>`;
    }
    const lord = A.cardLordPoints(card, data.themeMap, ct);
    const pool = (pools[ct] || {})[skillsClassKey(classKeyArg)] || [];
    const names = {};
    for (const s of pool) names[s.id] = s.name;
    const slots = A.cardSlotList(card).filter((s) => s && s.skill_id)
      .map((s) => `<span style="color:${SKILL_TYPE_COLORS[(data.skills[s.skill_id] || {}).type] || "inherit"}">${esc(shortName(names[s.skill_id] || skillName(s.skill_id), 26))}</span> <span class="warn">+${s.level ?? A.SKILL_BASELINE}</span>`)
      .join(", ");
    return `<div class="arcana-summary-row"><img src="${icon}" alt=""><b>${ct}</b>
      <span class="muted">${esc(card.theme)} — </span><span class="warn">${esc(lord ? lord[0] : "")}</span> ${lord ? lord[1] : ""}
      <span class="arcana-summary-slots">${slots}</span></div>`;
  });
  return `<div class="arcana-summary">${rows.join("")}</div>`;
}

export function lordBarHtml() {
  const parts = Object.entries(LORD_EFFECTS).map(([lord, effect]) => `<span class="warn" style="font-weight:700">${lord}</span> &rarr; ${esc(effect)}`);
  return `<div class="arcana-lord-bar"><div class="title">${T.types}</div><div class="text">${parts.join(" &nbsp;·&nbsp; ")}</div></div>`;
}

// ---- tooltips ----------------------------------------------------------------

let tooltipEl = null;

// Lives inside the open modal dialog when there is one: the top layer
// would otherwise cover a body-level tooltip.
function tooltip() {
  if (!tooltipEl || !tooltipEl.isConnected) {
    tooltipEl = document.createElement("div");
    tooltipEl.className = "tooltip arcana-tooltip";
    tooltipEl.hidden = true;
  }
  const host = document.querySelector("dialog[open]") || document.body;
  if (tooltipEl.parentNode !== host) host.appendChild(tooltipEl);
  return tooltipEl;
}

function showTooltip(html, event) {
  const el = tooltip();
  el.innerHTML = html;
  el.hidden = false;
  moveTooltip(event);
}

function moveTooltip(event) {
  const el = tooltip();
  if (el.hidden) return;
  const pad = 14;
  let x = event.clientX + pad;
  let y = event.clientY + pad;
  const rect = el.getBoundingClientRect();
  if (x + rect.width > window.innerWidth - 8) x = Math.max(8, event.clientX - rect.width - pad);
  if (y + rect.height > window.innerHeight - 8) y = Math.max(8, window.innerHeight - rect.height - 8);
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
}

function hideTooltip() { if (tooltipEl) tooltipEl.hidden = true; }

// ArcanaCardTooltip.set_card
function cardTooltipHtml(cardType, theme, lord, pool, assigned) {
  const lordLine = lord
    ? `<div class="lord-line"><span class="warn" style="font-weight:700">${lord}</span> <span class="accent" style="font-weight:700">+${A.CARD_EXTRA_BUDGET}</span><br><span class="muted">${esc(LORD_EFFECTS[lord] || "")}</span></div>`
    : "";
  const column = (type, title) => {
    const rows = pool.filter((s) => s.type === type).map((s) => {
      const isAssigned = s.id in assigned;
      const value = isAssigned ? `+${assigned[s.id]}` : `+${A.SKILL_BASELINE}–${A.PER_SKILL_CAP}`;
      return `<div class="skill-row"><span class="${isAssigned ? "" : "muted"}">${esc(shortName(s.name, 26))}</span>&nbsp;&nbsp;<span class="${isAssigned ? "accent" : "muted"}" style="font-weight:700">${value}</span></div>`;
    });
    if (!rows.length) return "";
    return `<div class="col"><div class="col-head" style="color:${SKILL_TYPE_COLORS[type]}">${title}</div>${rows.join("")}</div>`;
  };
  return `<div class="title">${cardType} — ${esc(theme)}</div>${lordLine}<div class="cols">${column("active", T.active)}${column("passive", T.passive)}</div>`;
}

function setBonusTooltipHtml(theme) {
  const info = SET_BONUSES[theme] || {};
  const color = THEME_COLORS[theme] || "var(--accent)";
  return `<div class="bonus-title" style="color:${color}">${esc(T.setBonus(info.setName || theme))}</div>
    <div class="bonus-line">${esc(T.bonus2(info["2pc"] || ""))}</div><div class="bonus-line">${esc(T.bonus4(info["4pc"] || ""))}</div>`;
}

function attachTooltip(el, htmlFn) {
  el.addEventListener("mouseenter", (e) => { const html = htmlFn(); if (html) showTooltip(html, e); });
  el.addEventListener("mousemove", moveTooltip);
  el.addEventListener("mouseleave", hideTooltip);
}

// ---- dialogs ------------------------------------------------------------------

function openDialog(html, className = "") {
  const dlg = document.createElement("dialog");
  dlg.className = `arcana-dialog ${className}`.trim();
  dlg.innerHTML = html;
  document.body.appendChild(dlg);
  dlg.addEventListener("close", () => { hideTooltip(); dlg.remove(); });
  dlg.showModal();
  return dlg;
}

// ---- cards -------------------------------------------------------------------

function gradeDots(grades) {
  return ["Common", "Rare", "Legend", "Unique"].filter((g) => grades.includes(g))
    .map((g) => `<span style="color:${GRADE_COLORS[g]}">&#9679;</span>`).join(" ");
}

function cardInfoHtml(entry, lordPoints) {
  if (entry.lord) {
    const value = lordPoints !== null && lordPoints !== undefined ? ` <span style="color:var(--fg);font-weight:700">${lordPoints}</span>` : "";
    return `<span class="warn" style="font-weight:700">${entry.lord}</span>${value}<br><span class="effect">${esc(LORD_EFFECTS[entry.lord] || "")}</span>`;
  }
  return `<span class="warn" style="font-weight:700">${esc(entry.mainStat || "")}</span><br><span class="effect">${T.randomSubstats}</span>`;
}

// _ArcanaCardButton: state "default" | "themed" | "unavailable".
function cardHtml(ct, entry, { unavailable = false, lordPoints = null, withSlots = false, grade = A.DEFAULT_GRADE, slotsEnabled = false } = {}) {
  const state = unavailable ? "unavailable" : entry ? "themed" : "default";
  const icon = unavailable ? "" : iconUrl(entry ? entry.iconFile : data.defaultIcon[ct]);
  const slots = withSlots ? `
    <div class="grade-pills">${["Rare", "Legend", "Unique"].map((g) => `<button type="button" class="grade-pill${g === grade ? " checked" : ""}" data-grade="${g}" style="color:${GRADE_COLORS[g]}" ${slotsEnabled ? "" : "disabled"}>${g}</button>`).join("")}</div>
    ${[0, 1, 2, 3].map((i) => `<div class="skill-slot${slotsEnabled ? "" : " disabled"}" data-slot="${i}"><span class="sname"></span><span class="sval"></span></div>`).join("")}` : "";
  return `<div class="arcana-card${withSlots ? " with-slots" : ""}" data-state="${state}" data-ct="${ct}">
    <div class="icon">${icon ? `<img src="${icon}" alt="">` : ""}</div>
    <div class="name" ${unavailable ? "hidden" : ""}>${ct}</div>
    <div class="info">${entry ? cardInfoHtml(entry, lordPoints) : ""}</div>
    <div class="hint">${unavailable ? T.notAvailable : entry ? "" : T.empty}</div>
    <div class="grades">${entry ? gradeDots(entry.grades) : ""}</div>${slots}</div>`;
}

function fillSkillSlots(cardEl, slots, idToSkill) {
  cardEl.querySelectorAll(".skill-slot").forEach((slotEl, i) => {
    const entry = slots[i];
    const nameEl = slotEl.querySelector(".sname");
    const valueEl = slotEl.querySelector(".sval");
    if (!entry || !entry.skill_id) { nameEl.innerHTML = ""; valueEl.innerHTML = ""; return; }
    const skill = idToSkill[entry.skill_id] || {};
    const level = entry.level ?? A.SKILL_BASELINE;
    nameEl.innerHTML = `<span style="color:${SKILL_TYPE_COLORS[skill.type] || "var(--fg)"}">${esc(shortName(skill.name || "", 26))}</span>`;
    valueEl.innerHTML = `<span class="warn" style="font-weight:700">+${level}</span>`;
  });
}

// ---- page -----------------------------------------------------------------------

let root = null;
let subTab = "info";
let activeTheme = null;

export async function mount(main) {
  root = main;
  root.innerHTML = `<div class="muted">Loading…</div>`;
  await loadArcanaData();
  if (root !== main) return;
  draw();
}

export function unmount() {
  hideTooltip();
  root = null;
}

function draw() {
  if (!root) return;
  hideTooltip();
  root.innerHTML = `<div class="arcana-page">
    <div class="row arcana-subtabs">
      <button type="button" data-tab="info" class="${subTab === "info" ? "active" : ""}">${T.information}</button>
      <button type="button" data-tab="sets" class="${subTab === "sets" ? "active" : ""}">${T.sets}</button>
    </div>
    <div class="arcana-body"></div>
    ${lordBarHtml()}
  </div>`;
  root.querySelectorAll(".arcana-subtabs button").forEach((b) => b.addEventListener("click", () => { subTab = b.dataset.tab; draw(); }));
  const body = root.querySelector(".arcana-body");
  if (subTab === "info") drawInformation(body); else drawSets(body);
}

// _build_arcana_column + _refresh_arcana_cards
function drawInformation(body) {
  const banners = THEME_ORDER.map((theme) => {
    const category = THEME_CATEGORY[theme];
    const setName = (SET_BONUSES[theme] || {}).setName || theme;
    const [zoom, ax, ay] = BANNER_TRANSFORM[setName] || [1.0, 0.5, 0.5];
    const fallback = `linear-gradient(135deg, ${CATEGORY_DEEP[category]}, ${CATEGORY_COLORS[category]})`;
    return `<button type="button" class="arcana-banner${activeTheme === theme ? " checked" : ""}" data-theme="${theme}" style="background:${fallback}">
      <img src="${bannerImage(setName)}" alt="" style="object-position:${ax * 100}% ${ay * 100}%;transform:scale(${zoom});transform-origin:${ax * 100}% ${ay * 100}%" onerror="this.remove()">
      <span class="overlay"></span><span class="spark">✦</span><span class="set-name">${esc(setName)}</span></button>`;
  }).join("");
  body.innerHTML = `<div class="arcana-info">
    <div class="arcana-sets-col">
      <button type="button" class="arcana-none${activeTheme === null ? " checked" : ""}">${T.noSets}</button>${banners}
    </div>
    <div class="arcana-card-grid info-grid">${CARD_TYPES.map((ct) => {
      if (activeTheme === null) return cardHtml(ct, null);
      const entry = (data.themeMap[activeTheme] || {})[ct];
      return entry ? cardHtml(ct, entry) : cardHtml(ct, null, { unavailable: true });
    }).join("")}</div>
  </div>`;
  body.querySelector(".arcana-none").addEventListener("click", () => { activeTheme = null; draw(); });
  body.querySelectorAll(".arcana-banner").forEach((b) => {
    b.addEventListener("click", () => { activeTheme = b.dataset.theme; draw(); });
    attachTooltip(b, () => setBonusTooltipHtml(b.dataset.theme));
  });
  body.querySelectorAll(".arcana-card").forEach((card) => {
    attachTooltip(card, () => {
      const ct = card.dataset.ct;
      const entry = activeTheme ? (data.themeMap[activeTheme] || {})[ct] : null;
      if (!entry) return "";
      return cardTooltipHtml(ct, activeTheme || "", entry.lord, classPool(ct), {});
    });
  });
}

// _build_arcana_sets_tab + _refresh_arcana_equip_slots
function drawSets(body) {
  const cls = classKey();
  const builds = skillBuildsFor(cls);
  const current = currentSkillBuildName(cls);
  const build = builds[current];
  const cards = build.arcana_cards || {};
  const [usable] = usableAndPools();
  const hasWish = Object.values(bp().skill_arcana_wish || {}).some((v) => v > 0);
  body.innerHTML = `<div class="arcana-sets">
    <div class="row build-row">
      <select class="build-select">${Object.keys(builds).map((n) => `<option ${n === current ? "selected" : ""}>${esc(n)}</option>`).join("")}</select>
      <button type="button" class="icon" data-act="add" title="${T.addBuild}">＋</button>
      <button type="button" class="icon" data-act="dup" title="${T.duplicateBuild}">⧉</button>
      <button type="button" class="icon" data-act="rename" title="${T.renameBuild}">✎</button>
      <button type="button" class="icon" data-act="delete" title="${T.deleteBuild}" ${Object.keys(builds).length > 1 ? "" : "disabled"}>🗑</button>
      <span class="grow"></span>
      <button type="button" class="arcana-calc" ${hasWish ? "" : "disabled"} title="${esc("Arcana wish — counts toward the damage preview, but resets once the Arcana Calculator applies a combination to a build.")}">${T.calculator}</button>
    </div>
    <div class="arcana-card-grid">${usable.map((ct) => {
      const card = cards[ct];
      const theme = card ? card.theme : null;
      const entry = theme ? (data.themeMap[theme] || {})[ct] : null;
      const lord = entry ? A.cardLordPoints(card, data.themeMap, ct) : null;
      return cardHtml(ct, entry || null, { withSlots: true, lordPoints: lord ? lord[1] : null, grade: A.cardGrade(card), slotsEnabled: !!theme });
    }).join("")}</div>
  </div>`;
  for (const ct of usable) {
    const cardEl = body.querySelector(`.arcana-card[data-ct="${ct}"]`);
    const pool = classPool(ct);
    const idToSkill = {};
    for (const s of pool) idToSkill[s.id] = s;
    fillSkillSlots(cardEl, A.cardSlotList(cards[ct]), idToSkill);
    cardEl.addEventListener("click", (e) => {
      if (e.target.closest(".skill-slot, .grade-pill")) return;
      onCardSetClicked(ct);
    });
    cardEl.querySelectorAll(".grade-pill").forEach((pill) => pill.addEventListener("click", () => onGradeChanged(ct, pill.dataset.grade)));
    cardEl.querySelectorAll(".skill-slot").forEach((slotEl) => slotEl.addEventListener("click", () => {
      if (slotEl.classList.contains("disabled")) return;
      onSkillSlotClicked(ct, Number(slotEl.dataset.slot));
    }));
  }
  body.querySelector(".build-select").addEventListener("change", (e) => { bp().current_skill_build_name = e.target.value; save(); draw(); });
  body.querySelectorAll(".build-row [data-act]").forEach((b) => b.addEventListener("click", () => onBuildAction(b.dataset.act)));
  body.querySelector(".arcana-calc").addEventListener("click", () => openArcanaCalculator());
}

function onBuildAction(action) {
  const cls = classKey();
  const builds = skillBuildsFor(cls);
  const current = currentSkillBuildName(cls);
  if (action === "add") {
    const name = (prompt(`${T.newBuild}\n${T.nameColon}`) || "").trim();
    if (!name || name in builds) return;
    builds[name] = emptySkillBuild();
    bp().current_skill_build_name = name;
  } else if (action === "dup") {
    const name = (prompt(`${T.duplicateTitle}\n${T.nameColon}`, T.duplicateDefault(current)) || "").trim();
    if (!name || name in builds) return;
    builds[name] = JSON.parse(JSON.stringify(builds[current]));
    bp().current_skill_build_name = name;
  } else if (action === "rename") {
    const name = (prompt(`${T.renameTitle}\n${T.nameColon}`, current) || "").trim();
    if (!name || name === current || name in builds) return;
    builds[name] = builds[current];
    delete builds[current];
    bp().current_skill_build_name = name;
  } else if (action === "delete") {
    if (Object.keys(builds).length <= 1 || !confirm(T.deleteConfirm(current))) return;
    delete builds[current];
    bp().current_skill_build_name = Object.keys(builds)[0];
  }
  save();
  draw();
}

function currentCardData(ct) {
  const build = skillBuildsFor(classKey())[currentSkillBuildName(classKey())];
  if (!build.arcana_cards) build.arcana_cards = {};
  if (!build.arcana_cards[ct]) build.arcana_cards[ct] = {};
  return build.arcana_cards[ct];
}

// ArcanaCardThemeDialog
function onCardSetClicked(ct) {
  const card = currentCardData(ct);
  const options = [...A.ACTIVE_THEMES].filter((theme) => ct in (data.themeMap[theme] || {})).map((theme) => [theme, data.themeMap[theme][ct]]);
  if (!options.length) return;
  const dlg = openDialog(`<h2>${T.chooseSet}</h2>
    <div class="list arcana-list">${options.map(([theme, entry]) => `<div class="card clickable option${theme === card.theme ? " current" : ""}" data-theme="${theme}">${esc(entry.lord ? `${theme} — ${entry.lord}` : theme)}</div>`).join("")}</div>
    <div class="row"><button type="button" class="clear">${T.clearSlot}</button><span class="grow"></span><button type="button" class="select">${T.select}</button></div>`, "narrow");
  let chosen = card.theme || null;
  const finish = (theme) => { card.theme = theme; save(); dlg.close(); draw(); };
  dlg.querySelectorAll(".option").forEach((o) => {
    o.addEventListener("click", () => { chosen = o.dataset.theme; dlg.querySelectorAll(".option").forEach((x) => x.classList.toggle("current", x === o)); });
    o.addEventListener("dblclick", () => finish(o.dataset.theme));
  });
  dlg.querySelector(".clear").addEventListener("click", () => finish(null));
  dlg.querySelector(".select").addEventListener("click", () => { if (chosen) finish(chosen); else dlg.close(); });
}

function onGradeChanged(ct, grade) {
  const card = currentCardData(ct);
  card.grade = grade;
  if (card.slots === undefined || card.slots === null) card.slots = A.cardSlotList(card);
  save();
  draw();
}

// ArcanaSkillSlotDialog
function onSkillSlotClicked(ct, slotIndex) {
  const card = currentCardData(ct);
  const slots = A.cardSlotList(card);
  const grade = A.cardGrade(card);
  const category = A.LORD_CATEGORY[ct] || "both";
  const eligible = classPool(ct).filter((s) => category === "both" || s.type === category);
  const usedElsewhere = new Set(slots.filter((s, i) => i !== slotIndex && s).map((s) => s.skill_id));
  const available = eligible.filter((s) => !usedElsewhere.has(s.id));
  const spentElsewhere = slots.reduce((sum, s, i) => (i !== slotIndex && s ? sum + Math.max(0, s.level - A.SKILL_BASELINE) : sum), 0);
  const remainingBudget = Math.max(0, (A.GRADE_MAX_LEVEL[grade] ?? A.MAX_CARD_LEVEL) - spentElsewhere);
  const current = slots[slotIndex];
  const maxLevel = Math.min(A.PER_SKILL_CAP, A.SKILL_BASELINE + remainingBudget);
  let selected = current ? available.find((s) => s.id === current.skill_id) || null : null;
  let level = selected && current ? (current.level ?? A.SKILL_BASELINE) : A.SKILL_BASELINE;

  const dlg = openDialog(`<h2>${T.chooseSkill}</h2>
    <input type="text" class="search" placeholder="${T.search}">
    <div class="list arcana-list skill-list"></div>
    <div class="row level-row"><span class="grow"></span><button type="button" class="icon minus">−</button><span class="level"></span><button type="button" class="icon plus">+</button><span class="grow"></span></div>
    <div class="row"><button type="button" class="clear">${T.clearSlot}</button><span class="grow"></span><button type="button" class="select">${T.select}</button></div>`, "narrow");
  const list = dlg.querySelector(".skill-list");
  const search = dlg.querySelector(".search");
  const refreshLevel = () => {
    dlg.querySelector(".level").textContent = selected ? `+${level}` : "—";
    dlg.querySelector(".minus").disabled = !selected || level <= A.SKILL_BASELINE;
    dlg.querySelector(".plus").disabled = !selected || level >= maxLevel;
  };
  const rowHtml = (s) => `<div class="card clickable skill-option${selected && selected.id === s.id ? " current" : ""}" data-id="${s.id}">
    ${skillIcon(data.skills[s.id]) ? `<img src="${skillIcon(data.skills[s.id])}" alt="">` : "<span class=\"no-icon\"></span>"}<span style="color:${SKILL_TYPE_COLORS[s.type] || "var(--fg)"}">${esc(s.name)}</span></div>`;
  const refreshList = () => {
    const query = search.value.trim().toLowerCase();
    const matched = available.filter((s) => !query || s.name.toLowerCase().includes(query));
    const types = new Set(matched.map((s) => s.type));
    const showHeaders = ["active", "passive"].filter((t) => types.has(t)).length > 1;
    list.innerHTML = showHeaders
      ? ["active", "passive"].map((type) => {
        const group = matched.filter((s) => s.type === type);
        return group.length ? `<div class="type-header" style="color:${SKILL_TYPE_COLORS[type]}">${type.toUpperCase()}</div>${group.map(rowHtml).join("")}` : "";
      }).join("")
      : matched.map(rowHtml).join("");
    list.querySelectorAll(".skill-option").forEach((o) => o.addEventListener("click", () => {
      const skill = available.find((s) => s.id === o.dataset.id);
      if (!selected || skill.id !== selected.id) { selected = skill; level = A.SKILL_BASELINE; }
      list.querySelectorAll(".skill-option").forEach((x) => x.classList.toggle("current", x === o));
      refreshLevel();
    }));
  };
  search.addEventListener("input", refreshList);
  dlg.querySelector(".minus").addEventListener("click", () => { level = Math.max(A.SKILL_BASELINE, level - 1); refreshLevel(); });
  dlg.querySelector(".plus").addEventListener("click", () => { level = Math.min(maxLevel, level + 1); refreshLevel(); });
  const finish = (entry) => {
    slots[slotIndex] = entry;
    card.slots = slots;
    card.grade = grade;
    save();
    dlg.close();
    draw();
  };
  dlg.querySelector(".clear").addEventListener("click", () => finish(null));
  dlg.querySelector(".select").addEventListener("click", () => { if (selected) finish({ skill_id: selected.id, level }); else dlg.close(); });
  refreshList();
  refreshLevel();
  search.focus();
}

// ---- the Arcana Calculator -------------------------------------------------------

// Opens the Calculator for the current class's wishes (bp().skill_arcana_wish);
// the Skill Planner page may call this too.
export async function openArcanaCalculator() {
  await loadArcanaData();
  const wishes = {};
  for (const [sid, v] of Object.entries(bp().skill_arcana_wish || {})) if (v > 0) wishes[sid] = v;
  if (!Object.keys(wishes).length) return;
  const choice = await themeChoiceDialog();
  if (!choice) return;
  const { usableTypes, typeToTheme, pools } = choice;
  const cls = classKey();
  const build = skillBuildsFor(cls)[currentSkillBuildName(cls)];
  const results = A.computeCombinations(usableTypes, typeToTheme, pools, wishes, skillTypeById(), priorityRank(build), 3);
  const names = {};
  for (const sid of Object.keys(wishes)) names[sid] = skillName(sid, pools);
  resultsDialog(results, wishes, names, usableTypes, pools, typeToTheme);
}

// ArcanaThemeChoiceDialog → {usableTypes, typeToTheme, pools} or null
function themeChoiceDialog() {
  return new Promise((resolve) => {
    let groupIdx = SEASON_GROUPS.findIndex(([, , themes]) => themes.some((t) => A.ACTIVE_THEMES.has(t)));
    if (groupIdx < 0) groupIdx = 0;
    const dlg = openDialog(`<h2>${T.themeTitle}</h2><div class="muted">${T.themeHint}</div>
      <div class="season-label">${T.seasonSet}</div><div class="row season-row"></div>
      <div class="theme-grid-wrap"></div>
      <div class="row"><span class="grow"></span><button type="button" class="cancel">${T.cancel}</button><button type="button" class="apply">${T.apply}</button></div>`, "wide");
    let done = false;
    const finish = (value) => { if (done) return; done = true; resolve(value); dlg.close(); };
    const rebuild = () => {
      const themes = SEASON_GROUPS[groupIdx][2];
      const usable = A.usableLordTypes(data.themeMap, new Set(themes));
      dlg.querySelector(".season-row").innerHTML = SEASON_GROUPS.map(([, label], i) => {
        const enabled = i === groupIdx || FUTURE_SEASONS_ENABLED;
        return `<button type="button" class="grow${i === groupIdx ? " active" : ""}" data-i="${i}" ${enabled ? "" : `disabled title="${T.seasonLocked}"`}>${label}${enabled ? "" : "  🔒"}</button>`;
      }).join("");
      dlg.querySelectorAll(".season-row button").forEach((b) => b.addEventListener("click", () => { groupIdx = Number(b.dataset.i); rebuild(); }));
      dlg.querySelector(".theme-grid-wrap").innerHTML = `<table class="arcana-theme-grid"><tr><th></th>${themes.map((theme) => `<th><span style="color:${THEME_COLORS[theme]}">${theme.toUpperCase()}</span> <span class="info-dot" data-theme="${theme}" style="color:${THEME_COLORS[theme]};border-color:${THEME_COLORS[theme]}">i</span></th>`).join("")}</tr>
        ${usable.map((ct) => {
          const defaultTheme = [...themes].reverse().find((t) => (data.themeMap[t] || {})[ct] && data.themeMap[t][ct].lord);
          return `<tr><td class="ct">${ct}</td>${themes.map((theme) => {
            const entry = (data.themeMap[theme] || {})[ct] || {};
            const lord = entry.lord;
            return `<td><label class="theme-option${theme === defaultTheme ? " selected" : ""}" data-theme="${theme}" style="--theme:${THEME_COLORS[theme]}" title="${lord ? esc(`${lord}\n${LORD_EFFECTS[lord] || ""}`) : ""}">
              <input type="radio" name="ct-${ct}" value="${theme}" ${lord ? "" : "disabled"} ${theme === defaultTheme ? "checked" : ""}><span class="lord">${lord ? `${lord} +${A.CARD_EXTRA_BUDGET}` : "—"}</span></label></td>`;
          }).join("")}</tr>`;
        }).join("")}</table>`;
      dlg.querySelectorAll(".info-dot").forEach((dot) => attachTooltip(dot, () => setBonusTooltipHtml(dot.dataset.theme)));
      dlg.querySelectorAll("input[type=radio]").forEach((r) => r.addEventListener("change", () => {
        dlg.querySelectorAll(`input[name="${r.name}"]`).forEach((x) => x.closest(".theme-option").classList.toggle("selected", x.checked));
      }));
    };
    rebuild();
    dlg.querySelector(".cancel").addEventListener("click", () => finish(null));
    dlg.addEventListener("close", () => finish(null));
    dlg.querySelector(".apply").addEventListener("click", () => {
      const themes = SEASON_GROUPS[groupIdx][2];
      const usableTypes = A.usableLordTypes(data.themeMap, new Set(themes));
      const typeToTheme = {};
      for (const ct of usableTypes) {
        const checked = dlg.querySelector(`input[name="ct-${ct}"]:checked`);
        if (checked) typeToTheme[ct] = checked.value;
      }
      if (!Object.keys(typeToTheme).length) { finish(null); return; }
      const key = skillsClassKey(classKey());
      const pools = {};
      for (const ct of usableTypes) pools[ct] = (data.classSkills[ct] || {})[key] || [];
      finish({ usableTypes, typeToTheme, pools });
    });
  });
}

// ArcanaResultsDialog
function resultsDialog(allResults, wishes, skillNames, usableTypes, pools, typeToTheme) {
  const hadAny = allResults.length > 0;
  const results = allResults.filter((r) => A.resultCoveragePercent(r, wishes) > MIN_COVERAGE_PERCENT);
  const typeById = skillTypeById();
  let bodyHtml;
  if (!results.length) {
    bodyHtml = `<div>${hadAny ? T.tooManyWishes : T.noCombination}</div>`;
  } else {
    bodyHtml = results.map((result, i) => {
      const byType = {};
      for (const a of result.assignments) byType[a.type] = a;
      const tiles = usableTypes.map((ct) => {
        const a = byType[ct];
        const theme = a ? a.theme : typeToTheme[ct] || "";
        const entry = (data.themeMap[theme] || {})[ct] || {};
        return `<div class="result-tile${a && Object.keys(a.skill_ids).length ? " assigned" : ""}" data-ct="${ct}" data-i="${i}"><img src="${iconUrl(entry.iconFile)}" alt=""></div>`;
      }).join("");

      // Cross-card excess attribution: non-Chalice/Scales cards first.
      const order = [...result.assignments].sort((a, b) => Number(["Chalice", "Scales"].includes(a.type)) - Number(["Chalice", "Scales"].includes(b.type)));
      const remainingWish = { ...wishes };
      const excessBudget = {};
      for (const a of order) {
        for (const sid of a.need_based_ids) {
          const value = a.skill_ids[sid];
          const stillNeeded = remainingWish[sid] || 0;
          const attributed = Math.min(value, stillNeeded);
          remainingWish[sid] = stillNeeded - attributed;
          const excess = (value - 1) - Math.max(0, attributed - 1);
          if (excess > 0) excessBudget[`${a.type}|${sid}`] = excess;
        }
      }
      const lines = Object.entries(wishes).map(([sid, need]) => {
        const covered = result.covered[sid] || 0;
        const name = skillNames[sid] || sid;
        const full = covered >= need;
        let html = `<div style="color:${full ? "#4ade80" : "var(--danger)"};font-weight:700">${esc(T.covered(name, Math.min(covered, need), need))}</div>`;
        if (!full) {
          const [key, kwargs] = A.uncoveredReason(sid, need, covered, usableTypes, pools, typeById);
          html += `<div class="reason">${esc(T.reason[key](kwargs))}</div>`;
        }
        return html;
      }).join("");
      const leftover = [];
      for (const a of result.assignments) {
        if (!a.need_based_ids.size) continue;
        const needBudget = [...a.need_based_ids].reduce((sum, sid) => sum + (a.skill_ids[sid] - 1) - (excessBudget[`${a.type}|${sid}`] || 0), 0);
        const fillerBudget = A.CARD_EXTRA_BUDGET - needBudget;
        if (fillerBudget <= 0) continue;
        const bonusFiller = Object.keys(a.skill_ids).filter((sid) => !a.need_based_ids.has(sid) && a.skill_ids[sid] > A.SKILL_BASELINE);
        const excessIds = [...a.need_based_ids].filter((sid) => `${a.type}|${sid}` in excessBudget);
        const displayIds = bonusFiller.concat(excessIds);
        const skillsText = ["Chalice", "Scales"].includes(a.type)
          ? T.leftoverAll
          : displayIds.map((sid) => T.leftoverSkill(skillNames[sid] || skillName(sid, pools), a.skill_ids[sid])).join(", ");
        leftover.push(T.leftoverLine(a.type, needBudget, A.CARD_EXTRA_BUDGET, fillerBudget, skillsText));
      }
      const leftoverHtml = leftover.length ? `<div class="leftover-header">${esc(T.leftoverHeader)}</div>${leftover.map((l) => `<div class="reason">${esc(l)}</div>`).join("")}` : "";
      return `<details class="accordion" ${i === 0 ? "open" : ""}><summary>${T.combination(i + 1)}</summary><div class="accordion-body">
        <div class="result-tiles">${tiles}</div><hr>${lines}${leftoverHtml}
        <button type="button" class="apply-combo eq-priority" data-i="${i}">${T.applyCombination}</button></div></details>`;
    }).join("");
  }
  const dlg = openDialog(`<h2>${T.resultsTitle}</h2><div class="list results-list">${bodyHtml}</div><div class="row"><button type="button" class="close grow">${T.close}</button></div>`, "wide tall");
  dlg.querySelector(".close").addEventListener("click", () => dlg.close());
  dlg.querySelectorAll(".result-tile").forEach((tile) => attachTooltip(tile, () => {
    const result = results[Number(tile.dataset.i)];
    const ct = tile.dataset.ct;
    const a = result.assignments.find((x) => x.type === ct);
    const theme = a ? a.theme : typeToTheme[ct] || "";
    return cardTooltipHtml(ct, theme, ((data.themeMap[theme] || {})[ct] || {}).lord, pools[ct] || [], a ? a.skill_ids : {});
  }));
  dlg.querySelectorAll(".apply-combo").forEach((b) => b.addEventListener("click", () => {
    const byType = {};
    for (const a of results[Number(b.dataset.i)].assignments) byType[a.type] = a;
    dlg.close();
    applyCombination(byType);
  }));
}

// ArcanaApplyTargetDialog + _on_apply_arcana_combination
function applyCombination(byType) {
  const cls = classKey();
  const builds = skillBuildsFor(cls);
  const current = currentSkillBuildName(cls);
  const others = Object.keys(builds).filter((n) => n !== current);
  const dlg = openDialog(`<h2>${T.targetTitle}</h2><div>${T.targetHint}</div>
    <button type="button" class="primary pick-current">${esc(T.applyCurrent(current))}</button>
    ${others.length ? `<div class="section-label">${T.applyOther}</div><div class="list arcana-list other-list">${others.map((n) => `<div class="card clickable option" data-name="${esc(n)}">${esc(n)}</div>`).join("")}</div><button type="button" class="pick-other">${T.select}</button>` : ""}
    <button type="button" class="pick-new">${T.applyNew}</button><button type="button" class="cancel">${T.cancel}</button>`, "narrow stack-dialog");
  let chosenOther = null;
  const write = (target, isNew) => {
    dlg.close();
    if (isNew) builds[target] = emptySkillBuild();
    else if (Object.keys(builds[target].arcana_cards || {}).length && !confirm(`${T.overwriteTitle}\n${T.overwriteHint}`)) return;
    const cards = {};
    for (const [ct, a] of Object.entries(byType)) {
      const order = a.skill_order || Object.keys(a.skill_ids);
      cards[ct] = { theme: a.theme, grade: A.DEFAULT_GRADE, slots: order.map((sid) => ({ skill_id: sid, level: a.skill_ids[sid] })) };
    }
    builds[target].arcana_cards = cards;
    bp().current_skill_build_name = target;
    bp().skill_arcana_wish = {};
    save();
    subTab = "sets";
    draw();
  };
  dlg.querySelector(".pick-current").addEventListener("click", () => write(current, false));
  dlg.querySelectorAll(".option").forEach((o) => {
    o.addEventListener("click", () => { chosenOther = o.dataset.name; dlg.querySelectorAll(".option").forEach((x) => x.classList.toggle("current", x === o)); });
    o.addEventListener("dblclick", () => write(o.dataset.name, false));
  });
  const pickOther = dlg.querySelector(".pick-other");
  if (pickOther) pickOther.addEventListener("click", () => { if (chosenOther) write(chosenOther, false); });
  dlg.querySelector(".pick-new").addEventListener("click", () => {
    const name = (prompt(`${T.newBuild}\n${T.nameColon}`) || "").trim();
    if (name) write(name, !(name in builds));
  });
  dlg.querySelector(".cancel").addEventListener("click", () => dlg.close());
}
