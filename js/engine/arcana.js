// The Arcana Calculator's best-case Lord-card solver: a 1:1 port of the
// desktop's ItemDatabase/armory_engine/arcana.py. Pure functions, no DOM.
//
// Two behaviours are load-bearing and pinned by tests/arcana.test.mjs:
// bestCombination is sequential over usableTypes (a later type's remaining
// need already reflects what earlier types covered), and
// computeCombinations excludes only need_based_ids between searches, never
// every skill a type touched.

export const LORD_TYPES = ["Chalice", "Parchment", "Compass", "Bell", "Mirror", "Scales"];
export const LORD_CATEGORY = {
  Chalice: "both", Parchment: "active", Compass: "active",
  Bell: "passive", Mirror: "passive", Scales: "active",
};
export const GRADE_MAX_LEVEL = { Rare: 3, Legend: 4, Unique: 5 };
export const MAX_CARD_LEVEL = GRADE_MAX_LEVEL.Unique;
export const ACTIVE_THEMES = new Set(["Vigor", "Magic"]);
export const SKILL_SLOTS_PER_CARD = 4;
export const SKILL_BASELINE = 1;
export const CARD_EXTRA_BUDGET = MAX_CARD_LEVEL;
export const PER_SKILL_CAP = 4;
export const DEFAULT_GRADE = "Unique";

export function usableLordTypes(themeMap, activeThemes) {
  return LORD_TYPES.filter((ct) => [...activeThemes].some((theme) => ct in (themeMap[theme] || {})));
}

// Exactly 4 positional entries, each null or {skill_id, level}; migrates the
// older {skill_ids: {sid: level}} shape on the fly.
export function cardSlotList(cardData) {
  if (!cardData) return new Array(SKILL_SLOTS_PER_CARD).fill(null);
  let slots = cardData.slots;
  if (slots === undefined || slots === null) {
    slots = Object.entries(cardData.skill_ids || {}).map(([skill_id, level]) => ({ skill_id, level }));
  }
  slots = slots.slice(0, SKILL_SLOTS_PER_CARD);
  while (slots.length < SKILL_SLOTS_PER_CARD) slots.push(null);
  return slots;
}

export function cardGrade(cardData) {
  if (!cardData) return DEFAULT_GRADE;
  return cardData.grade === undefined ? DEFAULT_GRADE : cardData.grade;
}

// The card's overall level, derived from the points its slots sit above
// baseline and clamped at its grade's own max.
export function cardLevel(cardData) {
  const spent = cardSlotList(cardData).reduce((sum, slot) => {
    if (!slot) return sum;
    const level = slot.level === undefined ? SKILL_BASELINE : slot.level;
    return sum + Math.max(0, level - SKILL_BASELINE);
  }, 0);
  const max = GRADE_MAX_LEVEL[cardGrade(cardData)];
  return Math.min(spent, max === undefined ? MAX_CARD_LEVEL : max);
}

export function eligibleSkillsForType(ct, wishes, classSkillPools, skillTypeById) {
  const category = LORD_CATEGORY[ct];
  const poolIds = new Set((classSkillPools[ct] || []).map((s) => s.id));
  return Object.keys(wishes).filter((sid) => poolIds.has(sid) && (category === "both" || skillTypeById[sid] === category));
}

export function fullPoolForType(ct, classSkillPools) {
  return (classSkillPools[ct] || []).map((s) => s.id);
}

const INF = Infinity;

function compareKeys(a, b) {
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return 0;
}

function sortedBy(list, keyFn) {
  return list.map((item, index) => ({ item, index, key: keyFn(item) }))
    .sort((x, y) => compareKeys(x.key, y.key) || x.index - y.index)
    .map((x) => x.item);
}

