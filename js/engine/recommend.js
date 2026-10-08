// Set completion and the recommendation orchestrator — port of
// ItemDatabase/armory_engine/recommend.py plus the in-memory half of
// providers.py (DataBundle; the disk provider has no web equivalent).

import { Reason, Recommendation } from "./explain.js";
import { displayNames, mergeRoleWeights, statGapRanked, statNameIndex, substatAlignment } from "./score.js";
import { computeStatTotalsDetailed } from "./stats.js";
import { mergeStatPriorityProfiles } from "./substats.js";

export const RECO_SET_INCOMPLETE = "armory_reco_set_incomplete";
export const REASON_SET_MISSING_PIECE = "armory_reason_set_missing_piece";
export const RECO_STAT_GAP = "armory_reco_stat_gap";
export const DATA_MISSING_KEY = "armory_reco_needs_data";

// Mirrors compute_dungeon_sets.py's DUNGEON_SET_SLOT_WORDS (the script
// that writes dungeon_sets.json).
export const SET_SLOT_WORDS = [
  "Helm", "Ring", "Boots", "Greatsword", "Breastplate", "Greaves", "Gloves",
  "Pauldrons", "Necklace", "Earrings", "Dagger", "Longsword", "Bow",
  "Spellbook", "Orb", "Mace", "Staff", "Fist", "Guard",
  "Bracelet", "Brooch", "Amulet",
];

export const DEFAULT_ROLE = "Angreifer";

const byString = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const asDict = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});

function getItem(itemsById, id) {
  if (!itemsById || id == null) return null;
  if (itemsById instanceof Map) return itemsById.get(id) || itemsById.get(String(id)) || null;
  return itemsById[id] || null;
}

function itemEntries(itemsById) {
  if (!itemsById) return [];
  if (itemsById instanceof Map) return [...itemsById.entries()];
  return Object.entries(itemsById);
}

export function setRoot(name, slotWords = SET_SLOT_WORDS) {
  const text = String(name || "");
  for (const word of slotWords) {
    const suffix = " " + word;
    if (text.endsWith(suffix)) return [text.slice(0, -suffix.length), word];
  }
  return null;
}

function rootsWithTags(dungeonSets) {
  const result = {};
  for (const tag of Object.keys(dungeonSets || {}).sort(byString)) {
    const roots = dungeonSets[tag];
    if (!roots || typeof roots !== "object" || Array.isArray(roots)) continue;
    for (const [root, info] of Object.entries(roots)) {
      if (root in result) continue;
      const entry = info && typeof info === "object"
        ? { grade: info.grade ?? "", gearscore: info.gearscore ?? null }
        : { grade: String(info || ""), gearscore: null };
      result[String(root)] = { tag, ...entry };
    }
  }
  return result;
}

export function buildSetIndex(itemsById, dungeonSets) {
  const index = {};
  for (const [root, info] of Object.entries(rootsWithTags(dungeonSets))) index[root] = { ...info, pieces: {} };
  for (const [key, item] of itemEntries(itemsById)) {
    if (!item || typeof item !== "object") continue;
    const parsed = setRoot(item.name || "");
    if (parsed === null) continue;
    const [root, slotWord] = parsed;
    const entry = index[root];
    if (!entry) continue;
    const previous = entry.pieces[slotWord];
    const id = Number(key);
    if (!previous || id < Number(previous.id)) entry.pieces[slotWord] = { id, name: item.name || "" };
  }
  return index;
}

function itemId(value) {
  if (value && typeof value === "object") value = value.id;
  if (value == null || typeof value === "boolean") return null;
  if (typeof value === "number") return Number.isFinite(value) ? Math.trunc(value) : null;
  if (typeof value === "string" && /^\s*[+-]?\d+\s*$/.test(value)) return parseInt(value, 10);
  return null;
}

function itemName(value, itemsById) {
  const id = itemId(value);
  const row = id !== null ? getItem(itemsById, id) : null;
  if (row && typeof row === "object" && row.name) return String(row.name);
  if (value && typeof value === "object" && value.name) return String(value.name);
  return "";
}

export function missingSetPieces(equipped, itemsById, dungeonSets, { index = null, limit = 0 } = {}) {
  index = index === null ? buildSetIndex(itemsById, dungeonSets) : index;

  const owned = {};
  for (const value of Object.values(equipped || {})) {
    const parsed = setRoot(itemName(value, itemsById));
    if (parsed === null) continue;
    const [root, slotWord] = parsed;
    if (root in index) (owned[root] || (owned[root] = new Set())).add(slotWord);
  }

  const rows = [];
  for (const [root, slotWords] of Object.entries(owned)) {
    const entry = index[root];
    const pieces = entry.pieces || {};
    const pieceWords = Object.keys(pieces);
    const total = pieceWords.length;
    const have = pieceWords.filter((word) => slotWords.has(word)).length;
    const missing = pieceWords.filter((word) => !slotWords.has(word)).sort(byString);
    if (!total || !missing.length) continue;
    const share = 1.0 / total;
    const completeness = have / total;
    const reasons = missing.map((slotWord) => new Reason({
      statId: "",
      delta: 1.0,
      weight: share,
      textKey: REASON_SET_MISSING_PIECE,
      textKwargs: { slot: slotWord, set: root, source: entry.tag || "", item: (pieces[slotWord] || {}).name || "" },
    }));
    rows.push([completeness, root, new Recommendation({
      pick: {
        kind: "set_completion",
        root,
        tag: entry.tag || "",
        grade: entry.grade || "",
        gearscore: entry.gearscore,
        owned: have,
        total,
        completeness,
        missing: missing.map((slotWord) => ({ slot: slotWord, id: (pieces[slotWord] || {}).id ?? null, name: (pieces[slotWord] || {}).name || "" })),
      },
      scoreDelta: missing.length * share,
      reasons,
      textKey: RECO_SET_INCOMPLETE,
      textKwargs: { set: root, owned: have, total, source: entry.tag || "" },
    })]);
  }

  rows.sort((a, b) => (b[0] - a[0]) || byString(a[1], b[1]));
  const ordered = rows.map(([, , recommendation]) => recommendation);
  return limit > 0 ? ordered.slice(0, limit) : ordered;
}

