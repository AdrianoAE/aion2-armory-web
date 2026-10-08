// node --test tests/enchant.test.mjs — the desktop's golden rows
// (tests/test_armory_engine_golden.py) and ENCHANT_RATES.json
// characterization (tests/test_enchant_model.py) against js/engine/enchant.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as enchant from "../js/engine/enchant.js";

const GOLDEN = JSON.parse(readFileSync(new URL("./fixtures/armory_engine_golden.json", import.meta.url)));
const RATES = JSON.parse(readFileSync(new URL("./fixtures/ENCHANT_RATES.json", import.meta.url)));
const TOL = 1e-9;
const UNIQUE_CURVE_TOLERANCE = 5.0;
const close = (actual, expected, tol = TOL) => assert.ok(Math.abs(actual - expected) <= tol, `${actual} != ${expected}`);
const closeDict = (actual, expected, tol = TOL) => {
  assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort());
  for (const key of Object.keys(expected)) close(actual[key], expected[key], tol);
};

const A_WEAPON = "Weapon", AN_ACCESSORY = "Ring", AN_ARMOR_PIECE = "Top", A_BELT = "Belt";

test("every estimator reproduces its recorded value", () => {
  assert.equal(GOLDEN.enchant.length, 494);
  for (const row of GOLDEN.enchant) {
    const { level, grade, cap, category } = row;
    close(enchant.estimateEnchantBonus(level, grade, cap, category), row.enchant);
    closeDict(enchant.estimateExceedBonus(level, cap, category), row.exceed);
    const armor = enchant.estimateArmorBonus(level, grade, cap, category);
    close(armor[0], row.armor[0]); close(armor[1], row.armor[1]);
    closeDict(enchant.estimateArmorExceedBonus(level, cap), row.armor_exceed);
    close(enchant.gearscorePush(level, cap), row.gearscore_push);
  }
});

test("the rune curve reproduces its recorded value", () => {
  assert.equal(GOLDEN.rune.length, 48);
  for (const row of GOLDEN.rune) closeDict(enchant.runeEnchantBonus(row.item_id, row.level), row.bonus);
});

test("the gearscore rates are the confirmed ones", () => {
  assert.equal(enchant.GEARSCORE_NORMAL_RATE, 1.0);
  assert.equal(enchant.GEARSCORE_EXCEED_RATE, 5.0);
});

// --- ENCHANT_RATES.json characterization ---------------------------------

test("linear weapon grades match the documented rate and cap bonus", () => {
  for (const [grade, spec] of Object.entries(RATES.weapons_and_guard.by_grade)) {
    if (spec.rate_per_level == null) continue;
    for (let level = 1; level <= 20; level++) {
      close(enchant.estimateEnchantBonus(level, grade, spec.cap_level, A_WEAPON), spec.rate_per_level * Math.min(level, spec.cap_level));
    }
    close(enchant.estimateEnchantBonus(spec.cap_level, grade, spec.cap_level, A_WEAPON), spec.bonus_at_cap);
  }
});

test("unique weapon curve reproduces its calibration samples", () => {
  const spec = RATES.weapons_and_guard.by_grade.Unique;
  for (const [level, documented] of [[6, 65], [10, 125], [12, 165], [15, 225]]) {
    close(enchant.estimateEnchantBonus(level, "Unique", spec.cap_level, A_WEAPON), documented, UNIQUE_CURVE_TOLERANCE);
  }
  close(enchant.estimateEnchantBonus(spec.cap_level, "Unique", spec.cap_level, A_WEAPON), spec.bonus_at_cap, UNIQUE_CURVE_TOLERANCE);
});

test("untested grades fall back to the Legend placeholder", () => {
  const legendRate = RATES.weapons_and_guard.by_grade.Legend.rate_per_level;
  for (const grade of ["Common", "Rare", "", "SomethingNew"]) close(enchant.estimateEnchantBonus(10, grade, 15, A_WEAPON), legendRate * 10);
});

test("accessories scale at the grade-independent rate", () => {
  const rate = RATES.accessories.rate_per_level;
  for (const [grade, spec] of Object.entries(RATES.accessories.by_grade)) {
    for (let level = 1; level <= spec.cap_level; level++) close(enchant.estimateEnchantBonus(level, grade, spec.cap_level, AN_ACCESSORY), rate * level);
    close(enchant.estimateEnchantBonus(spec.cap_level, grade, spec.cap_level, AN_ACCESSORY), spec.bonus_at_cap);
  }
  assert.deepEqual([...enchant.ACCESSORY_CATEGORIES].sort(), [...RATES.accessories.categories].sort());
  for (const category of RATES.accessories.categories) close(enchant.estimateEnchantBonus(3, "Heroic", 20, category), 15.0);
});

