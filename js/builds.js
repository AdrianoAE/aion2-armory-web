// Builds and presets. A Build is one Daevanion set of a class
// (daevanion_builds_data[class][name]); a preset is an equip set
// (equip_builds_data[class][name]) linking its Build, its skill build
// (levels, specializations, layout, arcana) and its genius profile.
// The pure functions take the profile's build_planner object; the
// wrappers at the end work on bp() and save.

import { bp, save } from "./state.js";
import { currentSkillBuildName, emptyBuildState, emptyLayout } from "./engine/skills.js";
import { spentCost, startIdOf } from "./engine/daevanion.js";
import { defaultState as freshGenius } from "./pages/genius.js";

const EQUIP_PARTS = ["equipped", "substats", "enchant", "philosopher_stone", "priority", "priority_progress"];

const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
const lower = (classKey) => String(classKey || "").trim().toLowerCase();
const displayClass = (cls) => (cls ? cls[0].toUpperCase() + cls.slice(1) : cls);
const sameName = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();

export function uniqueName(taken, wanted) {
  const has = (name) => (taken instanceof Set ? taken.has(name) : Object.prototype.hasOwnProperty.call(taken, name));
  if (!has(wanted)) return wanted;
  for (let i = 2; ; i += 1) if (!has(`${wanted} ${i}`)) return `${wanted} ${i}`;
}

function renameKey(object, oldName, newName) {
  const renamed = {};
  for (const [key, value] of Object.entries(object)) renamed[key === oldName ? newName : key] = value;
  for (const key of Object.keys(object)) delete object[key];
  Object.assign(object, renamed);
}

function emptyEquipSet() {
  const set = {};
  for (const key of EQUIP_PARTS) set[key] = {};
  return set;
}

function freshSkillBuild() {
  return { ...emptyBuildState(), layout: emptyLayout(), levels: {}, specs: {} };
}

