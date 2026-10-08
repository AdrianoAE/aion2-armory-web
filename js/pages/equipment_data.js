// Equipment page data: the desktop's slot/stat tables (ItemDatabase/app.py
// module constants), the catalog + per-item detail cache, and the totals
// pipeline the Stat Values panel and Build Compare share.

import { GEAR_STAT_ID_ALIASES, RUNE_PVE_ITEM_ID, RUNE_PVP_ITEM_ID } from "../engine/enchant.js";
import { computeGearscore, computeStatTotalsDetailed } from "../engine/stats.js";

// --- texts (core/translations.py, en block) --------------------------------
export const T = {
  equipment: "Equipment", jewelry: "Jewelry", stat_values: "Stat Values", gearscore_zero: "GearScore: 0",
  main_stats: "Main Stats", sub_stats: "Sub Stats", utility: "Utility & Recovery", genius: "Genius Insight",
  movement: "Movement", pve_stats: "PvE Stats", pvp_stats: "PvP Stats", status_chance: "Status Chance", status_resist: "Status Resist",
  offense: "Offense", defense: "Defense",
  stat_sum_note: "Sum of main stats + checked substats of all equipped items. Rows without a confirmed stat ID show \"—\" instead of an estimate.",
  section_weapon: "Weapon", section_armor: "Armor", section_accessory: "Accessory", section_wings: "Wings",
  quick_select: "Quick Select:", properties: "Properties", eq_priority: "EQ Priority", build_compare: "Build Compare",
  build_compare_tooltip: "Compare two of this class's saved sets side by side", build_compare_title: "Build Compare",
  compare_a: "Build A", compare_b: "Build B", back: "Back", close: "Close", cancel: "Cancel", save: "Save", all: "All", name_colon: "Name:",
  add_set: "Add new set", duplicate_set: "Duplicate current set", rename_set: "Rename current set", delete_set: "Delete current set",
  new_set: "New Set", duplicate_set_title: "Duplicate Set", rename_set_title: "Rename Set", duplicate_default: (name) => `${name} (Copy)`,
  delete_title: "Delete", delete_text: (name) => `Really delete "${name}"? This cannot be undone.`,
  bp_title: (name) => `Build "${name}"`, bp_skill: "Arcana / Skill Planner:", bp_daevanion: "Daevanion Board:", bp_genius: "Genius Insight:",
  choose_x: (label) => `Choose ${label}…`, choose_slot: "Choose Slot…", slot_empty_tooltip: (label) => `${label} — empty`,
  back_to_stats: "Back to stat overview", clear_slot: "Clear slot", loading_details: "Loading details…",
  required_level: "Required Level", source: "Source", tradable: "Tradable", yes: "Yes", no: "No", unknown: "unknown",
  simulate_enchant: "Simulate enchantment:",
  enchant_note: "Only the scaling stat(s) get a bonus when enchanting (Attack for weapons; Defense + HP for armor) — every other main stat stays unchanged, substats even more so (Soulbinding only). The bonus is a rough estimate calibrated against real API values — not real server numbers, and less reliable beyond the normal max level (Exceed).",
  possible_substats: (hint) => `<b>Possible Substats</b> <span style="font-weight:400">(random roll, independent of enchantment — only increasable via Soulbinding${hint})</span>`,
  slot_hint: (rolled, total) => ` — this item only actually rolls <b>${rolled}/${total}</b> of these`,
  substats_tab: "Substats", skills_tab: "Skills", show_selected_only: "Only show selected properties",
  use_philo: "Use Philosopher's Stone (+1 substat)",
  philo_tooltip: "Simulates 'Philosopher's Stone: Revelation' — opens an additional Soul Binding slot. Unique grade and above only.",
  stone_note: " (incl. Philosopher's Stone)",
  all_selected: (s, c, note) => `All possible substats selected (${s}/${c})${note}`,
  selected_count: (s, c, note) => `${s}/${c} substats selected${note}`,
  badge_offensive: "OFFENSIVE STATS", badge_defensive: "DEFENSIVE STATS", badge_pvp: "PVP STATS",
  badge_active: "ACTIVE SKILLS", badge_passive: "PASSIVE SKILLS", badge_possible_skills: "POSSIBLE SKILLS (PASSIVE/ACTIVE)",
  set_effect: (name) => `Set: ${name}`, set_effect_fallback: "Set Effect",
  search: "Search…", sort_by: "SORT BY", only_equipped: "Only equipped items", only_favorites: "Only favorites",
  level_prefix: (level) => `Lvl. ${level}`, on_priority: "On the Priority List", view_block: "Block", view_row: "Row",
  col_name: "Name", rarity: "Rarity", choose_item: "Choose item",
  equip_priority_hint: "Set an acquisition/upgrade order per equipment slot — click a slot to assign an item, and '+' to add another slot.",
  quick_equip_title: "Quick Select: Equipment", race: "Race", gear_type_filter: "Gear Type Filter", item_set: "Item Set",
  default_enchant: "Default Enchant (all slots)", included_slots: "Included Slots", equip: "Equip",
  no_entries: (filter, grade) => `No entries for '${filter}' with rarity '${grade}' found.`, choose_set_first: "Please choose an item set.",
  no_matching: "No matching items found for this selection.", manual_select: "Manual Selection", slot_empty_hint: "No item equipped in this slot",
  default_enchant_slot: "Target enchant for this slot",
  quick_select_result: "Quick Select", quick_equipped_result: (count, missing) => `${count} slot(s) equipped. Not found for: ${missing}.`,
  quick_stats_title: "Quick Select: Properties", gear_mode: "Gear Mode", role: "Role", auto_substats_for: "Automatically set substats for", apply: "Apply",
  substats_auto_set: (slots) => `Substats automatically set for: ${slots}.`,
  details_not_loaded: (slots) => `Item details not loaded yet, please try again shortly for: ${slots}.`,
  editor_title: "Edit Property Priority", reset_default: "Reset to Default", reset_title: "Reset",
  reset_text: (g, r) => `Reset priority for ${g} / ${r} to default?`,
  unsaved_text: "You have unsaved changes. If you continue, they will be lost. Continue anyway?", empty_option: "— (empty) —", saved: "✓ Saved",
  group_weapon: "Weapon / Guard", group_armor: "Armor", group_accessory: "Jewelry", category_ring: "Rings", category_jewelry: "Jewelry",
  category_earring_necklace: "Earrings & Necklace", category_bracelet: "Bracelets",
  role_attacker: "Attacker", role_defender: "Defender", role_support: "Support",
  stat_source: "Source", stat_effect: "Effect", stat_total: "Total", stat_source_wings: "Wings",
  nav_back: "Back to Characters", no_sets: "No Sets",
};

