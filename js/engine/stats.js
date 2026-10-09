// The equipment stat merge and GearScore — 1:1 port of
// ItemDatabase/armory_engine/stats.py. `provider` is anything with a
// `get(itemId) -> detail | null` (or a plain function); a slot whose detail
// is not resolvable is skipped, which is the normal cold-cache state.

import {
  ARMOR_CATEGORIES, BELT_CATEGORY, DEFENSE_STAT_ID, GEAR_STAT_ID_ALIASES, HP_STAT_ID, SCALING_STAT_ID,
  estimateArmorBonus, estimateArmorExceedBonus, estimateEnchantBonus, estimateExceedBonus, gearscorePush,
  runeEnchantBonus,
} from "./enchant.js";

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

export function parseStatValue(raw) {
  const text = String(raw ?? "None").replace(/%/g, "").trim();
  if (!NUMBER.test(text)) return 0.0;
  const value = Number(text);
  return Number.isFinite(value) ? value : 0.0;
}

function lookup(provider, itemId) {
  if (!provider) return null;
  if (typeof provider === "function") return provider(itemId) || null;
  return provider.get(itemId) || null;
}

function indices(value) {
  if (!value) return [];
  if (value instanceof Set) return [...value];
  if (Array.isArray(value)) return value;
  return [];
}

export function computeStatTotalsDetailed(equipped, substats, enchant, provider) {
  const totals = {};
  const bySlot = {};
  const add = (slotId, statId, value) => {
    if (!statId || !value) return;
    statId = GEAR_STAT_ID_ALIASES[statId] || statId;
    totals[statId] = (totals[statId] || 0.0) + value;
    const slotTotals = bySlot[statId] || (bySlot[statId] = {});
    slotTotals[slotId] = (slotTotals[slotId] || 0.0) + value;
  };

  for (const [slotId, item] of Object.entries(equipped || {})) {
    const detail = lookup(provider, item && item.id);
    if (!detail) continue;
    for (const stat of detail.mainStats || []) add(slotId, stat.id, parseStatValue(stat.value));
    const subStats = detail.subStats || [];
    for (const i of indices((substats || {})[slotId])) {
      if (i < subStats.length) add(slotId, subStats[i].id, parseStatValue(subStats[i].value));
    }

    const level = (enchant || {})[slotId] || 0;
    if (!level) continue;
    const gradeName = detail.gradeName || detail.grade || "";
    const categoryName = detail.categoryName || "";
    const normalMax = Number(detail.maxEnchantLevel || 0);
    if (categoryName === "Rune") {
      for (const [statId, value] of Object.entries(runeEnchantBonus(item.id, level))) add(slotId, statId, value);
      continue;
    }
    const isArmor = ARMOR_CATEGORIES.has(categoryName) || categoryName === BELT_CATEGORY;
    if (isArmor) {
      const [defBonus, hpBonus] = estimateArmorBonus(level, gradeName, normalMax, categoryName);
      add(slotId, DEFENSE_STAT_ID, defBonus);
      add(slotId, HP_STAT_ID, hpBonus);
      const exceed = estimateArmorExceedBonus(level, normalMax);
      add(slotId, DEFENSE_STAT_ID, exceed.defense);
      add(slotId, HP_STAT_ID, exceed.hp);
      if (exceed.defense_pct) add(slotId, "DefenseRatio", exceed.defense_pct);
    } else {
      add(slotId, SCALING_STAT_ID, estimateEnchantBonus(level, gradeName, normalMax, categoryName));
      const exceed = estimateExceedBonus(level, normalMax, categoryName);
      add(slotId, SCALING_STAT_ID, exceed.attack);
      if (exceed.attack_pct) add(slotId, "DamageRatio", exceed.attack_pct);
      if (exceed.defense) add(slotId, DEFENSE_STAT_ID, exceed.defense);
    }
  }
  return [totals, bySlot];
}

// The game's Gear Score: every equipped item's level plus its enchant push,
// plus one line per manastone by grade, plus the Daevanion points spent,
// plus the Arcana cards by grade. Matched against the official item level
// of four characters (0 difference on three, +11 on one exceed step).
export const MANASTONE_SCORE = { Common: 1, Rare: 2, Legend: 3, Unique: 4, Epic: 4 };
export const ARCANA_SCORE = { Common: 20, Rare: 40, Legend: 60, Epic: 60, Unique: 80 };

export function computeGearscore(equipped, enchant, provider, manastones = {}) {
  let total = 0.0;
  for (const [slotId, item] of Object.entries(equipped || {})) {
    if (!item) continue;
    const detail = lookup(provider, item.id);
    const itemLevel = Number(item.level) || (detail && detail.level) || 0;
    if (!itemLevel) continue;
    total += itemLevel;
    const maxEnchant = Number(item.maxEnchantLevel) || Number((detail && detail.maxEnchantLevel) || 0);
    const level = (enchant || {})[slotId] || 0;
    if (level) total += gearscorePush(level, maxEnchant);
    for (const grade of (manastones || {})[slotId] || []) total += MANASTONE_SCORE[grade] || 0;
  }
  return total;
}

export function manastoneScore(manastones) {
  let total = 0;
  for (const grades of Object.values(manastones || {})) for (const grade of grades || []) total += MANASTONE_SCORE[grade] || 0;
  return total;
}

export function arcanaScore(arcanaCards) {
  let total = 0;
  for (const card of Object.values(arcanaCards || {})) if (card && card.theme) total += ARCANA_SCORE[card.grade || "Unique"] || 0;
  return total;
}

// Points spent on every board of a Daevanion set (keys "s:<boardId>").
export function daevanionScore(set, nodeById) {
  let total = 0;
  for (const [key, ids] of Object.entries(set || {})) {
    if (!key.startsWith("s:") || !Array.isArray(ids)) continue;
    for (const id of ids) { const node = nodeById && nodeById.get(String(id)); if (node) total += Number(node.cost) || 0; }
  }
  return total;
}
