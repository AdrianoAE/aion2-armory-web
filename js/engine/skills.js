// Skill Planner / Skill Layout maths and data access, a port of the Qt-free
// parts of ItemDatabase/app.py (skill levels, specializations, skill points,
// description rendering, the skill bar's placement rules) plus the
// build_planner glue that picks the current skill build and Daevanion set.

import { variantIndex, skillBonusFromBoards as boardsBonus } from "./daevanion.js";
import {
  DAMAGE_TABLE, DESCRIPTION_ONLY_SCALING, EXACT_DESCRIPTION_ONLY, EXACT_TOKEN_TABLE, LEVEL_SCALING,
  NO_LEVEL_SCALING_DATA, PERCENT_STAT_IDS, RANGE_TABLE, UNRELIABLE_TOKENS,
} from "./skill_scaling.js";

export const SKILL_TYPES = ["active", "passive", "stigma"];
export const SECTION_LABELS = { active: "Active Skills", passive: "Passive Skills", stigma: "Stigma Skills" };
export const SKILL_TYPE_COLORS = { active: "#22d3ee", passive: "#a855f7", stigma: "#facc15" };
export const DAMAGE_TYPE_COLORS = { physic: "#f87171", magic: "#60a5fa" };
export const SPEC_STATE_COLORS = { available: "rgba(94, 234, 212, 0.35)", chosen: "#0d9488" };

export const SKILLPOINTS_BASE_AT_LEVEL_45 = 44;
const MONOLITH_WISDOM_STONE_TIERS = [[2, 2, 1], [3, 9, 2], [10, 14, 3], [15, 19, 4], [20, 24, 5], [25, 29, 6], [30, 30, 7]];
export const MONOLITH_MAX_LEVEL = 30;
export const SKILL_LEVEL_BASE_CAP = 10;
export const STIGMA_LEVEL_BASE_CAP = 20;
const ACTIVE_SKILL_SPEC_CAP_THRESHOLDS = [[20, 3], [12, 2], [8, 1]];

const SKILLS_DATA_CLASS_ALIASES = { spiritmaster: "elementalist" };

export function classDataKey(displayName) {
  const key = (displayName || "").trim().toLowerCase();
  return SKILLS_DATA_CLASS_ALIASES[key] || key;
}

export function monolithSkillpoints(level) {
  level = Math.max(0, Math.min(MONOLITH_MAX_LEVEL, level | 0));
  let total = 0;
  for (const [lo, hi, amount] of MONOLITH_WISDOM_STONE_TIERS) {
    if (level < lo) break;
    total += amount * (Math.min(level, hi) - lo + 1);
  }
  return total;
}

export function activeSpecCap(effectiveLevel) {
  for (const [threshold, cap] of ACTIVE_SKILL_SPEC_CAP_THRESHOLDS) if (effectiveLevel >= threshold) return cap;
  return 0;
}