export const SLOT_LABELS = {
  MainHand: "Main Weapon", SubHand: "Guard", Helmet: "Helmet", Shoulder: "Shoulders", Torso: "Chest", Gloves: "Gloves", Pants: "Pants",
  Boots: "Boots", Cloak: "Cloak", Earring1: "Earrings", Earring2: "Earrings", Necklace: "Necklace", Amulet: "Amulet", Ring1: "Rings", Ring2: "Rings",
  Bracelet1: "Bracelet", Bracelet2: "Bracelet", Brooch1: "Brooch", Brooch2: "Brooch", Rune1: "Rune", Rune2: "Rune", Wings1: "Wings",
};
export const QUICK_GEAR_SLOT_LABELS = {
  MainHand: "Main Weapon", SubHand: "Guard", Helmet: "Helmet", Shoulder: "Shoulders", Torso: "Chest", Gloves: "Gloves", Pants: "Pants",
  Boots: "Boots", Cloak: "Cloak", Earring1: "Earring 1", Earring2: "Earring 2", Necklace: "Necklace", Ring1: "Ring 1", Ring2: "Ring 2",
  Bracelet1: "Bracelet 1", Bracelet2: "Bracelet 2",
};

// --- slots ------------------------------------------------------------------
export const SLOT_LAYOUT = [
  ["MainHand", ["Greatsword", "Longsword", "Dagger", "Bow", "Spellbook", "Orb", "Mace", "Staff", "Fist"]],
  ["SubHand", ["Guard"]], ["Helmet", ["Helm"]], ["Shoulder", ["Pauldrons"]], ["Torso", ["Top"]], ["Gloves", ["Gloves"]],
  ["Pants", ["Legs"]], ["Boots", ["Shoes"]], ["Cloak", ["Cloak"]], ["Earring1", ["Earrings"]], ["Earring2", ["Earrings"]],
  ["Necklace", ["Necklace"]], ["Amulet", ["Amulet"]], ["Ring1", ["Ring"]], ["Ring2", ["Ring"]], ["Bracelet1", ["Bracelet"]],
  ["Bracelet2", ["Bracelet"]], ["Brooch1", ["Brooch"]], ["Brooch2", ["Brooch"]], ["Rune1", ["Rune"]], ["Rune2", ["Rune"]],
  ["Wings1", ["Wings Equip"]],
];
export const SLOT_CATEGORIES = Object.fromEntries(SLOT_LAYOUT);
export const LEFT_SECTIONS = [
  [T.section_weapon, ["MainHand", "SubHand"]],
  [T.section_armor, ["Helmet", "Shoulder", "Torso", "Gloves", "Pants", "Boots", "Cloak"]],
  [T.section_wings, ["Wings1"]],
];
export const RIGHT_SECTIONS = [
  [T.section_accessory, ["Earring1", "Earring2", "Necklace", "Amulet", "Ring1", "Ring2", "Bracelet1", "Bracelet2", "Rune1", "Rune2"]],
];
export const SLOT_PLACEHOLDER = {
  MainHand: "weapon", SubHand: "guard", Helmet: "helm", Shoulder: "pauldrons", Torso: "top", Gloves: "gloves", Pants: "legs", Boots: "shoes",
  Earring1: "earrings_1", Earring2: "earrings_2", Necklace: "necklace", Amulet: "amulet", Ring1: "ring_1", Ring2: "ring_2",
  Bracelet1: "bracelet_1", Bracelet2: "bracelet_2", Wings1: "wings", Cloak: "cloak",
};
export const EQUIP_PRIORITY_SECTIONS = [
  ["weapon", T.section_weapon, ["Greatsword", "Longsword", "Dagger", "Bow", "Spellbook", "Orb", "Mace", "Staff", "Fist"]],
  ["guard", "Guard", ["Guard"]], ["helm", "Helmet", ["Helm"]], ["shoulder", "Shoulders", ["Pauldrons"]], ["torso", "Chest", ["Top"]],
  ["gloves", "Gloves", ["Gloves"]], ["legs", "Pants", ["Legs"]], ["shoes", "Boots", ["Shoes"]], ["cloak", "Cloak", ["Cloak"]],
  ["earrings", "Earrings", ["Earrings"]], ["necklace", "Necklace", ["Necklace"]], ["ring", "Rings", ["Ring"]],
];
export const EQUIP_PRIORITY_MAX_ITEMS = 5;

export const CLASS_WEAPON_CATEGORY = {
  Gladiator: "Greatsword", Templar: "Longsword", Assassin: "Dagger", Ranger: "Bow", Sorcerer: "Spellbook", Spiritmaster: "Orb",
  Cleric: "Mace", Chanter: "Staff", Brawler: "Fist",
};
export const ACTIVE_SUBSKILL_SLOT_CATEGORIES = new Set(["Greatsword", "Longsword", "Dagger", "Bow", "Spellbook", "Orb", "Mace", "Staff", "Fist", "Guard", "Ring"]);
export const RARITY_ORDER = ["Common", "Rare", "Legend", "Unique", "Epic"];
export const RARITY_RANK = Object.fromEntries(RARITY_ORDER.map((g, i) => [g, i]));
export const GRADE_COLORS = { Common: "#94a3b8", Rare: "#4ade80", Unique: "#facc15", Epic: "#f59e0b", Legend: "#38bdf8" };
export const ROLE_COLORS = { Angreifer: "#fb923c", Verteidiger: "#60a5fa", Support: "#4ade80" };
export const ROLE_LABELS = { Angreifer: T.role_attacker, Verteidiger: T.role_defender, Support: T.role_support };
export const AION2_RACES = ["Elyos", "Asmodae"];

