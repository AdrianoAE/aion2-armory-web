// node --test tests/daevanion.test.mjs
// Ports tests/test_armory_engine_daevanion_multi.py and the Daevanion
// half of tests/test_armory_engine_golden.py. fixtures/daevanion_golden.json
// is the desktop's recorded golden (same inputs as its inputs.py below);
// fixtures/daevanion_random_boards.json holds the 40 seeded boards of the
// Python "close to optimal" test with the Python results for each.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as D from "../js/engine/daevanion.js";

const GOLDEN = JSON.parse(readFileSync(new URL("./fixtures/daevanion_golden.json", import.meta.url)));
const RANDOM = JSON.parse(readFileSync(new URL("./fixtures/daevanion_random_boards.json", import.meta.url)));

const sorted = (s) => [...s].sort();
const trees = (result) => Object.fromEntries(Object.entries(result.trees).map(([k, t]) => [k, sorted(t)]));

function lineBoard(prefix, costs) {
  const nodes = [{ id: `${prefix}0`, r: 1, c: 1, g: "start", cost: 0, e: [] }];
  costs.forEach((cost, i) => nodes.push({ id: `${prefix}${i + 1}`, r: 1, c: i + 2, g: "common", cost, e: [] }));
  return [D.makeGrid(nodes), D.makeNodeIndex(nodes)];
}

function board(key, grid, enabled = true, active = []) {
  return { key, grid, start_id: D.startIdOf(grid), enabled, active: new Set(active) };
}

function merge(...indexes) {
  const out = new Map();
  for (const index of indexes) for (const [k, v] of index) out.set(k, v);
  return out;
}

test("every selected node is taken on every board in the route", () => {
  const [gridA, byA] = lineBoard("a", [1, 4, 1]);
  const [gridB, byB] = lineBoard("b", [2, 2]);
  const groups = [{ key: "g", count: null, nodes: { A: new Set(["a3"]), B: new Set(["b2"]) } }];
  const result = D.planRoute([board("A", gridA), board("B", gridB)], merge(byA, byB), groups);
  assert.deepEqual(trees(result), { A: ["a0", "a1", "a2", "a3"], B: ["b0", "b1", "b2"] });
  assert.equal(result.cost, 10);
  assert.deepEqual(result.unmet, {});
});

test("a wanted number takes the cheapest nodes across boards", () => {
  const [gridA, byA] = lineBoard("a", [3, 3]);
  const [gridB, byB] = lineBoard("b", [1, 1]);
  const groups = [{ key: "g", count: 2, nodes: { A: new Set(["a1", "a2"]), B: new Set(["b1", "b2"]) } }];
  const result = D.planRoute([board("A", gridA), board("B", gridB)], merge(byA, byB), groups);
  assert.deepEqual(trees(result), { A: ["a0"], B: ["b0", "b1", "b2"] });
  assert.equal(result.cost, 2);
});

test("nodes on a board left out of the route count toward the wanted number", () => {
  const [gridA, byA] = lineBoard("a", [1]);
  const [gridB, byB] = lineBoard("b", [1, 1]);
  const groups = [{ key: "g", count: 2, nodes: { A: new Set(["a1"]), B: new Set(["b1", "b2"]) } }];
  const boards = [board("A", gridA, false, ["a0", "a1"]), board("B", gridB)];
  const result = D.planRoute(boards, merge(byA, byB), groups);
  assert.deepEqual(trees(result), { B: ["b0", "b1"] });
  assert.deepEqual(result.unmet, {});
});

test("more than exist is reported as unmet", () => {
  const [gridA, byA] = lineBoard("a", [1, 1]);
  const groups = [{ key: "g", count: 5, nodes: { A: new Set(["a1", "a2"]) } }];
  const result = D.planRoute([board("A", gridA)], byA, groups);
  assert.deepEqual(sorted(result.trees.A), ["a0", "a1", "a2"]);
  assert.deepEqual(result.unmet, { g: 3 });
});

function twoRowBoard() {
  const ids = [[1, 1, "s"], [1, 2, "a"], [1, 3, "b"], [2, 1, "c"], [2, 2, "d"], [2, 3, "t"]];
  const nodes = ids.map(([r, c, id]) => ({ id, r, c, g: id === "s" ? "start" : "common", cost: id === "s" ? 0 : 1, e: [] }));
  return [D.makeGrid(nodes), D.makeNodeIndex(nodes)];
}

