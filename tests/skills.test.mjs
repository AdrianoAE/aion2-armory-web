// node --test tests/   (the pure Skill Planner / Skill Layout helpers)
import { test } from "node:test";
import assert from "node:assert/strict";
import * as skills from "../js/engine/skills.js";

const spec = (id, lvl, note) => ({ id, parentSkillLvl: lvl, specialized: note });
const active = { id: "A1", type: "active", name: "Aerial Snare", specializations: [spec(10, 8, "Multi-Hit"), spec(20, 8, "Airborne"), spec(30, 12, "Chain"), spec(40, 16, "-10s cooldown")] };
const stigma = { id: "S1", type: "stigma", name: "Rage Burst", cooldown: 90000, specializations: [spec(1, 5, "-30s cooldown"), spec(2, 10, "More"), spec(3, 15, "Even more")] };

test("effective level floors at 1, layout level does not", () => {
  assert.equal(skills.effectiveLevel(0, 0, 0), 1);
  assert.equal(skills.effectiveLevel(8, 2, 4), 14);
  assert.equal(skills.layoutLevel(0, 0, 0), 0);
  assert.equal(skills.layoutLevel(5, 2, 1), 8);
});

test("active spec cap: 1 pick at Lv.8, 2 at Lv.12, 3 at Lv.20", () => {
  assert.deepEqual([1, 7, 8, 11, 12, 19, 20, 40].map(skills.activeSpecCap), [0, 0, 1, 1, 2, 2, 3, 3]);
});

test("monolith skill points follow the Wisdom Stone tiers", () => {
  assert.equal(skills.monolithSkillpoints(0), 0);
  assert.equal(skills.monolithSkillpoints(2), 1);
  assert.equal(skills.monolithSkillpoints(9), 15);
  assert.equal(skills.monolithSkillpoints(15), 34);
  assert.equal(skills.monolithSkillpoints(30), 112);
  assert.equal(skills.monolithSkillpoints(99), 112);
});

test("skill points: only the first 10 levels of non-stigma skills cost points", () => {
  const typeById = { a: "active", p: "passive", s: "stigma" };
  assert.equal(skills.skillPointsRemaining({}, typeById, 0), 44);
  assert.equal(skills.skillPointsRemaining({ a: 12, p: 3, s: 20 }, typeById, 0), 44 - 10 - 3);
  assert.equal(skills.skillPointsRemaining({ a: 10, p: 10, s: 5 }, typeById, 30), 44 + 112 - 20);
  assert.equal(skills.skillPointsRemaining({ a: 10, p: 10 }, typeById, 0), 24);
  assert.equal(skills.stigmaPointsSpent({ a: 10, s: 7 }, typeById), 7);
});

