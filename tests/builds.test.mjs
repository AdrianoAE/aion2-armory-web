// node --test tests/builds.test.mjs   (Builds and presets on an injected profile)
import { test } from "node:test";
import assert from "node:assert/strict";
import * as B from "../js/builds.js";
import { skillContext } from "../js/engine/skills.js";

function oldProfile() {
  return {
    character_class: "Gladiator",
    current_build_name: "PvE",
    current_skill_build_name: "Main",
    current_daevanion_build_name: "Default",
    current_genius_build_name: "Default",
    skill_levels: { 11010000: 10, 11020000: 5 },
    skill_active_specs: { 11010000: ["11010020", "11010040"] },
    equip_builds_data: {
      gladiator: {
        PvE: { equipped: { MainHand: { id: 1, name: "Sword" } }, enchant: { MainHand: 7 }, substats: {}, character_name: "Calvora", linked_skill_build: null, linked_daevanion_build: "Default", linked_genius_build: null },
        PvP: { equipped: { MainHand: { id: 2, name: "Axe" } }, enchant: {}, substats: {}, character_name: "Calvora", linked_skill_build: "Burst", linked_daevanion_build: "gone" },
      },
      cleric: { Default: { equipped: {}, character_name: "Dream" } },
    },
    skill_builds_data: {
      gladiator: {
        Main: { priority: {}, arcana_cards: {}, layout: { slots: { "3,0": "11010000" }, keys: {}, macro: [] } },
        Burst: { priority: {}, arcana_cards: { Vigor: { theme: "Fire", slots: [{ skill_id: "11010000", level: 2 }] } }, layout: { slots: {}, keys: {}, macro: [] } },
      },
    },
    daevanion_builds_data: { gladiator: { Default: { "s:11": ["110001", "110002"] }, Endgame: { "s:11": ["110001", "110003"], "s:12": ["120001"] } } },
    daevanion_build_settings: { gladiator: { Default: { budget: 316 } } },
    genius_builds_data: { Default: { Cogni: { 1: { stat: "DefenseBonus", value: 160, locked: false } } } },
  };
}

test("migration moves levels and specs into every skill build and pins every link", () => {
  const p = B.migrateProfile(oldProfile());
  const glad = p.skill_builds_data.gladiator;
  for (const build of Object.values(glad)) {
    assert.deepEqual(build.levels, { 11010000: 10, 11020000: 5 });
    assert.deepEqual(build.specs, { 11010000: ["11010020", "11010040"] });
  }
  assert.notEqual(glad.Main.levels, glad.Burst.levels);
  assert.equal(p.equip_builds_data.gladiator.PvE.linked_skill_build, "Main");
  assert.equal(p.equip_builds_data.gladiator.PvP.linked_daevanion_build, "Default");
  assert.equal(p.equip_builds_data.gladiator.PvE.linked_genius_build, "Default");
  assert.equal(p.equip_builds_data.cleric.Default.linked_daevanion_build, "Default");
  assert.ok(p.daevanion_builds_data.cleric.Default);
  assert.equal(p.skill_levels, glad.Main.levels, "the old key mirrors the current skill build");
  const again = JSON.stringify(B.migrateProfile(p));
  assert.equal(JSON.stringify(B.migrateProfile(JSON.parse(again))), again, "migration is idempotent");
});

test("builds list every Daevanion set with the equip sets linked to it", () => {
  const p = B.migrateProfile(oldProfile());
  assert.deepEqual(B.buildsOf(p, "Gladiator").map((b) => [b.name, b.presets]), [["Default", ["PvE", "PvP"]], ["Endgame", []]]);
  p.equip_builds_data.gladiator.PvP.linked_daevanion_build = "nowhere";
  assert.deepEqual(B.buildsOf(p, "gladiator")[0].presets, ["PvE", "PvP"]);
  assert.equal(p.equip_builds_data.gladiator.PvP.linked_daevanion_build, "Default");
  assert.equal(B.currentPresetOf(p, "gladiator"), "PvE");
  assert.equal(B.currentBuildOf(p, "gladiator"), "Default");
  assert.equal(B.currentPresetOf(p, "cleric", "Dream"), "Default");
});

test("selecting a preset switches every current_* name to its links", () => {
  const p = B.migrateProfile(oldProfile());
  p.equip_builds_data.gladiator.PvP.linked_daevanion_build = "Endgame";
  assert.equal(B.selectPresetIn(p, "gladiator", "PvP"), true);
  assert.equal(p.current_build_name, "PvP");
  assert.equal(p.current_skill_build_name, "Burst");
  assert.equal(p.current_daevanion_build_name, "Endgame");
  assert.equal(p.current_genius_build_name, "Default");
  assert.equal(p.skill_levels, p.skill_builds_data.gladiator.Burst.levels);
  B.selectPresetIn(p, "cleric", "Default");
  assert.equal(p.character_class, "Cleric");
  assert.equal(B.currentPresetOf(p, "gladiator", "Calvora"), "PvP", "the last preset of a character is remembered");
});

