// Daevanion Board maths: a 1:1 port of the desktop's
// ItemDatabase/armory_engine/daevanion.py (router, reachability, costs,
// multi-board Steiner planner) plus the Qt-free helpers that lived in
// app.py next to it (variant indexes, node labels, effect lines, stat
// totals, filter groups, skill bonus, set/settings JSON shapes).
//
// Grids are Maps keyed "r,c" in data order (the Python dict keyed by
// (r, c)); node_by_id is a Map; active sets are Sets. The stage-1 Dijkstra
// keeps the linear scan of the Python (its first-minimum-in-grid-order tie
// break decides which equal-cost path is materialised); the planner uses a
// binary heap ordered (distance, grid index, id) like the Python heapq.

export const GRID_SIZE = 15;
export const DISABLED_CLASSES = new Set(["fighter"]);
export const SKILLS_DATA_CLASS_ALIASES = { spiritmaster: "elementalist" };

export function skillsDataClassKey(displayName) {
  const key = (displayName || "").trim().toLowerCase();
  return SKILLS_DATA_CLASS_ALIASES[key] || key;
}

export function gridKey(r, c) { return `${r},${c}`; }

export function makeGrid(nodes) {
  const grid = new Map();
  for (const n of nodes) grid.set(gridKey(n.r, n.c), n);
  return grid;
}

export function makeNodeIndex(nodes) {
  const byId = new Map();
  for (const n of nodes) byId.set(n.id, n);
  return byId;
}

export function startIdOf(grid) {
  for (const n of grid.values()) if (n.g === "start") return n.id;
  return null;
}

// ── variant indexes (app.py _daevanion_variant) ────────────────────────────

export function variantIndex(raw) {
  const boards = (raw.boards || []).filter((b) => !DISABLED_CLASSES.has(b.classId));
  const allowed = new Set(boards.map((b) => b.id));
  const nodes = (raw.nodes || []).filter((n) => allowed.has(n.b));
  const boardByClassOrder = new Map();
  for (const b of boards) boardByClassOrder.set(`${b.classId}:${b.order}`, b);
  const nodesByBoard = new Map();
  const nodeById = new Map();
  for (const n of nodes) {
    if (!nodesByBoard.has(n.b)) nodesByBoard.set(n.b, new Map());
    nodesByBoard.get(n.b).set(gridKey(n.r, n.c), n);
    nodeById.set(n.id, n);
  }
  return {
    boards,
    class_ids: [...new Set(boards.map((b) => b.classId))].sort(),
    deity_orders: [...new Set(boards.map((b) => b.order))].sort((a, b) => a - b),
    board_by_class_order: boardByClassOrder,
    nodes_by_board: nodesByBoard,
    node_by_id: nodeById,
  };
}

const variantCache = new Map();

export async function loadVariant(variant = "s", base = "") {
  if (!variantCache.has(variant)) {
    variantCache.set(variant, fetch(`${base}data/daevanion_boards_${variant}.json`)
      .then((r) => (r.ok ? r.json() : { boards: [], nodes: [] }))
      .then((raw) => variantIndex(raw)));
  }
  return variantCache.get(variant);
}

export function classBoards(variant, classKey) {
  return variant.boards.filter((b) => b.classId === classKey).sort((a, b) => a.order - b.order);
}

// ── stage-1 router (verbatim port) ──────────────────────────────────────────

export function neighbors(r, c) {
  return [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]];
}

export function isReachable(node, grid, active) {
  if (active.has(node.id)) return true;
  for (const [r, c] of neighbors(node.r, node.c)) {
    const nb = grid.get(gridKey(r, c));
    if (nb && nb.g !== "empty" && active.has(nb.id)) return true;
  }
  return false;
}

export function totalCost(grid) {
  let sum = 0;
  for (const n of grid.values()) sum += n.cost;
  return sum;
}

export function spentCost(active, nodeById) {
  let sum = 0;
  for (const nid of active) if (nodeById.has(nid)) sum += nodeById.get(nid).cost;
  return sum;
}

export const MP_NAMES = new Set(["mpmax", "Max MP"]);

export function nodeMpCount(node) {
  return (node.e || []).some((e) => e.t === "s" && MP_NAMES.has(e.n)) ? 1 : 0;
}

function cmp(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return 0;
}

const INF2 = [Infinity, Infinity];

export function shortestFromTree(grid, tree, nodeById) {
  const dist = new Map();
  for (const n of grid.values()) dist.set(n.id, tree.has(n.id) ? [0, 0] : INF2);
  const prev = new Map();
  const visited = new Set();
  while (visited.size < dist.size) {
    let bestId = null, bestD = INF2;
    for (const [nid, d] of dist) {
      if (!visited.has(nid) && cmp(d, bestD) < 0) { bestD = d; bestId = nid; }
    }
    if (bestId === null) break;
    visited.add(bestId);
    const n = nodeById.get(bestId);
    for (const [r, c] of neighbors(n.r, n.c)) {
      const nb = grid.get(gridKey(r, c));
      if (!nb || nb.g === "empty" || visited.has(nb.id)) continue;
      const inTree = tree.has(nb.id);
      const nd = [bestD[0] + (inTree ? 0 : nb.cost), bestD[1] + (inTree ? 0 : nodeMpCount(nb))];
      if (cmp(nd, dist.get(nb.id)) < 0) {
        dist.set(nb.id, nd);
        prev.set(nb.id, bestId);
      }
    }
  }
  return { dist, prev };
}