test("specs in effect: active skills show picked ones, stigma every unlocked tier", () => {
  const chosen = new Set(["20"]);
  let r = skills.specsInEffect(active, 9, chosen);
  assert.deepEqual(r.unlocked.map((s) => s.id), [10, 20]);
  assert.deepEqual(r.applied.map((s) => s.id), [20]);
  assert.equal(r.state, "chosen");
  r = skills.specsInEffect(active, 7, chosen);
  assert.deepEqual(r.applied, []);
  r = skills.specsInEffect(stigma, 12, new Set());
  assert.deepEqual(r.applied.map((s) => s.id), [1, 2]);
  assert.equal(r.state, "unlocked");
  assert.equal(skills.specsHtml(active, 9, new Set()), `<span class="spec-none">No specialization chosen</span>`);
  assert.equal(skills.specsHtml(active, 3, new Set()), "");
  assert.match(skills.specsHtml(stigma, 5, new Set()), /spec-unlocked">Lv 5: -30s cooldown</);
});

test("level html colours manual white, bonus accent, wish secondary", () => {
  assert.equal(skills.formatLevelHtml(8, 0, 0), `<span class="lv-manual">8</span>`);
  assert.equal(skills.formatLevelHtml(8, 2, 4), `<span class="lv-manual">8</span> <span class="lv-bonus">(+2)</span> <span class="lv-wish">(+4)</span>`);
});

test("own flat cooldown reduction: stigma by level, active only when picked", () => {
  assert.equal(skills.cooldownReductionMs(stigma, 4, null), 0);
  assert.equal(skills.cooldownReductionMs(stigma, 5, null), 30000);
  assert.equal(skills.cooldownReductionMs(active, 16, new Set()), 0);
  assert.equal(skills.cooldownReductionMs(active, 16, new Set(["40"])), 10000);
  assert.equal(skills.cooldownReductionMs(active, 15, new Set(["40"])), 0);
  assert.match(skills.formatSkillStats(stigma, 30000), /<b>Cooldown:<\/b> 60s <span class="ok">\(-30s\)<\/span>/);
});

test("skill stats lines", () => {
  const s = { consumed: { mp: 150, hp: 0 }, cooldown: 45000, range: { min: 400, max: 400 }, requiredWeapons: ["greatsword"] };
  assert.equal(skills.formatSkillStats(s), "<b>Cost:</b> 150 MP<br><b>Cooldown:</b> 45s<br><b>Range:</b> 4m<br><b>Required weapon(s):</b> Greatsword");
  assert.equal(skills.formatSkillStats({ range: { min: 100, max: 2500 } }), "<b>Range:</b> 1-25m");
  assert.equal(skills.formatSkillStats({}), "—");
});

test("level value skips a bogus placeholder entry but keeps the first real one", () => {
  const levels = [
    { level: 1, minValue: "TargetLocation_X", maxValue: "100" }, { level: 1, minValue: "435", maxValue: "435" },
    { level: 1, minValue: "180", maxValue: "198" }, { level: 2, minValue: "571", maxValue: "571" },
  ];
  assert.equal(skills.levelValue(levels, 1, "minValue"), "435");
  assert.equal(skills.levelValue(levels, 2, "maxValue"), "571");
  assert.equal(skills.levelValue([{ level: 1 }], 1, "minValue"), undefined);
});

test("description tokens resolve from the per-level data, else XXX", () => {
  const text = 'Deals <span style="color: #FCC78B">{se_dmg:1:SkillUIMinDmgSum}-{se_dmg:1:SkillUIMaxDmgSum}</span> damage\n20 Stagger';
  const levels = [{ level: 1, minValue: "435", maxValue: "435" }, { level: 2, minValue: "571", maxValue: "571" }];
  assert.equal(skills.renderSkillDescription(text, levels, 2), 'Deals <span style="color: #FCC78B">571-571</span> damage<br>20 Stagger');
  assert.equal(skills.renderSkillDescription(text, [{ level: 1, minValue: "FALSE", maxValue: "DeBuff" }], 1), 'Deals <span style="color: #FCC78B">XXX-XXX</span> damage<br>20 Stagger');
  assert.equal(skills.renderSkillDescription("{se_abe_dmg:1709000011:1709000011:SkillUIHotMin:tick}", levels, 1), "XXX");
});

test("passive descriptions get their level number and a Lvl. note", () => {
  const html = skills.passiveDescriptionWithLevel("18750000", 'PvE +<span style="color: #FCC78B">5.5%</span>, PvP +<span style="color: #FCC78B">2.75%</span>, Def <span style="color: #FCC78B">2%</span>', 10);
  assert.match(html, /^<span class="lv-note">Lvl\. 10<\/span><br>/);
  assert.match(html, /PvE \+<span style="color: #FCC78B">10%<\/span>, PvP \+<span style="color: #FCC78B">5%<\/span>, Def <span style="color: #FCC78B">20%<\/span>/);
  assert.equal(skills.passiveDescriptionWithLevel("nope", "plain", 5), "plain");
  assert.equal(skills.formatPassiveScaledValue(18.5556), "18.6");
  assert.equal(skills.formatPassiveScaledValue(20), "20");
});

test("stigma description folds in the highest unlocked tier with the same span count", () => {
  const s = {
    id: "S9", type: "stigma", description: "Base <span style=\"color: #FCC78B\">1</span>.",
    specializations: [
      { parentSkillLvl: 10, description: "Tier10 <span style=\"color: #FCC78B\">1</span>." },
      { parentSkillLvl: 5, description: "Tier5 <span style=\"color: #FCC78B\">1</span>." },
      { parentSkillLvl: 15, description: "Tier15 <span style=\"color: #FCC78B\">1</span> <span style=\"color: #FCC78B\">2</span>." },
    ],
  };
  assert.equal(skills.describeSkill(s, 4), "Base <span style=\"color: #FCC78B\">1</span>.");
  assert.equal(skills.describeSkill(s, 12), "Tier10 <span style=\"color: #FCC78B\">1</span>.");
  assert.equal(skills.describeSkill(s, 20), "Tier10 <span style=\"color: #FCC78B\">1</span>.");
});

test("arcana ceiling: +4 per eligible lord type of the right category", () => {
  const info = { arcana: [{ cardType: "Chalice", theme: "Vigor" }, { cardType: "Parchment", theme: "Magic" }, { cardType: "Bell", theme: "Vigor" }, { cardType: "Scales", theme: "Frenzy" }] };
  const usable = skills.arcanaUsableLordTypes(info);
  assert.deepEqual(usable, ["Chalice", "Parchment", "Bell"]);
  const classSkills = { Chalice: { Unique: { gladiator: [{ id: "A1" }, { id: "P1" }] } }, Parchment: { Rare: { gladiator: [{ id: "A1" }] } }, Bell: { Unique: { gladiator: [{ id: "A1" }] } } };
  const pools = skills.arcanaClassPools(classSkills, "Gladiator", usable);
  assert.equal(skills.arcanaCeiling("A1", "active", usable, pools), 8);
  assert.equal(skills.arcanaCeiling("P1", "passive", usable, pools), 4);
  assert.equal(skills.arcanaCeiling("X", "active", usable, pools), 0);
});

test("arcana card bonus sums slot levels, old skill_ids shape included", () => {
  const build = { arcana_cards: { Chalice: { slots: [{ skill_id: "A1", level: 3 }, null, { skill_id: "P1", level: 1 }, null] }, Bell: { skill_ids: { A1: 2 } } } };
  assert.deepEqual(skills.arcanaCardSkillBonus(build), { A1: 5, P1: 1 });
});

test("daevanion board bonus adds every active skill_level node of the class", () => {
  const boards = {
    boards: [{ id: "41", classId: "assassin" }, { id: "11", classId: "gladiator" }],
    nodes: [
      { id: "410037", b: "41", r: 0, c: 0, e: [{ t: "k", v: 1, skill_id: 13720000 }] }, { id: "410039", b: "41", r: 0, c: 1, e: [{ t: "k", v: 2, skill_id: 13720000 }] },
      { id: "410040", b: "41", r: 1, c: 0, e: [{ t: "s", v: 100 }] }, { id: "110001", b: "11", r: 0, c: 0, e: [{ t: "k", v: 1, skill_id: 11300000 }] },
    ],
  };
  assert.deepEqual(skills.skillBonusFromBoards("assassin", { "s:41": ["410037", "410039", "410040", "missing"], "s:11": ["110001"] }, boards), { 13720000: 3 });
  assert.deepEqual(skills.skillBonusFromBoards("Spiritmaster", {}, boards), {});
});

test("current skill build follows the equip set's link, then the last viewed, then the first", () => {
  const p = { character_class: "Gladiator", current_build_name: "PvP", current_skill_build_name: "Default",
    skill_builds_data: { gladiator: { Default: skills.emptyBuildState(), Burst: skills.emptyBuildState() } },
    equip_builds_data: { gladiator: { PvP: { linked_skill_build: "Burst" } } } };
  assert.equal(skills.currentSkillBuildName(p, "gladiator"), "Burst");
  p.equip_builds_data.gladiator.PvP.linked_skill_build = "gone";
  assert.equal(skills.currentSkillBuildName(p, "gladiator"), "Default");
  p.current_skill_build_name = "nope";
  assert.equal(skills.currentSkillBuildName(p, "gladiator"), "Default");
  skills.setCurrentSkillBuild(p, "gladiator", "Burst");
  assert.equal(p.current_skill_build_name, "Burst");
  assert.equal(p.equip_builds_data.gladiator.PvP.linked_skill_build, "Burst");
  assert.deepEqual(Object.keys(skills.ensureClassBuilds(p, "cleric")), ["Default"]);
});

test("empty layout has the default key row", () => {
  const layout = skills.emptyLayout();
  assert.deepEqual(layout.slots, {});
  assert.deepEqual(layout.macro, []);
  assert.equal(layout.keys["4,0"], "1");
  assert.equal(layout.keys["4,6"], "@mouse_forward");
  assert.equal(layout.keys["4,11"], "@mouse_right");
  const copy = skills.layoutCopy(layout);
  copy.keys["4,0"] = "Z";
  assert.equal(layout.keys["4,0"], "1");
  assert.deepEqual(skills.normalizeLayout({ slots: { "4,2": "X", "3,2": "Y" } }).slots, { "3,2": "Y" });
});

test("bar contents: the key row shows the lowest skill of each column", () => {
  const layout = skills.emptyLayout();
  layout.slots["0,3"] = "top";
  layout.slots["2,3"] = "low";
  layout.slots["3,5"] = "only";
  const contents = skills.barContents(layout);
  assert.deepEqual(contents["4,3"], ["low", "4"]);
  assert.deepEqual(contents["4,5"], ["only", "X"]);
  assert.deepEqual(contents["4,0"], [null, "1"]);
  assert.deepEqual(contents["0,3"], ["top", ""]);
  assert.equal(Object.keys(contents).length, 60);
});

test("placing on the bar moves a skill off any other slot; the key row refuses", () => {
  const layout = skills.emptyLayout();
  assert.equal(skills.placeSkill(layout, ["bar", "3,0"], "A"), true);
  assert.equal(skills.placeSkill(layout, ["bar", "1,4"], "A"), true);
  assert.deepEqual(layout.slots, { "1,4": "A" });
  assert.equal(skills.placeSkill(layout, ["bar", "4,0"], "B"), false);
  assert.deepEqual(layout.slots, { "1,4": "A" });
});

test("macro: replace a step, append on the empty one, never more than 4", () => {
  const layout = skills.emptyLayout();
  skills.placeSkill(layout, ["macro", 0], "A");
  skills.placeSkill(layout, ["macro", 1], "B");
  skills.placeSkill(layout, ["macro", 0], "C");
  assert.deepEqual(layout.macro, ["C", "B"]);
  skills.placeSkill(layout, ["macro", 2], "D");
  skills.placeSkill(layout, ["macro", 3], "E");
  assert.equal(skills.placeSkill(layout, ["macro", 4], "F"), false);
  assert.deepEqual(layout.macro, ["C", "B", "D", "E"]);
  assert.equal(skills.removeAt(layout, ["macro", 1]), true);
  assert.deepEqual(layout.macro, ["C", "D", "E"]);
  assert.equal(skills.removeAt(layout, ["macro", 7]), false);
});

test("drops: list onto bar, bar swap/move, bar to macro, macro reorder", () => {
  const layout = skills.emptyLayout();
  assert.equal(skills.dropped(layout, ["list", "A"], ["bar", "3,0"]), true);
  assert.equal(skills.dropped(layout, ["list", "B"], ["bar", "3,1"]), true);
  assert.equal(skills.dropped(layout, ["bar", "3,0"], ["bar", "3,1"]), true);
  assert.deepEqual(layout.slots, { "3,0": "B", "3,1": "A" });
  assert.equal(skills.dropped(layout, ["bar", "3,1"], ["bar", "2,1"]), true);
  assert.deepEqual(layout.slots, { "3,0": "B", "2,1": "A" });
  assert.equal(skills.dropped(layout, ["bar", "3,0"], ["bar", "4,0"]), false);
  assert.equal(skills.dropped(layout, ["bar", "0,0"], ["bar", "1,0"]), false);
  assert.equal(skills.dropped(layout, ["bar", "3,0"], ["macro", 0]), true);
  assert.deepEqual(layout.macro, ["B"]);
  assert.deepEqual(layout.slots, { "3,0": "B", "2,1": "A" });
  skills.dropped(layout, ["list", "C"], ["macro", 1]);
  skills.dropped(layout, ["list", "D"], ["macro", 2]);
  assert.equal(skills.dropped(layout, ["macro", 2], ["macro", 0]), true);
  assert.deepEqual(layout.macro, ["D", "B", "C"]);
  assert.equal(skills.dropped(layout, ["macro", 0], ["bar", "0,0"]), true);
  assert.deepEqual(layout.slots, { "0,0": "D", "3,0": "B", "2,1": "A" });
  assert.deepEqual(layout.macro, ["D", "B", "C"]);
  assert.equal(skills.dropped(layout, ["macro", 9], ["macro", 0]), false);
  assert.equal(skills.dropped(layout, ["bar", "0,0"], ["bar", "0,0"]), false);
  assert.equal(skills.removeAt(layout, ["bar", "0,0"]), true);
  assert.equal(skills.removeAt(layout, ["bar", "0,0"]), false);
});

test("two-line palette labels break near the middle", () => {
  assert.equal(skills.twoLineLabel("Aerial Snare"), "Aerial Snare");
  assert.equal(skills.twoLineLabel("Sword Aura Rampage"), "Sword Aura\nRampage");
  assert.equal(skills.twoLineLabel("Supercalifragilistic"), "Supercalifragilistic");
});

test("class data key maps Spiritmaster to elementalist", () => {
  assert.equal(skills.classDataKey("Spiritmaster"), "elementalist");
  assert.equal(skills.classDataKey(" Gladiator "), "gladiator");
});