const SKILLS_DATA_CLASS_ALIASES = { spiritmaster: "elementalist" };
export const skillsClassKey = (displayName) => { const key = String(displayName || "").trim().toLowerCase(); return SKILLS_DATA_CLASS_ALIASES[key] || key; };

// --- stat rows (name, stat id | null) ---------------------------------------
export const MAIN_STAT_ROWS = [
  ["Attack", "WeaponFixingDamage"], ["Attack increase", "DamageRatio"], ["Accuracy", "WeaponAccuracy"], ["Critical Hit", "Critical"],
  ["HP", "HPMax"], ["Combat Speed", "CombatSpeed"], ["Cooldown", "CooldownReduction"], ["Smite", "HardHit"],
  ["Perfect Chance", "PerfectChance"], ["Multi-hit Chance", "AdditionalHitRate"],
];
export const MOVEMENT_STAT_ROWS = [["Move Speed", "MoveSpeed"], ["Stamina", null], ["Flight Power", "FPMax"]];
export const SUB_STAT_ROWS = [["Defense", "ArmorDefense"], ["Evasion", "ArmorEvasion"], ["Critical Hit Resist", "CriticalResist"], ["MP", "MPMax"]];
export const OFFENSE_STAT_ROWS = [
  ["Max Attack", "MaxAttack"], ["Attack Bonus", "AttackBonus"], ["Critical Attack", "CriticalAttack"], ["Back Attack", "BackAttack"],
  ["Front Attack", "FrontAttack"], ["Back Attack Critical Hit", "BackAttackCriticalHit"], ["Front Attack Critical Hit", "FrontAttackCriticalHit"],
  ["Damage Boost", "AmplifyAllDamage"], ["Weapon Damage Boost", "AmplifyWeaponDamage"], ["Critical Damage Boost", "AmplifyCriticalDamage"],
  ["Back Attack Damage Boost", "AmplifyBackAttack"], ["Front Attack Damage Boost", "AmplifyFrontAttack"], ["Accuracy Bonus", "AccuracyBonus"],
  ["Accuracy increase", "AccuracyIncrease"], ["Critical Hit increase", "CriticalHitIncrease"],
];
export const DEFENSE_STAT_ROWS = [
  ["Defense Bonus", "DefenseBonus"], ["Critical Damage Defense", "CriticalDamageDefense"], ["Back Defense", "BackDefense"], ["Front Defense", "FrontDefense"],
  ["Evasion Bonus", "EvasionBonus"], ["Evasion increase", "EvasionIncrease"], ["Critical Hit Resist increase", "CriticalHitResistIncrease"],
  ["Back Attack Critical Hit Resist", "BackAttackCriticalHitResist"], ["Front Attack Critical Hit Resist", "FrontAttackCriticalHitResist"],
  ["Block", "Block"], ["Block increase", "BlockIncrease"], ["Block Penetration", "BlockPierce"], ["Multi-hit Resist", "AdditionalHitResistRate"],
  ["Parry Damage Reduction Amount", null], ["Parry Damage Reduction Rate", null], ["Defense increase", "DefenseRatio"], ["Endurance", "IronWall"],
  ["Regeneration", "Restoration"], ["Damage Tolerance", "DamageTolerance"], ["Weapon Damage Tolerance", "WeaponDamageTolerance"],
  ["Critical Damage Tolerance", "CriticalDamageTolerance"], ["Back Attack Damage Tolerance", "BackAttackDamageTolerance"],
  ["Front Attack Damage Tolerance", "FrontAttackDamageTolerance"],
];
export const UTILITY_RECOVERY_STAT_ROWS = [
  ["Natural HP Regen", "HPRegen"], ["Natural MP Regen", "MPRegen"], ["Natural Flight Power Regen", "FPRegen"], ["Natural Stamina Regen", "SPRegen"],
  ["HP Potion Recovery increase", "HpPotionRate"], ["Incoming Heal", "AmplifyHpHealGet"], ["HP increase", "HPIncrease"], ["MP increase", "MPIncrease"],
  ["MP Cost", "MPCostReduction"], ["Power Shard Damage Bonus", "SealStoneAddDamage"],
];
export const GENIUS_BOARD_STAT_ROWS = [
  ["Cogni Damage Boost", "CogniDamageBoost"], ["Fera Damage Boost", "FeraDamageBoost"], ["Natura Damage Boost", "NaturaDamageBoost"],
  ["Varian Damage Boost", "VarianDamageBoost"], ["Cogni Damage Tolerance", "CogniDamageTolerance"], ["Fera Damage Tolerance", "FeraDamageTolerance"],
  ["Natura Damage Tolerance", "NaturaDamageTolerance"], ["Varian Damage Tolerance", "VarianDamageTolerance"],
];
export const PVE_MODE_STAT_ROWS = [
  ["PvE Attack", "PvEAttack"], ["PvE Defense", "PvEDefense"], ["PvE Accuracy", "PvEAccuracy"], ["PvE Evasion", "PvEEvasion"],
  ["PvE Damage Boost", "PvEAmplifyDamage"], ["PvE Damage Tolerance", "PvEDecreaseDamage"], ["Boss Attack", "BossAttack"], ["Boss Defense", "BossNpcDefense"],
  ["Boss Damage Boost", "BossNpcAmplifyDamage"], ["Boss Damage Tolerance", "BossNpcDecreaseDamage"],
];
export const PVP_MODE_STAT_ROWS = [
  ["PvP Attack", "PvPAddDamage"], ["PvP Defense", "PvPDamageDefense"], ["PvP Accuracy", "PvPAccuracy"], ["PvP Evasion", "PvPEvasion"],
  ["PvP Critical Hit", "PvPCritical"], ["PvP Critical Hit Resist", "PvPCriticalResist"], ["PvP Damage Boost", "PvPAmplifyDamage"],
  ["PvP Damage Tolerance", "PvPDecreaseDamage"], ["PvP Block", "PvPBlock"], ["PvP Block Penetration", "PvPBlockPierce"], ["Penetration", "DefensePierce"],
  ["Regeneration Penetration", "RegenerationPenetration"], ["Endurance Penetration", "EndurancePenetration"], ["Smite Resist", "HardHitResist"],
  ["Perfect Resist", "PerfectResist"],
];
const STATUS_EFFECTS = ["Stun", "Knockdown", "Airborne", "Grab", "Fear", "Sleep", "Polymorph", "Taunt", "Seal", "Frost", "Paralyze", "Root", "Blind", "Lethargy", "Slow", "Poison", "Bleed"];
export const STATUS_CHANCE_STAT_ROWS = [
  ["Status Effect Chance", "AbnormalAccuracy"], ["Ailment-type Chance", "BodyPropertyAccuracy"], ["Mental-type Chance", "MentalPropertyAccuracy"],
  ["Impact-type Chance", "ShockPropertyAccuracy"], ...STATUS_EFFECTS.map((e) => [`${e} Chance`, null]),
];
export const STATUS_RESIST_STAT_ROWS = [
  ["Status Effect Resist", "AbnormalResistance"], ["Ailment-type Resist", "BodyPropertyResist"], ["Mental-type Resist", "MentalPropertyResist"],
  ["Impact-type Resist", "ShockPropertyResist"], ...STATUS_EFFECTS.map((e) => [`${e} Resist`, null]),
];
export const STAT_COMPARE_CATEGORIES = [
  ["main", T.main_stats, [...MAIN_STAT_ROWS, ["MP", "MPMax"]]],
  ["offense", T.offense, OFFENSE_STAT_ROWS],
  ["defense", T.defense, [["Defense", "ArmorDefense"], ["Evasion", "ArmorEvasion"], ["Critical Hit Resist", "CriticalResist"], ...DEFENSE_STAT_ROWS]],
  ["utility", T.utility, UTILITY_RECOVERY_STAT_ROWS],
  ["pve_mode", T.pve_stats, PVE_MODE_STAT_ROWS],
  ["pvp_mode", T.pvp_stats, PVP_MODE_STAT_ROWS],
];