test("skill levels are per preset: each skill context reads its own build", () => {
  const p = B.migrateProfile(oldProfile());
  const main = skillContext(p, "gladiator", "Main");
  main.levels[11010000] = 3;
  const burst = skillContext(p, "gladiator", "Burst");
  assert.equal(burst.manual("11010000"), 10);
  assert.equal(main.manual("11010000"), 3);
  assert.equal(p.skill_levels[11010000], 3, "the current build writes through to the old key");
  burst.specs[11010000] = ["11010020"];
  assert.deepEqual([...burst.chosen("11010000")], ["11010020"]);
  assert.deepEqual([...main.chosen("11010000")].sort(), ["11010020", "11010040"]);
});

test("new build: empty Daevanion set and a fresh Default preset", () => {
  const p = B.migrateProfile(oldProfile());
  assert.equal(B.newBuildIn(p, "gladiator", "Default"), false);
  assert.equal(B.newBuildIn(p, "gladiator", "Leveling"), "Leveling");
  assert.deepEqual(p.daevanion_builds_data.gladiator.Leveling, {});
  const build = B.buildsOf(p, "gladiator").find((b) => b.name === "Leveling");
  assert.equal(build.presets.length, 1);
  const preset = build.presets[0];
  const equip = p.equip_builds_data.gladiator[preset];
  assert.equal(equip.character_name, "Calvora");
  assert.deepEqual(equip.equipped, {});
  assert.deepEqual(p.skill_builds_data.gladiator[equip.linked_skill_build].levels, {});
  assert.ok(p.genius_builds_data[equip.linked_genius_build].Cogni);
  assert.equal(p.current_build_name, preset);
  assert.equal(p.current_daevanion_build_name, "Leveling");
});

test("duplicate build deep-copies the set, its presets, skill builds and genius profiles", () => {
  const p = B.migrateProfile(oldProfile());
  const name = B.duplicateBuildIn(p, "gladiator", "Default", "Copy");
  assert.equal(name, "Copy");
  const sets = p.daevanion_builds_data.gladiator;
  assert.deepEqual(sets.Copy, sets.Default);
  assert.notEqual(sets.Copy["s:11"], sets.Default["s:11"]);
  assert.deepEqual(p.daevanion_build_settings.gladiator.Copy, { budget: 316 });
  const copy = B.buildsOf(p, "gladiator").find((b) => b.name === "Copy");
  assert.deepEqual(copy.presets, ["PvE (Copy)", "PvP (Copy)"]);
  const pve = p.equip_builds_data.gladiator["PvE (Copy)"], pvp = p.equip_builds_data.gladiator["PvP (Copy)"];
  assert.equal(pve.equipped.MainHand.name, "Sword");
  assert.notEqual(pve.equipped, p.equip_builds_data.gladiator.PvE.equipped);
  assert.notEqual(pve.linked_skill_build, "Main");
  assert.deepEqual(p.skill_builds_data.gladiator[pve.linked_skill_build].layout, p.skill_builds_data.gladiator.Main.layout);
  assert.notEqual(pvp.linked_skill_build, pve.linked_skill_build);
  assert.equal(pve.linked_genius_build, pvp.linked_genius_build, "presets sharing a genius profile share the copy");
  assert.notEqual(pve.linked_genius_build, "Default");
  assert.equal(B.duplicateBuildIn(p, "gladiator", "Default", "Copy"), "Copy 2");
});

test("rename and delete builds keep links consistent; the last build stays", () => {
  const p = B.migrateProfile(oldProfile());
  assert.equal(B.renameBuildIn(p, "gladiator", "Default", "Endgame"), false);
  assert.equal(B.renameBuildIn(p, "gladiator", "Default", "Start"), "Start");
  assert.deepEqual(Object.keys(p.daevanion_builds_data.gladiator), ["Start", "Endgame"]);
  assert.equal(p.equip_builds_data.gladiator.PvE.linked_daevanion_build, "Start");
  assert.equal(p.current_daevanion_build_name, "Start");
  assert.ok(p.daevanion_build_settings.gladiator.Start);
  B.duplicatePresetIn(p, "gladiator", "PvE", "Solo");
  B.selectPresetIn(p, "gladiator", "PvE");
  assert.equal(B.deleteBuildIn(p, "gladiator", "Start"), true);
  assert.deepEqual(Object.keys(p.daevanion_builds_data.gladiator), ["Endgame"]);
  assert.deepEqual(Object.keys(p.equip_builds_data.gladiator), ["Default"]);
  assert.equal(p.current_build_name, "Default");
  assert.equal(p.equip_builds_data.gladiator.Default.character_name, "Calvora");
  assert.ok(!("Solo" in p.skill_builds_data.gladiator), "orphaned skill builds go with their preset");
  assert.equal(B.deleteBuildIn(p, "gladiator", "Endgame"), false);
});

