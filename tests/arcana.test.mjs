// node --test tests/   (the desktop's tests/test_armory_engine_golden.py
// Arcana section; fixtures/arcana_golden.json is its golden.json subset)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as arcana from "../js/engine/arcana.js";

const GOLDEN = JSON.parse(readFileSync(new URL("./fixtures/arcana_golden.json", import.meta.url)));
const TOL = 1e-9;

// tests/fixtures/armory_engine/inputs.py — an Arcana wishlist
const POOLS = {
  Chalice: [
    { id: "s_rush", name: "Rushing Smash" }, { id: "s_spin", name: "Spinning Strike" },
    { id: "s_dark", name: "Dark Crush" }, { id: "s_guard", name: "Iron Guard" }, { id: "s_focus", name: "Focus" },
  ],
  Parchment: [
    { id: "s_rush", name: "Rushing Smash" }, { id: "s_onslaught", name: "Onslaught" },
    { id: "s_spin", name: "Spinning Strike" }, { id: "s_cleave", name: "Cleave" }, { id: "s_impact", name: "Impactful Crush" },
  ],
  Compass: [
    { id: "s_onslaught", name: "Onslaught" }, { id: "s_impact", name: "Impactful Crush" },
    { id: "s_dash", name: "Dash" }, { id: "s_cleave", name: "Cleave" },
  ],
  Bell: [
    { id: "s_guard", name: "Iron Guard" }, { id: "s_focus", name: "Focus" },
    { id: "s_endure", name: "Endure" }, { id: "s_vigor", name: "Vigor Mastery" },
  ],
  Mirror: [{ id: "s_focus", name: "Focus" }, { id: "s_endure", name: "Endure" }, { id: "s_reflect", name: "Reflect" }],
  Scales: [{ id: "s_dash", name: "Dash" }, { id: "s_cleave", name: "Cleave" }],
};
const TYPE_BY_ID = {
  s_rush: "active", s_spin: "active", s_dark: "active", s_onslaught: "active", s_cleave: "active",
  s_impact: "active", s_dash: "active", s_guard: "passive", s_focus: "passive", s_endure: "passive",
  s_vigor: "passive", s_reflect: "passive",
};
const THEME_MAP = {
  Vigor: { Chalice: {}, Parchment: {}, Bell: {} },
  Magic: { Chalice: {}, Compass: {}, Mirror: {} },
  Frenzy: { Scales: {} },
};
const TYPE_TO_THEME = { Chalice: "Vigor", Parchment: "Vigor", Bell: "Vigor", Compass: "Magic", Mirror: "Magic" };
const PRIORITY_RANK = {
  s_dark: 0, s_onslaught: 1, s_rush: 2, s_spin: 3, s_impact: 4, s_focus: 5, s_guard: 6, s_cleave: 7, s_endure: 8, s_dash: 9,
};
const CASES = [
  { name: "easy", wishes: { s_dark: 4, s_rush: 2 } },
  { name: "competing", wishes: { s_dark: 4, s_rush: 4, s_spin: 4, s_onslaught: 4, s_impact: 3 } },
  { name: "impossible", wishes: { s_dash: 4, s_focus: 2 } },
];
const USABLE = GOLDEN.arcana_usable_types;
const wishesOf = (name) => CASES.find((c) => c.name === name).wishes;
const solve = (wishes) => arcana.computeCombinations(USABLE, TYPE_TO_THEME, POOLS, wishes, TYPE_BY_ID, PRIORITY_RANK);

test("the usable lord types are unchanged (Scales has no Vigor/Magic entry)", () => {
  const usable = arcana.usableLordTypes(THEME_MAP, new Set(["Vigor", "Magic"]));
  assert.deepEqual(usable, USABLE);
  assert.ok(!usable.includes("Scales"));
});