// The catalog side of a recommendation: items_all.json rows keyed by id,
// dungeon_sets.json, and whether the catalog was found at all.
export class DataBundle {
  constructor({ itemsById = {}, dungeonSets = {}, statPriorityOptions = {}, missing = [] } = {}) {
    this.itemsById = itemsById;
    this.dungeonSets = dungeonSets;
    this.statPriorityOptions = statPriorityOptions;
    this.missing = [...missing];
    this.setIndex = null;
  }

  get available() { return itemEntries(this.itemsById).length > 0; }

  get reasonKey() { return this.available ? "" : DATA_MISSING_KEY; }
}

export function itemsByIdFromCatalog(payload) {
  const rows = payload && !Array.isArray(payload) && typeof payload === "object" ? (payload.items ?? payload) : payload;
  const result = {};
  if (!Array.isArray(rows)) return result;
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const id = itemId(row.id);
    if (id === null) continue;
    result[id] = row;
  }
  return result;
}

function activeBuild(state) {
  const classKey = String(state.character_class || "").trim().toLowerCase();
  const name = String(state.current_build_name || "").trim() || "Default";
  const build = asDict(asDict(asDict(state.equip_builds_data)[classKey])[name]);
  return [asDict(build.equipped), asDict(build.substats), asDict(build.enchant)];
}

function substatIndices(raw) {
  const result = new Set();
  const values = raw instanceof Set ? [...raw] : Array.isArray(raw) ? raw : [];
  for (const value of values) {
    if (typeof value === "boolean") continue;
    const number = typeof value === "number" ? Math.trunc(value) : (typeof value === "string" && /^\s*[+-]?\d+\s*$/.test(value) ? parseInt(value, 10) : NaN);
    if (!Number.isNaN(number)) result.add(number);
  }
  return result;
}

function lookup(provider, id) {
  if (!provider) return null;
  if (typeof provider === "function") return provider(id) || null;
  return provider.get(id) || null;
}

function equippedSubstatNames(equipped, substats, provider) {
  const result = {};
  for (const [slotId, item] of Object.entries(equipped || {})) {
    const detail = lookup(provider, itemId(item));
    if (!detail) continue;
    const subStats = detail.subStats || [];
    const names = [...substatIndices(substats[slotId])].sort((a, b) => a - b)
      .filter((i) => i < subStats.length).map((i) => String(subStats[i].name || "")).filter(Boolean);
    if (names.length) result[String(slotId)] = names;
  }
  return result;
}

export function nextBestActions(state, provider, data, { limit = 5, topK = 3 } = {}) {
  if (!data.available) {
    return [new Recommendation({ pick: { kind: "unavailable", missing: [...data.missing] }, scoreDelta: 0.0, textKey: data.reasonKey })];
  }

  state = asDict(state);
  const [equipped, substats, enchant] = activeBuild(state);
  if (!Object.keys(equipped).length) return [];

  let recommendations = [];
  if (data.dungeonSets && Object.keys(data.dungeonSets).length) {
    if (data.setIndex === null) data.setIndex = buildSetIndex(data.itemsById, data.dungeonSets);
    recommendations = recommendations.concat(missingSetPieces(equipped, data.itemsById, data.dungeonSets, { index: data.setIndex, limit: 3 }));
  }

  const gearType = (state.active_gear_types || []).includes("PvP") ? "PvP" : "PvE";
  const profiles = mergeStatPriorityProfiles(asDict(state.stat_priority_profiles));
  const categories = asDict(asDict(profiles[gearType])[DEFAULT_ROLE]);
  const weights = mergeRoleWeights(categories);
  const names = displayNames(categories);

  if (provider != null && Object.keys(weights).length) {
    const alignment = substatAlignment(equippedSubstatNames(equipped, substats, provider), weights, { names });
    if (alignment.textKey) recommendations.push(alignment);

    const normalized = {};
    for (const [slot, value] of Object.entries(substats)) normalized[slot] = substatIndices(value);
    const [totals, bySlot] = computeStatTotalsDetailed(equipped, normalized, enchant, provider);
    const resolved = {};
    for (const [slot, item] of Object.entries(equipped)) resolved[slot] = lookup(provider, itemId(item));
    const ranked = Object.keys(totals).length ? statGapRanked(totals, weights, null, {
      bySlot,
      slots: Object.keys(resolved).filter((slot) => resolved[slot]).map(String).sort(byString),
      index: statNameIndex(Object.values(resolved)),
      names,
      topK,
    }) : [];
    if (ranked.length) {
      recommendations.push(new Recommendation({
        pick: { kind: "stat_gap", gear_type: gearType, role: DEFAULT_ROLE, shortfalls: ranked.map(([shortfall]) => shortfall) },
        scoreDelta: ranked.reduce((sum, [shortfall]) => sum + shortfall, 0),
        reasons: ranked.map(([, reason]) => reason),
        textKey: RECO_STAT_GAP,
        textKwargs: { count: ranked.length, gear_type: gearType, role: DEFAULT_ROLE },
      }));
    }
  }

  return limit > 0 ? recommendations.slice(0, limit) : recommendations;
}