export function pathNodesToAdd(prev, targetId, tree) {
  const chain = [];
  let cur = targetId;
  while (cur !== undefined && cur !== null) {
    chain.push(cur);
    if (tree.has(cur)) break;
    cur = prev.get(cur);
  }
  return chain;
}

export function computeAutoRoute(grid, nodeById, wantedIds, startId) {
  const tree = new Set([startId]);
  const cap = totalCost(grid);
  let spent = 0;
  const remaining = new Set([...wantedIds].filter((id) => id !== startId));
  const included = new Set();
  const skipped = new Set();
  while (remaining.size) {
    const { dist, prev } = shortestFromTree(grid, tree, nodeById);
    let bestId = null, bestD = INF2;
    for (const nid of remaining) {
      const d = dist.get(nid) || INF2;
      if (cmp(d, bestD) < 0) { bestD = d; bestId = nid; }
    }
    if (bestId === null || bestD[0] === Infinity || spent + bestD[0] > cap) {
      for (const nid of remaining) skipped.add(nid);
      break;
    }
    for (const nid of pathNodesToAdd(prev, bestId, tree)) {
      if (!tree.has(nid)) { tree.add(nid); spent += nodeById.get(nid).cost; }
    }
    included.add(bestId);
    remaining.delete(bestId);
  }
  return { tree, included, skipped, spent, cap };
}

// ── multi-board planner ─────────────────────────────────────────────────────

const ROUTE_INF = [Infinity, Infinity, Infinity];
const ROUTE_ZERO = [0, 0, 0];
const ROUTE_RESTARTS = 12;

function routeStep(node, pref) {
  return [node.cost, pref.has(node.id) ? -1 : 0, nodeMpCount(node)];
}

function routeCost(nodes, nodeById, pref = new Set()) {
  const total = [0, 0, 0];
  for (const n of nodes) {
    const step = routeStep(nodeById.get(n), pref);
    for (let i = 0; i < 3; i++) total[i] += step[i];
  }
  return total;
}

class Heap {
  constructor(items = []) { this.a = items; for (let i = (items.length >> 1) - 1; i >= 0; i--) this.down(i); }
  static less(x, y) {
    const c = cmp(x[0], y[0]);
    if (c) return c < 0;
    if (x[1] !== y[1]) return x[1] < y[1];
    return x[2] < y[2];
  }
  push(item) { this.a.push(item); this.up(this.a.length - 1); }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) { a[0] = last; this.down(0); }
    return top;
  }
  get size() { return this.a.length; }
  up(i) {
    const a = this.a;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!Heap.less(a[i], a[p])) break;
      [a[i], a[p]] = [a[p], a[i]];
      i = p;
    }
  }
  down(i) {
    const a = this.a, n = a.length;
    for (;;) {
      let m = i;
      const l = 2 * i + 1, r = l + 1;
      if (l < n && Heap.less(a[l], a[m])) m = l;
      if (r < n && Heap.less(a[r], a[m])) m = r;
      if (m === i) break;
      [a[i], a[m]] = [a[m], a[i]];
      i = m;
    }
  }
}

function routeDijkstra(grid, sources, free, nodeById, order, pref) {
  const dist = new Map();
  const items = [];
  for (const nid of sources) { dist.set(nid, ROUTE_ZERO); items.push([ROUTE_ZERO, order.get(nid), nid]); }
  const prev = new Map();
  const heap = new Heap(items);
  const done = new Set();
  while (heap.size) {
    const [d, , nid] = heap.pop();
    if (done.has(nid)) continue;
    done.add(nid);
    const n = nodeById.get(nid);
    for (const [r, c] of neighbors(n.r, n.c)) {
      const nb = grid.get(gridKey(r, c));
      if (!nb || nb.g === "empty" || done.has(nb.id)) continue;
      let nd;
      if (free.has(nb.id)) nd = d;
      else {
        const step = routeStep(nb, pref);
        nd = [d[0] + step[0], d[1] + step[1], d[2] + step[2]];
      }
      if (cmp(nd, dist.get(nb.id) || ROUTE_INF) < 0) {
        dist.set(nb.id, nd);
        prev.set(nb.id, nid);
        heap.push([nd, order.get(nb.id), nb.id]);
      }
    }
  }
  return { dist, prev };
}

function routePath(prev, target, stop) {
  const path = [];
  let cur = target;
  while (cur !== undefined && cur !== null && !stop.has(cur)) {
    path.push(cur);
    cur = prev.get(cur);
  }
  return path;
}

function minBy(ids, key) {
  let best = null, bestKey = null;
  for (const nid of ids) {
    const k = key(nid);
    if (best === null || cmp(k, bestKey) < 0) { best = nid; bestKey = k; }
  }
  return best;
}