test("armor scales defense and hp at the documented rates, belt is grade independent", () => {
  for (const [grade, spec] of Object.entries(RATES.armor.by_grade)) {
    for (let level = 1; level <= spec.cap_level; level++) {
      const [def, hp] = enchant.estimateArmorBonus(level, grade, spec.cap_level, AN_ARMOR_PIECE);
      close(def, spec.defense.rate_per_level * level); close(hp, spec.hp.rate_per_level * level);
    }
    assert.deepEqual(enchant.estimateArmorBonus(spec.cap_level, grade, spec.cap_level, AN_ARMOR_PIECE), [spec.defense.bonus_at_cap, spec.hp.bonus_at_cap]);
  }
  for (const [grade, spec] of Object.entries(RATES.belt.by_grade)) {
    assert.equal(spec.cap_level, 10);
    for (let level = 1; level <= spec.cap_level; level++) {
      const [def, hp] = enchant.estimateArmorBonus(level, grade, spec.cap_level, A_BELT);
      close(def, spec.defense.rate_per_level * level); close(hp, spec.hp.rate_per_level * level);
    }
    assert.deepEqual(enchant.estimateArmorBonus(spec.cap_level, grade, spec.cap_level, A_BELT), [spec.defense.bonus_at_cap, spec.hp.bonus_at_cap]);
  }
  assert.deepEqual([...enchant.ARMOR_CATEGORIES].sort(), ["Cloak", "Gloves", "Helm", "Legs", "Pauldrons", "Shoes", "Top"]);
  assert.equal(enchant.BELT_CATEGORY, "Belt");
});

const EVERY_SHAPE = [["Legend", 15, A_WEAPON], ["Unique", 15, A_WEAPON], ["Heroic", 20, A_WEAPON], ["Legend", 15, AN_ACCESSORY], ["Heroic", 20, AN_ACCESSORY]];

test("no bonus at or below level zero, non-decreasing, freezes at the cap", () => {
  for (const [grade, cap, category] of EVERY_SHAPE) {
    for (const level of [0, -1, -20]) {
      assert.equal(enchant.estimateEnchantBonus(level, grade, cap, category), 0.0);
      assert.deepEqual(enchant.estimateArmorBonus(level, grade, cap, AN_ARMOR_PIECE), [0.0, 0.0]);
    }
    const values = Array.from({ length: 31 }, (_, level) => enchant.estimateEnchantBonus(level, grade, cap, category));
    assert.deepEqual(values, [...values].sort((a, b) => a - b));
    const atCap = enchant.estimateEnchantBonus(cap, grade, cap, category);
    for (const level of [cap + 1, cap + 5, cap + 25]) assert.equal(enchant.estimateEnchantBonus(level, grade, cap, category), atCap);
  }
});

test("an unknown cap means no freeze at all", () => {
  close(enchant.estimateEnchantBonus(30, "Legend", 0, A_WEAPON), 300.0);
  assert.deepEqual(enchant.estimateArmorBonus(30, "Unique", 0, AN_ARMOR_PIECE), [900, 600]);
});

test("exceed lines match the documented per-step rates", () => {
  const weapon = RATES.weapons_and_guard.exceed, accessory = RATES.accessories.exceed, armor = RATES.armor.exceed;
  for (let steps = 1; steps <= 5; steps++) {
    const got = enchant.estimateExceedBonus(15 + steps, 15, A_WEAPON);
    close(got.attack, weapon.Attack.per_level * steps); close(got.attack_pct, weapon["Attack increase"].per_level * steps); assert.equal(got.defense, 0.0);
    const acc = enchant.estimateExceedBonus(15 + steps, 15, AN_ACCESSORY);
    close(acc.attack, accessory.Attack.per_level * steps); close(acc.defense, accessory.Defense.per_level * steps); close(acc.attack_pct, accessory["Attack increase"].per_level * steps);
    const arm = enchant.estimateArmorExceedBonus(20 + steps, 20);
    close(arm.defense, armor.Defense.per_level * steps); close(arm.hp, armor.HP.per_level * steps);
    close(arm.defense_pct, armor["Defense increase"].per_level * steps); close(arm.hp_pct, armor["HP increase"].per_level * steps);
  }
  for (const level of [0, 1, 14, 15]) {
    assert.deepEqual(enchant.estimateExceedBonus(level, 15, A_WEAPON), { attack: 0.0, attack_pct: 0.0, defense: 0.0 });
    assert.deepEqual(enchant.estimateArmorExceedBonus(level, 15), { defense: 0.0, defense_pct: 0.0, hp: 0.0, hp_pct: 0.0 });
  }
  assert.equal(enchant.estimateExceedBonus(30, 0, A_WEAPON).attack, 0.0);
  assert.equal(enchant.estimateArmorExceedBonus(30, 0).defense, 0.0);
});

test("gearscore push: zero without enchant, +1 per normal level, +5 per exceed step", () => {
  for (const level of [0, -1, -10]) assert.equal(enchant.gearscorePush(level, 15), 0.0);
  for (let level = 1; level <= 15; level++) close(enchant.gearscorePush(level, 15), level);
  for (let steps = 1; steps <= 10; steps++) close(enchant.gearscorePush(15 + steps, 15), 15.0 + 5.0 * steps);
  assert.equal(enchant.gearscorePush(20, 15), 40.0);
  assert.equal(enchant.gearscorePush(25, 20), 45.0);
  assert.equal(enchant.gearscorePush(30, 0), 30.0);
  const values = Array.from({ length: 31 }, (_, level) => enchant.gearscorePush(level, 15));
  assert.deepEqual(values, [...values].sort((a, b) => a - b));
});