test("preferred nodes are the first choice for connecting required ones", () => {
  const [grid, byId] = twoRowBoard();
  const groups = [{ key: "g", count: null, nodes: { A: new Set(["t"]) } }];
  const result = D.planRoute([board("A", grid)], byId, groups, { A: new Set(["d"]) }, 3);
  assert.ok(result.trees.A.has("d") && !result.trees.A.has("b"));
  assert.equal(result.cost, 3);
  assert.equal(result.preferred_taken, 1);
});

test("leftover points buy preferred nodes and stop at the budget", () => {
  const [gridA, byA] = lineBoard("a", [1, 1, 1, 1]);
  const groups = [{ key: "g", count: null, nodes: { A: new Set(["a1"]) } }];
  const result = D.planRoute([board("A", gridA)], byA, groups, { A: new Set(["a2", "a3", "a4"]) }, 3);
  assert.deepEqual(sorted(result.trees.A), ["a0", "a1", "a2", "a3"]);
  assert.equal(result.required_cost, 1);
  assert.equal(result.cost, 3);
  assert.deepEqual([result.preferred_taken, result.preferred_total], [2, 3]);
});

test("preferred nodes are never required", () => {
  const [gridA, byA] = lineBoard("a", [1, 1]);
  const result = D.planRoute([board("A", gridA)], byA, [], { A: new Set(["a2"]) }, 1);
  assert.equal(result.over_budget, false);
  assert.deepEqual(sorted(result.trees.A), ["a0"]);
});

test("required nodes over the budget are flagged", () => {
  const [gridA, byA] = lineBoard("a", [2, 2]);
  const groups = [{ key: "g", count: null, nodes: { A: new Set(["a2"]) } }];
  const result = D.planRoute([board("A", gridA)], byA, groups, undefined, 3);
  assert.equal(result.over_budget, true);
  assert.equal(result.required_cost, 4);
});

function connected(grid, byId, nodes) {
  const first = nodes.values().next().value;
  const seen = new Set([first]);
  const queue = [first];
  while (queue.length) {
    const n = byId.get(queue.pop());
    for (const [r, c] of D.neighbors(n.r, n.c)) {
      const nb = grid.get(D.gridKey(r, c));
      if (nb && nodes.has(nb.id) && !seen.has(nb.id)) { seen.add(nb.id); queue.push(nb.id); }
    }
  }
  return seen.size === nodes.size;
}

function* combinations(items, k, start = 0, chosen = []) {
  if (chosen.length === k) { yield chosen; return; }
  for (let i = start; i <= items.length - (k - chosen.length); i++) yield* combinations(items, k, i + 1, [...chosen, items[i]]);
}

function optimum(grid, byId, start, wanted) {
  const fixed = new Set([...wanted, start]);
  let base = 0;
  for (const n of fixed) base += byId.get(n).cost;
  const optional = [...grid.values()].filter((n) => n.g !== "empty" && !fixed.has(n.id)).map((n) => n.id).sort((a, b) => byId.get(a).cost - byId.get(b).cost);
  const cheapest = [0];
  for (const o of optional) cheapest.push(cheapest[cheapest.length - 1] + byId.get(o).cost);
  let best = null;
  for (let k = 0; k <= optional.length; k++) {
    if (best !== null && base + cheapest[k] >= best) break;
    for (const extra of combinations(optional, k)) {
      const cost = base + extra.reduce((s, n) => s + byId.get(n).cost, 0);
      if ((best === null || cost < best) && connected(grid, byId, new Set([...fixed, ...extra]))) best = cost;
    }
  }
  return best;
}

test("routes are close to optimal, never worse than the old router, and match the Python results", () => {
  let checked = 0, optimal = 0;
  for (const c of RANDOM) {
    const grid = D.makeGrid(c.nodes), byId = D.makeNodeIndex(c.nodes);
    const wanted = new Set(c.wanted);
    const old = D.computeAutoRoute(grid, byId, wanted, c.start);
    assert.deepEqual(sorted(old.skipped), c.old_skipped);
    // The old router picks among equally cheap wanted nodes in Python set
    // order, which varies with PYTHONHASHSEED; the fixture holds every
    // value Python produced across seeds.
    assert.ok(c.old_spent_seen.includes(old.spent), `old router spent ${old.spent}, Python saw ${c.old_spent_seen}`);
    if (old.skipped.size) continue;
    const result = D.planRoute([board("b", grid)], byId, [{ key: "g", count: null, nodes: { b: wanted } }]);
    for (const w of wanted) assert.ok(result.trees.b.has(w));
    assert.ok(result.cost <= old.spent);
    assert.equal(result.cost, c.plan_cost);
    assert.deepEqual(sorted(result.trees.b), c.plan_tree);
    checked += 1;
    const best = optimum(grid, byId, c.start, wanted);
    assert.equal(best, c.optimum);
    optimal += result.cost === best ? 1 : 0;
  }
  assert.ok(checked >= 30);
  assert.ok(optimal >= checked - 2);
});

