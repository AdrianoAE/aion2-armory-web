// The profile: the `build_planner` object kept in localStorage, exported and
// imported as profile JSON (older profiles with the same keys import as is).

import { defaultPlannerTasks, migratePlannerTasks } from "./engine/planner.js";
import { buildsOf, currentPresetOf, migrateProfile, selectPresetIn } from "./builds.js";
import { DEFAULT_REGION } from "./engine/timers.js";
import { DEFAULT_SERVER } from "./engine/fieldboss.js";

const KEY = "aion2-armory-profile";
const listeners = new Set();

export const CLASSES = ["Gladiator", "Templar", "Assassin", "Ranger", "Sorcerer", "Spiritmaster", "Cleric", "Chanter"];

function defaultBuildPlanner() {
  const tasks = defaultPlannerTasks();
  return {
    character_class: "Gladiator",
    current_build_name: "Default",
    equip_builds_data: {},
    character_order: [],
    planner: {
      servers: [{ id: "sv1", name: "My server", characters: [] }],
      tasks,
      done: {},
      odyle: {},
      excluded: {},
      next_id: 1,
      defaults_seen: Object.entries(tasks).flatMap(([scope, list]) => list.map((t) => `${scope}:${t.name}`)),
    },
    timers_region: DEFAULT_REGION,
    fieldboss_server: DEFAULT_SERVER,
    fieldboss_only_artwork: true,
    fieldboss_tracked: ["elyos20", "elyos24"],
    fieldboss_done: {},
    official_characters: {},
  };
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* unreadable or blocked storage: start fresh */ }
  return { build_planner: defaultBuildPlanner() };
}

export const profile = load();

export function bp() {
  if (!profile.build_planner) profile.build_planner = defaultBuildPlanner();
  const p = profile.build_planner;
  const d = defaultBuildPlanner();
  for (const key of Object.keys(d)) if (p[key] === undefined) p[key] = d[key];
  for (const key of Object.keys(d.planner)) if (p.planner[key] === undefined) p.planner[key] = d.planner[key];
  migratePlannerTasks(p.planner);
  mergeDefaultTasks(p.planner);
  migrateProfile(p);
  return p;
}

// Default tasks added in later versions join a saved checklist once, by
// name, so one the player removed stays removed.
function mergeDefaultTasks(planner) {
  const seen = planner.defaults_seen;
  for (const [scope, defaults] of Object.entries(defaultPlannerTasks())) {
    planner.tasks[scope] = planner.tasks[scope] || [];
    const names = new Set(planner.tasks[scope].map((t) => t.name.toLowerCase()));
    for (const task of defaults) {
      const key = `${scope}:${task.name}`;
      if (seen.includes(key)) continue;
      seen.push(key);
      if (!names.has(task.name.toLowerCase())) {
        planner.next_id += 1;
        planner.tasks[scope].push({ id: `t${planner.next_id}`, name: task.name, kind: task.kind });
      }
    }
  }
}

export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(profile)); } catch (e) { /* storage blocked */ }
  for (const fn of listeners) fn();
}

export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function newId(prefix) {
  const planner = bp().planner;
  planner.next_id += 1;
  return `${prefix}${planner.next_id}`;
}

export function plannerServer() {
  const planner = bp().planner;
  if (!planner.servers.length) planner.servers.push({ id: newId("sv"), name: "My server", characters: [] });
  return planner.servers[0];
}

// One entry per character: the equip sets (presets) of one class sharing a
// name; `builds` lists the presets, `builds2` the Builds with their presets.
export function characters() {
  const p = bp();
  const grouped = new Map();
  for (const [cls, builds] of Object.entries(p.equip_builds_data || {})) {
    if (!cls) continue;
    for (const [buildName, build] of Object.entries(builds)) {
      const name = (build.character_name || "").trim();
      const key = `${cls}|${name.toLowerCase()}`;
      if (!grouped.has(key)) grouped.set(key, { key, class: cls, name, builds: [], current: null });
      const entry = grouped.get(key);
      entry.builds.push(buildName);
      if (cls === p.character_class.toLowerCase() && buildName === p.current_build_name) entry.current = buildName;
    }
  }
  for (const entry of grouped.values()) {
    entry.builds2 = buildsOf(p, entry.class, entry.name);
    entry.preset = currentPresetOf(p, entry.class, entry.name);
  }
  const order = p.character_order || [];
  return [...grouped.values()].sort((a, b) => {
    const ia = order.indexOf(a.key), ib = order.indexOf(b.key);
    const ra = ia < 0 ? order.length : ia, rb = ib < 0 ? order.length : ib;
    return ra - rb || (a.name === "") - (b.name === "") || a.name.localeCompare(b.name) || a.class.localeCompare(b.class);
  });
}