// What ONE card of this type contributes in the perfect case, given what is
// already covered. Returns [values, needBasedIds, order]; `order` is the
// slot order the desktop's dict iteration would have produced.
export function bestCardContribution(eligible, fullPool, priorityRank, wishes, covered) {
  const rank = (sid) => (priorityRank[sid] === undefined ? INF : priorityRank[sid]);
  const remainingNeed = (sid, value) => Math.max(0, (wishes[sid] || 0) - (covered[sid] || 0) - value);
  const needChosen = sortedBy(
    eligible.filter((sid) => (wishes[sid] || 0) - (covered[sid] || 0) > 0),
    (sid) => [-Math.max(0, (wishes[sid] || 0) - (covered[sid] || 0)), rank(sid), sid],
  ).slice(0, SKILL_SLOTS_PER_CARD);
  let chosen = [...needChosen];
  if (chosen.length < SKILL_SLOTS_PER_CARD) {
    const filler = sortedBy(fullPool.filter((sid) => !chosen.includes(sid)), (sid) => [rank(sid), sid]);
    chosen = chosen.concat(filler.slice(0, SKILL_SLOTS_PER_CARD - chosen.length));
  }
  if (!chosen.length) return [{}, new Set(), []];

  const values = {};
  for (const sid of chosen) values[sid] = SKILL_BASELINE;
  let budget = CARD_EXTRA_BUDGET;
  while (budget > 0) {
    const candidates = chosen.filter((sid) => values[sid] < PER_SKILL_CAP);
    if (!candidates.length) break;
    const best = sortedBy(candidates, (sid) => [-remainingNeed(sid, values[sid]), rank(sid), sid])[0];
    values[best] += 1;
    budget -= 1;
  }
  return [values, new Set(needChosen), chosen];
}

export function bestCombination(usableTypes, typeToTheme, eligibleByType, fullPoolByType, priorityRank, wishes) {
  const covered = {};
  const path = [];
  for (const ct of usableTypes) {
    const theme = typeToTheme[ct];
    if (!theme) continue;
    const [contribution, needBasedIds, order] = bestCardContribution(
      eligibleByType[ct] || [], fullPoolByType[ct] || [], priorityRank, wishes, covered,
    );
    if (!Object.keys(contribution).length) continue;
    for (const [sid, value] of Object.entries(contribution)) covered[sid] = (covered[sid] || 0) + value;
    path.push({ type: ct, theme, skill_ids: contribution, need_based_ids: needBasedIds, skill_order: order });
  }
  return [covered, path];
}

// Up to maxResults distinct combinations, best first.
export function computeCombinations(usableTypes, typeToTheme, classSkillPools, wishes, skillTypeById, priorityRank = null, maxResults = 3) {
  if (!Object.keys(wishes).length) return [];
  const eligibleByType = {};
  const fullPoolByType = {};
  for (const ct of usableTypes) {
    eligibleByType[ct] = eligibleSkillsForType(ct, wishes, classSkillPools, skillTypeById);
    fullPoolByType[ct] = fullPoolForType(ct, classSkillPools);
  }
  priorityRank = priorityRank || {};
  const results = [];
  const excluded = new Set();
  for (let i = 0; i < maxResults; i += 1) {
    const prunedEligible = {};
    const prunedFull = {};
    for (const ct of usableTypes) {
      prunedEligible[ct] = eligibleByType[ct].filter((sid) => !excluded.has(`${ct}\u0000${sid}`));
      prunedFull[ct] = fullPoolByType[ct].filter((sid) => !excluded.has(`${ct}\u0000${sid}`));
    }
    const [covered, path] = bestCombination(usableTypes, typeToTheme, prunedEligible, prunedFull, priorityRank, wishes);
    if (!path.length) break;
    results.push({ assignments: path, covered });
    for (const a of path) for (const sid of a.need_based_ids) excluded.add(`${a.type}\u0000${sid}`);
  }
  return results;
}