// ── golden (tests/fixtures/armory_engine/inputs.py DAEVANION_NODES) ─────────

const NODES = [
  { id: "n00", r: 0, c: 0, g: "start", cost: 0, e: [{ t: "s", n: "Attack Bonus", v: 5 }] },
  { id: "n01", r: 0, c: 1, g: "normal", cost: 2, e: [{ t: "s", n: "Max MP", v: 40 }] },
  { id: "n02", r: 0, c: 2, g: "normal", cost: 1, e: [{ t: "s", n: "Accuracy", v: 7 }] },
  { id: "n03", r: 0, c: 3, g: "empty", cost: 0, e: [] },
  { id: "n04", r: 0, c: 4, g: "normal", cost: 3, e: [{ t: "s", n: "Critical", v: 9 }] },
  { id: "n10", r: 1, c: 0, g: "normal", cost: 2, e: [{ t: "s", n: "Max MP", v: 40 }] },
  { id: "n11", r: 1, c: 1, g: "normal", cost: 4, e: [{ t: "s", n: "Defense", v: 30 }] },
  { id: "n12", r: 1, c: 2, g: "empty", cost: 0, e: [] },
  { id: "n13", r: 1, c: 3, g: "normal", cost: 2, e: [{ t: "s", n: "Evasion", v: 6 }] },
  { id: "n14", r: 1, c: 4, g: "normal", cost: 1, e: [{ t: "k", n: "skill", v: 1, skill_id: "9001" }] },
  { id: "n20", r: 2, c: 0, g: "normal", cost: 1, e: [{ t: "s", n: "Block", v: 12 }] },
  { id: "n21", r: 2, c: 1, g: "normal", cost: 1, e: [{ t: "s", n: "Max MP", v: 40 }] },
  { id: "n22", r: 2, c: 2, g: "normal", cost: 5, e: [{ t: "s", n: "Attack Bonus", v: 22 }] },
  { id: "n23", r: 2, c: 3, g: "normal", cost: 1, e: [{ t: "s", n: "Perfect", v: 4 }] },
  { id: "n24", r: 2, c: 4, g: "normal", cost: 2, e: [{ t: "s", n: "Restoration", v: 8 }] },
  { id: "n30", r: 3, c: 0, g: "normal", cost: 3, e: [{ t: "s", n: "Damage Boost", v: 2 }] },
  { id: "n31", r: 3, c: 1, g: "normal", cost: 2, e: [{ t: "s", n: "Iron Wall", v: 11 }] },
  { id: "n32", r: 3, c: 2, g: "normal", cost: 1, e: [{ t: "s", n: "Accuracy", v: 7 }] },
  { id: "n33", r: 3, c: 3, g: "normal", cost: 4, e: [{ t: "s", n: "Critical", v: 15 }] },
  { id: "n34", r: 3, c: 4, g: "empty", cost: 0, e: [] },
  { id: "n40", r: 4, c: 0, g: "normal", cost: 2, e: [{ t: "s", n: "Defense", v: 30 }] },
  { id: "n41", r: 4, c: 1, g: "normal", cost: 5, e: [{ t: "s", n: "Attack Bonus", v: 22 }] },
  { id: "n42", r: 4, c: 2, g: "normal", cost: 3, e: [{ t: "s", n: "Block", v: 12 }] },
  { id: "n43", r: 4, c: 3, g: "empty", cost: 0, e: [] },
  { id: "n44", r: 4, c: 4, g: "normal", cost: 6, e: [{ t: "s", n: "Amplify All Damage", v: 3 }] },
];
const START_ID = "n00";
const CASES = {
  single_target: ["n22"],
  spread: ["n04", "n22", "n40"],
  unreachable: ["n04", "n22", "n44"],
  many: ["n04", "n14", "n22", "n24", "n33", "n41", "n42"],
};
const GRID = D.makeGrid(NODES);
const BY_ID = D.makeNodeIndex(NODES);

test("the board cap is unchanged", () => {
  assert.equal(D.totalCost(GRID), GOLDEN.daevanion_total_cost);
  assert.equal(D.spentCost(new Set(["n00", "n01", "n22"]), BY_ID), GOLDEN.daevanion_spent_cost);
});