test("presets: new, duplicate, rename, delete (never the last of a build)", () => {
  const p = B.migrateProfile(oldProfile());
  assert.equal(B.newPresetIn(p, "gladiator", "Endgame", "Raid"), "Raid");
  assert.equal(p.equip_builds_data.gladiator.Raid.linked_daevanion_build, "Endgame");
  assert.equal(B.newPresetIn(p, "gladiator", "Endgame", "Raid"), false);
  assert.equal(B.deletePresetIn(p, "gladiator", "Raid"), false);
  assert.equal(B.duplicatePresetIn(p, "gladiator", "PvP", "PvP 2"), "PvP 2");
  const dup = p.equip_builds_data.gladiator["PvP 2"];
  assert.equal(dup.linked_daevanion_build, "Default");
  assert.notEqual(dup.linked_skill_build, "Burst");
  assert.deepEqual(p.skill_builds_data.gladiator[dup.linked_skill_build].arcana_cards, p.skill_builds_data.gladiator.Burst.arcana_cards);
  assert.notEqual(p.skill_builds_data.gladiator[dup.linked_skill_build].levels, p.skill_builds_data.gladiator.Burst.levels);
  assert.equal(p.current_build_name, "PvP 2");
  assert.equal(B.renamePresetIn(p, "gladiator", "PvP 2", "Arena"), "Arena");
  assert.equal(p.current_build_name, "Arena");
  assert.equal(B.deletePresetIn(p, "gladiator", "Arena"), true);
  assert.ok(!("Arena" in p.equip_builds_data.gladiator));
  assert.ok(["PvE", "PvP"].includes(p.current_build_name));
});

test("diff lists only what differs", () => {
  const p = B.migrateProfile(oldProfile());
  p.equip_builds_data.gladiator.PvP.linked_daevanion_build = "Endgame";
  p.skill_builds_data.gladiator.Burst.levels = { 11010000: 12, 11020000: 5 };
  p.skill_builds_data.gladiator.Burst.specs = {};
  p.genius_builds_data.Burst = { Cogni: { 1: { stat: "HP", value: 200 } } };
  p.equip_builds_data.gladiator.PvP.linked_genius_build = "Burst";
  const d = B.diffOf(p, "gladiator", "PvE", "PvP", { skillName: (id) => `skill ${id}` });
  assert.deepEqual(d.equipment.map((r) => [r.slot, r.a.name, r.a.enchant, r.b.name, r.b.enchant]), [["MainHand", "Sword", 7, "Axe", 0]]);
  assert.deepEqual(d.skills, [{ id: "11010000", name: "skill 11010000", a: { level: 10, specs: ["11010020", "11010040"] }, b: { level: 12, specs: [] } }]);
  assert.deepEqual(d.layout.map((r) => [r.where, r.a, r.b]), [["Bar row 4, slot 1", "11010000", null]]);
  assert.deepEqual(d.arcana, [{ cardType: "Vigor", a: null, b: { theme: "Fire", slots: [{ skill_id: "11010000", level: 2 }] } }]);
  assert.deepEqual(d.genius, [{ board: "Cogni", line: 1, a: { stat: "DefenseBonus", value: 160 }, b: { stat: "HP", value: 200 } }]);
  assert.deepEqual(d.daevanion.boards, [
    { board: "11", added: ["110003"], removed: ["110002"], spentA: 2, spentB: 2 },
    { board: "12", added: ["120001"], removed: [], spentA: 0, spentB: 1 },
  ]);
  const self = B.diffOf(p, "gladiator", "PvE", "PvE");
  assert.deepEqual([self.equipment, self.skills, self.layout, self.arcana, self.genius, self.daevanion.boards], [[], [], [], [], [], []]);
});

test("diff uses board data for start nodes and point costs", () => {
  const p = B.migrateProfile(oldProfile());
  p.equip_builds_data.gladiator.PvP.linked_daevanion_build = "Endgame";
  const grid = new Map([["0,0", { id: "120000", g: "start", r: 0, c: 0 }]]);
  const variant = {
    nodes_by_board: new Map([["12", grid]]),
    node_by_id: new Map([["110001", { cost: 1 }], ["110002", { cost: 2 }], ["110003", { cost: 3 }], ["120000", { cost: 0 }], ["120001", { cost: 5 }]]),
  };
  const boards = B.diffOf(p, "gladiator", "PvE", "PvP", { variant }).daevanion.boards;
  assert.deepEqual(boards[0], { board: "11", added: ["110003"], removed: ["110002"], spentA: 3, spentB: 4 });
  assert.deepEqual(boards[1], { board: "12", added: ["120001"], removed: ["120000"], spentA: 0, spentB: 5 });
});
