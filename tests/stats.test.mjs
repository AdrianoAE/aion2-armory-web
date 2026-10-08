// node --test tests/stats.test.mjs — the stat merge + GearScore goldens
// (tests/test_armory_engine_golden.py) against js/engine/stats.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as stats from "../js/engine/stats.js";

const GOLDEN = JSON.parse(readFileSync(new URL("./fixtures/armory_engine_golden.json", import.meta.url)));
const F = JSON.parse(readFileSync(new URL("./fixtures/armory_engine_inputs.json", import.meta.url))).golden_inputs;
const TOL = 1e-9;
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) <= TOL, `${actual} != ${expected}`);
const closeDict = (actual, expected) => {
  assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort());
  for (const key of Object.keys(expected)) close(actual[key], expected[key]);
};

const provider = { get: (id) => F.DETAILS[id] };
const SUBSTATS = Object.fromEntries(Object.entries(F.SUBSTATS).map(([slot, list]) => [slot, new Set(list)]));

test("the stat merge reproduces its recorded totals and per-slot breakdown", () => {
  const [totals, bySlot] = stats.computeStatTotalsDetailed(F.EQUIPPED, SUBSTATS, F.ENCHANT, provider);
  closeDict(totals, GOLDEN.stat_totals);
  assert.deepEqual(Object.keys(bySlot).sort(), Object.keys(GOLDEN.stat_by_slot).sort());
  for (const [statId, slots] of Object.entries(GOLDEN.stat_by_slot)) closeDict(bySlot[statId], slots);
  for (const [statId, value] of Object.entries(totals)) close(Object.values(bySlot[statId]).reduce((a, b) => a + b, 0), value);
});

test("substats given as plain arrays (the persisted shape) merge the same way", () => {
  const [totals] = stats.computeStatTotalsDetailed(F.EQUIPPED, F.SUBSTATS, F.ENCHANT, provider);
  closeDict(totals, GOLDEN.stat_totals);
});

test("the unenchanted merge reproduces its recorded totals", () => {
  const [totals, bySlot] = stats.computeStatTotalsDetailed(F.EQUIPPED, SUBSTATS, {}, provider);
  closeDict(totals, GOLDEN.stat_totals_unenchanted);
  assert.deepEqual(Object.keys(bySlot).sort(), Object.keys(GOLDEN.stat_by_slot_unenchanted).sort());
});

test("the gearscore reproduces its recorded value", () => {
  close(stats.computeGearscore(F.EQUIPPED, F.ENCHANT, provider), GOLDEN.gearscore);
  close(stats.computeGearscore(F.EQUIPPED, {}, provider), GOLDEN.gearscore_unenchanted);
});

test("an unresolvable slot is skipped, not raised", () => {
  const [, bySlot] = stats.computeStatTotalsDetailed(F.EQUIPPED, SUBSTATS, F.ENCHANT, provider);
  const slots = new Set(Object.values(bySlot).flatMap((s) => Object.keys(s)));
  assert.ok(!slots.has("Cloak"));
});

test("an empty build is empty", () => {
  assert.deepEqual(stats.computeStatTotalsDetailed({}, {}, {}, provider), [{}, {}]);
  assert.equal(stats.computeGearscore({}, {}, provider), 0.0);
});

test("stat value parsing is unchanged", () => {
  for (const [raw, expected] of Object.entries(GOLDEN.parse_stat_value)) close(stats.parseStatValue(raw === "None" ? null : raw), expected);
  close(stats.parseStatValue(12), 12);
  close(stats.parseStatValue("15.9%"), 15.9);
});