function routeConnect(grid, nodeById, order, pref, tree, targets) {
  let remaining = new Set([...targets].filter((t) => !tree.has(t)));
  while (remaining.size) {
    const { dist, prev } = routeDijkstra(grid, tree, tree, nodeById, order, pref);
    const best = minBy([...remaining].filter((nid) => dist.has(nid)), (nid) => [...dist.get(nid), order.get(nid)]);
    if (best === null) return remaining;
    for (const nid of routePath(prev, best, tree)) tree.add(nid);
    remaining = new Set([...remaining].filter((t) => !tree.has(t)));
  }
  return new Set();
}

function* routeNeighboursIn(grid, nodeById, nid, nodes) {
  const n = nodeById.get(nid);
  for (const [r, c] of neighbors(n.r, n.c)) {
    const nb = grid.get(gridKey(r, c));
    if (nb && nodes.has(nb.id)) yield nb.id;
  }
}

function countNeighboursIn(grid, nodeById, nid, nodes) {
  let count = 0;
  for (const _ of routeNeighboursIn(grid, nodeById, nid, nodes)) count++;
  return count;
}

function sortedByOrder(ids, order) {
  return [...ids].sort((a, b) => order.get(a) - order.get(b));
}

function routeComponents(grid, nodeById, order, nodes) {
  const seen = new Set();
  const parts = [];
  for (const start of sortedByOrder(nodes, order)) {
    if (seen.has(start)) continue;
    const part = new Set([start]);
    const queue = [start];
    while (queue.length) {
      for (const nb of routeNeighboursIn(grid, nodeById, queue.pop(), nodes)) {
        if (!part.has(nb)) { part.add(nb); queue.push(nb); }
      }
    }
    for (const id of part) seen.add(id);
    parts.push(part);
  }
  return parts;
}

function routePrune(grid, nodeById, tree, fixed) {
  tree = new Set(tree);
  let changed = true;
  while (changed) {
    changed = false;
    for (const nid of [...tree].filter((id) => !fixed.has(id))) {
      if (countNeighboursIn(grid, nodeById, nid, tree) <= 1) { tree.delete(nid); changed = true; }
    }
  }
  return tree;
}

function routeReconnect(grid, nodeById, order, pref, parts, root) {
  const tree = new Set(parts.find((p) => p.has(root)));
  let others = parts.filter((p) => !p.has(root));
  const free = new Set();
  for (const p of parts) for (const id of p) free.add(id);
  while (others.length) {
    const { dist, prev } = routeDijkstra(grid, tree, free, nodeById, order, pref);
    const candidates = [];
    for (const p of others) for (const nid of p) if (dist.has(nid)) candidates.push(nid);
    const best = minBy(candidates, (nid) => [...dist.get(nid), order.get(nid)]);
    if (best === null) return null;
    for (const nid of routePath(prev, best, tree)) tree.add(nid);
    const still = [];
    for (const p of others) {
      let touches = false;
      for (const id of p) if (tree.has(id)) { touches = true; break; }
      if (touches) for (const id of p) tree.add(id);
      else still.push(p);
    }
    others = still;
  }
  return tree;
}

function* routeRemovalCandidates(grid, nodeById, order, tree, fixed) {
  const degree = new Map();
  for (const nid of tree) degree.set(nid, countNeighboursIn(grid, nodeById, nid, tree));
  const keyNodes = new Set(fixed);
  for (const [nid, d] of degree) if (d !== 2) keyNodes.add(nid);
  const seen = new Set();
  for (const start of sortedByOrder([...tree].filter((id) => !keyNodes.has(id)), order)) {
    if (seen.has(start)) continue;
    const chain = new Set([start]);
    const queue = [start];
    while (queue.length) {
      for (const nb of routeNeighboursIn(grid, nodeById, queue.pop(), tree)) {
        if (!keyNodes.has(nb) && !chain.has(nb)) { chain.add(nb); queue.push(nb); }
      }
    }
    for (const id of chain) seen.add(id);
    yield chain;
  }
  for (const nid of sortedByOrder([...tree].filter((id) => !fixed.has(id)), order)) {
    if (degree.get(nid) >= 3) yield new Set([nid]);
  }
}

function routeImprove(grid, nodeById, order, pref, tree, fixed, root) {
  tree = routePrune(grid, nodeById, tree, fixed);
  let cost = routeCost(tree, nodeById, pref);
  let improved = true;
  while (improved) {
    improved = false;
    for (const removal of routeRemovalCandidates(grid, nodeById, order, tree, fixed)) {
      const rest = new Set([...tree].filter((id) => !removal.has(id)));
      const parts = routeComponents(grid, nodeById, order, rest);
      let candidate = parts.length === 1 ? rest : routeReconnect(grid, nodeById, order, pref, parts, root);
      if (candidate === null) continue;
      candidate = routePrune(grid, nodeById, candidate, fixed);
      const candidateCost = routeCost(candidate, nodeById, pref);
      if (cmp(candidateCost, cost) < 0) {
        tree = candidate; cost = candidateCost; improved = true;
        break;
      }
    }
  }
  return tree;
}