export const PERCENT_STAT_IDS = new Set([
  "CombatSpeed", "PvEAmplifyDamage", "PvPAmplifyDamage", "PvEDecreaseDamage", "PvPDecreaseDamage", "AmplifyAllDamage", "AbnormalAccuracy",
  "AdditionalHitRate", "AmplifyWeaponDamage", "AbnormalResistance", "AmplifyCriticalDamage", "HardHit", "HardHitResist", "AmplifyBackAttack",
  "AmplifyFrontAttack", "AdditionalHitResistRate", "BlockPierce", "PvPBlockPierce", "HpPotionRate", "BodyPropertyAccuracy", "MentalPropertyAccuracy",
  "ShockPropertyAccuracy", "BodyPropertyResist", "MentalPropertyResist", "ShockPropertyResist", "BossNpcAmplifyDamage", "BossNpcDecreaseDamage",
  "DamageRatio", "DefenseRatio", "PerfectChance", "DamageTolerance", "WeaponDamageTolerance", "CriticalDamageTolerance", "BackAttackDamageTolerance",
  "FrontAttackDamageTolerance", "CogniDamageBoost", "FeraDamageBoost", "NaturaDamageBoost", "VarianDamageBoost", "CogniDamageTolerance",
  "FeraDamageTolerance", "NaturaDamageTolerance", "VarianDamageTolerance", "AccuracyIncrease", "CriticalHitIncrease", "EvasionIncrease",
  "CriticalHitResistIncrease", "BlockIncrease", "CooldownReduction", "MPCostReduction", "RegenerationPenetration", "EndurancePenetration",
  "PerfectResist", "HPIncrease", "MPIncrease", "MoveSpeed", "HealBoost", "DoubleChance", "HealReduce", "MaxHPProcPct", "InstantHealMaxHPPct",
  "IncomingHealPct", "EnduranceIncreasePct", "SplitPct", "DefenseReduce", "StatusResistReduce", "CriticalDamageBoost", "BackAttackDamageBoost",
  "MoveSpeedOnHit", "SpiritHealPct",
]);

export const LORD_POINTS_STAT_ID = {
  Death: "DeathLordPoints", Destiny: "DestinyLordPoints", Destruction: "DestructionLordPoints", Freedom: "FreedomLordPoints",
  Illusion: "IllusionLordPoints", Justice: "JusticeLordPoints", Life: "LifeLordPoints", Space: "SpaceLordPoints", Time: "TimeLordPoints", Wisdom: "WisdomLordPoints",
};
export const LORD_POINTS_ID_TO_LORD = Object.fromEntries(Object.entries(LORD_POINTS_STAT_ID).map(([k, v]) => [v, k]));
export const STAT_ICON_ROWS = [
  [["Might", "str", "STR"], ["Dexterity", "dex", "DEX"], ["Precision", "agi", "AGI"], ["Willpower", "wis", "WIS"], ["Intelligence", "int", "INT"], ["Constitution", "con", "CON"]],
  [["Death", "lords_death", "DeathLordPoints"], ["Destiny", "lords_destiny", "DestinyLordPoints"], ["Destruction", "lords_destruction", "DestructionLordPoints"],
    ["Freedom", "lords_freedom", "FreedomLordPoints"], ["Illusion", "lords_illusion", "IllusionLordPoints"], ["Justice", "lords_justice", "JusticeLordPoints"]],
  [["Life", "lords_life", "LifeLordPoints"], ["Space", "lords_space", "SpaceLordPoints"], ["Time", "lords_time", "TimeLordPoints"], ["Wisdom", "lords_wisdom", "WisdomLordPoints"]],
];
export const ATTRIBUTE_RATE = 0.1;
export const ATTRIBUTE_STAT_IDS = {
  STR: ["DamageRatio"], DEX: ["EvasionIncrease", "BlockIncrease", "CriticalHitResistIncrease"], AGI: ["AccuracyIncrease", "CriticalHitIncrease"],
  WIS: ["AbnormalResistance"], INT: ["AbnormalAccuracy"], CON: ["HPIncrease"],
};
export const ATTRIBUTE_ID_DISPLAY_NAME = { STR: "Might", DEX: "Dexterity", AGI: "Precision", WIS: "Willpower", INT: "Intelligence", CON: "Constitution" };
export const ARCANA_LORD_RATE = 0.2;
export const ARCANA_LORD_STAT_IDS = {
  Time: ["CombatSpeed", "HardHitResist"], Space: ["MoveSpeed", "BlockIncrease"], Justice: ["DefenseRatio", "PerfectChance"],
  Freedom: ["AccuracyIncrease", "EvasionIncrease"], Illusion: ["CooldownReduction", "EndurancePenetration"], Life: ["HPIncrease", "Restoration"],
  Destiny: ["MPIncrease", "IronWall"], Wisdom: ["MPCostReduction", "HardHit"], Death: ["CriticalHitIncrease", "RegenerationPenetration"],
  Destruction: ["DamageRatio", "PerfectResist"],
};