export function escapeHtml(text) {
  return String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ── data ────────────────────────────────────────────────────────────────────

export function skillsByClass(skillsData) {
  const byClass = {};
  for (const s of skillsData.skills || []) {
    const cat = (s.mainCategory || "").trim().toLowerCase();
    if (!cat) continue;
    (byClass[cat] = byClass[cat] || []).push(s);
  }
  return byClass;
}

export function skillIconUrl(skill) {
  return skill && skill.iconFile ? `assets/skill_icons/${skill.iconFile}` : null;
}

export function specIconUrl(spec) {
  return spec && spec.iconFile ? `assets/skill_spec_icons/${spec.iconFile}` : null;
}

export function specIconHtml(spec, size) {
  const url = specIconUrl(spec);
  return url ? `<img src="${url}" width="${size}" height="${size}" style="vertical-align: middle;">&nbsp;` : "";
}

let dataPromise = null;
export const data = { skills: null, byClass: {}, byId: {}, typeById: {}, arcanaInfo: null, arcanaClassSkills: null, boards: null };

async function fetchJson(path) {
  const base = new URL(".", import.meta.url);
  const response = await fetch(new URL(`../../${path}`, base));
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return response.json();
}

// Loads every JSON file the skill pages read, once. `skillCardsHtml` and the
// bonus maths are synchronous after this resolves.
export function ready() {
  if (!dataPromise) {
    dataPromise = Promise.all([
      fetchJson("data/skills_all.json"), fetchJson("data/arcana_info.json"),
      fetchJson("data/arcana_class_skills.json"), fetchJson("data/daevanion_boards_s.json"),
    ]).then(([skills, arcanaInfo, arcanaClassSkills, boards]) => {
      data.skills = skills;
      data.byClass = skillsByClass(skills);
      for (const list of Object.values(data.byClass)) for (const s of list) { data.byId[s.id] = s; data.typeById[s.id] = s.type || ""; }
      data.arcanaInfo = arcanaInfo;
      data.arcanaClassSkills = arcanaClassSkills;
      data.boards = boards;
      return data;
    });
  }
  return dataPromise;
}

// The game's skill window orders Stigmas by a key no data source exposes;
// this is the Sorcerer's order read off the window.
const STIGMA_ORDER = {
  sorcerer: ["15360000", "15160000", "15400000", "15140000", "15200000", "15130000", "15230000", "15390000", "15300000", "15320000", "15120000", "15700000", "15410000"],
};

export function skillOrder(a, b, classKey) {
  const fixed = STIGMA_ORDER[classKey];
  if (fixed && a.type === "stigma" && b.type === "stigma") {
    const ia = fixed.indexOf(String(a.id)), ib = fixed.indexOf(String(b.id));
    if (ia >= 0 && ib >= 0) return ia - ib;
    if (ia >= 0 || ib >= 0) return ia >= 0 ? -1 : 1;
  }
  const la = a.learnLevel ?? 999, lb = b.learnLevel ?? 999;
  if (la !== lb) return la - lb;
  if (!!a.isBasicSkill !== !!b.isBasicSkill) return a.isBasicSkill ? -1 : 1;
  return Number(b.id) - Number(a.id);
}

export function classSkills(classNameOrKey) {
  const key = classDataKey(classNameOrKey);
  return [...(data.byClass[key] || [])].sort((a, b) => skillOrder(a, b, key));
}

// ── levels and specializations ──────────────────────────────────────────────

export function effectiveLevel(manual, bonus = 0, wish = 0) {
  return Math.max(1, (manual || 0) + (bonus || 0) + (wish || 0));
}

// The Skill Layout shows the plain sum (an un-leveled skill shows no level).
export function layoutLevel(manual, bonus = 0, wish = 0) {
  return (manual || 0) + (bonus || 0) + (wish || 0);
}

export function unlockedSpecs(skill, level) {
  return (skill.specializations || []).filter((spec) => Number.isInteger(spec.parentSkillLvl) && level >= spec.parentSkillLvl);
}

// The specializations in effect: the picked ones for Active skills, every
// unlocked tier for Stigma/Passive. `chosen` is a Set of spec id strings.
export function specsInEffect(skill, level, chosen) {
  const unlocked = unlockedSpecs(skill, level);
  if (skill.type === "active") {
    const picked = chosen || new Set();
    return { unlocked, applied: unlocked.filter((spec) => picked.has(String(spec.id ?? ""))), state: "chosen" };
  }
  return { unlocked, applied: unlocked, state: "unlocked" };
}

export function specLabel(spec) {
  const note = (spec.specialized || "").trim();
  return note ? `Lv ${spec.parentSkillLvl}: ${note}` : `Lv ${spec.parentSkillLvl}`;
}

export function specsHtml(skill, level, chosen, iconSize = 18) {
  const { unlocked, applied, state } = specsInEffect(skill, level, chosen);
  if (!applied.length) {
    if (skill.type !== "active" || !unlocked.length) return "";
    return `<span class="spec-none">No specialization chosen</span>`;
  }
  return applied.map((spec) => `${specIconHtml(spec, iconSize)}<span class="spec-${state}">${escapeHtml(specLabel(spec))}</span>`).join("<br>");
}

export function formatLevelHtml(manual, bonus = 0, wish = 0) {
  let html = `<span class="lv-manual">${manual || 0}</span>`;
  if (bonus > 0) html += ` <span class="lv-bonus">(+${bonus})</span>`;
  if (wish > 0) html += ` <span class="lv-wish">(+${wish})</span>`;
  return html;
}

export function skillPointsRemaining(levels, typeById, monolithLevel) {
  let spent = 0;
  for (const [sid, v] of Object.entries(levels || {})) if (typeById[sid] !== "stigma") spent += Math.min(v, SKILL_LEVEL_BASE_CAP);
  return Math.max(0, SKILLPOINTS_BASE_AT_LEVEL_45 + monolithSkillpoints(monolithLevel) - spent);
}

export function stigmaPointsSpent(levels, typeById) {
  let spent = 0;
  for (const [sid, v] of Object.entries(levels || {})) if (typeById[sid] === "stigma") spent += v;
  return spent;
}

const OWN_FLAT_COOLDOWN_REDUCTION_RE = /^-(\d+(?:\.\d+)?)s cooldown$/;

export function cooldownReductionMs(skill, level, chosen) {
  const isActive = skill.type === "active";
  let total = 0;
  for (const spec of skill.specializations || []) {
    if (level < (spec.parentSkillLvl || 0)) continue;
    if (isActive && !(chosen && chosen.has(String(spec.id ?? "")))) continue;
    const m = OWN_FLAT_COOLDOWN_REDUCTION_RE.exec((spec.specialized || "").trim());
    if (m) total += parseFloat(m[1]) * 1000;
  }
  return total;
}

function capitalize(word) { return word ? word[0].toUpperCase() + word.slice(1) : ""; }

export function formatSkillStats(skill, cooldownReduction = 0) {
  const lines = [];
  const costs = Object.entries(skill.consumed || {}).filter(([, v]) => v).map(([k, v]) => `${v} ${k.toUpperCase()}`);
  if (costs.length) lines.push(`<b>Cost:</b> ${costs.join(", ")}`);
  if (skill.cooldown) {
    const reduced = Math.max(0, skill.cooldown - cooldownReduction);
    let text = `<b>Cooldown:</b> ${Math.round(reduced / 1000)}s`;
    if (cooldownReduction) text += ` <span class="ok">(-${Math.round(cooldownReduction / 1000)}s)</span>`;
    lines.push(text);
  }
  const range = skill.range || {};
  if (range.max) {
    const min = range.min || 0;
    lines.push(min && min !== range.max
      ? `<b>Range:</b> ${Math.round(min / 100)}-${Math.round(range.max / 100)}m`
      : `<b>Range:</b> ${Math.round(range.max / 100)}m`);
  }
  const weapons = skill.requiredWeapons || [];
  if (weapons.length) lines.push(`<b>Required weapon(s):</b> ${weapons.map(capitalize).join(", ")}`);
  return lines.length ? lines.join("<br>") : "—";
}

// ── description rendering ───────────────────────────────────────────────────

const UNRESOLVED_TOKEN_RE = /\{[a-zA-Z_]+(?::[A-Za-z0-9_]+)+\}/g;
const HIGHLIGHT_SPAN_RE = /(<span style="color: #FCC78B">)([^<]+)(<\/span>)/g;

const isDigits = (v) => /^\d+$/.test(String(v).replace(/^-/, ""));
const isNumeric = (v) => v !== null && v !== undefined && /^-?\d+(\.\d+)?$/.test(String(v).replace(/^-/, ""));

// Some skills carry several entries per level: a bogus placeholder first,
// or two real sub-effects. The first fully numeric entry is the right one.
export function levelValue(levels, level, key) {
  const candidates = (levels || []).filter((l) => l.level === level);
  let entry = candidates.find((l) => isNumeric(l.minValue) && isNumeric(l.maxValue));
  if (!entry) entry = candidates[0] || (levels && levels[0]) || null;
  return entry ? entry[key] : null;
}

function tableMax(table) { return Math.max(...Object.keys(table).map(Number)); }
function tableValue(table, level) { return table[String(Math.max(1, Math.min(tableMax(table), level)))]; }

export function formatPassiveScaledValue(value) {
  const rounded = Math.round(value * 10) / 10;
  return rounded === Math.trunc(rounded) ? String(Math.trunc(rounded)) : rounded.toFixed(1);
}

export function renderSkillDescription(text, levels, level = 1, skillId = null) {
  const minVaries = !!levels && new Set(levels.map((l) => l.minValue)).size > 1;
  const maxVaries = !!levels && new Set(levels.map((l) => l.maxValue)).size > 1;
  const damageTable = skillId ? DAMAGE_TABLE[skillId] : null;
  const rendered = (text || "").replace(UNRESOLVED_TOKEN_RE, (token) => {
    if (UNRELIABLE_TOKENS.includes(token)) return "XXX";
    const exact = EXACT_TOKEN_TABLE[token];
    if (exact) return formatPassiveScaledValue(tableValue(exact, level));
    if (token.includes("Min")) {
      if (damageTable) return formatPassiveScaledValue(tableValue(damageTable, level));
      if (levels) {
        const value = levelValue(levels, level, "minValue");
        if (minVaries && value !== null && value !== undefined && isDigits(value)) return String(value);
      }
    } else if (token.includes("Max")) {
      if (damageTable) return formatPassiveScaledValue(tableValue(damageTable, level));
      if (levels) {
        const value = levelValue(levels, level, "maxValue");
        if (maxVaries && value !== null && value !== undefined && isDigits(value)) return String(value);
      }
    }
    return "XXX";
  });
  return rendered.replace(/\n/g, "<br>");
}

export function passiveDescriptionWithLevel(skillId, description, level) {
  const entries = LEVEL_SCALING[skillId];
  const rangeTable = RANGE_TABLE[skillId];
  const descOnly = DESCRIPTION_ONLY_SCALING[skillId];
  const exactDescOnly = EXACT_DESCRIPTION_ONLY[skillId];
  const hasDamageTable = skillId in DAMAGE_TABLE;
  if (!entries && !rangeTable && !descOnly && !exactDescOnly && !hasDamageTable) return description;
  const texts = [];
  for (const entry of [...(entries || []), ...(descOnly || [])]) {
    const [statId, lv1, lv10] = entry;
    const consumesSpan = entry.length > 3 ? entry[3] : true;
    if (lv1 === lv10 || !consumesSpan) continue;
    const value = lv1 + (lv10 - lv1) / 9 * (level - 1);
    texts.push(formatPassiveScaledValue(value) + (PERCENT_STAT_IDS.includes(statId) ? "%" : ""));
  }
  for (const [statId, table, suffixOverride] of exactDescOnly || []) {
    const suffix = suffixOverride || (PERCENT_STAT_IDS.includes(statId) ? "%" : "");
    texts.push(formatPassiveScaledValue(tableValue(table, level)) + suffix);
  }
  if (rangeTable) {
    const [min, max] = tableValue(rangeTable, level);
    texts.push(`${formatPassiveScaledValue(min)}-${formatPassiveScaledValue(max)}`);
  }
  let i = 0;
  const substituted = description.replace(HIGHLIGHT_SPAN_RE, (whole, open, content, close) => {
    UNRESOLVED_TOKEN_RE.lastIndex = 0;
    if (UNRESOLVED_TOKEN_RE.test(content)) return whole;
    if (i >= texts.length) return whole;
    return open + texts[i++] + close;
  });
  return `<span class="lv-note">Lvl. ${level}</span><br>` + substituted;
}

function countSpans(text) { return (text.match(HIGHLIGHT_SPAN_RE) || []).length; }

// The description panel's text at a level: Stigma tiers fold their bonus
// into the base text, passives get their real per-level numbers.
export function describeSkill(skill, level) {
  let base = skill.description || "";
  if (skill.type === "stigma") {
    const baseCount = countSpans(base);
    const specs = [...(skill.specializations || [])].sort((a, b) => (a.parentSkillLvl || 0) - (b.parentSkillLvl || 0));
    for (const spec of specs) {
      if (level < (spec.parentSkillLvl || 0)) continue;
      const candidate = spec.description || "";
      if (countSpans(candidate) === baseCount) base = candidate;
    }
  }
  let rendered = renderSkillDescription(passiveDescriptionWithLevel(skill.id, base, level), skill.levels, level, skill.id);
  if (NO_LEVEL_SCALING_DATA.includes(skill.id)) {
    rendered += `<br><br><span class="warn" style="font-style:italic">No reliable data is available for this skill's level scaling.</span>`;
  }
  return rendered;
}

// ── Arcana ceiling and card bonus ───────────────────────────────────────────

const ARCANA_LORD_TYPES = ["Chalice", "Parchment", "Compass", "Bell", "Mirror", "Scales"];
const ARCANA_LORD_CATEGORY = { Chalice: "both", Parchment: "active", Compass: "active", Bell: "passive", Mirror: "passive", Scales: "active" };
const ARCANA_ACTIVE_THEMES = ["Vigor", "Magic"];
export const ARCANA_PER_SKILL_CAP = 4;

export function arcanaUsableLordTypes(arcanaInfo) {
  const cards = (arcanaInfo && arcanaInfo.arcana) || [];
  return ARCANA_LORD_TYPES.filter((ct) => cards.some((a) => a.cardType === ct && ARCANA_ACTIVE_THEMES.includes(a.theme)));
}

export function arcanaClassPools(arcanaClassSkills, classKey, usableTypes) {
  const pools = {};
  for (const ct of usableTypes) {
    const grades = (arcanaClassSkills || {})[ct] || {};
    const pool = grades.Unique || Object.values(grades)[0] || {};
    pools[ct] = pool[classDataKey(classKey)] || [];
  }
  return pools;
}

export function arcanaCeiling(skillId, category, usableTypes, pools) {
  const eligible = usableTypes.filter((ct) => (pools[ct] || []).some((s) => s.id === skillId)
    && (ARCANA_LORD_CATEGORY[ct] === "both" || ARCANA_LORD_CATEGORY[ct] === category));
  return eligible.length * ARCANA_PER_SKILL_CAP;
}

export function arcanaCardSlotList(card) {
  if (!card) return [null, null, null, null];
  if (card.slots) return [...card.slots, null, null, null, null].slice(0, 4);
  const entries = Object.entries(card.skill_ids || {}).map(([skill_id, level]) => ({ skill_id, level }));
  return [...entries, null, null, null, null].slice(0, 4);
}

export function arcanaCardSkillBonus(build) {
  const bonus = {};
  for (const card of Object.values((build && build.arcana_cards) || {})) {
    for (const entry of arcanaCardSlotList(card)) {
      if (entry && entry.skill_id) bonus[entry.skill_id] = (bonus[entry.skill_id] || 0) + (Number(entry.level) || 0);
    }
  }
  return bonus;
}

// ── Daevanion board bonus ───────────────────────────────────────────────────
// Bonus skill levels from the class's active Daevanion nodes, via the
// Daevanion engine.
const variantCache = new WeakMap();
export function skillBonusFromBoards(classKey, activeSets, boards) {
  if (!boards) return {};
  let variant = variantCache.get(boards);
  if (!variant) { variant = variantIndex(boards); variantCache.set(boards, variant); }
  return boardsBonus(variant, classDataKey(classKey), activeSets || {}, "s");
}

// ── build_planner glue (pure functions of the profile dict) ─────────────────

export function emptyBuildState() {
  return { priority: { active: [null], passive: [null], stigma: [null] }, arcana_cards: {}, layout: emptyLayout() };
}

export function ensureClassBuilds(p, classLower) {
  p.skill_builds_data = p.skill_builds_data || {};
  const builds = p.skill_builds_data[classLower] = p.skill_builds_data[classLower] || {};
  if (!Object.keys(builds).length) builds.Default = emptyBuildState();
  return builds;
}

function equipBuild(p, classLower) {
  return ((p.equip_builds_data || {})[classLower] || {})[p.current_build_name] || null;
}

// The equip set's linked skill build, else the one last viewed, else the first.
export function currentSkillBuildName(p, classLower) {
  const builds = ensureClassBuilds(p, classLower);
  const equip = equipBuild(p, classLower);
  if (equip && equip.linked_skill_build in builds) return equip.linked_skill_build;
  if (p.current_skill_build_name in builds) return p.current_skill_build_name;
  return Object.keys(builds)[0];
}

export function setCurrentSkillBuild(p, classLower, name) {
  p.current_skill_build_name = name;
  const equip = equipBuild(p, classLower);
  if (equip) equip.linked_skill_build = name;
}

function copySpecs(specs) {
  return Object.fromEntries(Object.entries(specs || {}).map(([sid, ids]) => [sid, Array.isArray(ids) ? [...ids] : []]));
}

const isMap = (value) => !!value && typeof value === "object" && !Array.isArray(value);

// Levels and specializations belong to the skill build; one without its own
// starts from the profile-wide keys.
export function skillBuild(p, classLower, name) {
  const builds = ensureClassBuilds(p, classLower);
  const build = builds[name] = builds[name] || emptyBuildState();
  if (!isMap(build.levels)) build.levels = { ...(p.skill_levels || {}) };
  if (!isMap(build.specs)) build.specs = copySpecs(p.skill_active_specs);
  build.priority = build.priority || {};
  for (const type of SKILL_TYPES) if (!Array.isArray(build.priority[type]) || !build.priority[type].length) build.priority[type] = [null];
  build.arcana_cards = build.arcana_cards || {};
  build.layout = normalizeLayout(build.layout);
  return build;
}

export function daevanionSetName(p, classLower) {
  const sets = (p.daevanion_builds_data || {})[classLower] || {};
  const equip = equipBuild(p, classLower);
  if (equip && equip.linked_daevanion_build in sets) return equip.linked_daevanion_build;
  if (p.current_daevanion_build_name in sets) return p.current_daevanion_build_name;
  return Object.keys(sets)[0] || null;
}

export function chosenSpecs(p, skillId) {
  p.skill_active_specs = p.skill_active_specs || {};
  return new Set((p.skill_active_specs[skillId] || []).map(String));
}

// Everything a page needs about one class + skill build, from loaded data.
export function skillContext(p, classLower, buildName) {
  p.skill_levels = p.skill_levels || {};
  p.skill_arcana_wish = p.skill_arcana_wish || {};
  p.skill_active_specs = p.skill_active_specs || {};
  p.skill_hidden_ids = p.skill_hidden_ids || [];
  const build = skillBuild(p, classLower, buildName);
  if (classLower === String(p.character_class || "").toLowerCase() && buildName === currentSkillBuildName(p, classLower)) {
    p.skill_levels = build.levels;
    p.skill_active_specs = build.specs;
  }
  const { levels, specs } = build;
  const setName = daevanionSetName(p, classLower);
  const activeSets = setName ? ((p.daevanion_builds_data || {})[classLower] || {})[setName] || {} : {};
  const daevanion = skillBonusFromBoards(classLower, activeSets, data.boards);
  const arcana = arcanaCardSkillBonus(build);
  const total = { ...daevanion };
  for (const [sid, v] of Object.entries(arcana)) total[sid] = (total[sid] || 0) + v;
  const skills = classSkills(classLower);
  const priorityIds = new Set();
  for (const ids of Object.values(build.priority)) for (const id of ids) if (id !== null && id !== undefined) priorityIds.add(id);
  return {
    classLower, dataKey: classDataKey(classLower), buildName, build, skills, byId: data.byId, typeById: data.typeById,
    levels, specs, wish: p.skill_arcana_wish, hidden: new Set(p.skill_hidden_ids), priorityIds,
    bonus: { total, gear: {}, daevanion, arcana },
    chosen: (sid) => new Set((specs[sid] || []).map(String)),
    manual: (sid) => levels[sid] || 0,
    bonusOf: (sid) => total[sid] || 0,
    wishOf: (sid) => p.skill_arcana_wish[sid] || 0,
    effective: (sid) => effectiveLevel(levels[sid] || 0, total[sid] || 0, p.skill_arcana_wish[sid] || 0),
    layoutLevel: (sid) => layoutLevel(levels[sid] || 0, total[sid] || 0, p.skill_arcana_wish[sid] || 0),
  };
}

// Stat Info contribution of the passive skills at their effective level
// (app.py _passive_skill_stat_totals_for). Needs ready().
export function passiveSkillStatTotals(p, classLower, buildName) {
  const context = skillContext(p, classLower, buildName);
  const totals = {};
  for (const [skillId, entries] of Object.entries(LEVEL_SCALING)) {
    const level = (context.levels[skillId] || 0) + (context.bonus.total[skillId] || 0);
    if (level <= 0) continue;
    for (const [statId, lv1, lv10] of entries) totals[statId] = (totals[statId] || 0) + lv1 + (lv10 - lv1) / 9 * (level - 1);
  }
  return totals;
}

// ── Skill Layout: bar + macro ───────────────────────────────────────────────

export const SKILL_LAYOUT_ROWS = 5;
export const SKILL_LAYOUT_COLS = 12;
export const SKILL_MACRO_MAX = 4;
export const DEFAULT_SKILL_BAR_KEYS = ["1", "2", "3", "4", "R", "X", "@mouse_forward", "@mouse_back", "Q", "E", "@mouse_left", "@mouse_right"];
export const MOUSE_KEY_LABELS = ["@mouse_left", "@mouse_right", "@mouse_forward", "@mouse_back"];
export const KEY_ROW = SKILL_LAYOUT_ROWS - 1;

export function emptyLayout() {
  const keys = {};
  DEFAULT_SKILL_BAR_KEYS.forEach((key, col) => { keys[`${KEY_ROW},${col}`] = key; });
  return { slots: {}, keys, macro: [] };
}

export function layoutCopy(layout) {
  if (!layout) return emptyLayout();
  return { slots: { ...(layout.slots || {}) }, keys: { ...(layout.keys || {}) }, macro: [...(layout.macro || [])] };
}

// Fills missing parts in place and drops anything placed on the key row.
export function normalizeLayout(layout) {
  if (!layout || typeof layout !== "object") layout = {};
  const empty = emptyLayout();
  if (!layout.slots || typeof layout.slots !== "object") layout.slots = {};
  if (!layout.keys || typeof layout.keys !== "object") layout.keys = empty.keys;
  if (!Array.isArray(layout.macro)) layout.macro = [];
  for (const key of Object.keys(layout.slots)) if (key.startsWith(`${KEY_ROW},`)) delete layout.slots[key];
  return layout;
}

// Bar slot key -> [skill id, key label]; the key row shows the lowest skill
// placed in its column.
export function barContents(layout) {
  const contents = {};
  for (let c = 0; c < SKILL_LAYOUT_COLS; c++) {
    let lowest = null;
    for (let r = 0; r < KEY_ROW; r++) {
      const skillId = layout.slots[`${r},${c}`] || null;
      contents[`${r},${c}`] = [skillId, ""];
      lowest = skillId || lowest;
    }
    contents[`${KEY_ROW},${c}`] = [lowest, layout.keys[`${KEY_ROW},${c}`] || ""];
  }
  return contents;
}

// Bar: a skill sits in one bar slot only, so it moves off any other slot.
// Macro: replaces that step, or appends when it is the empty one.
export function placeSkill(layout, address, skillId) {
  const [kind, where] = address;
  if (kind === "bar") {
    if (String(where).startsWith(`${KEY_ROW},`)) return false;
    for (const [key, sid] of Object.entries(layout.slots)) if (sid === skillId) delete layout.slots[key];
    layout.slots[where] = skillId;
    return true;
  }
  const macro = layout.macro;
  if (where < macro.length) macro[where] = skillId;
  else if (macro.length < SKILL_MACRO_MAX) macro.push(skillId);
  else return false;
  return true;
}

export function removeAt(layout, address) {
  const [kind, where] = address;
  if (kind === "bar") {
    if (!(where in layout.slots)) return false;
    delete layout.slots[where];
    return true;
  }
  if (where < layout.macro.length) { layout.macro.splice(where, 1); return true; }
  return false;
}

// A drop of `source` onto `target` (addresses ["list", id] / ["bar", "r,c"] /
// ["macro", i]); returns whether the layout changed.
export function dropped(layout, source, target) {
  const [sourceKind, sourceWhere] = source;
  const [targetKind, targetWhere] = target;
  if (sourceKind === target[0] && String(sourceWhere) === String(targetWhere)) return false;
  if (sourceKind === "list") return placeSkill(layout, target, sourceWhere);
  if (sourceKind === "bar") {
    const skillId = layout.slots[sourceWhere];
    if (!skillId) return false;
    if (targetKind === "bar") {
      if (String(targetWhere).startsWith(`${KEY_ROW},`)) return false;
      const other = layout.slots[targetWhere];
      layout.slots[targetWhere] = skillId;
      if (other === undefined || other === null) delete layout.slots[sourceWhere];
      else layout.slots[sourceWhere] = other;
      return true;
    }
    return placeSkill(layout, target, skillId);
  }
  const macro = layout.macro;
  if (sourceWhere >= macro.length) return false;
  if (targetKind === "macro") {
    const [skillId] = macro.splice(sourceWhere, 1);
    macro.splice(Math.min(targetWhere, macro.length), 0, skillId);
    return true;
  }
  return placeSkill(layout, target, macro[sourceWhere]);
}

// Breaks a long name at the space nearest its middle, for the palette tiles.
export function twoLineLabel(text, maxLine = 16) {
  if (text.length <= maxLine || !text.includes(" ")) return text;
  const spaces = [...text].map((ch, i) => (ch === " " ? i : -1)).filter((i) => i >= 0);
  const cut = spaces.reduce((best, i) => (Math.abs(i - text.length / 2) < Math.abs(best - text.length / 2) ? i : best), spaces[0]);
  return text.slice(0, cut) + "\n" + text.slice(cut + 1);
}
