// node --test tests/recommend.test.mjs — tests/test_armory_engine_recommend.py
// groups 2 and 3 (set completion, orchestration, bundle) against
// js/engine/recommend.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as recommend from "../js/engine/recommend.js";

const F = JSON.parse(readFileSync(new URL("./fixtures/armory_engine_inputs.json", import.meta.url))).reco_inputs;
const close = (a, b, tol = 1e-12) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);
const provider = (details = F.DETAILS) => ({ get: (id) => details[id] });
const bundle = (overrides = {}) => new recommend.DataBundle({ itemsById: F.ITEMS, dungeonSets: F.DUNGEON_SETS, ...overrides });
const state = (overrides = {}) => ({
  character_class: "Gladiator",
  current_build_name: "PvE t1",
  active_gear_types: ["PvE", "Neutral"],
  equip_builds_data: { gladiator: { "PvE t1": { equipped: F.EQUIPPED_AS_ITEMS, substats: F.SUBSTATS, enchant: {} } } },
  ...overrides,
});

test("the set root is the name minus its trailing slot word", () => {
  assert.deepEqual(recommend.setRoot("Abyssal Helm"), ["Abyssal", "Helm"]);
  assert.deepEqual(recommend.setRoot("Corrupted Judicator Boots"), ["Corrupted Judicator", "Boots"]);
  assert.deepEqual(recommend.setRoot("Fierce Battle Amulet"), ["Fierce Battle", "Amulet"]);
  assert.equal(recommend.setRoot("Helm"), null);
  assert.equal(recommend.setRoot("Abyssal Helmet"), null);
  assert.equal(recommend.setRoot(""), null);
});

test("the slot word mirror matches the desktop's list", () => {
  assert.deepEqual(recommend.SET_SLOT_WORDS, [
    "Helm", "Ring", "Boots", "Greatsword", "Breastplate", "Greaves", "Gloves", "Pauldrons", "Necklace", "Earrings",
    "Dagger", "Longsword", "Bow", "Spellbook", "Orb", "Mace", "Staff", "Fist", "Guard", "Bracelet", "Brooch", "Amulet",
  ]);
});

test("the set index keeps the lowest id, the alphabetically first tag, ignores unlisted sets", () => {
  const index = recommend.buildSetIndex(F.ITEMS, F.DUNGEON_SETS);
  assert.equal(index.Abyssal.pieces.Ring.id, 104);
  assert.equal(index.Abyssal.tag, "Expedition");
  assert.equal(index.Corrupted.tag, "Sanctuary");
  assert.deepEqual(Object.keys(index).sort(), ["Abyssal", "Corrupted"]);
  const flat = recommend.buildSetIndex(F.ITEMS, F.DUNGEON_SETS_FLAT);
  assert.equal(flat.Abyssal.grade, "Unique");
  assert.equal(flat.Abyssal.gearscore, null);
});

test("missing pieces are sorted by completeness descending and name every piece", () => {
  const picks = recommend.missingSetPieces(F.EQUIPPED_AS_ITEMS, F.ITEMS, F.DUNGEON_SETS);
  assert.deepEqual(picks.map((p) => p.pick.root), ["Abyssal", "Corrupted"]);
  assert.equal(picks[0].pick.owned, 3); assert.equal(picks[0].pick.total, 4);
  assert.equal(picks[1].pick.owned, 1); assert.equal(picks[1].pick.total, 3);
  assert.equal(picks[0].textKey, recommend.RECO_SET_INCOMPLETE);
  assert.deepEqual(picks[0].textKwargs, { set: "Abyssal", owned: 3, total: 4, source: "Expedition" });
  assert.deepEqual(picks[1].reasons.map((r) => r.textKwargs.slot), ["Boots", "Helm"]);
  assert.equal(picks[1].reasons[0].textKwargs.item, "Corrupted Boots");
  assert.equal(picks[1].reasons[0].textKwargs.source, "Sanctuary");
  for (const pick of picks) close(pick.reasons.reduce((s, r) => s + r.scoreContribution, 0), pick.scoreDelta);
  close(picks[0].scoreDelta, 0.25); close(picks[1].scoreDelta, 2 / 3);
});