function buildStatIdDisplayNames() {
  const names = {};
  for (const rows of [MAIN_STAT_ROWS, MOVEMENT_STAT_ROWS, SUB_STAT_ROWS, OFFENSE_STAT_ROWS, DEFENSE_STAT_ROWS, UTILITY_RECOVERY_STAT_ROWS,
    GENIUS_BOARD_STAT_ROWS, PVE_MODE_STAT_ROWS, PVP_MODE_STAT_ROWS, STATUS_CHANCE_STAT_ROWS, STATUS_RESIST_STAT_ROWS]) {
    for (const [name, sid] of rows) if (sid && !(sid in names)) names[sid] = name;
  }
  return names;
}
export const STAT_ID_DISPLAY_NAME = buildStatIdDisplayNames();

// --- quick select / priority editor tables ------------------------------------
export const RACE_TIER_ROOT = { Elyos: "True Dragon Lord", Asmodae: "Star Dragon Lord" };
export const RACE_EPIC_TIER_ROOT = { Elyos: "Noble Dragon Lord", Asmodae: "Horned Dragon Lord" };
export const ABYSS_GEAR_RACE_PREFIX = { Elyos: "Guardian", Asmodae: "Archon" };
export const QUICK_GEAR_SLOT_WORDS = {
  SubHand: "Guard", Helmet: "Helm", Shoulder: "Pauldrons", Torso: "Breastplate", Gloves: "Gloves", Pants: "Greaves", Boots: "Boots", Cloak: "Cloak",
  Earring1: "Earrings", Earring2: "Earrings", Necklace: "Necklace", Ring1: "Ring", Ring2: "Ring", Bracelet1: "Bracelet", Bracelet2: "Bracelet",
};
export const QUICK_GEAR_CATEGORY_GROUPS = [
  ["weapon", T.group_weapon, ["MainHand", "SubHand"]],
  ["armor", T.group_armor, ["Helmet", "Shoulder", "Torso", "Gloves", "Pants", "Boots", "Cloak"]],
  ["accessory", T.group_accessory, ["Earring1", "Earring2", "Necklace", "Ring1", "Ring2"]],
  ["bracelet", T.category_bracelet, ["Bracelet1", "Bracelet2"]],
];
export const CRAFTING_WEAPON_NAMES = {
  "Corroded Sovereign's": {
    Greatsword: "Corroded Sovereign's Raptorial Greatsword", Longsword: "Corroded Sovereign's Cinderblade", Dagger: "Corroded Sovereign's Malice",
    Bow: "Corroded Sovereign's Cinderbow", Spellbook: "Corroded Sovereign's Blazebloom", Orb: "Corroded Sovereign's Crimson Blazestone",
    Mace: "Corroded Sovereign's Searing Mallet", Staff: "Corroded Sovereign's Searing Staff", Fist: "Corroded Sovereign's Blazestone Fist",
    Guard: "Corroded Sovereign's Chains",
  },
  "Lava Heart": {
    Greatsword: "Lava Heart Terrorblade", Longsword: "Lava Heart Flamesword", Dagger: "Lava Heart Deathblade", Bow: "Lava Heart Flamebow",
    Spellbook: "Lava Heart Tome", Orb: "Lava Heart Voidgem", Mace: "Lava Heart Firemace", Staff: "Lava Heart Flamestaff", Fist: "Lava Heart Gauntlet",
    Guard: "Lava Heart Barrier",
  },
};
export const ENCHANT_REFERENCE_SLOTS = ["Ring1", "Helmet", "MainHand", "SubHand", "Necklace", "Bracelet1"];
export const GEAR_TYPE_TO_QUICK_SELECT_TAGS = { PvE: ["Crafting"], PvP: ["Abyss Gear"], Neutral: ["Expedition", "Sanctuary"] };
export const QUICK_GEAR_ENCHANT_DEFAULTS = { Common: 0, Rare: 5, Legend: 15, Unique: 20, Epic: 25 };

