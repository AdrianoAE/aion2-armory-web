// Rank-derived role weights, stat coverage and substat alignment — port of
// ItemDatabase/armory_engine/score.py. Nothing here compares magnitudes of
// different stats; only coverage, or the same stat against a baseline.

import { GEAR_STAT_ID_ALIASES } from "./enchant.js";
import { Reason, Recommendation } from "./explain.js";
import { normalizeStatName } from "./substats.js";

export const REASON_STAT_ABSENT = "armory_reason_stat_absent";
export const REASON_STAT_THIN = "armory_reason_stat_thin";
export const REASON_STAT_BEHIND = "armory_reason_stat_behind";
export const REASON_STAT_SUBSTAT_MISSING = "armory_reason_substat_missing";
export const REASON_SLOT_OFF_PROFILE = "armory_reason_slot_off_profile";
export const RECO_SUBSTAT_ALIGNMENT = "armory_reco_substat_alignment";

const CAMEL_BOUNDARY = /(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/g;

export const DEFAULT_DECAY = 0.75;

const byString = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export function normalizeStatId(statId) {
  return normalizeStatName(String(statId || "").replace(CAMEL_BOUNDARY, " "));
}

export function roleWeights(profileRankedNames, decay = DEFAULT_DECAY) {
  if (!(decay > 0.0 && decay <= 1.0)) throw new RangeError(`decay must be in (0, 1], got ${decay}`);
  const weights = {};
  let rank = 0;
  for (const raw of profileRankedNames || []) {
    const key = normalizeStatName(String(raw));
    if (!key || key in weights) continue;
    weights[key] = Math.pow(decay, rank);
    rank += 1;
  }
  return weights;
}

export function mergeRoleWeights(categories, decay = DEFAULT_DECAY) {
  const merged = {};
  for (const names of Object.values(categories || {})) {
    for (const [key, weight] of Object.entries(roleWeights(Array.isArray(names) ? names : [], decay))) {
      if (weight > (merged[key] || 0.0)) merged[key] = weight;
    }
  }
  return merged;
}

export function displayNames(categories) {
  const names = {};
  for (const entries of Object.values(categories || {})) {
    for (const raw of Array.isArray(entries) ? entries : []) {
      const key = normalizeStatName(String(raw));
      if (key && !(key in names)) names[key] = String(raw);
    }
  }
  return names;
}

export function statNameIndex(details) {
  const index = {};
  for (const detail of details || []) {
    if (!detail || typeof detail !== "object") continue;
    for (const bucket of ["mainStats", "subStats"]) {
      for (const entry of detail[bucket] || []) {
        if (!entry || typeof entry !== "object") continue;
        let statId = entry.id;
        statId = GEAR_STAT_ID_ALIASES[statId] || statId;
        const key = normalizeStatName(String(entry.name || ""));
        if (statId && key && !(statId in index)) index[String(statId)] = key;
      }
    }
  }
  return index;
}

function foldByName(totals, index) {
  const values = {};
  const ids = {};
  for (const [statId, value] of Object.entries(totals || {})) {
    const key = index[String(statId)] || normalizeStatId(statId);
    if (!key) continue;
    const number = Number(value);
    if (Number.isNaN(number)) continue;
    values[key] = (values[key] || 0.0) + number;
    (ids[key] || (ids[key] = [])).push(String(statId));
  }
  return [values, ids];
}

export function statGapRanked(totals, weights, reference = null, { bySlot = null, slots = [], index = null, names = null, topK = 3 } = {}) {
  index = index || {};
  names = names || {};
  bySlot = bySlot || {};
  const [currentByName, idsByName] = foldByName(totals, index);
  const referenceByName = reference != null ? foldByName(reference, index)[0] : null;

  let active = [...(slots || [])];
  if (!active.length) {
    const seen = new Set();
    for (const perSlot of Object.values(bySlot)) for (const [slot, value] of Object.entries(perSlot)) if (value) seen.add(slot);
    active = [...seen].sort(byString);
  }

  const ranked = [];
  for (const [key, weight] of Object.entries(weights)) {
    const current = currentByName[key] || 0.0;
    const statIds = idsByName[key] || [];
    const carryingSet = new Set();
    for (const statId of statIds) for (const [slot, value] of Object.entries(bySlot[statId] || {})) if (value) carryingSet.add(slot);
    const carrying = [...carryingSet].sort(byString);
    const label = names[key] || key;
    let kwargs = { stat: label, slots: carrying.length, total: active.length };
    let shortfall;
    let textKey;
    if (referenceByName !== null) {
      const baseline = referenceByName[key] || 0.0;
      if (baseline <= 0 || current >= baseline) continue;
      shortfall = weight * (baseline - current) / baseline;
      textKey = REASON_STAT_BEHIND;
      kwargs = { ...kwargs, reference: baseline, value: current };
    } else {
      const coverage = active.length ? carrying.length / active.length : 0.0;
      shortfall = weight * (1.0 - coverage);
      textKey = carrying.length ? REASON_STAT_THIN : REASON_STAT_ABSENT;
    }
    if (shortfall <= 0.0) continue;
    ranked.push([shortfall, key, new Reason({
      statId: statIds.length ? statIds[0] : key,
      delta: current,
      weight,
      textKey,
      textKwargs: kwargs,
    })]);
  }
  ranked.sort((a, b) => (b[0] - a[0]) || (b[2].weight - a[2].weight) || byString(a[1], b[1]));
  return ranked.slice(0, Math.max(0, topK)).map(([shortfall, , reason]) => [shortfall, reason]);
}

export function statGap(totals, weights, reference = null, options = {}) {
  return statGapRanked(totals, weights, reference, options).map(([, reason]) => reason);
}

export function substatAlignment(equippedSubstats, weights, { topN = 3, names = null } = {}) {
  names = names || {};
  const top = Object.keys(weights).sort((a, b) => (weights[b] - weights[a]) || byString(a, b)).slice(0, Math.max(0, topN));

  const chosen = {};
  const spelled = {};
  for (const [slot, picks] of Object.entries(equippedSubstats || {})) {
    const pairs = (picks || []).map((pick) => [normalizeStatName(String(pick)), String(pick)]).filter((pair) => pair[0]);
    chosen[String(slot)] = pairs.map(([key]) => key);
    spelled[String(slot)] = pairs.map(([, raw]) => raw);
  }

  const total = Object.values(chosen).reduce((sum, keys) => sum + keys.length, 0);
  const aligned = Object.values(chosen).reduce((sum, keys) => sum + keys.filter((key) => top.includes(key)).length, 0);
  const share = total ? aligned / total : 0.0;

  if (!total) {
    return new Recommendation({
      pick: { kind: "substat_alignment", aligned: 0, total: 0, share: 0.0, top, top_n: topN, missing: [], off_profile_slots: [] },
      scoreDelta: 0.0,
    });
  }

  const offProfileSlots = Object.keys(chosen).sort(byString).filter((slot) => chosen[slot].length && !chosen[slot].some((key) => key in weights));
  const missing = top.filter((key) => !Object.values(chosen).some((keys) => keys.includes(key)));

  const reasons = missing.map((key) => new Reason({
    statId: key, delta: 0.0, weight: weights[key], textKey: REASON_STAT_SUBSTAT_MISSING, textKwargs: { stat: names[key] || key },
  }));
  for (const slot of offProfileSlots) {
    reasons.push(new Reason({
      statId: chosen[slot][0], delta: 0.0, weight: 0.0, textKey: REASON_SLOT_OFF_PROFILE,
      textKwargs: { slot, stat: names[chosen[slot][0]] || spelled[slot][0] },
    }));
  }

  return new Recommendation({
    pick: { kind: "substat_alignment", aligned, total, share, top, top_n: topN, missing, off_profile_slots: offProfileSlots },
    scoreDelta: 1.0 - share,
    reasons,
    textKey: RECO_SUBSTAT_ALIGNMENT,
    textKwargs: { aligned, total, top_n: top.length },
  });
}
