// node --test tests/score.test.mjs — tests/test_armory_engine_recommend.py
// group 1 (weights, coverage ranking, substat alignment) against
// js/engine/score.js. Expectations are hand-computed, as in the Python.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as score from "../js/engine/score.js";
import * as stats from "../js/engine/stats.js";
import { Reason, Recommendation } from "../js/engine/explain.js";

const F = JSON.parse(readFileSync(new URL("./fixtures/armory_engine_inputs.json", import.meta.url))).reco_inputs;
const close = (a, b, tol = 1e-12) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);
const provider = { get: (id) => F.DETAILS[id] };
const weights = () => score.mergeRoleWeights(F.PROFILE_CATEGORIES);
const names = () => score.displayNames(F.PROFILE_CATEGORIES);
const totals = () => stats.computeStatTotalsDetailed(F.EQUIPPED_AS_ITEMS, F.SUBSTATS, {}, provider);

test("role weights decay geometrically from one", () => {
  const w = score.roleWeights(["Attack", "Critical Hit", "Smite"]);
  assert.deepEqual(Object.keys(w), ["attack", "critical hit", "smite"]);
  assert.equal(w.attack, 1.0); close(w["critical hit"], 0.75); close(w.smite, 0.5625);
});

test("role weights normalize through the substat alias table", () => {
  const w = score.roleWeights(["MOVEMENT SPEED", "  Attack  "]);
  assert.deepEqual(Object.keys(w).sort(), ["attack", "move speed"]);
  assert.equal(w["move speed"], 1.0);
});

test("a repeated name keeps its best rank and consumes none", () => {
  const w = score.roleWeights(["Attack", "attack", "Critical Hit"]);
  assert.deepEqual(Object.keys(w), ["attack", "critical hit"]);
  assert.equal(w.attack, 1.0); close(w["critical hit"], 0.75);
});

test("empty profile, impossible decay, decay of one", () => {
  assert.deepEqual(score.roleWeights([]), {});
  assert.deepEqual(score.roleWeights(null), {});
  for (const decay of [0.0, -0.5, 1.5]) assert.throws(() => score.roleWeights(["Attack"], decay), RangeError);
  assert.deepEqual(score.roleWeights(["A", "B", "C"], 1.0), { a: 1.0, b: 1.0, c: 1.0 });
});

test("merge takes the best rank a stat reaches in any category", () => {
  const merged = score.mergeRoleWeights({ helmet: ["Attack", "Smite"], boots: ["Move Speed", "Attack"] });
  assert.equal(merged.attack, 1.0); close(merged.smite, 0.75); assert.equal(merged["move speed"], 1.0);
});

test("display names keep the spelling the profile used", () => {
  assert.equal(names()["move speed"], "Movement Speed");
  assert.equal(names()["critical hit"], "Critical Hit");
});

test("a stat id folds onto the name space", () => {
  for (const [id, expected] of [["CriticalHit", "critical hit"], ["MoveSpeed", "move speed"], ["DamageRatio", "damage ratio"], ["HPRegen", "hp regen"], ["Attack", "attack"], ["", ""]]) {
    assert.equal(score.normalizeStatId(id), expected);
  }
});

test("the name index uses the totals spelling not the pieces", () => {
  const index = score.statNameIndex([F.DETAILS[103]]);
  assert.equal(index.DefenseBonus, "defense increase");
  assert.ok(!("Defense" in index));
});

test("the stat gap ranks by weight times missing slot coverage", () => {
  const [t, bySlot] = totals();
  const ranked = score.statGapRanked(t, weights(), null, {
    bySlot, slots: Object.keys(F.EQUIPPED).sort(), index: score.statNameIndex(Object.values(F.DETAILS)), names: names(), topK: 4,
  });
  assert.deepEqual(ranked.map(([, r]) => r.statId), ["CriticalHit", "Smite", "MoveSpeed", "Attack"]);
  const shortfalls = ranked.map(([s]) => s);
  close(shortfalls[0], 0.5625); close(shortfalls[1], 0.421875); close(shortfalls[2], 0.31640625); close(shortfalls[3], 0.25);
});