export const STAT_PRIORITY_CATEGORIES = [
  ["weapon", T.group_weapon, ["MainHand", "SubHand"]], ["helmet", "Helmet", ["Helmet"]], ["shoulder", "Shoulders", ["Shoulder"]],
  ["torso", "Chest", ["Torso"]], ["gloves", "Gloves", ["Gloves"]], ["pants", "Pants", ["Pants"]], ["boots", "Boots", ["Boots"]],
  ["cloak", "Cloak", ["Cloak"]], ["ring", T.category_ring, ["Ring1", "Ring2"]], ["jewelry", T.category_earring_necklace, ["Earring1", "Earring2", "Necklace"]],
  ["bracelet", T.category_bracelet, ["Bracelet1", "Bracelet2"]],
];
export const SLOT_TO_STAT_CATEGORY = Object.fromEntries(STAT_PRIORITY_CATEGORIES.flatMap(([key, , slots]) => slots.map((s) => [s, key])));
export const STAT_PRIORITY_GROUPS = [
  ["weapon_guard", T.group_weapon, ["weapon"]],
  ["armor", T.group_armor, ["helmet", "shoulder", "torso", "gloves", "pants", "boots", "cloak"]],
  ["jewelry", T.category_jewelry, ["ring", "jewelry", "bracelet"]],
];
const CATEGORY_TO_GROUP_LABEL = Object.fromEntries(STAT_PRIORITY_GROUPS.flatMap(([, label, cats]) => cats.map((c) => [c, label])));
export const SLOT_TO_GROUP_LABEL = Object.fromEntries(Object.entries(SLOT_TO_STAT_CATEGORY).map(([slot, cat]) => [slot, CATEGORY_TO_GROUP_LABEL[cat] || cat]));
export const STAT_PRIORITY_CATEGORY_SKILL_TYPES = {
  weapon: ["active"], ring: ["active"], jewelry: ["passive"], helmet: ["passive"], shoulder: ["passive"], torso: ["passive"],
  gloves: ["passive"], pants: ["passive"], boots: ["passive"], cloak: ["passive"],
};
export const STAT_PRIORITY_CATEGORY_ORDER_OVERRIDE = {
  bracelet: ["Wisdom [Lumiel]", "Time [Siel]", "Illusion [Kaisinel]", "Destruction [Zikel]", "Death [Triniel]", "Freedom [Vaizel]", "Justice [Nezekan]"],
};