test("the Max MP tiebreak input is unchanged", () => {
  for (const [nodeId, expected] of Object.entries(GOLDEN.daevanion_mp_counts)) {
    assert.equal(D.nodeMpCount(BY_ID.get(nodeId)), expected, nodeId);
  }
});

test("reachability is unchanged", () => {
  for (const [nodeId, expected] of Object.entries(GOLDEN.daevanion_reachable)) {
    assert.equal(D.isReachable(BY_ID.get(nodeId), GRID, new Set(["n00", "n21"])), expected, nodeId);
  }
});

test("the Dijkstra reproduces its recorded distances and parents", () => {
  const { dist, prev } = D.shortestFromTree(GRID, new Set([START_ID]), BY_ID);
  const recorded = Object.fromEntries([...dist].map(([nid, d]) => [nid, d[0] === Infinity ? null : d]));
  assert.deepEqual(recorded, GOLDEN.daevanion_dist_from_start);
  assert.deepEqual(Object.fromEntries(prev), GOLDEN.daevanion_prev_from_start);
});

test("the auto route reproduces its recorded routes", () => {
  for (const golden of GOLDEN.daevanion_routes) {
    const result = D.computeAutoRoute(GRID, BY_ID, new Set(CASES[golden.name]), START_ID);
    assert.deepEqual(sorted(result.tree), golden.tree, golden.name);
    assert.deepEqual(sorted(result.included), golden.included, golden.name);
    assert.deepEqual(sorted(result.skipped), golden.skipped, golden.name);
    assert.equal(result.spent, golden.spent, golden.name);
    assert.equal(result.cap, golden.cap, golden.name);
    assert.ok(golden.spent <= golden.cap);
  }
});

test("an unreachable target makes the router abandon the rest", () => {
  const result = D.computeAutoRoute(GRID, BY_ID, new Set(CASES.unreachable), START_ID);
  assert.deepEqual(sorted(result.skipped), ["n44"]);
  assert.deepEqual(sorted(result.included), ["n04", "n22"]);
  assert.ok(result.spent <= result.cap);
});

test("the router reproduces its recorded route on the twelve random boards", () => {
  for (const golden of GOLDEN.daevanion_random) {
    const grid = D.makeGrid(golden.nodes), byId = D.makeNodeIndex(golden.nodes);
    const start = golden.nodes.find((n) => n.g === "start").id;
    const result = D.computeAutoRoute(grid, byId, new Set(golden.wanted), start);
    assert.deepEqual(sorted(result.tree), golden.tree, `seed${golden.seed}`);
    assert.deepEqual(sorted(result.included), golden.included, `seed${golden.seed}`);
    assert.deepEqual(sorted(result.skipped), golden.skipped, `seed${golden.seed}`);
    assert.equal(result.spent, golden.spent, `seed${golden.seed}`);
  }
});

// ── the app.py helpers moved next to the router ─────────────────────────────

const SKILLS = new Map([["9001", { id: "9001", name: "Shadow Fall", type: "active" }]]);

test("node labels: skill name, short codes for 1-point stats, full names otherwise", () => {
  assert.equal(D.nodeLabel(BY_ID.get("n14"), SKILLS), "Shadow Fall");
  assert.equal(D.nodeLabel(BY_ID.get("n02"), SKILLS), "ACC");
  assert.equal(D.nodeLabel(BY_ID.get("n22"), SKILLS), "Attack");
  assert.equal(D.nodeLabel({ cost: 1, e: [{ t: "s", n: "HP" }, { t: "s", n: "Combat Speed" }] }, SKILLS), "HP / Combat Speed");
  assert.equal(D.nodeLabel({ cost: 3, e: [{ t: "s", n: "PvPAddDamage" }, { t: "s", n: "fixingdamage" }] }, SKILLS), "PvP Attack + Attack");
  assert.equal(D.nodeLabel({ cost: 0, e: [] }, SKILLS), "");
});

test("effect lines scale percent stats by 1/100 with one decimal", () => {
  assert.deepEqual(D.effectLines({ e: [{ t: "s", n: "Combat Speed", v: 250 }] }, SKILLS), [["Combat Speed", "+2.5%"]]);
  assert.deepEqual(D.effectLines({ e: [{ t: "s", n: "Critical Hit", v: 235 }] }, SKILLS), [["Critical Hit", "+235"]]);
  assert.deepEqual(D.effectLines(BY_ID.get("n14"), SKILLS), [["Shadow Fall", "+1 Lvl"]]);
  assert.deepEqual(D.effectLines({ e: [{ t: "k", v: 2, skill_id: "77" }] }, SKILLS), [["Skill #77", "+2 Lvl"]]);
});