test("each gap reason carries the current value and its attribution", () => {
  const [t, bySlot] = totals();
  const reasons = score.statGap(t, weights(), null, {
    bySlot, slots: Object.keys(F.EQUIPPED).sort(), index: score.statNameIndex(Object.values(F.DETAILS)), names: names(), topK: 1,
  });
  assert.equal(reasons.length, 1);
  const [reason] = reasons;
  assert.ok(reason instanceof Reason);
  assert.equal(reason.delta, 10.0); close(reason.weight, 0.75);
  assert.equal(reason.textKey, score.REASON_STAT_THIN);
  assert.deepEqual(reason.textKwargs, { stat: "Critical Hit", slots: 1, total: 4 });
});

test("a stat no slot carries is reported as absent at full weight", () => {
  const reasons = score.statGap({ Attack: 100.0 }, { attack: 1.0, block: 0.75 }, null, { bySlot: { Attack: { Helmet: 100.0 } }, slots: ["Helmet"], topK: 2 });
  assert.deepEqual(reasons.map((r) => r.textKey), [score.REASON_STAT_ABSENT]);
  assert.equal(reasons[0].statId, "block");
  assert.equal(reasons[0].delta, 0.0);
  assert.equal(reasons[0].textKwargs.slots, 0);
});

test("top_k bounds the report", () => {
  const [t, bySlot] = totals();
  assert.equal(score.statGap(t, weights(), null, { bySlot, topK: 2 }).length, 2);
  assert.deepEqual(score.statGap(t, weights(), null, { bySlot, topK: 0 }), []);
});

test("a reference build switches the gap to the one legal magnitude", () => {
  const reasons = score.statGap({ Attack: 650.0 }, { attack: 1.0 }, { Attack: 1000.0 }, { topK: 3 });
  assert.equal(reasons.length, 1);
  assert.equal(reasons[0].textKey, score.REASON_STAT_BEHIND);
  assert.equal(reasons[0].textKwargs.value, 650.0);
  assert.equal(reasons[0].textKwargs.reference, 1000.0);
  assert.deepEqual(score.statGap({ Attack: 1200.0 }, { attack: 1.0 }, { Attack: 1000.0 }), []);
});

test("two stat ids that share a name are summed not double counted", () => {
  const reasons = score.statGap({ Attack: 100.0, WeaponFixingDamage: 50.0 }, { attack: 1.0 }, null, {
    bySlot: { Attack: { Ring1: 100.0 }, WeaponFixingDamage: { MainHand: 50.0 } },
    slots: ["Ring1", "MainHand", "Helmet"], index: { Attack: "attack", WeaponFixingDamage: "attack" }, topK: 1,
  });
  assert.equal(reasons[0].delta, 150.0);
  assert.equal(reasons[0].textKwargs.slots, 2);
});

const alignment = () => score.substatAlignment({
  Helmet: ["Critical Hit", "Smite"], Gloves: ["Combat Speed"], Boots: ["Move Speed"], Ring1: ["Accuracy"],
}, weights(), { names: names() });

test("substat alignment counts the share inside the profile top-n", () => {
  const a = alignment();
  assert.ok(a instanceof Recommendation);
  assert.equal(a.pick.aligned, 2); assert.equal(a.pick.total, 5);
  close(a.pick.share, 0.4); close(a.scoreDelta, 0.6);
  assert.equal(a.textKey, score.RECO_SUBSTAT_ALIGNMENT);
});

test("substat alignment names the slots that are entirely off profile", () => {
  const a = alignment();
  assert.deepEqual(a.pick.off_profile_slots, ["Gloves", "Ring1"]);
  assert.deepEqual(a.pick.missing, ["attack"]);
  assert.deepEqual(a.reasons.map((r) => r.textKey), [score.REASON_STAT_SUBSTAT_MISSING, score.REASON_SLOT_OFF_PROFILE, score.REASON_SLOT_OFF_PROFILE]);
  assert.deepEqual(a.reasons[1].textKwargs, { slot: "Gloves", stat: "Combat Speed" });
});

test("an empty substat sheet is a zero recommendation with no headline", () => {
  const a = score.substatAlignment({}, weights());
  assert.equal(a.scoreDelta, 0.0);
  assert.deepEqual([...a.reasons], []);
  assert.equal(a.textKey, "");
});