// --- small helpers -----------------------------------------------------------
export function roundHalfEven(x) {
  const f = Math.floor(x);
  const d = x - f;
  if (d < 0.5) return f;
  if (d > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}
export function formatNumber(value, decimals = 0) {
  if (decimals) return Number(value).toFixed(decimals);
  return String(roundHalfEven(Number(value) || 0));
}
export function shortName(name, maxLen = 12) {
  name = name || "";
  return name.length <= maxLen ? name : name.slice(0, maxLen - 1).trimEnd() + "…";
}
export function escapeHtml(text) {
  return String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
export function gearTypeOf(item) {
  const options = (item && item.options) || [];
  if (!options.length) return "";
  if (options.some((o) => o.includes("PvP"))) return "PvP";
  if (options.some((o) => o.includes("PvE"))) return "PvE";
  return "Neutral";
}
const PVP_STAT_HINTS = ["abnormal", "pvp", "suppress", "resil", "tenacity", "resist"];
const DEFENSIVE_STAT_HINTS = ["defense", "evasion", "hpmax", "mpmax", "block"];
export function classifyStat(statId) {
  const sid = (statId || "").toLowerCase();
  if (PVP_STAT_HINTS.some((h) => sid.includes(h))) return "pvp";
  if (DEFENSIVE_STAT_HINTS.some((h) => sid.includes(h))) return "defensive";
  return "offensive";
}

// --- catalog extras ----------------------------------------------------------
export const RUNE_EXTRA_ITEMS = [
  { id: RUNE_PVE_ITEM_ID, name: "Clash Rune", image: "https://assets.playnccdn.com/static-aion2-gamedata/resources/Icon_Acc_Rune_R_002.png", grade: "Special",
    options: ["Combat Speed 1%", "Penetration 100", "Multi-hit Chance 1%", "PvE Damage Boost 0.5%", "PvE Damage Tolerance 0.5%"], favorite: false, tradable: false, categoryName: "Rune" },
  { id: RUNE_PVP_ITEM_ID, name: "Devotion Rune", image: "https://assets.playnccdn.com/static-aion2-gamedata/resources/Icon_Acc_Rune_R_004.png", grade: "Special",
    options: ["Combat Speed 1%", "Penetration 100", "Multi-hit Chance 1%", "PvP Damage Boost 0.5%", "PvP Damage Tolerance 0.5%"], favorite: false, tradable: false, categoryName: "Rune" },
];
export const SYNTHETIC_SLOT_PLACEHOLDER_ITEM = { Rune1: RUNE_EXTRA_ITEMS[0], Rune2: RUNE_EXTRA_ITEMS[1] };
const EXCLUDED_ITEM_NAME_PREFIXES = ["Ancient Spirit "];

const WINGS_STAT_ID_MAP = {
  fpmax: "FPMax", hardhit: "HardHit", defensepierce: "DefensePierce", hpregen: "HPRegen", mpregen: "MPRegen", mpusedecrease: "MPCostReduction",
  amplifyfrontattack: "AmplifyFrontAttack", amplifyhphealget: "AmplifyHpHealGet", backattackdamage: "BackAttack",
  backattackcriticalresist: "BackAttackCriticalHitResist", frontattackdefense: "FrontDefense", decreasedamage: "DamageTolerance",
  amplifyweapondamage: "AmplifyWeaponDamage", defense: "DefenseBonus", evasion: "EvasionBonus", accuracy: "WeaponAccuracy", block: "Block",
  criticalresist: "CriticalResist", hpmax: "HPMax", mpmax: "MPMax", perfect: "PerfectChance", bossnpcadddamage: "BossAttack",
  bossnpcdefense: "BossNpcDefense", fixingdamage: "WeaponFixingDamage", pvedamagedefense: "PvEDefense", amplifyalldamage: "AmplifyAllDamage",
};
const WINGS_STAT_SCALE_100 = new Set(["fpmax", "decreasedamage", "perfect", "amplifyalldamage", "mpusedecrease", "amplifyweapondamage", "amplifyfrontattack", "amplifyhphealget"]);
export const WINGS_STAT_IS_PERCENT = new Set(["DamageTolerance", "PerfectChance", "AmplifyAllDamage", "MPCostReduction", "AmplifyWeaponDamage", "AmplifyFrontAttack", "AmplifyHpHealGet"]);
export const WINGS_STAT_DISPLAY = {
  FPMax: "Flight Power", HardHit: "Smite", DefensePierce: "Penetration", HPRegen: "Natural HP Regen", MPRegen: "Natural MP Regen",
  MPCostReduction: "MP Cost", AmplifyFrontAttack: "Front Attack Damage Boost", AmplifyHpHealGet: "Incoming Heal", BackAttack: "Back Attack",
  BackAttackCriticalHitResist: "Back Attack Critical Hit Resist", FrontDefense: "Front Defense", DamageTolerance: "Damage Tolerance",
  AmplifyWeaponDamage: "Weapon Damage Boost", DefenseBonus: "Defense Bonus", EvasionBonus: "Evasion Bonus", WeaponAccuracy: "Accuracy", Block: "Block",
  CriticalResist: "Critical Hit Resist", HPMax: "HP", MPMax: "MP", PerfectChance: "Perfect Chance", BossAttack: "Boss Attack",
  BossNpcDefense: "Boss Defense", WeaponFixingDamage: "Attack", PvEDefense: "PvE Defense", AmplifyAllDamage: "Damage Boost",
};
const WINGS_EQUIP_EFFECT_ID_MAP = {
  "Accuracy Bonus": "AccuracyBonus", "Attack Bonus": "AttackBonus", Block: "Block", "Block Penetration": "BlockPierce", "Boss Attack": "BossAttack",
  "Boss Damage Boost": "BossNpcAmplifyDamage", "Boss Damage Tolerance": "BossNpcDecreaseDamage", "Boss Defense": "BossNpcDefense",
  "Cooldown Reduction": "CooldownReduction", "Critical Attack": "CriticalAttack", "Critical Hit": "Critical", "Criticial Hit": "Critical",
  "Critical Hit Resist": "CriticalResist", "Damage Boost": "AmplifyAllDamage", "Defense Bonus": "DefenseBonus", Endurance: "IronWall",
  "Evasion Bonus": "EvasionBonus", "Frontal Attack": "FrontAttack", "Frontal Damage Boost": "AmplifyFrontAttack", "Frontal Defense": "FrontDefense",
  HP: "HPMax", "HP Potion Recovery increase": "HpPotionRate", "Impact-type Chance": "ShockPropertyAccuracy", "Incoming Heal": "AmplifyHpHealGet",
  MP: "MPMax", "MP Cost Reduction": "MPCostReduction", "Max Attack": "MaxAttack", "Natural HP Regen": "HPRegen", "Natural MP Regen": "MPRegen",
  Penetration: "DefensePierce", "Perfect Chance": "PerfectChance", "PvE Accuracy": "PvEAccuracy", "PvE Attack": "PvEAttack",
  "PvE Damage Boost": "PvEAmplifyDamage", "PvE Damage Tolerance": "PvEDecreaseDamage", "PvE Defense": "PvEDefense", Regeneration: "Restoration",
  "Status Effect Chance": "AbnormalAccuracy", "Status Effect Resist": "AbnormalResistance",
};
const WINGS_GRADE_MAP = { 11: "Common", 21: "Rare", 31: "Legend", 41: "Unique" };
const WING_EFFECT_RE = /\[Equip(?:ped)? Effect\]([\s\S]*?)\[Owned Effect\]([\s\S]*)/;

export function parseWingEffectLines(description) {
  const match = WING_EFFECT_RE.exec(description || "");
  if (!match) return [[], []];
  const lines = (block) => block.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return [lines(match[1]), lines(match[2])];
}
export function stripWingsRaceSuffix(name) {
  for (const suffix of [" (Elyos)", " (Asmodae)"]) if (name.endsWith(suffix)) return name.slice(0, -suffix.length);
  return name;
}
function parseWingsEquipEffectStats(lines) {
  const stats = {};
  for (const line of lines) {
    const at = line.lastIndexOf(":");
    if (at < 0) continue;
    const statId = WINGS_EQUIP_EFFECT_ID_MAP[line.slice(0, at).trim()];
    if (!statId) continue;
    const value = parseFloat(line.slice(at + 1).trim().replace(/%$/, ""));
    if (Number.isNaN(value)) continue;
    stats[statId] = (stats[statId] || 0) + value;
  }
  return stats;
}

// --- data --------------------------------------------------------------------
export const data = {
  loaded: false, items: [], itemsById: {}, nameToItem: {}, dungeonSets: {}, statPriorityOptions: {}, skillsByClass: {},
  wingsStats: {}, wingsEquipLines: {}, index: {}, recipes: null,
};
let loading = null;

async function fetchJson(path) {
  const response = await fetch(path, { cache: "force-cache" });
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return response.json();
}

export function loadData() {
  if (loading) return loading;
  loading = (async () => {
    const [catalog, dungeonSets, statOptions, skills, wings, index] = await Promise.all([
      fetchJson("data/items_all.json"), fetchJson("data/dungeon_sets.json").catch(() => ({})), fetchJson("data/stat_priority_options.json").catch(() => ({})),
      fetchJson("data/skills_all.json").catch(() => ({ skills: [] })), fetchJson("data/wings_items.json").catch(() => []), fetchJson("data/details_index.json").catch(() => ({})),
    ]);
    const raw = Array.isArray(catalog) ? catalog : catalog.items || [];
    const seen = new Set();
    const items = [];
    for (const item of [...raw, ...RUNE_EXTRA_ITEMS]) {
      if (EXCLUDED_ITEM_NAME_PREFIXES.some((p) => (item.name || "").startsWith(p))) continue;
      const key = `${item.name}|${item.grade}|${(item.options || []).join("\u0001")}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(item);
    }
    const wingsStats = {};
    for (const entry of wings) {
      const levelZero = (entry.levels || []).find((lv) => lv.level === 0);
      if (!levelZero) continue;
      const stats = {};
      for (const [rawKey, value] of Object.entries(levelZero.stats || {})) {
        const statId = WINGS_STAT_ID_MAP[rawKey];
        if (!statId) continue;
        stats[statId] = (stats[statId] || 0) + (WINGS_STAT_SCALE_100.has(rawKey) ? value / 100 : value);
      }
      if (Object.keys(stats).length) wingsStats[String(entry.id)] = stats;
    }
    for (const entry of wings) {
      if (!entry.id) continue;
      const stats = wingsStats[String(entry.id)] || {};
      const options = Object.entries(stats).map(([sid, v]) => `${sid}: ${formatNumber(v)}`);
      const texture = String(entry.icon || "").split(".").pop();
      items.push({
        id: Number(entry.id), name: (entry.name || "Wings") + ({ light: " (Elyos)", dark: " (Asmodae)" }[entry.race] || ""),
        image: `https://assets.playnccdn.com/static-aion2-gamedata/resources/${texture}.png`, grade: WINGS_GRADE_MAP[entry.grade] || "",
        options: options.length ? options : ["Wings"], favorite: false, tradable: false, categoryName: "Wings Equip",
      });
    }
    const shugoWings = raw.filter((it) => ["Wings", "Wings Unlocking Item"].includes(it.categoryName || ""));
    const wingsEquipLines = {};
    for (const entry of wings) {
      const name = entry.name || "";
      if (!name || name in wingsEquipLines) continue;
      const candidates = shugoWings.filter((it) => (it.name || "").includes(name));
      if (!candidates.length) continue;
      const best = candidates.reduce((a, b) => ((b.name || "").length < (a.name || "").length ? b : a));
      const [equipLines] = parseWingEffectLines(best.description || "");
      if (equipLines.length) wingsEquipLines[name] = equipLines;
    }
    const skillsByClass = {};
    for (const s of skills.skills || []) {
      const cat = (s.mainCategory || "").trim().toLowerCase();
      if (cat) (skillsByClass[cat] || (skillsByClass[cat] = [])).push(s);
    }
    Object.assign(data, {
      loaded: true, items, itemsById: Object.fromEntries(items.map((it) => [it.id, it])),
      nameToItem: Object.fromEntries(items.filter((it) => it.name).map((it) => [it.name, it])),
      dungeonSets, statPriorityOptions: statOptions, skillsByClass, wingsStats, wingsEquipLines, index,
    });
    return data;
  })();
  return loading;
}