function copySpecs(specs) {
  return Object.fromEntries(Object.entries(specs || {}).map(([sid, ids]) => [sid, Array.isArray(ids) ? [...ids] : []]));
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

// ── profile accessors ───────────────────────────────────────────────────────

export function equipSetsOf(p, classKey) {
  const cls = lower(classKey);
  p.equip_builds_data = p.equip_builds_data || {};
  return (p.equip_builds_data[cls] = p.equip_builds_data[cls] || {});
}

export function daevanionSetsOf(p, classKey) {
  const cls = lower(classKey);
  p.daevanion_builds_data = p.daevanion_builds_data || {};
  const sets = (p.daevanion_builds_data[cls] = p.daevanion_builds_data[cls] || {});
  if (!Object.keys(sets).length) sets.Default = {};
  return sets;
}

export function skillBuildsOf(p, classKey) {
  const cls = lower(classKey);
  p.skill_builds_data = p.skill_builds_data || {};
  const builds = (p.skill_builds_data[cls] = p.skill_builds_data[cls] || {});
  if (!Object.keys(builds).length) builds.Default = { ...emptyBuildState(), levels: { ...(p.skill_levels || {}) }, specs: copySpecs(p.skill_active_specs) };
  return builds;
}

export function geniusBuildsOf(p) {
  if (!isPlainObject(p.genius_builds_data) || !Object.keys(p.genius_builds_data).length) p.genius_builds_data = { Default: freshGenius() };
  return p.genius_builds_data;
}

export function linkedSkillBuild(p, classKey, presetName) {
  const builds = skillBuildsOf(p, classKey);
  const equip = equipSetsOf(p, classKey)[presetName] || {};
  if (equip.linked_skill_build in builds) return equip.linked_skill_build;
  if (p.current_skill_build_name in builds) return p.current_skill_build_name;
  return Object.keys(builds)[0];
}

export function linkedGeniusBuild(p, classKey, presetName) {
  const builds = geniusBuildsOf(p);
  const equip = equipSetsOf(p, classKey)[presetName] || {};
  if (equip.linked_genius_build in builds) return equip.linked_genius_build;
  if (p.current_genius_build_name in builds) return p.current_genius_build_name;
  return Object.keys(builds)[0];
}

function defaultBuildName(p, sets) {
  if (p.current_daevanion_build_name in sets) return p.current_daevanion_build_name;
  return Object.keys(sets)[0];
}

export function buildOfPreset(p, classKey, presetName) {
  const sets = daevanionSetsOf(p, classKey);
  const equip = equipSetsOf(p, classKey)[presetName];
  if (!equip) return null;
  if (!(equip.linked_daevanion_build in sets)) equip.linked_daevanion_build = Object.keys(sets)[0];
  return equip.linked_daevanion_build;
}

// ── migration (runs from bp()) ──────────────────────────────────────────────

// Skill levels and specializations move into each skill build, seeded from
// the profile-wide keys; every equip set gets pinned links. The profile-wide
// keys then alias the current skill build's own objects, so exported
// profiles keep them filled for older readers.
export function migrateProfile(p) {
  const globalLevels = isPlainObject(p.skill_levels) ? p.skill_levels : {};
  const globalSpecs = isPlainObject(p.skill_active_specs) ? p.skill_active_specs : {};
  for (const builds of Object.values(p.skill_builds_data || {})) {
    for (const build of Object.values(builds || {})) {
      if (!isPlainObject(build)) continue;
      if (!isPlainObject(build.levels)) build.levels = { ...globalLevels };
      if (!isPlainObject(build.specs)) build.specs = copySpecs(globalSpecs);
    }
  }
  const hasGenius = isPlainObject(p.genius_builds_data) && Object.keys(p.genius_builds_data).length > 0;
  for (const [cls, sets] of Object.entries(p.equip_builds_data || {})) {
    if (!cls || !isPlainObject(sets) || !Object.keys(sets).length) continue;
    const daevanion = daevanionSetsOf(p, cls);
    const skills = skillBuildsOf(p, cls);
    for (const equip of Object.values(sets)) {
      if (!isPlainObject(equip)) continue;
      if (!(equip.linked_daevanion_build in daevanion)) equip.linked_daevanion_build = defaultBuildName(p, daevanion);
      if (!(equip.linked_skill_build in skills)) equip.linked_skill_build = p.current_skill_build_name in skills ? p.current_skill_build_name : Object.keys(skills)[0];
      if (hasGenius && !(equip.linked_genius_build in p.genius_builds_data)) {
        equip.linked_genius_build = p.current_genius_build_name in p.genius_builds_data ? p.current_genius_build_name : Object.keys(p.genius_builds_data)[0];
      }
    }
  }
  mirrorCurrentProgress(p);
  return p;
}

function mirrorCurrentProgress(p) {
  const cls = lower(p.character_class);
  if (!cls || !p.skill_builds_data || !p.skill_builds_data[cls] || !Object.keys(p.skill_builds_data[cls]).length) return;
  const build = p.skill_builds_data[cls][currentSkillBuildName(p, cls)];
  if (!isPlainObject(build)) return;
  if (!isPlainObject(build.levels)) build.levels = { ...(p.skill_levels || {}) };
  if (!isPlainObject(build.specs)) build.specs = copySpecs(p.skill_active_specs);
  p.skill_levels = build.levels;
  p.skill_active_specs = build.specs;
}

// ── queries ─────────────────────────────────────────────────────────────────

function belongsTo(equip, characterName) {
  return characterName === undefined || characterName === null || sameName(equip.character_name, characterName);
}

// [{ name, daevanionSet, presets }] for every Daevanion set of the class.
// With a character name, presets are that character's, and Builds holding
// only other characters' presets are left out.
export function buildsOf(p, classKey, characterName) {
  const sets = daevanionSetsOf(p, classKey);
  const equips = equipSetsOf(p, classKey);
  const first = Object.keys(sets)[0];
  const list = Object.keys(sets).map((name) => ({ name, daevanionSet: sets[name], presets: [], others: 0 }));
  const byName = new Map(list.map((b) => [b.name, b]));
  for (const [presetName, equip] of Object.entries(equips)) {
    if (!isPlainObject(equip)) continue;
    if (!(equip.linked_daevanion_build in sets)) equip.linked_daevanion_build = first;
    const build = byName.get(equip.linked_daevanion_build);
    if (belongsTo(equip, characterName)) build.presets.push(presetName); else build.others += 1;
  }
  return list.filter((b) => b.presets.length || !b.others).map(({ name, daevanionSet, presets }) => ({ name, daevanionSet, presets }));
}

export function presetsOfBuild(p, classKey, buildName, characterName) {
  const build = buildsOf(p, classKey, characterName).find((b) => b.name === buildName);
  return build ? build.presets : [];
}

function presetKey(cls, characterName) {
  return `${cls}|${String(characterName || "").trim().toLowerCase()}`;
}

export function currentPresetOf(p, classKey, characterName) {
  const cls = lower(classKey);
  const equips = equipSetsOf(p, cls);
  const mine = (name) => name in equips && belongsTo(equips[name], characterName);
  if (lower(p.character_class) === cls && mine(p.current_build_name)) return p.current_build_name;
  const remembered = characterName !== undefined ? (p.last_presets || {})[presetKey(cls, characterName)] : null;
  if (remembered && mine(remembered)) return remembered;
  return Object.keys(equips).find(mine) || null;
}

export function currentBuildOf(p, classKey, characterName) {
  const preset = currentPresetOf(p, classKey, characterName);
  if (preset) return buildOfPreset(p, classKey, preset);
  return Object.keys(daevanionSetsOf(p, classKey))[0];
}

function characterOf(p, cls, characterName) {
  if (characterName !== undefined && characterName !== null) return characterName;
  const preset = currentPresetOf(p, cls);
  return preset ? equipSetsOf(p, cls)[preset].character_name ?? null : null;
}

// ── selection ───────────────────────────────────────────────────────────────

export function selectPresetIn(p, classKey, presetName) {
  const cls = lower(classKey);
  const equip = equipSetsOf(p, cls)[presetName];
  if (!equip) return false;
  p.character_class = displayClass(cls);
  p.current_build_name = presetName;
  const buildName = buildOfPreset(p, cls, presetName);
  const skillName = linkedSkillBuild(p, cls, presetName);
  const geniusName = linkedGeniusBuild(p, cls, presetName);
  equip.linked_skill_build = skillName;
  equip.linked_genius_build = geniusName;
  p.current_skill_build_name = skillName;
  p.current_daevanion_build_name = buildName;
  p.current_genius_build_name = geniusName;
  p.daevanion_active = { ...(daevanionSetsOf(p, cls)[buildName] || {}) };
  p.last_presets = p.last_presets || {};
  p.last_presets[presetKey(cls, equip.character_name)] = presetName;
  mirrorCurrentProgress(p);
  return true;
}

// Switches to a Build: its current preset when one is selected, else its
// first; a Build without presets gets a fresh "Default" one.
export function selectBuildIn(p, classKey, buildName, characterName) {
  const cls = lower(classKey);
  const who = characterOf(p, cls, characterName);
  const presets = presetsOfBuild(p, cls, buildName, who);
  const current = currentPresetOf(p, cls, who);
  if (presets.includes(current)) return selectPresetIn(p, cls, current) && current;
  if (presets.length) return selectPresetIn(p, cls, presets[0]) && presets[0];
  return newPresetIn(p, cls, buildName, uniqueName(equipSetsOf(p, cls), "Default"), who);
}

// ── Builds ──────────────────────────────────────────────────────────────────

function addPreset(p, cls, buildName, wanted, characterName, source) {
  const equips = equipSetsOf(p, cls);
  const presetName = uniqueName(equips, wanted);
  const skills = skillBuildsOf(p, cls);
  const genius = geniusBuildsOf(p);
  let equip, skillName, geniusName;
  if (source) {
    equip = clone(source.equip);
    skillName = source.skillName;
    geniusName = source.geniusName;
  } else {
    equip = emptyEquipSet();
    skillName = uniqueName(skills, presetName);
    skills[skillName] = freshSkillBuild();
    geniusName = uniqueName(genius, presetName);
    genius[geniusName] = freshGenius();
  }
  equip.linked_daevanion_build = buildName;
  equip.linked_skill_build = skillName;
  equip.linked_genius_build = geniusName;
  equip.character_name = characterName ?? null;
  equips[presetName] = equip;
  return presetName;
}

export function newBuildIn(p, classKey, name, characterName) {
  const cls = lower(classKey);
  const sets = daevanionSetsOf(p, cls);
  const wanted = String(name || "").trim();
  if (!wanted || wanted in sets) return false;
  const who = characterOf(p, cls, characterName);
  sets[wanted] = {};
  const equips = equipSetsOf(p, cls);
  const presetName = addPreset(p, cls, wanted, "Default" in equips ? uniqueName(equips, wanted) : "Default", who);
  selectPresetIn(p, cls, presetName);
  return wanted;
}

// Copies the Daevanion set and every preset of it with its skill build and
// genius profile; presets sharing a skill build or genius profile share the
// copy too.
export function duplicateBuildIn(p, classKey, fromName, newName, characterName) {
  const cls = lower(classKey);
  const sets = daevanionSetsOf(p, cls);
  if (!(fromName in sets)) return false;
  const name = uniqueName(sets, String(newName || "").trim() || `${fromName} (Copy)`);
  const who = characterOf(p, cls, characterName);
  sets[name] = clone(sets[fromName]);
  const settings = ((p.daevanion_build_settings || {})[cls] || {})[fromName];
  if (settings) p.daevanion_build_settings[cls][name] = clone(settings);
  const equips = equipSetsOf(p, cls);
  const skills = skillBuildsOf(p, cls);
  const genius = geniusBuildsOf(p);
  const skillCopies = new Map(), geniusCopies = new Map();
  let firstCopy = null;
  for (const presetName of presetsOfBuild(p, cls, fromName, who)) {
    const target = uniqueName(equips, `${presetName} (${name})`);
    const skillFrom = linkedSkillBuild(p, cls, presetName);
    const geniusFrom = linkedGeniusBuild(p, cls, presetName);
    if (!skillCopies.has(skillFrom)) {
      const copyName = uniqueName(skills, target);
      skills[copyName] = clone(skills[skillFrom]);
      skillCopies.set(skillFrom, copyName);
    }
    if (!geniusCopies.has(geniusFrom)) {
      const copyName = uniqueName(genius, target);
      genius[copyName] = clone(genius[geniusFrom]);
      geniusCopies.set(geniusFrom, copyName);
    }
    const created = addPreset(p, cls, name, target, equips[presetName].character_name ?? who,
      { equip: equips[presetName], skillName: skillCopies.get(skillFrom), geniusName: geniusCopies.get(geniusFrom) });
    firstCopy = firstCopy || created;
  }
  if (!firstCopy) firstCopy = addPreset(p, cls, name, uniqueName(equips, name), who);
  selectPresetIn(p, cls, firstCopy);
  return name;
}

export function renameBuildIn(p, classKey, oldName, newName) {
  const cls = lower(classKey);
  const sets = daevanionSetsOf(p, cls);
  const name = String(newName || "").trim();
  if (!(oldName in sets) || !name || name in sets) return false;
  renameKey(sets, oldName, name);
  const settings = (p.daevanion_build_settings || {})[cls];
  if (settings && oldName in settings) renameKey(settings, oldName, name);
  for (const equip of Object.values(equipSetsOf(p, cls))) if (equip.linked_daevanion_build === oldName) equip.linked_daevanion_build = name;
  if (p.current_daevanion_build_name === oldName) p.current_daevanion_build_name = name;
  return name;
}

function isLinked(p, field, value, skipCls, skipPresets) {
  for (const [cls, sets] of Object.entries(p.equip_builds_data || {})) {
    if (field === "linked_skill_build" && cls !== skipCls) continue;
    for (const [presetName, equip] of Object.entries(sets || {})) {
      if (cls === skipCls && skipPresets.has(presetName)) continue;
      if (equip && equip[field] === value) return true;
    }
  }
  return false;
}

function dropPresets(p, cls, presetNames) {
  const equips = equipSetsOf(p, cls);
  const skills = skillBuildsOf(p, cls);
  const genius = geniusBuildsOf(p);
  const doomed = new Set(presetNames);
  for (const presetName of presetNames) {
    const skillName = linkedSkillBuild(p, cls, presetName);
    const geniusName = linkedGeniusBuild(p, cls, presetName);
    if (!isLinked(p, "linked_skill_build", skillName, cls, doomed)) delete skills[skillName];
    if (!isLinked(p, "linked_genius_build", geniusName, cls, doomed)) delete genius[geniusName];
  }
  for (const presetName of presetNames) delete equips[presetName];
  if (!(p.current_skill_build_name in skillBuildsOf(p, cls))) p.current_skill_build_name = Object.keys(skills)[0];
  if (!(p.current_genius_build_name in geniusBuildsOf(p))) p.current_genius_build_name = Object.keys(geniusBuildsOf(p))[0];
}

export function deleteBuildIn(p, classKey, name, characterName) {
  const cls = lower(classKey);
  const sets = daevanionSetsOf(p, cls);
  if (!(name in sets) || Object.keys(sets).length <= 1) return false;
  const who = characterOf(p, cls, characterName);
  if (buildsOf(p, cls, who).length <= 1) return false;
  const wasCurrent = currentBuildOf(p, cls, who) === name;
  const doomed = Object.entries(equipSetsOf(p, cls)).filter(([, e]) => e.linked_daevanion_build === name).map(([n]) => n);
  dropPresets(p, cls, doomed);
  delete sets[name];
  const settings = (p.daevanion_build_settings || {})[cls];
  if (settings) delete settings[name];
  if (p.current_daevanion_build_name === name) p.current_daevanion_build_name = Object.keys(sets)[0];
  const remaining = buildsOf(p, cls, who);
  const target = remaining.find((b) => b.presets.length) || remaining[0] || { name: Object.keys(sets)[0] };
  if (wasCurrent || !Object.keys(equipSetsOf(p, cls)).length) selectBuildIn(p, cls, target.name, who);
  return true;
}

// ── presets ─────────────────────────────────────────────────────────────────

export function newPresetIn(p, classKey, buildName, name, characterName) {
  const cls = lower(classKey);
  if (!(buildName in daevanionSetsOf(p, cls))) return false;
  const wanted = String(name || "").trim();
  if (!wanted || wanted in equipSetsOf(p, cls)) return false;
  const presetName = addPreset(p, cls, buildName, wanted, characterOf(p, cls, characterName));
  selectPresetIn(p, cls, presetName);
  return presetName;
}

export function duplicatePresetIn(p, classKey, fromPreset, newName) {
  const cls = lower(classKey);
  const equips = equipSetsOf(p, cls);
  const source = equips[fromPreset];
  if (!source) return false;
  const name = uniqueName(equips, String(newName || "").trim() || `${fromPreset} (Copy)`);
  const skills = skillBuildsOf(p, cls);
  const genius = geniusBuildsOf(p);
  const skillName = uniqueName(skills, name);
  skills[skillName] = clone(skills[linkedSkillBuild(p, cls, fromPreset)]);
  const geniusName = uniqueName(genius, name);
  genius[geniusName] = clone(genius[linkedGeniusBuild(p, cls, fromPreset)]);
  addPreset(p, cls, buildOfPreset(p, cls, fromPreset), name, source.character_name, { equip: source, skillName, geniusName });
  selectPresetIn(p, cls, name);
  return name;
}

export function renamePresetIn(p, classKey, oldName, newName) {
  const cls = lower(classKey);
  const equips = equipSetsOf(p, cls);
  const name = String(newName || "").trim();
  if (!(oldName in equips) || !name || name in equips) return false;
  renameKey(equips, oldName, name);
  if (lower(p.character_class) === cls && p.current_build_name === oldName) p.current_build_name = name;
  for (const [key, value] of Object.entries(p.last_presets || {})) if (key.startsWith(`${cls}|`) && value === oldName) p.last_presets[key] = name;
  return name;
}

export function deletePresetIn(p, classKey, name) {
  const cls = lower(classKey);
  const equips = equipSetsOf(p, cls);
  const equip = equips[name];
  if (!equip) return false;
  const buildName = buildOfPreset(p, cls, name);
  const siblings = presetsOfBuild(p, cls, buildName, equip.character_name);
  if (siblings.length <= 1) return false;
  const wasCurrent = lower(p.character_class) === cls && p.current_build_name === name;
  dropPresets(p, cls, [name]);
  if (wasCurrent) selectPresetIn(p, cls, siblings.find((n) => n !== name));
  return true;
}

// ── diff ────────────────────────────────────────────────────────────────────

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function equipEntry(equip, slot) {
  const item = ((equip || {}).equipped || {})[slot];
  if (!item) return null;
  return {
    id: item.id ?? null, name: item.name || String(item.id ?? ""), grade: item.grade || null,
    enchant: Number(((equip.enchant || {})[slot]) || 0), substats: [...(((equip.substats || {})[slot]) || [])],
  };
}

function skillEntry(build, sid) {
  const level = Number(((build || {}).levels || {})[sid] || 0);
  const specs = [...(((build || {}).specs || {})[sid] || [])].map(String).sort();
  return level || specs.length ? { level, specs } : null;
}

function layoutEntries(layout) {
  const out = new Map();
  for (const [key, sid] of Object.entries((layout || {}).slots || {})) {
    if (!sid) continue;
    const [r, c] = key.split(",").map(Number);
    out.set(`bar:${key}`, { where: `Bar row ${r + 1}, slot ${c + 1}`, value: sid, kind: "skill", order: r * 100 + c });
  }
  for (const [key, label] of Object.entries((layout || {}).keys || {})) {
    const c = Number(key.split(",")[1]);
    out.set(`key:${key}`, { where: `Key ${c + 1}`, value: label, kind: "key", order: 10000 + c });
  }
  ((layout || {}).macro || []).forEach((sid, i) => {
    if (sid) out.set(`macro:${i}`, { where: `Macro step ${i + 1}`, value: sid, kind: "skill", order: 20000 + i });
  });
  return out;
}

function arcanaEntry(card) {
  if (!card || (!card.theme && !card.slots && !card.skill_ids)) return null;
  const slots = card.slots
    ? card.slots.filter((s) => s && s.skill_id).map((s) => ({ skill_id: String(s.skill_id), level: s.level ?? null }))
    : Object.entries(card.skill_ids || {}).map(([skill_id, level]) => ({ skill_id: String(skill_id), level }));
  if (!card.theme && !slots.length) return null;
  return { theme: card.theme || null, slots };
}

function geniusEntry(state, board, line) {
  const entry = ((state || {})[board] || {})[line];
  return entry ? { stat: entry.stat, value: entry.value } : null;
}

function boardLists(set) {
  const lists = new Map();
  for (const [key, ids] of Object.entries(set || {})) if (key.startsWith("s:") && Array.isArray(ids)) lists.set(key.slice(2), ids.map(String));
  return lists;
}

function activeIds(lists, boardId, variant) {
  const known = variant && variant.node_by_id ? (id) => variant.node_by_id.has(id) && variant.node_by_id.get(id).g !== "empty" : () => true;
  if (lists.has(boardId)) return new Set(lists.get(boardId).filter(known));
  const grid = variant && variant.nodes_by_board ? variant.nodes_by_board.get(boardId) : null;
  const start = grid ? startIdOf(grid) : null;
  return new Set(start ? [start] : []);
}

// Only the differences between two presets of a class. options.variant
// (the Daevanion board data) adds start nodes and real point costs;
// options.skillName(id) names skills.
export function diffOf(p, classKey, presetA, presetB, options = {}) {
  const cls = lower(classKey);
  const equips = equipSetsOf(p, cls);
  const a = equips[presetA] || {}, b = equips[presetB] || {};
  const skills = skillBuildsOf(p, cls);
  const genius = geniusBuildsOf(p);
  const skillA = skills[linkedSkillBuild(p, cls, presetA)] || {};
  const skillB = skills[linkedSkillBuild(p, cls, presetB)] || {};
  const nameOf = options.skillName || ((id) => id);

  const equipment = [];
  const slots = new Set([...Object.keys(a.equipped || {}), ...Object.keys(b.equipped || {})]);
  for (const slot of slots) {
    const ea = equipEntry(a, slot), eb = equipEntry(b, slot);
    if (!same(ea, eb)) equipment.push({ slot, a: ea, b: eb });
  }

  const skillDiff = [];
  const ids = new Set([...Object.keys(skillA.levels || {}), ...Object.keys(skillB.levels || {}), ...Object.keys(skillA.specs || {}), ...Object.keys(skillB.specs || {})]);
  for (const id of ids) {
    const sa = skillEntry(skillA, id), sb = skillEntry(skillB, id);
    if (!same(sa, sb)) skillDiff.push({ id, name: nameOf(id), a: sa, b: sb });
  }
  skillDiff.sort((x, y) => String(x.name).localeCompare(String(y.name)));

  const layout = [];
  const la = layoutEntries(skillA.layout), lb = layoutEntries(skillB.layout);
  for (const key of new Set([...la.keys(), ...lb.keys()])) {
    const ea = la.get(key), eb = lb.get(key);
    if ((ea && ea.value) !== (eb && eb.value)) {
      layout.push({ where: (ea || eb).where, kind: (ea || eb).kind, a: ea ? ea.value : null, b: eb ? eb.value : null, order: (ea || eb).order });
    }
  }
  layout.sort((x, y) => x.order - y.order);
  for (const row of layout) delete row.order;

  const arcana = [];
  const cardsA = skillA.arcana_cards || {}, cardsB = skillB.arcana_cards || {};
  for (const cardType of new Set([...Object.keys(cardsA), ...Object.keys(cardsB)])) {
    const ca = arcanaEntry(cardsA[cardType]), cb = arcanaEntry(cardsB[cardType]);
    if (!same(ca, cb)) arcana.push({ cardType, a: ca, b: cb });
  }

  const geniusDiff = [];
  const ga = genius[linkedGeniusBuild(p, cls, presetA)] || {}, gb = genius[linkedGeniusBuild(p, cls, presetB)] || {};
  const reference = freshGenius();
  for (const board of Object.keys(reference)) {
    for (const line of Object.keys(reference[board])) {
      const va = geniusEntry(ga, board, line) || geniusEntry(reference, board, line);
      const vb = geniusEntry(gb, board, line) || geniusEntry(reference, board, line);
      if (!same(va, vb)) geniusDiff.push({ board, line: Number(line), a: va, b: vb });
    }
  }

  const sets = daevanionSetsOf(p, cls);
  const setA = sets[buildOfPreset(p, cls, presetA)] || {}, setB = sets[buildOfPreset(p, cls, presetB)] || {};
  const variant = options.variant || null;
  const listsA = boardLists(setA), listsB = boardLists(setB);
  const boards = [];
  for (const board of new Set([...listsA.keys(), ...listsB.keys()])) {
    const activeA = activeIds(listsA, board, variant), activeB = activeIds(listsB, board, variant);
    const added = [...activeB].filter((id) => !activeA.has(id)).sort();
    const removed = [...activeA].filter((id) => !activeB.has(id)).sort();
    if (!added.length && !removed.length) continue;
    const cost = (active) => (variant && variant.node_by_id ? spentCost(active, variant.node_by_id) : active.size);
    boards.push({ board, added, removed, spentA: cost(activeA), spentB: cost(activeB) });
  }
  boards.sort((x, y) => x.board.localeCompare(y.board, undefined, { numeric: true }));

  return { equipment, skills: skillDiff, layout, arcana, genius: geniusDiff, daevanion: { boards } };
}

// ── wrappers on the stored profile ──────────────────────────────────────────

function saved(result) {
  if (result !== false) save();
  return result;
}

export const builds = (classKey, characterName) => buildsOf(bp(), classKey, characterName);
export const currentBuild = (classKey, characterName) => currentBuildOf(bp(), classKey, characterName);
export const currentPreset = (classKey, characterName) => currentPresetOf(bp(), classKey, characterName);
export const newBuild = (classKey, name, characterName) => saved(newBuildIn(bp(), classKey, name, characterName));
export const duplicateBuild = (classKey, fromName, newName, characterName) => saved(duplicateBuildIn(bp(), classKey, fromName, newName, characterName));
export const renameBuild = (classKey, oldName, newName) => saved(renameBuildIn(bp(), classKey, oldName, newName));
export const deleteBuild = (classKey, name, characterName) => saved(deleteBuildIn(bp(), classKey, name, characterName));
export const newPreset = (classKey, buildName, name, characterName) => saved(newPresetIn(bp(), classKey, buildName, name, characterName));
export const duplicatePreset = (classKey, fromPreset, newName) => saved(duplicatePresetIn(bp(), classKey, fromPreset, newName));
export const renamePreset = (classKey, oldName, newName) => saved(renamePresetIn(bp(), classKey, oldName, newName));
export const deletePreset = (classKey, name) => saved(deletePresetIn(bp(), classKey, name));
export const selectPreset = (classKey, presetName) => saved(selectPresetIn(bp(), classKey, presetName));
export const selectBuild = (classKey, buildName, characterName) => saved(selectBuildIn(bp(), classKey, buildName, characterName));
export const diff = (classKey, presetA, presetB, options) => diffOf(bp(), classKey, presetA, presetB, options);