export function resultCoveragePercent(result, wishes) {
  const totalWish = Object.values(wishes).reduce((a, b) => a + b, 0);
  if (totalWish <= 0) return 0;
  const covered = result.covered || {};
  const useful = Object.entries(wishes).reduce((sum, [sid, need]) => sum + Math.min(covered[sid] || 0, need), 0);
  return (useful / totalWish) * 100;
}

export function eligibleTypes(skillId, category, usableTypes, classSkillPools) {
  return usableTypes.filter((ct) => (classSkillPools[ct] || []).some((s) => s.id === skillId)
    && (LORD_CATEGORY[ct] === "both" || LORD_CATEGORY[ct] === category));
}

export function maxCeiling(skillId, category, usableTypes, classSkillPools) {
  return eligibleTypes(skillId, category, usableTypes, classSkillPools).length * PER_SKILL_CAP;
}

// Why a wished skill did not reach its target: [translation key, kwargs].
export function uncoveredReason(skillId, wish, covered, usableTypes, classSkillPools, skillTypeById) {
  const category = skillTypeById[skillId];
  const types = eligibleTypes(skillId, category, usableTypes, classSkillPools);
  if (!types.length) return ["arm_arcana_reason_no_card", {}];
  const maxPossible = types.length * PER_SKILL_CAP;
  if (maxPossible < wish) return ["arm_arcana_reason_not_enough_slots", { max: maxPossible }];
  return ["arm_arcana_reason_competing_wishes", {}];
}

// ---- Lord points (app.py _arcana_card_lord_points) ----------------------

export const LORD_RATE = 0.2;
export const LORD_STAT_IDS = {
  Time: ["CombatSpeed", "HardHitResist"],
  Space: ["MoveSpeed", "BlockIncrease"],
  Justice: ["DefenseRatio", "PerfectChance"],
  Freedom: ["AccuracyIncrease", "EvasionIncrease"],
  Illusion: ["CooldownReduction", "EndurancePenetration"],
  Life: ["HPIncrease", "Restoration"],
  Destiny: ["MPIncrease", "IronWall"],
  Wisdom: ["MPCostReduction", "HardHit"],
  Death: ["CriticalHitIncrease", "RegenerationPenetration"],
  Destruction: ["DamageRatio", "PerfectResist"],
};
export const LORD_POINTS_STAT_ID = {
  Death: "DeathLordPoints", Destiny: "DestinyLordPoints", Destruction: "DestructionLordPoints",
  Freedom: "FreedomLordPoints", Illusion: "IllusionLordPoints", Justice: "JusticeLordPoints",
  Life: "LifeLordPoints", Space: "SpaceLordPoints", Time: "TimeLordPoints", Wisdom: "WisdomLordPoints",
};
export const CHALICE_LORD_BASE = 20;
export const CHALICE_LORD_PER_LEVEL = {
  Vigor: 1, Magic: 1, Frenzy: 1, Purity: 1,
  Punishment: 2, Protection: 2, Indomitability: 2,
};

// [lord, points] this card grants at its derived level, or null.
export function cardLordPoints(cardData, themeMap, cardType) {
  if (!cardData) return null;
  const theme = cardData.theme;
  if (!theme) return null;
  const entry = (themeMap[theme] || {})[cardType];
  const lord = entry ? entry.lord : null;
  if (!lord) return null;
  const perLevel = CHALICE_LORD_PER_LEVEL[theme] || 0;
  return [lord, CHALICE_LORD_BASE + perLevel * cardLevel(cardData)];
}

// {skill_id: level} summed over every card's slots (app.py
// _compute_arcana_card_skill_bonus_for).
export function cardSkillBonus(arcanaCards) {
  const bonus = {};
  for (const cardData of Object.values(arcanaCards || {})) {
    for (const entry of cardSlotList(cardData)) {
      if (entry && entry.skill_id) bonus[entry.skill_id] = (bonus[entry.skill_id] || 0) + Number(entry.level || 0);
    }
  }
  return bonus;
}