let recipesLoading = null;
export function loadRecipes() {
  if (!recipesLoading) recipesLoading = fetchJson("data/recipes_all.json").then((payload) => { data.recipes = payload; return payload; });
  return recipesLoading;
}

// --- per-item details --------------------------------------------------------
export const detailCache = new Map();
const pending = new Set();
const detailListeners = new Set();
export function onDetailReady(fn) { detailListeners.add(fn); return () => detailListeners.delete(fn); }

export function requestDetail(itemId) {
  if (!itemId || detailCache.has(itemId) || pending.has(itemId)) return;
  pending.add(itemId);
  fetch(`data/details/${itemId}.json`, { cache: "force-cache" })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
    .then((detail) => {
      pending.delete(itemId);
      detailCache.set(itemId, detail && typeof detail === "object" ? detail : null);
      for (const fn of detailListeners) fn(itemId);
    });
}
export function requestDetails(equipped) { for (const item of Object.values(equipped || {})) if (item && item.id) requestDetail(item.id); }

export const provider = { get: (id) => detailCache.get(id) || null };
// GearScore only needs level + maxEnchantLevel, which the compact index has
// for every equipment item, so the score never waits on a detail fetch.
export const scoreProvider = {
  get(id) {
    const detail = detailCache.get(id);
    if (detail) return detail;
    const row = data.index[String(id)];
    return row ? { level: row[0], maxEnchantLevel: row[2] } : null;
  },
};

// --- totals ------------------------------------------------------------------
export function substatSets(substats) {
  return Object.fromEntries(Object.entries(substats || {}).map(([slot, list]) => [slot, new Set(list instanceof Set ? [...list] : list || [])]));
}

export function wingsTotalsFor(equipped) {
  const item = (equipped || {}).Wings1;
  if (!item) return {};
  const totals = { ...(data.wingsStats[String(item.id || "")] || {}) };
  const lines = data.wingsEquipLines[stripWingsRaceSuffix(item.name || "")] || [];
  for (const [sid, value] of Object.entries(parseWingsEquipEffectStats(lines))) totals[sid] = (totals[sid] || 0) + value;
  return totals;
}

export function attributeDerivedDetailed(baseTotals) {
  const derived = {};
  const byAttr = {};
  for (const [attrId, statIds] of Object.entries(ATTRIBUTE_STAT_IDS)) {
    const value = baseTotals[attrId] || 0;
    if (!value) continue;
    const pct = value * ATTRIBUTE_RATE;
    const attrName = ATTRIBUTE_ID_DISPLAY_NAME[attrId] || attrId;
    for (const sid of statIds) {
      derived[sid] = (derived[sid] || 0) + pct;
      (byAttr[sid] || (byAttr[sid] = {}))[attrName] = ((byAttr[sid] || {})[attrName] || 0) + pct;
    }
  }
  return [derived, byAttr];
}

// Lord points rolled on gear (Bracelets) feed the Lords' derived %-stats;
// Arcana cards and the Pantheon are not on the web Armory yet.
export function lordDerivedDetailed(equipmentTotals) {
  const totals = {};
  const byLord = {};
  for (const [lord, pointsId] of Object.entries(LORD_POINTS_STAT_ID)) {
    const points = equipmentTotals[pointsId] || 0;
    if (!points) continue;
    const pct = points * ARCANA_LORD_RATE;
    for (const sid of ARCANA_LORD_STAT_IDS[lord] || []) {
      totals[sid] = (totals[sid] || 0) + pct;
      (byLord[sid] || (byLord[sid] = {}))[lord] = ((byLord[sid] || {})[lord] || 0) + pct;
    }
  }
  return [totals, byLord];
}

export function fullBuildTotals(build) {
  const [equipment, bySlot] = computeStatTotalsDetailed(build.equipped || {}, substatSets(build.substats), build.enchant || {}, provider);
  const [attribute, byAttr] = attributeDerivedDetailed(equipment);
  const [lord, byLord] = lordDerivedDetailed(equipment);
  const wings = wingsTotalsFor(build.equipped || {});
  const totals = { ...equipment };
  for (const source of [attribute, lord, wings]) for (const [sid, v] of Object.entries(source)) totals[sid] = (totals[sid] || 0) + v;
  return { totals, equipment, bySlot, byAttr, byLord, wings };
}

export function buildGearscore(build) {
  return computeGearscore(build.equipped || {}, build.enchant || {}, scoreProvider);
}

export const GEAR_STAT_ALIASES = GEAR_STAT_ID_ALIASES;