export function plannerCharacterNamed(name) {
  if (!name) return null;
  for (const server of bp().planner.servers) {
    const found = server.characters.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (found) return found;
  }
  return null;
}

// Every named roster character has a planner entry.
export function syncPlannerCharacters() {
  const server = plannerServer();
  for (const entry of characters()) {
    if (entry.name && !plannerCharacterNamed(entry.name)) {
      server.characters.push({ id: newId("ch"), name: entry.name, class: entry.class[0].toUpperCase() + entry.class.slice(1) });
    }
  }
}

export function addCharacter(name, cls) {
  const p = bp();
  const key = cls.toLowerCase();
  p.equip_builds_data[key] = p.equip_builds_data[key] || {};
  const builds = p.equip_builds_data[key];
  const unnamedOnly = Object.keys(builds).length === 1 && !(Object.values(builds)[0].character_name || "").trim();
  let setName;
  if (unnamedOnly) {
    setName = Object.keys(builds)[0];
  } else {
    setName = name;
    while (builds[setName]) setName += " 2";
    builds[setName] = { equipped: {}, substats: {}, enchant: {}, philosopher_stone: {}, priority: {}, priority_progress: {} };
    const sharesClass = Object.values(builds).some((e) => (e.character_name || "").trim());
    if (sharesClass) {
      p.daevanion_builds_data = p.daevanion_builds_data || {};
      const sets = p.daevanion_builds_data[key] = p.daevanion_builds_data[key] || {};
      let buildName = name;
      while (sets[buildName]) buildName += " 2";
      sets[buildName] = {};
      builds[setName].linked_daevanion_build = buildName;
    }
  }
  builds[setName].character_name = name;
  migrateProfile(p);
  selectPresetIn(p, key, setName);
  syncPlannerCharacters();
  save();
}

export function selectCharacter(cls, presetName, characterName) {
  const p = bp();
  const preset = presetName || currentPresetOf(p, cls, characterName);
  if (!selectPresetIn(p, cls, preset)) {
    p.character_class = cls[0].toUpperCase() + cls.slice(1);
    p.current_build_name = preset;
  }
  save();
}

export function currentCharacter() {
  const p = bp();
  return characters().find((c) => c.class === p.character_class.toLowerCase() && c.builds.includes(p.current_build_name)) || null;
}

export function renameCharacter(entry, newName) {
  const p = bp();
  const previous = entry.name;
  for (const buildName of entry.builds) p.equip_builds_data[entry.class][buildName].character_name = newName || null;
  const stillUsed = characters().some((c) => c.name.toLowerCase() === previous.toLowerCase());
  const planner = plannerCharacterNamed(previous);
  if (previous && newName && planner && !stillUsed && !plannerCharacterNamed(newName)) planner.name = newName;
  save();
}

// Drag-and-drop: put `fromKey` where `toKey` currently is.
export function reorderCharacter(fromKey, toKey) {
  const keys = characters().map((c) => c.key);
  const from = keys.indexOf(fromKey), to = keys.indexOf(toKey);
  if (from < 0 || to < 0 || from === to) return;
  keys.splice(to, 0, keys.splice(from, 1)[0]);
  bp().character_order = keys;
  save();
}

export function moveCharacter(entry, delta) {
  const keys = characters().map((c) => c.key);
  const index = keys.indexOf(entry.key);
  const target = index + delta;
  if (target < 0 || target >= keys.length) return;
  [keys[index], keys[target]] = [keys[target], keys[index]];
  bp().character_order = keys;
  save();
}

export function exportProfile() {
  const blob = new Blob([JSON.stringify(profile, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "Aion2-Armory-profile.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export async function importProfile(file) {
  const parsed = JSON.parse(await file.text());
  const incoming = parsed.build_planner ? parsed : { build_planner: parsed };
  for (const key of Object.keys(profile)) delete profile[key];
  Object.assign(profile, incoming);
  bp();
  save();
}