function routeSteiner(grid, nodeById, order, pref, start, required) {
  let tree = new Set([start]);
  const missing = routeConnect(grid, nodeById, order, pref, tree, required);
  const fixed = new Set([...required].filter((id) => !missing.has(id)));
  fixed.add(start);
  let best = routeImprove(grid, nodeById, order, pref, tree, fixed, start);
  let bestCost = routeCost(best, nodeById, pref);
  const roots = sortedByOrder([...fixed].filter((id) => id !== start), order).filter((_, i) => i % 2 === 0).slice(0, ROUTE_RESTARTS);
  for (const root of roots) {
    tree = new Set([root]);
    if (routeConnect(grid, nodeById, order, pref, tree, fixed).size) continue;
    tree = routeImprove(grid, nodeById, order, pref, tree, fixed, start);
    const cost = routeCost(tree, nodeById, pref);
    if (cmp(cost, bestCost) < 0) { best = tree; bestCost = cost; }
  }
  return [best, missing];
}

function intersect(a, b) {
  const out = new Set();
  for (const x of a) if (b.has(x)) out.add(x);
  return out;
}

// boards: [{key, grid, start_id, enabled, active}], groups: [{key, count,
// nodes: {boardKey: Set}}], preferred: {boardKey: Set}, budget: number.
export function planRoute(boards, nodeById, groups, preferred = {}, budget = Infinity) {
  preferred = preferred || {};
  const order = new Map();
  for (const b of boards) {
    let i = 0;
    for (const n of b.grid.values()) order.set(n.id, i++);
  }
  const enabled = boards.filter((b) => b.enabled && b.start_id);
  const enabledKeys = enabled.map((b) => b.key);
  const pref = {};
  const required = {};
  for (const k of enabledKeys) { pref[k] = new Set(preferred[k] || []); required[k] = new Set(); }
  const countGroups = [];
  const unmet = {};

  for (const g of groups) {
    const pool = {};
    let poolSize = 0;
    for (const k of enabledKeys) {
      const ids = g.nodes[k];
      if (ids && (ids.size || ids.length)) { pool[k] = new Set(ids); poolSize += pool[k].size; }
    }
    if (g.count === null || g.count === undefined) {
      for (const [k, ids] of Object.entries(pool)) for (const id of ids) required[k].add(id);
      continue;
    }
    let already = 0;
    for (const b of boards) {
      if (enabled.includes(b)) continue;
      already += intersect(new Set(g.nodes[b.key] || []), b.active).size;
    }
    const need = g.count - already;
    if (need <= 0) continue;
    if (need >= poolSize) {
      for (const [k, ids] of Object.entries(pool)) for (const id of ids) required[k].add(id);
      if (need > poolSize) unmet[g.key] = need - poolSize;
      continue;
    }
    countGroups.push({ key: g.key, pool, need });
  }

  const trees = {};
  const unreachable = new Set();
  for (const b of enabled) {
    const [tree, missing] = routeSteiner(b.grid, nodeById, order, pref[b.key], b.start_id, required[b.key]);
    trees[b.key] = tree;
    for (const id of missing) unreachable.add(id);
  }

  const gridOf = {};
  for (const b of enabled) gridOf[b.key] = b.grid;
  const boardIndex = {};
  enabledKeys.forEach((k, i) => { boardIndex[k] = i; });
  const cache = new Map();
  const dijkstra = (k) => {
    if (!cache.has(k)) cache.set(k, routeDijkstra(gridOf[k], trees[k], trees[k], nodeById, order, pref[k]));
    return cache.get(k);
  };
  const counted = (cg) => {
    let n = 0;
    for (const [k, ids] of Object.entries(cg.pool)) n += intersect(ids, trees[k]).size;
    return n;
  };

  for (;;) {
    let best = null;
    for (const cg of countGroups) {
      if (counted(cg) >= cg.need) continue;
      for (const [k, ids] of Object.entries(cg.pool)) {
        const { dist } = dijkstra(k);
        for (const nid of ids) {
          if (trees[k].has(nid) || !dist.has(nid)) continue;
          const rank = [...dist.get(nid), boardIndex[k], order.get(nid)];
          if (best === null || cmp(rank, best[0]) < 0) best = [rank, k, nid];
        }
      }
    }
    if (best === null) break;
    const [, k, nid] = best;
    for (const id of routePath(cache.get(k).prev, nid, trees[k])) trees[k].add(id);
    cache.delete(k);
  }

  for (const cg of countGroups) {
    const missing = cg.need - counted(cg);
    if (missing > 0) unmet[cg.key] = (unmet[cg.key] || 0) + missing;
  }

  if (countGroups.length) {
    const countedNodes = new Set();
    for (const cg of countGroups) for (const ids of Object.values(cg.pool)) for (const id of ids) countedNodes.add(id);
    for (const b of enabled) {
      const k = b.key;
      const fixed = new Set([...required[k]].filter((id) => !unreachable.has(id)));
      fixed.add(b.start_id);
      for (const id of trees[k]) if (countedNodes.has(id)) fixed.add(id);
      trees[k] = routeImprove(b.grid, nodeById, order, pref[k], trees[k], fixed, b.start_id);
    }
    cache.clear();
  }

  for (const g of groups) {
    let missing = 0;
    for (const ids of Object.values(g.nodes)) missing += intersect(new Set(ids), unreachable).size;
    if (missing) unmet[g.key] = (unmet[g.key] || 0) + missing;
  }

  const points = () => Object.values(trees).reduce((sum, t) => sum + routeCost(t, nodeById)[0], 0);

  const requiredCost = points();
  const preferredTotal = Object.values(pref).reduce((sum, ids) => sum + ids.size, 0);
  if (requiredCost > budget) {
    return { trees, cost: requiredCost, required_cost: requiredCost, over_budget: true, unmet, preferred_taken: 0, preferred_total: preferredTotal };
  }

  let left = budget - requiredCost;
  for (;;) {
    let best = null;
    for (const k of enabledKeys) {
      const wanted = [...pref[k]].filter((id) => !trees[k].has(id));
      if (!wanted.length) continue;
      const { dist, prev } = dijkstra(k);
      for (const nid of wanted) {
        if (!dist.has(nid) || dist.get(nid)[0] > left) continue;
        const path = routePath(prev, nid, trees[k]);
        const gained = path.filter((p) => pref[k].has(p)).length;
        const cost = dist.get(nid)[0];
        const rank = [-(gained / cost), cost, dist.get(nid)[2], boardIndex[k], order.get(nid)];
        if (best === null || cmp(rank, best[0]) < 0) best = [rank, k, path, cost];
      }
    }
    if (best === null) break;
    const [, k, path, cost] = best;
    for (const id of path) trees[k].add(id);
    cache.delete(k);
    left -= cost;
  }

  return {
    trees,
    cost: points(),
    required_cost: requiredCost,
    over_budget: false,
    unmet,
    preferred_taken: enabledKeys.reduce((sum, k) => sum + intersect(pref[k], trees[k]).size, 0),
    preferred_total: preferredTotal,
  };
}

