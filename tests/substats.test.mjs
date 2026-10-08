// node --test tests/substats.test.mjs — substat auto-pick + priority
// profile goldens (tests/test_armory_engine_golden.py) against
// js/engine/substats.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as substats from "../js/engine/substats.js";

const GOLDEN = JSON.parse(readFileSync(new URL("./fixtures/armory_engine_golden.json", import.meta.url)));
const F = JSON.parse(readFileSync(new URL("./fixtures/armory_engine_inputs.json", import.meta.url))).golden_inputs;

test("the substat pick reproduces its recorded indices", () => {
  assert.equal(F.SUBSTAT_CASES.length, GOLDEN.substats.length);
  F.SUBSTAT_CASES.forEach((c, i) => {
    assert.equal(c.name, GOLDEN.substats[i].name);
    const picked = substats.pickPrioritySubstats(c.sub_stats, c.count, c.priority);
    assert.deepEqual([...picked].sort((a, b) => a - b), GOLDEN.substats[i].picked);
  });
});

test("the default profiles are unchanged", () => {
  assert.deepEqual(substats.defaultStatPriorityProfiles(), GOLDEN.stat_priority_defaults);
});

test("merging a saved profile still drops junk and truncates", () => {
  const merged = substats.mergeStatPriorityProfiles({
    PvE: {
      Angreifer: { weapon: ["QA One", "QA Two", "QA Three", "QA Four", "QA Five", "QA Six", "QA Seven", "QA Eight"] },
      Nonsense: { weapon: ["x"] },
    },
    Nope: { Angreifer: { weapon: ["y"] } },
  });
  assert.deepEqual(merged, GOLDEN.stat_priority_merge);
  assert.equal(merged.PvE.Angreifer.weapon.length, substats.STAT_PRIORITY_MAX_ENTRIES);
});

test("stat name normalization is unchanged", () => {
  for (const [raw, expected] of Object.entries(GOLDEN.normalize_stat_name)) assert.equal(substats.normalizeStatName(raw), expected);
});