for (const golden of GOLDEN.arcana) {
  test(`the solver reproduces its recorded combinations: ${golden.name}`, () => {
    const wishes = wishesOf(golden.name);
    const combos = solve(wishes);
    assert.equal(combos.length, golden.combinations.length);
    combos.forEach((combo, i) => {
      const expected = golden.combinations[i];
      assert.deepEqual(combo.covered, expected.covered);
      assert.equal(combo.assignments.length, expected.assignments.length);
      combo.assignments.forEach((a, j) => {
        const e = expected.assignments[j];
        assert.equal(a.type, e.type);
        assert.equal(a.theme, e.theme);
        assert.deepEqual(a.skill_ids, e.skill_ids);
        assert.deepEqual([...a.need_based_ids].sort(), e.need_based_ids);
        assert.deepEqual([...a.skill_order].sort(), Object.keys(e.skill_ids).sort());
      });
      assert.ok(Math.abs(arcana.resultCoveragePercent(combo, wishes) - expected.coverage_percent) < TOL);
    });
  });

  test(`every card spends its whole budget within the per-skill cap: ${golden.name}`, () => {
    for (const combo of golden.combinations) {
      for (const a of combo.assignments) {
        const values = Object.values(a.skill_ids);
        assert.ok(values.length <= arcana.SKILL_SLOTS_PER_CARD);
        assert.ok(values.every((v) => v >= arcana.SKILL_BASELINE && v <= arcana.PER_SKILL_CAP));
        const spent = values.reduce((s, v) => s + v - arcana.SKILL_BASELINE, 0);
        const cappedOut = values.every((v) => v === arcana.PER_SKILL_CAP);
        assert.ok(spent === arcana.CARD_EXTRA_BUDGET || cappedOut, `${a.type} spent ${spent}`);
      }
    }
  });

  test(`the ceilings and eligibility are unchanged: ${golden.name}`, () => {
    for (const [sid, expected] of Object.entries(golden.ceilings)) {
      assert.equal(arcana.maxCeiling(sid, TYPE_BY_ID[sid], USABLE, POOLS), expected);
    }
    for (const [sid, expected] of Object.entries(golden.eligible_types)) {
      assert.deepEqual(arcana.eligibleTypes(sid, TYPE_BY_ID[sid], USABLE, POOLS), expected);
    }
  });

  test(`the uncovered reason tiers are unchanged: ${golden.name}`, () => {
    const wishes = wishesOf(golden.name);
    const combos = solve(wishes);
    for (const [sid, wish] of Object.entries(wishes)) {
      const covered = combos.length ? combos[0].covered[sid] || 0 : 0;
      const [key, kwargs] = arcana.uncoveredReason(sid, wish, covered, USABLE, POOLS, TYPE_BY_ID);
      assert.deepEqual([key, kwargs], golden.uncovered_reasons[sid]);
      assert.ok(key.startsWith("arm_arcana_reason_"));
    }
  });
}

test("a skill no usable type can roll reports the structural reason", () => {
  assert.deepEqual(arcana.uncoveredReason("s_not_in_any_pool", 4, 0, USABLE, POOLS, TYPE_BY_ID), ["arm_arcana_reason_no_card", {}]);
});

test("the card slot migration is unchanged", () => {
  const inputs = [
    null,
    {},
    { skill_ids: { s_dark: 4, s_rush: 2 } },
    { slots: [{ skill_id: "s_dark", level: 4 }, null, null, null] },
    { slots: new Array(6).fill({ skill_id: "s_a", level: 1 }) },
  ];
  inputs.forEach((cardData, index) => {
    const slots = arcana.cardSlotList(cardData);
    assert.deepEqual(slots, GOLDEN.arcana_card_slots[index]);
    assert.equal(slots.length, arcana.SKILL_SLOTS_PER_CARD);
  });
});

test("the derived card level is unchanged", () => {
  const cards = [
    null,
    { grade: "Unique", slots: [{ skill_id: "s_dark", level: 4 }, { skill_id: "s_rush", level: 2 }, null, null] },
    { grade: "Rare", slots: [{ skill_id: "s_dark", level: 4 }, { skill_id: "s_rush", level: 4 }, null, null] },
    { grade: "Legend", slots: [{ skill_id: "s_dark", level: 1 }, null, null, null] },
  ];
  assert.deepEqual(cards.map(arcana.cardLevel), GOLDEN.arcana_card_level);
  assert.deepEqual([null, {}, { grade: "Rare" }].map(arcana.cardGrade), GOLDEN.arcana_card_grade);
});

test("the per-type pools are unchanged", () => {
  const wishes = CASES[1].wishes;
  const eligible = {};
  const full = {};
  for (const ct of USABLE) {
    eligible[ct] = arcana.eligibleSkillsForType(ct, wishes, POOLS, TYPE_BY_ID);
    full[ct] = arcana.fullPoolForType(ct, POOLS);
  }
  assert.deepEqual(eligible, GOLDEN.arcana_eligible_skills);
  assert.deepEqual(full, GOLDEN.arcana_full_pools);
});

test("a passive-only card never offers an active skill", () => {
  for (const [cardType, category] of Object.entries(arcana.LORD_CATEGORY)) {
    if (category === "both" || !(cardType in POOLS)) continue;
    const wishes = Object.fromEntries(Object.keys(TYPE_BY_ID).map((sid) => [sid, 4]));
    const eligible = arcana.eligibleSkillsForType(cardType, wishes, POOLS, TYPE_BY_ID);
    assert.ok(eligible.every((sid) => TYPE_BY_ID[sid] === category), cardType);
  }
});

test("lord points follow the derived level and the theme's per-level rate", () => {
  const themeMap = { Vigor: { Chalice: { lord: "Time" } }, Punishment: { Chalice: { lord: "Time" } } };
  const card = { theme: "Vigor", grade: "Unique", slots: [{ skill_id: "a", level: 4 }, { skill_id: "b", level: 3 }, null, null] };
  assert.deepEqual(arcana.cardLordPoints(card, themeMap, "Chalice"), ["Time", 25]);
  assert.deepEqual(arcana.cardLordPoints({ ...card, theme: "Punishment" }, themeMap, "Chalice"), ["Time", 30]);
  assert.equal(arcana.cardLordPoints({ grade: "Unique" }, themeMap, "Chalice"), null);
  assert.deepEqual(arcana.cardSkillBonus({ Chalice: card, Bell: { skill_ids: { a: 2 } } }), { a: 6, b: 3 });
});