// Drops every active node without a path back to start (app.py
// _daevanion_prune_unreachable).
export function pruneUnreachable(grid, active, nodeById) {
  const startIds = [...grid.values()].filter((n) => n.g === "start" && active.has(n.id)).map((n) => n.id);
  if (!startIds.length) { active.clear(); return; }
  const reached = new Set(startIds);
  const queue = [...startIds];
  while (queue.length) {
    const node = nodeById.get(queue.pop());
    if (!node) continue;
    for (const [r, c] of neighbors(node.r, node.c)) {
      const nb = grid.get(gridKey(r, c));
      if (nb && active.has(nb.id) && !reached.has(nb.id)) { reached.add(nb.id); queue.push(nb.id); }
    }
  }
  for (const id of [...active]) if (!reached.has(id)) active.delete(id);
}

// ── labels, effects, stats (app.py module-level tables) ─────────────────────

export const GRADE_LABEL = { start: "Start", common: "Common", rare: "Rare", legend: "Legend", unique: "Unique" };
export const GRADE_TO_ITEM_GRADE = { common: "Common", rare: "Rare", legend: "Legend", unique: "Unique" };
export const GRADE_RANK = { unique: 3, legend: 2, rare: 1, common: 0, start: -1, empty: -1 };
// core/theme.py GRADE_COLORS; "start" takes the accent.
export const ITEM_GRADE_COLORS = { Common: "#94a3b8", Rare: "#4ade80", Unique: "#facc15", Epic: "#f59e0b", Legend: "#38bdf8" };

export function gradeColor(grade, accent = "#22d3ee") {
  if (grade === "start") return accent;
  return ITEM_GRADE_COLORS[GRADE_TO_ITEM_GRADE[grade] || "Common"];
}