test("stat totals sum by Stat Info id, the summary by display label", () => {
  const active = new Set(["n00", "n01", "n10", "n22"]);
  assert.deepEqual(D.statTotals(BY_ID, active), { WeaponFixingDamage: 27, MPMax: 80 });
  assert.deepEqual(D.activeStatSummary(BY_ID, active), [["Attack", 27, false], ["Max MP", 80, false]]);
  assert.deepEqual(D.activeStatSummary(BY_ID, new Set(["n44"])), [["Amplify All Damage", 0.03, true]]);
});

test("skill bonus sums +level over every board of the class", () => {
  const raw = {
    boards: [{ id: "1", name: "A", classId: "ranger", order: 1 }, { id: "2", name: "B", classId: "ranger", order: 2 }, { id: "3", name: "C", classId: "fighter", order: 1 }],
    nodes: [
      { id: "x1", b: "1", r: 1, c: 1, g: "legend", cost: 2, e: [{ t: "k", v: 1, skill_id: 9001 }] },
      { id: "x2", b: "2", r: 1, c: 1, g: "legend", cost: 2, e: [{ t: "k", v: 2, skill_id: 9001 }, { t: "k", v: 1, skill_id: 9002 }] },
      { id: "x3", b: "3", r: 1, c: 1, g: "legend", cost: 2, e: [{ t: "k", v: 5, skill_id: 9001 }] },
    ],
  };
  const variant = D.variantIndex(raw);
  assert.deepEqual(variant.class_ids, ["ranger"]);
  assert.equal(variant.node_by_id.has("x3"), false);
  assert.deepEqual(D.skillBonusFromBoards(variant, "ranger", { "s:1": ["x1"], "s:2": new Set(["x2"]) }), { 9001: 3, 9002: 1 });
  assert.deepEqual(D.skillBonusFromBoards(variant, "ranger", { "s:1": ["x1"], "s:2": ["x2"] }, "a"), {});
});

test("filter groups bucket single stats, combined stats and skills by type", () => {
  const groups = D.buildFilterGroups(GRID, SKILLS);
  assert.deepEqual(sorted(groups.substats["Max MP"].ids), ["n01", "n10", "n21"]);
  assert.equal(groups.substats["Max MP"].label, "Max MP");
  assert.deepEqual(sorted(groups.active["9001"].ids), ["n14"]);
  assert.equal(groups.active["9001"].label, "Shadow Fall");
  assert.deepEqual(groups.passive, {});
  const combined = D.buildFilterGroups(D.makeGrid([{ id: "c", r: 1, c: 1, g: "rare", cost: 2, e: [{ t: "s", n: "MP" }, { t: "s", n: "HP" }] }]), SKILLS);
  assert.deepEqual(Object.keys(combined.combined), ["HP+MP"]);
  assert.equal(combined.combined["HP+MP"].label, "Max HP + Max MP");
  assert.equal(D.entryAccentGrade(new Set(["common", "rare"])), "Rare");
  assert.equal(D.entryAccentGrade(new Set(["common"])), null);
});

test("pruning drops the branch cut off from start, not just the clicked node", () => {
  const [grid, byId] = lineBoard("a", [1, 1, 1]);
  const active = new Set(["a0", "a2", "a3"]);
  D.pruneUnreachable(grid, active, byId);
  assert.deepEqual(sorted(active), ["a0"]);
});

test("route settings and saved sets keep the desktop's JSON shapes", () => {
  assert.deepEqual(D.routeSettingsFromJson({ budget: 0, disabled_boards: ["s:2", "s:1"], skip: { "s:1": ["substats|HP"] } }),
    { budget: null, disabled_boards: ["s:1", "s:2"], skip: { "s:1": ["substats|HP"] } });
  assert.deepEqual(D.routeSettingsFromJson({ budget: 120.0 }).budget, 120);
  assert.deepEqual(D.routeSettingsToJson({ budget: 5, disabled_boards: new Set(["b", "a"]), skip: { x: [], y: new Set(["k"]) } }),
    { budget: 5, disabled_boards: ["a", "b"], skip: { y: ["k"] } });
  const variant = D.variantIndex({ boards: [{ id: "1", classId: "ranger", order: 1 }], nodes: [{ id: "s1", b: "1", r: 8, c: 8, g: "start", cost: 0, e: [] }, { id: "n1", b: "1", r: 8, c: 9, g: "common", cost: 1, e: [] }] });
  assert.deepEqual(D.savedSets({ "s:1": new Set(["s1"]), "s:2": new Set(["n1", "s1"]) }, () => variant), { "s:2": ["n1", "s1"] });
});
