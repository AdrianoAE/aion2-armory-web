// Enchant, Exceed and GearScore estimators — 1:1 port of
// ItemDatabase/armory_engine/enchant.py (same constants, same curves).

// Real per-item substat ids that spell the SAME stat differently from the
// id the stat rows use; normalized at gear-collection time.
export const GEAR_STAT_ID_ALIASES = {
  Accuracy: "AccuracyBonus",
  Evasion: "EvasionBonus",
  Perfect: "PerfectChance",
  Defense: "DefenseBonus",
  FixingDamage: "AttackBonus",
  WeaponDamage: "MaxAttack",
  CriticalAddDamage: "CriticalAttack",
  BackAttackDamage: "BackAttack",
  FrontAttackDamage: "FrontAttack",
  BackAttackCritical: "BackAttackCriticalHit",
  FrontAttackCritical: "FrontAttackCriticalHit",
  BackAttackDefense: "BackDefense",
  FrontAttackDefense: "FrontDefense",
  BackAttackCriticalResist: "BackAttackCriticalHitResist",
  FrontAttackCriticalResist: "FrontAttackCriticalHitResist",
  DecreaseBackAttack: "BackAttackDamageTolerance",
  DecreaseFrontAttack: "FrontAttackDamageTolerance",
  DecreaseWeaponDamage: "WeaponDamageTolerance",
  DecreaseDamage: "DamageTolerance",
  DecreaseCriticalDamage: "CriticalDamageTolerance",
  IgnoreIronWall: "EndurancePenetration",
  IgnoreRestoration: "RegenerationPenetration",
  PvEAddDamage: "PvEAttack",
  PvEDamageDefense: "PvEDefense",
  BossNpcAddDamage: "BossAttack",
  Time: "TimeLordPoints", Space: "SpaceLordPoints", Justice: "JusticeLordPoints",
  Freedom: "FreedomLordPoints", Illusion: "IllusionLordPoints", Life: "LifeLordPoints",
  Destiny: "DestinyLordPoints", Wisdom: "WisdomLordPoints", Death: "DeathLordPoints",
  Destruction: "DestructionLordPoints",
};

export const SCALING_STAT_ID = "WeaponFixingDamage";

export const ACCESSORY_CATEGORIES = new Set(["Necklace", "Earrings", "Ring", "Bracelet", "Brooch", "Amulet"]);
const ACCESSORY_RATE_PER_LEVEL = 5.0;

// (k, p) for bonus = k * level**p, fit to real equipped-gear samples.
const WEAPON_CURVE_PARAMS = { Legend: [10.0, 1.0], Unique: [5.733, 1.355] };
const HEROIC_RATE_PER_LEVEL = 17.5;
const DEFAULT_WEAPON_CURVE = [10.0, 1.0];

export const RUNE_PVE_ITEM_ID = 310900001; // Clash Rune
export const RUNE_PVP_ITEM_ID = 310900002; // Devotion Rune
const RUNE_COMBAT_SPEED_THRESHOLD = 6;
const RUNE_MULTI_HIT_THRESHOLD = 9;

export function runeEnchantBonus(itemId, level) {
  if (level <= 0) return {};
  const bonus = {
    CombatSpeed: Math.max(0, level - RUNE_COMBAT_SPEED_THRESHOLD + 1) * 1.0,
    DefensePierce: level * 50.0,
    AdditionalHitRate: Math.max(0, level - RUNE_MULTI_HIT_THRESHOLD + 1) * 1.0,
  };
  if (itemId === RUNE_PVE_ITEM_ID) {
    bonus.PvEAmplifyDamage = level * 0.5;
    bonus.PvEDecreaseDamage = level * 0.5;
  } else if (itemId === RUNE_PVP_ITEM_ID) {
    bonus.PvPAmplifyDamage = level * 0.5;
    bonus.PvPDecreaseDamage = level * 0.5;
  }
  return bonus;
}

export function estimateEnchantBonus(level, gradeName = "", normalMaxLevel = 0, categoryName = "") {
  const effective = normalMaxLevel ? Math.min(level, normalMaxLevel) : level;
  if (effective <= 0) return 0.0;
  if (ACCESSORY_CATEGORIES.has(categoryName)) return ACCESSORY_RATE_PER_LEVEL * effective;
  if (gradeName === "Heroic") return HEROIC_RATE_PER_LEVEL * effective;
  const [k, p] = WEAPON_CURVE_PARAMS[gradeName] || DEFAULT_WEAPON_CURVE;
  return k * Math.pow(effective, p);
}

export function estimateExceedBonus(level, normalMaxLevel, categoryName = "") {
  if (!normalMaxLevel || level <= normalMaxLevel) return { attack: 0.0, attack_pct: 0.0, defense: 0.0 };
  const steps = level - normalMaxLevel;
  if (ACCESSORY_CATEGORIES.has(categoryName)) return { attack: 20.0 * steps, attack_pct: 1.0 * steps, defense: 40.0 * steps };
  return { attack: 30.0 * steps, attack_pct: 1.0 * steps, defense: 0.0 };
}

export const ARMOR_CATEGORIES = new Set(["Helm", "Top", "Pauldrons", "Gloves", "Legs", "Shoes", "Cloak"]);
export const BELT_CATEGORY = "Belt";
export const DEFENSE_STAT_ID = "ArmorDefense";
export const HP_STAT_ID = "HPMax";

const ARMOR_DEFENSE_RATE = { Unique: 30.0, Heroic: 35.0 };
const DEFAULT_ARMOR_DEFENSE_RATE = 30.0;
const ARMOR_HP_RATE_PER_LEVEL = 20.0;
const BELT_DEFENSE_RATE_PER_LEVEL = 30.0;
const BELT_HP_RATE_PER_LEVEL = 50.0;

export function estimateArmorBonus(level, gradeName = "", normalMaxLevel = 0, categoryName = "") {
  const effective = normalMaxLevel ? Math.min(level, normalMaxLevel) : level;
  if (effective <= 0) return [0.0, 0.0];
  if (categoryName === BELT_CATEGORY) {
    return [Math.round(BELT_DEFENSE_RATE_PER_LEVEL * effective), Math.round(BELT_HP_RATE_PER_LEVEL * effective)];
  }
  const defRate = ARMOR_DEFENSE_RATE[gradeName] ?? DEFAULT_ARMOR_DEFENSE_RATE;
  return [Math.round(defRate * effective), Math.round(ARMOR_HP_RATE_PER_LEVEL * effective)];
}

export function estimateArmorExceedBonus(level, normalMaxLevel) {
  if (!normalMaxLevel || level <= normalMaxLevel) return { defense: 0.0, defense_pct: 0.0, hp: 0.0, hp_pct: 0.0 };
  const steps = level - normalMaxLevel;
  return { defense: 80.0 * steps, defense_pct: 1.0 * steps, hp: 80.0 * steps, hp_pct: 1.0 * steps };
}

export const GEARSCORE_NORMAL_RATE = 1.0;
export const GEARSCORE_EXCEED_RATE = 5.0;

export function gearscorePush(enchantLevel, normalMaxLevel) {
  if (enchantLevel <= 0) return 0.0;
  const normalSteps = normalMaxLevel ? Math.min(enchantLevel, normalMaxLevel) : enchantLevel;
  const exceedSteps = normalMaxLevel ? Math.max(0, enchantLevel - normalMaxLevel) : 0;
  return GEARSCORE_NORMAL_RATE * normalSteps + GEARSCORE_EXCEED_RATE * exceedSteps;
}