test("complete sets, id-or-dict slots, catalog fallback, no table, limit", () => {
  assert.deepEqual(recommend.missingSetPieces({ Helmet: 101, Gloves: 102, Boots: 103, Ring1: 104 }, F.ITEMS, F.DUNGEON_SETS), []);
  const byId = recommend.missingSetPieces(F.EQUIPPED, F.ITEMS, F.DUNGEON_SETS);
  const byDict = recommend.missingSetPieces(F.EQUIPPED_AS_ITEMS, F.ITEMS, F.DUNGEON_SETS);
  assert.deepEqual(byId.map((p) => p.pick), byDict.map((p) => p.pick));
  const fallback = recommend.missingSetPieces({ Helmet: { id: 999, name: "Abyssal Helm" } }, F.ITEMS, F.DUNGEON_SETS);
  assert.equal(fallback[0].pick.root, "Abyssal"); assert.equal(fallback[0].pick.owned, 1);
  assert.deepEqual(recommend.missingSetPieces(F.EQUIPPED_AS_ITEMS, F.ITEMS, {}), []);
  assert.deepEqual(recommend.missingSetPieces(F.EQUIPPED_AS_ITEMS, F.ITEMS, F.DUNGEON_SETS, { limit: 1 }).map((p) => p.pick.root), ["Abyssal"]);
});

test("next best actions orders sets then alignment then the gap, every one explained", () => {
  const picks = recommend.nextBestActions(state(), provider(), bundle());
  assert.deepEqual(picks.map((p) => p.pick.kind), ["set_completion", "set_completion", "substat_alignment", "stat_gap"]);
  assert.deepEqual(picks.slice(0, 2).map((p) => p.pick.root), ["Abyssal", "Corrupted"]);
  for (const pick of picks) {
    assert.ok(pick.textKey); assert.ok(pick.reasons.length);
    for (const reason of pick.reasons) assert.ok(reason.textKey);
  }
  const gap = picks.find((p) => p.pick.kind === "stat_gap");
  assert.equal(gap.textKwargs.role, recommend.DEFAULT_ROLE); assert.equal(recommend.DEFAULT_ROLE, "Angreifer");
  assert.equal(gap.textKwargs.gear_type, "PvE");
  close(gap.scoreDelta, gap.pick.shortfalls.reduce((a, b) => a + b, 0));
});

test("the pvp toggle selects the pvp profile", () => {
  const gap = recommend.nextBestActions(state({ active_gear_types: ["PvP"] }), provider(), bundle()).find((p) => p.pick.kind === "stat_gap");
  assert.equal(gap.textKwargs.gear_type, "PvP");
});

test("degradation paths", () => {
  const none = recommend.nextBestActions(state(), provider(), new recommend.DataBundle());
  assert.equal(none.length, 1);
  assert.equal(none[0].textKey, recommend.DATA_MISSING_KEY);
  assert.equal(none[0].pick.kind, "unavailable");
  assert.deepEqual([...none[0].reasons], []);
  assert.deepEqual(recommend.nextBestActions(state(), provider(), bundle({ dungeonSets: {} })).map((p) => p.pick.kind), ["substat_alignment", "stat_gap"]);
  assert.deepEqual(new Set(recommend.nextBestActions(state(), null, bundle()).map((p) => p.pick.kind)), new Set(["set_completion"]));
  assert.deepEqual(new Set(recommend.nextBestActions(state(), provider({}), bundle()).map((p) => p.pick.kind)), new Set(["set_completion"]));
  for (const s of [null, {}, { character_class: "Gladiator" }, { character_class: "Unknown", equip_builds_data: { gladiator: {} } }, { equip_builds_data: "not a dict" }]) {
    assert.deepEqual(recommend.nextBestActions(s, provider(), bundle()), []);
  }
});

test("the build name defaults to Default, the set index is cached, the limit bounds the list", () => {
  const s = state({ current_build_name: "" });
  s.equip_builds_data.gladiator = { Default: s.equip_builds_data.gladiator["PvE t1"] };
  assert.ok(recommend.nextBestActions(s, provider(), bundle()).length);
  const b = bundle();
  assert.equal(b.setIndex, null);
  recommend.nextBestActions(state(), provider(), b);
  const first = b.setIndex;
  assert.ok(first);
  recommend.nextBestActions(state(), provider(), b);
  assert.equal(b.setIndex, first);
  assert.equal(recommend.nextBestActions(state(), provider(), bundle(), { limit: 2 }).length, 2);
});

test("the bundle reads a catalog payload in both shapes", () => {
  const fromObject = recommend.itemsByIdFromCatalog({ items: Object.values(F.ITEMS) });
  assert.equal(fromObject[101].name, "Abyssal Helm");
  const bare = recommend.itemsByIdFromCatalog([{ id: 1, name: "Abyssal Helm" }, { name: "no id" }, "junk"]);
  assert.deepEqual(Object.keys(bare), ["1"]);
  const b = new recommend.DataBundle({ itemsById: fromObject, dungeonSets: F.DUNGEON_SETS, missing: ["stat_priority_options.json"] });
  assert.equal(b.available, true); assert.equal(b.reasonKey, "");
  assert.equal(new recommend.DataBundle().available, false);
  assert.equal(new recommend.DataBundle().reasonKey, recommend.DATA_MISSING_KEY);
});
