// Property-priority profiles and the substat auto-pick — 1:1 port of
// ItemDatabase/armory_engine/substats.py.

export const STAT_PRIORITY_GEAR_TYPES = ["PvE", "PvP"];
export const STAT_PRIORITY_ROLES = ["Angreifer", "Verteidiger", "Support"];
export const STAT_PRIORITY_MAX_ENTRIES = 7;

export const DEFAULT_STAT_PRIORITY_BY_CATEGORY = {
  weapon: ["Weapon Damage Boost", "Combat Speed", "Damage Boost", "Might", "Precision", "Attack", "Multi-hit Chance"],
  helmet: ["Attack increase", "Smite", "Attack", "Endurance", "Incoming Heal"],
  shoulder: ["Critical Damage Boost", "Attack", "Endurance", "Defense increase", "Accuracy", "Critical Hit"],
  torso: ["Damage Boost", "Attack", "Endurance", "Defense increase", "Accuracy", "Critical Hit"],
  gloves: ["Combat Speed", "Attack", "Perfect Chance", "Defense increase", "Accuracy", "Critical Hit"],
  pants: ["Damage Tolerance", "Attack increase", "Attack", "Perfect Chance", "Endurance"],
  boots: ["Move Speed", "Attack", "Perfect Chance", "Defense increase", "Accuracy", "Critical Hit"],
  jewelry: ["Attack", "Accuracy", "Critical Hit"],
  ring: ["Attack"],
  bracelet: [],
};

export function defaultStatPriorityProfiles() {
  const result = {};
  for (const gearType of STAT_PRIORITY_GEAR_TYPES) {
    result[gearType] = {};
    for (const role of STAT_PRIORITY_ROLES) {
      result[gearType][role] = {};
      for (const [cat, names] of Object.entries(DEFAULT_STAT_PRIORITY_BY_CATEGORY)) result[gearType][role][cat] = [...names];
    }
  }
  return result;
}

// Merges a persisted profiles dict onto the defaults so an older profile
// missing a gear type / role / category stays filled rather than blank.
export function mergeStatPriorityProfiles(saved) {
  const result = defaultStatPriorityProfiles();
  for (const [gearType, roles] of Object.entries(saved || {})) {
    if (!(gearType in result)) continue;
    for (const [role, categories] of Object.entries(roles || {})) {
      if (!(role in result[gearType])) continue;
      for (const [category, names] of Object.entries(categories || {})) {
        if (category in result[gearType][role] && Array.isArray(names)) {
          result[gearType][role][category] = names.map(String).slice(0, STAT_PRIORITY_MAX_ENTRIES);
        }
      }
    }
  }
  return result;
}

export const STAT_NAME_ALIASES = { "movement speed": "move speed" };

export function normalizeStatName(name) {
  const key = String(name || "").trim().toLowerCase();
  return STAT_NAME_ALIASES[key] || key;
}

// Walks the ranked names top to bottom, taking the first still-unused
// match for each, through the WHOLE list, up to `count` picks.
export function pickPrioritySubstats(subStats, count, priorityNames) {
  if (count <= 0 || !subStats || !subStats.length || !priorityNames || !priorityNames.length) return new Set();
  const normalized = subStats.map((s) => normalizeStatName((s && s.name) || ""));
  const chosen = [];
  const used = new Set();
  for (const wantedName of priorityNames) {
    if (chosen.length >= count) break;
    const wanted = normalizeStatName(wantedName);
    for (let i = 0; i < normalized.length; i++) {
      if (used.has(i) || normalized[i] !== wanted) continue;
      chosen.push(i);
      used.add(i);
      break;
    }
  }
  return new Set(chosen.slice(0, count));
}
