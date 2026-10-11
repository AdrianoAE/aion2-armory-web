import { test } from "node:test";
import assert from "node:assert/strict";
import * as plan from "../js/engine/odyleplan.js";

const utc = (...a) => new Date(Date.UTC(...a));
const JUST_AFTER_RESET = utc(2026, 9, 7, 9, 0, 1);
const NIGHT_BEFORE_RESET = utc(2026, 9, 13, 21, 0);

test("the Kina cut steps at the table's run counts", () => {
  assert.equal(plan.kinaPercent("conquest", 83), 100);
  assert.equal(plan.kinaPercent("conquest", 84), 80);
  assert.equal(plan.kinaPercent("conquest", 146), 40);
  assert.equal(plan.kinaPercent("conquest", 147), 20);
  assert.equal(plan.kinaPercent("transcendence", 55), 100);
  assert.equal(plan.kinaPercent("transcendence", 56), 80);
  assert.equal(plan.kinaPercent("transcendence", 98), 20);
  assert.equal(plan.kinaTotal("conquest", 82, 4), 100 + 100 + 80 + 80);
});

test("item level picks the highest Conquest tier and Transcendence stage", () => {
  assert.equal(plan.conquestTier(699), null);
  assert.equal(plan.conquestTier(700).tier, 1);
  assert.equal(plan.conquestTier(2100).tier, 3);
  assert.equal(plan.transcendenceStage(1599), null);
  assert.equal(plan.transcendenceStage(1600).stage, 1);
  assert.equal(plan.transcendenceStage(3000).stage, 4);
});

test("a full week regenerates 840 energy", () => {
  assert.equal(plan.regenUntil(JUST_AFTER_RESET, utc(2026, 9, 14, 9, 0)), 840);
  assert.equal(plan.regenUntil(NIGHT_BEFORE_RESET, utc(2026, 9, 14, 9, 0)), 60);
});

test("purchases only count in the week they were made", () => {
  assert.equal(plan.purchasesThisWeek({ count: 12, at: "2026-10-08T10:00:00Z" }, utc(2026, 9, 10)), 12);
  assert.equal(plan.purchasesThisWeek({ count: 12, at: "2026-10-06T10:00:00Z" }, utc(2026, 9, 10)), 0);
  assert.equal(plan.purchaseLimit("main"), 20);
  assert.equal(plan.purchaseLimit("alt"), 4);
});

test("the main counts at full use at 80 Odyle a run", () => {
  const result = plan.planWeek({
    now: JUST_AFTER_RESET,
    characters: [{ id: "m", name: "Main", role: "main", itemLevel: 2600, base: 0, extra: 0, purchasesLeft: 40 }],
  });
  const [main] = result.rows;
  assert.equal(main.total, 840 + 1600);
  assert.deepEqual([main.cubes, main.transcendence, main.conquest, main.fromExtra], [30, 14, 16, 20]);
  assert.equal(main.stage.stage, 4);
  assert.equal(main.extraKept, 1600 - (30 * 80 - 840));
  assert.equal(main.baseLost, 0);
});

test("priority characters fill up in order, the other alts use energy down to 80% Kina", () => {
  const result = plan.planWeek({
    now: JUST_AFTER_RESET,
    runsDone: { conquest: 60, transcendence: 0 },
    characters: [
      { id: "o", name: "Other", role: "alt", itemLevel: 1700, base: 800, extra: 200, purchasesLeft: 8 },
      { id: "b", name: "Blessing", role: "priority", itemLevel: 1700, base: 0, extra: 400, purchasesLeft: 8 },
      { id: "c", name: "Chanter", role: "priority", itemLevel: 1000, base: 0, extra: 0, purchasesLeft: 8 },
      { id: "m", name: "Main", role: "main", itemLevel: 2600, base: 0, extra: 0, purchasesLeft: 40 },
      { id: "x", name: "Resting", role: "off", itemLevel: 3000, base: 800, extra: 0, purchasesLeft: 8 },
    ],
  });
  assert.deepEqual(result.rows.map((r) => r.name), ["Main", "Blessing", "Chanter", "Other"]);
  const [main, blessing, chanter, other] = result.rows;
  assert.deepEqual([main.conquest, main.transcendence], [16, 14]);
  assert.deepEqual([blessing.conquest, blessing.transcendence, blessing.fromExtra], [5, 14, 9]);
  assert.deepEqual([chanter.conquest, chanter.transcendence], [14, 0]);
  assert.deepEqual(chanter.shares, { 100: 3, 80: 11 });
  assert.deepEqual([other.cubes, other.transcendence, other.conquest], [24, 14, 10]);
  assert.deepEqual(other.shares, { 100: 14, 80: 10 });
  assert.equal(other.extraKept, 200 + 320 - (24 * 80 - 1640));
  assert.equal(other.baseAtReset, 0);
  assert.deepEqual(result.after, { conquest: 105, transcendence: 42 });
});

test("priority characters past the Expedition cut go to Transcendence", () => {
  const result = plan.planWeek({
    now: NIGHT_BEFORE_RESET,
    runsDone: { conquest: 80, transcendence: 0 },
    characters: [
      { id: "a", name: "A", role: "priority", itemLevel: 1700, base: 740, extra: 0, purchasesLeft: 0 },
      { id: "b", name: "B", role: "priority", itemLevel: 1750, base: 740, extra: 0, purchasesLeft: 0 },
    ],
  });
  assert.deepEqual(result.planned, { conquest: 0, transcendence: 20 });
  assert.deepEqual(result.rows.map((r) => [r.conquest, r.transcendence]), [[0, 10], [0, 10]]);
});

test("an alt spends its energy, additional included, while runs pay full Kina", () => {
  const result = plan.planWeek({
    now: NIGHT_BEFORE_RESET,
    characters: [{ id: "a", name: "Alt", role: "alt", itemLevel: 2000, base: 300, extra: 120, purchasesLeft: 0 }],
  });
  const [alt] = result.rows;
  assert.equal(alt.cubes, 6);
  assert.deepEqual(alt.shares, { 100: 6 });
  assert.equal(alt.fromExtra, 2);
  assert.equal(alt.extraKept, 0);
  assert.equal(alt.baseAtReset, 0);
});

test("an alt stops at the 80% line but still clears its overflow", () => {
  const result = plan.planWeek({
    now: JUST_AFTER_RESET,
    runsDone: { conquest: 100, transcendence: 0 },
    characters: [{ id: "a", name: "Alt", role: "alt", itemLevel: 1000, base: 800, extra: 0, purchasesLeft: 0 }],
  });
  const [alt] = result.rows;
  assert.equal(alt.cubes, 10);
  assert.deepEqual(alt.shares, { 80: 5, 60: 5 });
  assert.equal(alt.baseLost, 0);
});

test("base energy a character cannot spend is lost at the cap", () => {
  const result = plan.planWeek({
    now: JUST_AFTER_RESET,
    characters: [{ id: "a", name: "Low", role: "alt", itemLevel: 500, base: 800, extra: 0, purchasesLeft: 0 }],
  });
  assert.equal(result.rows[0].cubes, 0);
  assert.equal(result.rows[0].baseLost, 800);
});