export function statKey(raw) {
  return String(raw || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export const STAT_LABELS = {
  hpmax: "Max HP", hp: "Max HP", maxhp: "Max HP",
  mpmax: "Max MP", mp: "Max MP", maxmp: "Max MP",
  fixingdamage: "Attack", attackbonus: "Attack",
  defense: "Defense", defensebonus: "Defense",
  critical: "Critical Hit", criticalhit: "Critical Hit",
  criticalresist: "Critical Resist", criticalhitresist: "Critical Resist",
  accuracy: "Accuracy", block: "Block", blockpierce: "Block Penetration",
  evasion: "Evasion", weapondamage: "Weapon Damage",
  perfect: "Perfect Chance", perfectresist: "Perfect Resist",
  combatspeed: "Combat Speed",
  restoration: "Restoration", ignorerestoration: "Ignore Restoration",
  ironwall: "Iron Wall", ignoreironwall: "Ignore Iron Wall",
  damageratio: "Damage Ratio", defenseratio: "Defense Ratio", maxhpratio: "Max HP Ratio",
  cooltimedecrease: "Cooldown Reduction", cooldowndecrease: "Cooldown Reduction",
  amplifyalldamage: "Amplify All Damage",
  amplifycriticaldamage: "Amplify Critical Damage", decreasecriticaldamage: "Decrease Critical Damage",
  amplifyweapondamage: "Amplify Weapon Damage", decreaseweapondamage: "Decrease Weapon Damage",
  decreasedamage: "Decrease Damage",
  additionalhitrate: "Additional Hit Rate", additionalhitresistrate: "Additional Hit Resist",
  multihitchance: "Multi-hit Chance", multihitresist: "Multi-hit Resist",
  abnormalaccuracy: "Status Effect Chance", abnormalresistance: "Status Effect Resist",
  damageboost: "Damage Boost", damagetolerance: "Damage Tolerance",
  criticaldamageboost: "Critical Damage Boost", criticaldamagetolerance: "Critical Damage Tolerance",
  bossattack: "Boss Attack", bossnpcadddamage: "Boss Attack",
  bossdefense: "Boss Defense", bossnpcdefense: "Boss Defense",
  bossnpcamplifydamage: "Boss Damage Boost", bossnpcdecreasedamage: "Boss Damage Tolerance",
  pvpaccuracy: "PvP Accuracy", pveaccuracy: "PvE Accuracy",
  pvpevasion: "PvP Evasion", pveevasion: "PvE Evasion",
  pvpcritical: "PvP Critical Hit", pvpcriticalresist: "PvP Critical Hit Resist",
  pvpadddamage: "PvP Attack", pvpdamagedefense: "PvP Defense", pvpdefense: "PvP Defense",
  pvpdecreasedamage: "PvP Damage Tolerance", pvpamplifydamage: "PvP Damage Boost",
  pveattack: "PvE Attack", pveadddamage: "PvE Attack",
  pvedamagedefense: "PvE Defense", pvedefense: "PvE Defense",
  pvedecreasedamage: "PvE Damage Tolerance", pveamplifydamage: "PvE Damage Boost",
  pvedamageboost: "PvE Damage Boost", pvedamagetolerance: "PvE Damage Tolerance",
};

export const STAT_ID_MAP = {
  hpmax: "HPMax", hp: "HPMax", maxhp: "HPMax",
  mpmax: "MPMax", mp: "MPMax", maxmp: "MPMax",
  fixingdamage: "WeaponFixingDamage", attackbonus: "WeaponFixingDamage",
  defense: "ArmorDefense", defensebonus: "ArmorDefense",
  critical: "Critical", criticalhit: "Critical",
  criticalresist: "CriticalResist", criticalhitresist: "CriticalResist",
  accuracy: "WeaponAccuracy",
  block: "Block",
  evasion: "ArmorEvasion",
  perfect: "PerfectChance", perfectresist: "PerfectResist",
  combatspeed: "CombatSpeed",
  restoration: "Restoration", ignorerestoration: "RegenerationPenetration",
  ironwall: "IronWall", ignoreironwall: "EndurancePenetration",
  damageratio: "DamageRatio", defenseratio: "DefenseRatio",
  maxhpratio: "HPIncrease",
  cooltimedecrease: "CooldownReduction", cooldowndecrease: "CooldownReduction",
  amplifyalldamage: "AmplifyAllDamage", damageboost: "AmplifyAllDamage",
  amplifycriticaldamage: "AmplifyCriticalDamage", criticaldamageboost: "AmplifyCriticalDamage",
  decreasecriticaldamage: "CriticalDamageTolerance", criticaldamagetolerance: "CriticalDamageTolerance",
  amplifyweapondamage: "AmplifyWeaponDamage",
  decreaseweapondamage: "WeaponDamageTolerance",
  decreasedamage: "DamageTolerance", damagetolerance: "DamageTolerance",
  additionalhitrate: "AdditionalHitRate", multihitchance: "AdditionalHitRate",
  abnormalaccuracy: "AbnormalAccuracy", abnormalresistance: "AbnormalResistance",
  bossattack: "BossAttack", bossnpcadddamage: "BossAttack",
  bossdefense: "BossNpcDefense", bossnpcdefense: "BossNpcDefense",
  bossnpcamplifydamage: "BossNpcAmplifyDamage", bossnpcdecreasedamage: "BossNpcDecreaseDamage",
  additionalhitresistrate: "AdditionalHitResistRate", multihitresist: "AdditionalHitResistRate",
  blockpierce: "BlockPierce",
  pvpaccuracy: "PvPAccuracy", pveaccuracy: "PvEAccuracy",
  pvpevasion: "PvPEvasion", pveevasion: "PvEEvasion",
  pvpcritical: "PvPCritical", pvpcriticalresist: "PvPCriticalResist",
  pvpadddamage: "PvPAddDamage", pvpdamagedefense: "PvPDamageDefense", pvpdefense: "PvPDamageDefense",
  pvpdecreasedamage: "PvPDecreaseDamage", pvpamplifydamage: "PvPAmplifyDamage",
  pveattack: "PvEAttack", pveadddamage: "PvEAttack",
  pvedamagedefense: "PvEDefense", pvedefense: "PvEDefense",
  pvedecreasedamage: "PvEDecreaseDamage", pvedamagetolerance: "PvEDecreaseDamage",
  pveamplifydamage: "PvEAmplifyDamage", pvedamageboost: "PvEAmplifyDamage",
};

// app.py _PERCENT_STAT_IDS (raw "v" is stored x100 for these).
export const PERCENT_STAT_IDS = new Set([
  "CombatSpeed", "PvEAmplifyDamage", "PvPAmplifyDamage", "PvEDecreaseDamage", "PvPDecreaseDamage",
  "AmplifyAllDamage", "AbnormalAccuracy", "AdditionalHitRate", "AmplifyWeaponDamage", "AbnormalResistance",
  "AmplifyCriticalDamage", "HardHit", "HardHitResist",
  "AmplifyBackAttack", "AmplifyFrontAttack", "AdditionalHitResistRate",
  "BlockPierce", "PvPBlockPierce", "HpPotionRate",
  "BodyPropertyAccuracy", "MentalPropertyAccuracy", "ShockPropertyAccuracy",
  "BodyPropertyResist", "MentalPropertyResist", "ShockPropertyResist",
  "BossNpcAmplifyDamage", "BossNpcDecreaseDamage",
  "DamageRatio", "DefenseRatio",
  "PerfectChance", "DamageTolerance", "WeaponDamageTolerance", "CriticalDamageTolerance",
  "BackAttackDamageTolerance", "FrontAttackDamageTolerance",
  "CogniDamageBoost", "FeraDamageBoost", "NaturaDamageBoost", "VarianDamageBoost",
  "CogniDamageTolerance", "FeraDamageTolerance", "NaturaDamageTolerance", "VarianDamageTolerance",
  "AccuracyIncrease", "CriticalHitIncrease", "EvasionIncrease", "CriticalHitResistIncrease",
  "BlockIncrease", "CooldownReduction", "MPCostReduction", "RegenerationPenetration",
  "EndurancePenetration", "PerfectResist", "HPIncrease", "MPIncrease", "MoveSpeed",
  "HealBoost", "DoubleChance", "HealReduce", "MaxHPProcPct", "InstantHealMaxHPPct", "IncomingHealPct", "EnduranceIncreasePct",
  "SplitPct", "DefenseReduce", "StatusResistReduce",
  "CriticalDamageBoost", "BackAttackDamageBoost", "MoveSpeedOnHit", "SpiritHealPct",
]);

export function effectDisplayValue(key, rawValue) {
  const value = rawValue || 0;
  const statId = STAT_ID_MAP[key];
  const isPercent = statId ? PERCENT_STAT_IDS.has(statId) : false;
  if (!isPercent) return [value, false];
  return [value / 100, true];
}

export function statLabel(rawName) {
  return STAT_LABELS[statKey(rawName)] || rawName;
}

export const STAT_SHORT = {
  hp: "HP", hpmax: "HP", maxhp: "HP",
  mp: "MP", mpmax: "MP", maxmp: "MP",
  attackbonus: "ATK", fixingdamage: "ATK",
  defensebonus: "DEF", defense: "DEF",
  criticalhit: "CRIT", critical: "CRIT",
  criticalhitresist: "RES", criticalresist: "RES",
  accuracy: "ACC", evasion: "EVA", block: "BLK", blockpierce: "BLK PEN",
  weapondamage: "WPN DMG",
  bossattack: "BOSS ATK", bossnpcadddamage: "BOSS ATK",
  bossdefense: "BOSS DEF", bossnpcdefense: "BOSS DEF",
  pveattack: "PvE ATK", pveadddamage: "PvE ATK",
  pvedefense: "PvE DEF", pvedamagedefense: "PvE DEF",
  pveaccuracy: "PvE ACC", pveevasion: "PvE EVA",
  pvpadddamage: "PvP ATK", pvpdefense: "PvP DEF", pvpdamagedefense: "PvP DEF",
  pvpaccuracy: "PvP ACC", pvpevasion: "PvP EVA",
  pvpcritical: "PvP CRIT", pvpcriticalresist: "PvP RES",
};

export function formatNumber(value, decimals = 0) {
  if (decimals) return value.toFixed(decimals);
  return String(Math.round(value));
}

// classSkillsById: Map or object of skill id (string) -> skill.
function skillOf(classSkillsById, id) {
  if (!classSkillsById) return undefined;
  return classSkillsById instanceof Map ? classSkillsById.get(id) : classSkillsById[id];
}

export function nodeLabel(node, classSkillsById) {
  const effects = node.e || [];
  const skillEffect = effects.find((e) => e.t === "k");
  if (skillEffect) {
    const skill = skillOf(classSkillsById, String(skillEffect.skill_id || ""));
    return skill ? skill.name || "" : skillEffect.n || "";
  }
  const names = effects.filter((e) => e.t === "s").map((e) => e.n || "");
  if (!names.length) return "";
  if (node.cost === 1) return names.map((n) => STAT_SHORT[statKey(n)] || statLabel(n)).join(" / ");
  return names.map((n) => statLabel(n)).join(" + ");
}

export function effectLines(node, classSkillsById) {
  const lines = [];
  for (const e of node.e || []) {
    if (e.t === "s") {
      const name = e.n || "";
      const [value, isPercent] = effectDisplayValue(statKey(name), e.v);
      lines.push([statLabel(name), `${value > 0 ? "+" : ""}${formatNumber(value, isPercent ? 1 : 0)}${isPercent ? "%" : ""}`]);
    } else if (e.t === "k") {
      const skillId = String(e.skill_id || "");
      const skill = skillOf(classSkillsById, skillId);
      lines.push([skill ? skill.name : (e.n || `Skill #${skillId}`), `+${e.v} Lvl`]);
    }
  }
  return lines;
}

// Stat totals by Stat Info id over `active` node ids (app.py _daevanion_stat_totals).
export function statTotals(nodeById, active) {
  const totals = {};
  for (const nodeId of active) {
    const node = nodeById.get(nodeId);
    if (!node) continue;
    for (const e of node.e || []) {
      if (e.t !== "s") continue;
      const key = statKey(e.n || "");
      const statId = STAT_ID_MAP[key];
      if (!statId) continue;
      const [value] = effectDisplayValue(key, e.v);
      totals[statId] = (totals[statId] || 0) + value;
    }
  }
  return totals;
}

// [[label, value, isPercent]] sorted by label (app.py _daevanion_active_stat_summary).
export function activeStatSummary(nodeById, active) {
  const totals = new Map();
  for (const nodeId of active) {
    const node = nodeById.get(nodeId);
    if (!node) continue;
    for (const e of node.e || []) {
      if (e.t !== "s") continue;
      const key = statKey(e.n || "");
      const label = statLabel(e.n || "");
      const [value, isPercent] = effectDisplayValue(key, e.v);
      const prev = totals.get(label);
      totals.set(label, [(prev ? prev[0] : 0) + value, prev ? prev[1] : isPercent]);
    }
  }
  return [...totals].map(([label, [value, isPercent]]) => [label, value, isPercent]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

// +level per skill id from every active skill node of the class's boards
// (app.py _compute_daevanion_skill_bonus). activeByBoardKey: {"variant:boardId": iterable of ids}.
export function skillBonusFromBoards(variant, classKey, activeByBoardKey, variantKey = "s") {
  const bonus = {};
  for (const board of variant.boards) {
    if (board.classId !== classKey) continue;
    const active = activeByBoardKey[`${variantKey}:${board.id}`] || [];
    for (const nodeId of active) {
      const node = variant.node_by_id.get(nodeId);
      if (!node) continue;
      for (const e of node.e || []) {
        if (e.t === "k") {
          const sid = String(e.skill_id || "");
          if (sid) bonus[sid] = (bonus[sid] || 0) + (parseInt(e.v, 10) || 0);
        }
      }
    }
  }
  return bonus;
}

// {substats, combined, passive, active}: key -> {label, ids: Set, grades: Set, skill?}
export function buildFilterGroups(grid, classSkillsById) {
  const groups = { substats: {}, combined: {}, passive: {}, active: {} };
  for (const n of grid.values()) {
    const statEffs = (n.e || []).filter((e) => e.t === "s");
    const skillEffs = (n.e || []).filter((e) => e.t === "k");
    if (statEffs.length === 1) {
      const name = statEffs[0].n || "";
      const entry = groups.substats[name] || (groups.substats[name] = { label: statLabel(name), ids: new Set(), grades: new Set() });
      entry.ids.add(n.id);
      entry.grades.add(n.g);
    } else if (statEffs.length > 1) {
      const names = statEffs.map((e) => e.n || "").sort();
      const key = names.join("+");
      const entry = groups.combined[key] || (groups.combined[key] = { label: names.map((nm) => statLabel(nm)).join(" + "), ids: new Set(), grades: new Set() });
      entry.ids.add(n.id);
      entry.grades.add(n.g);
    }
    for (const e of skillEffs) {
      const skillId = String(e.skill_id || "");
      const skill = skillOf(classSkillsById, skillId);
      const name = skill ? skill.name : (e.n || `Skill #${skillId}`);
      const bucket = skill && skill.type === "active" ? "active" : "passive";
      const key = skillId || name;
      const entry = groups[bucket][key] || (groups[bucket][key] = { label: name, ids: new Set(), grades: new Set(), skill });
      entry.ids.add(n.id);
      entry.grades.add(n.g);
    }
  }
  return groups;
}

export const FILTER_SECTIONS = [
  ["substats", "Substats"], ["combined", "Combined Substats"],
  ["passive", "Passive Skills"], ["active", "Active Skills"],
];

export function entryAccentGrade(grades) {
  let best = "common";
  for (const g of grades) if ((GRADE_RANK[g] ?? -1) > (GRADE_RANK[best] ?? -1)) best = g;
  if ((GRADE_RANK[best] ?? -1) <= 0) return null;
  return GRADE_TO_ITEM_GRADE[best] || null;
}

// ── profile shapes (app.py route settings / saved sets) ─────────────────────

export function defaultRouteSettings() {
  return { budget: null, disabled_boards: [], skip: {} };
}

export function routeSettingsFromJson(saved) {
  saved = saved || {};
  const budget = saved.budget;
  const skip = {};
  for (const [key, keys] of Object.entries(saved.skip || {})) skip[key] = [...new Set(keys)];
  return {
    budget: typeof budget === "number" && budget > 0 ? Math.trunc(budget) : null,
    disabled_boards: [...new Set(saved.disabled_boards || [])].sort(),
    skip,
  };
}

export function routeSettingsToJson(settings) {
  const skip = {};
  for (const [key, keys] of Object.entries(settings.skip || {})) if (keys && (keys.length || keys.size)) skip[key] = [...keys].sort();
  return {
    budget: settings.budget ?? null,
    disabled_boards: [...(settings.disabled_boards || [])].sort(),
    skip,
  };
}

// Board states as sorted lists; a board holding only its start node is left
// out so looking at a board never changes the saved profile.
export function savedSets(active, variantOf) {
  const saved = {};
  for (const [key, ids] of Object.entries(active)) {
    const list = [...ids];
    if (list.length === 1) {
      const variantKey = key.split(":")[0];
      const variant = variantOf ? variantOf(variantKey) : null;
      const node = variant ? variant.node_by_id.get(list[0]) : null;
      if (node && node.g === "start") continue;
    }
    saved[key] = list.sort();
  }
  return saved;
}
