// Daevanion Board: the desktop's _build_daevanion_board_tab, DaevanionBoardCanvas,
// DaevanionNodeTooltip and the _daevanion_* handlers. One deity board of the
// current class at a time, per-character named sets linked from the equip set,
// the wanted-values sidebar and the multi-board route planner.
//
// Reusable by other pages: prepare(), renderBoard(), hitTest(), boardsInUse(),
// showTooltip()/hideTooltip(), boardTabsWidget().

import { bp, onChange as onProfileChange, save } from "../state.js";
import { builds as buildList, duplicateBuild, newBuild, presetsOfBuild } from "../builds.js";
import { navigate } from "../app.js";
import * as D from "../engine/daevanion.js";

const VARIANT = "s";
const CELL = 30, GAP = 3, PAD = 10;
const ZOOM_MIN = 0.5, ZOOM_MAX = 3.0, ZOOM_STEP = 1.12, FIT_ZOOM_MIN = 0.6;
const INACTIVE_OPACITY = 0.25;
const SPRITE_DIR = "assets/daevanion_nodes/";
const SPRITE_GRADE_FILE = { common: "Common", rare: "Rare", legend: "Legend", unique: "Unique" };
const BUILDS_CLASS_BY_DATA_KEY = { elementalist: "spiritmaster" };
const SIZE_STORE = "aion2-armory-daevanion-size";
const BOARD_STORE = "aion2-armory-daevanion-board";
const SIDE_MIN = 320, SIDE_MAX = 1600, SIDE_KEY_STEP = 16;

const T = {
  hide_borders: "Hide borders",
  show_labels: "Show labels",
  reset_board: "Reset board",
  find_route: "Find best route",
  find_route_tooltip: "Plans every board in use at once, sharing the point budget.",
  stat_summary_title: "Stats Gained",
  stat_summary_empty: "No stats active yet.",
  no_board_for_class: "There's no Daevanion Board for this class yet.",
  status_start: "Always active",
  status_active: "Active — click to refund",
  status_locked: "Locked — connect an adjacent node first",
  status_no_points: "Not enough Daevanion Points",
  status_available: "Available — click to activate",
  route_pick_value: "Check at least one value in the list first.",
  route_ok: (v) => `Route takes every required node on ${v.boards} boards, plus ${v.taken} of ${v.total} wanted plain nodes (${v.spent}/${v.budget} points).`,
  route_over_budget: (v) => `The required (coloured) nodes need ${v.needed} points, but the budget is ${v.budget}. Nothing was changed.`,
  route_unmet: (v) => `Route applied (${v.spent}/${v.budget} points), but these could not all be reached: ${v.items}.`,
  count_all: "All",
  count_tooltip: "How many of this entry's coloured nodes to take across all boards in the route (All = every one). Plain 1-point nodes are never required.",
  points_total_label: (v) => `Daevanion Points: ${v.total} / ${v.budget} (this board: ${v.board})`,
  budget_label: "Point budget:",
  budget_tooltip: "How many Daevanion Points this set may spend across all boards together (0 = no limit).",
  use_board: "Use this board in the route",
  use_board_tooltip: "Off: the route leaves this board as it is — its nodes still count toward the budget.",
  board_off: (name) => `${name} (off)`,
  skipped_here: "– skipped on this board",
  other_boards: "On other boards",
  skip_hint: "Right-click: skip this on the current board only",
  skip_on_board: (name) => `Skip on ${name}`,
  unskip_on_board: (name) => `Use on ${name} again`,
  set_tooltip: "Which board set this equipment set uses. Each set (e.g. a character) can have its own board — add a new one with +.",
  add_new_build: "Add new build",
  duplicate_current_build: "Duplicate current build",
  rename_current_build: "Rename current build",
  delete_current_build: "Delete current build",
  name_colon: "Name:",
  duplicate_default_name: (name) => `${name} (Copy)`,
  delete_confirm: (name) => `Really delete "${name}"? This cannot be undone.`,
  loading: "Loading the Daevanion boards…",
  tab_tooltip: (name, spent) => `${name}: ${spent} point${spent === 1 ? "" : "s"} spent`,
  resize_tooltip: "Drag to resize the board (arrow keys work too)",
  zoom: "Zoom",
  zoom_tooltip: "Zoom inside the board frame (mouse wheel works too). 100% fits the frame; drag the corner to resize the frame.",
};

const ICONS = {
  plus: '<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10 4v12M4 10h12"/></svg>',
  duplicate: '<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="7" y="7" width="9" height="9" rx="1.5"/><path d="M13 7V5.5A1.5 1.5 0 0 0 11.5 4h-6A1.5 1.5 0 0 0 4 5.5v6A1.5 1.5 0 0 0 5.5 13H7"/></svg>',
  edit: '<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M4 16h3l8-8-3-3-8 8v3zM11 6l3 3"/></svg>',
  trash: '<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h12M8 6V4h4v2M6 6l1 10h6l1-10M9 9v4M11 9v4"/></svg>',
};

// ── data ────────────────────────────────────────────────────────────────────

let variant = null;
let skillsByClass = null;
let preparing = null;
const sprites = new Map();
const skillIcons = new Map();
let redrawRequested = null;

function esc(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

async function loadSkills() {
  const raw = await fetch("data/skills_all.json").then((r) => (r.ok ? r.json() : { skills: [] }));
  const byClass = new Map();
  for (const s of raw.skills || []) {
    const cat = (s.mainCategory || "").trim().toLowerCase();
    if (!cat) continue;
    if (!byClass.has(cat)) byClass.set(cat, []);
    byClass.get(cat).push(s);
  }
  return byClass;
}

function spriteFile(grade, enabled) {
  if (grade === "start") return "UT_FWindow_Daevanion_Node_Start_Sprite.webp";
  const tier = SPRITE_GRADE_FILE[grade];
  return tier ? `UT_FWindow_Daevanion_Node_${tier}_${enabled ? "Sprite" : "Disabled_Sprite"}.webp` : null;
}

function sprite(grade, enabled) {
  const file = spriteFile(grade, enabled);
  return file ? sprites.get(file) || null : null;
}

function classSkillsById(classKey) {
  const map = new Map();
  for (const s of (skillsByClass && skillsByClass.get(classKey)) || []) map.set(String(s.id), s);
  return map;
}

function skillIcon(skill) {
  const file = skill && skill.iconFile;
  if (!file) return null;
  if (!skillIcons.has(file)) {
    skillIcons.set(file, null);
    loadImage(`assets/skill_icons/${file}`).then((img) => { skillIcons.set(file, img); requestRedraw(); });
  }
  return skillIcons.get(file);
}

function requestRedraw() {
  if (redrawRequested || !root) return;
  redrawRequested = requestAnimationFrame(() => { redrawRequested = null; drawCanvas(); });
}

// Node icons (skill nodes only) and labels for one board grid.
function boardOverlays(grid, skillsById) {
  const icons = new Map();
  const labels = new Map();
  for (const n of grid.values()) {
    labels.set(n.id, D.nodeLabel(n, skillsById));
    if (n.g === "empty" || n.g === "start") continue;
    const skillEff = (n.e || []).find((e) => e.t === "k");
    if (!skillEff) continue;
    const img = skillIcon(skillsById.get(String(skillEff.skill_id || "")));
    if (img) icons.set(n.id, img);
  }
  return { icons, labels };
}

// Loads board data, skills and sprites; with a class key also the skill
// icons its boards show, so renderBoard() draws complete on the first call.
export async function prepare(classKey = null) {
  if (!preparing) {
    preparing = (async () => {
      const files = ["UT_FWindow_Daevanion_Node_Start_Sprite.webp"];
      for (const tier of Object.values(SPRITE_GRADE_FILE)) files.push(`UT_FWindow_Daevanion_Node_${tier}_Sprite.webp`, `UT_FWindow_Daevanion_Node_${tier}_Disabled_Sprite.webp`);
      const [v, s, ...imgs] = await Promise.all([D.loadVariant(VARIANT), loadSkills(), ...files.map((f) => loadImage(SPRITE_DIR + f))]);
      variant = v;
      skillsByClass = s;
      files.forEach((f, i) => { if (imgs[i]) sprites.set(f, imgs[i]); });
    })();
  }
  await preparing;
  if (classKey) {
    const key = D.skillsDataClassKey(classKey);
    const byId = classSkillsById(key);
    const pending = [];
    for (const board of D.classBoards(variant, key)) {
      for (const n of variant.nodes_by_board.get(board.id)?.values() || []) {
        const skillEff = (n.e || []).find((e) => e.t === "k");
        const file = skillEff && byId.get(String(skillEff.skill_id || ""))?.iconFile;
        if (file && !skillIcons.get(file)) pending.push(loadImage(`assets/skill_icons/${file}`).then((img) => skillIcons.set(file, img)));
      }
    }
    await Promise.all(pending);
  }
}

// ── profile state (the desktop's dict names and shapes) ─────────────────────

function classDisplay() { return bp().character_class || ""; }
function classLower() { return classDisplay().trim().toLowerCase(); }
function classKey() { return D.skillsDataClassKey(classDisplay()); }
function boardKey(board) { return `${VARIANT}:${board.id}`; }

function buildsOf(className) {
  const p = bp();
  if (!p.daevanion_builds_data) p.daevanion_builds_data = {};
  if (!p.daevanion_builds_data[className]) p.daevanion_builds_data[className] = {};
  return p.daevanion_builds_data[className];
}

function equipBuildOf(className) {
  const p = bp();
  return ((p.equip_builds_data || {})[className] || {})[p.current_build_name] || null;
}

function linkedSetName(equip, className) {
  const builds = (bp().daevanion_builds_data || {})[className] || {};
  const linked = equip && equip.linked_daevanion_build;
  if (linked && builds[linked]) return linked;
  const current = bp().current_daevanion_build_name;
  if (current && builds[current]) return current;
  return Object.keys(builds)[0] || "Default";
}

// _sync_daevanion_build_to_equip_build + _bind_current_daevanion_build: the
// current equip set's linked Daevanion set is the one in use.
function bindCurrentSet() {
  const className = classLower();
  const builds = buildsOf(className);
  if (!Object.keys(builds).length) builds.Default = {};
  const equip = equipBuildOf(className);
  const name = linkedSetName(equip, className);
  if (equip) equip.linked_daevanion_build = name;
  bp().current_daevanion_build_name = name;
  return builds[name];
}

function currentSet() { return bindCurrentSet(); }
function currentSetName() { bindCurrentSet(); return bp().current_daevanion_build_name; }

function startOf(board) {
  return D.startIdOf(variant.nodes_by_board.get(board.id) || new Map());
}

function activeOf(set, board) {
  const ids = set[boardKey(board)];
  if (ids) return new Set(ids);
  const start = startOf(board);
  return new Set(start ? [start] : []);
}

function activeSet(board) { return activeOf(currentSet(), board); }

// A board holding only its start node is left out (the desktop's
// _daevanion_saved_sets), so looking at a board never changes the profile.
function storeActive(board, ids) {
  const set = currentSet();
  const list = [...ids].sort();
  if (list.length === 0 || (list.length === 1 && list[0] === startOf(board))) delete set[boardKey(board)];
  else set[boardKey(board)] = list;
}

function persist() {
  const p = bp();
  p.daevanion_active = { ...currentSet() };
  save();
}

function routeSettings() {
  const p = bp();
  if (!p.daevanion_build_settings) p.daevanion_build_settings = {};
  const cls = p.daevanion_build_settings[classLower()] || (p.daevanion_build_settings[classLower()] = {});
  const name = currentSetName();
  if (!cls[name]) cls[name] = D.defaultRouteSettings();
  const s = cls[name];
  if (!Array.isArray(s.disabled_boards)) s.disabled_boards = [...(s.disabled_boards || [])];
  if (!s.skip) s.skip = {};
  return s;
}

function filterKey() { return `${VARIANT}:${classKey()}`; }

function filterChecked() {
  const p = bp();
  if (!p.daevanion_filter_checked) p.daevanion_filter_checked = {};
  return p.daevanion_filter_checked[filterKey()] || (p.daevanion_filter_checked[filterKey()] = []);
}

function filterCounts() {
  const p = bp();
  if (!p.daevanion_filter_counts) p.daevanion_filter_counts = {};
  return p.daevanion_filter_counts[filterKey()] || (p.daevanion_filter_counts[filterKey()] = {});
}

function view() {
  const p = bp();
  if (!p.daevanion_view) p.daevanion_view = { hide_borders: false, show_labels: true };
  if (p.daevanion_view.show_labels === undefined) p.daevanion_view.show_labels = true;
  return p.daevanion_view;
}

function classBoardsHere() { return D.classBoards(variant, classKey()); }

function totalSpent() {
  const set = currentSet();
  let total = 0;
  for (const b of classBoardsHere()) total += D.spentCost(activeOf(set, b), variant.node_by_id);
  return total;
}

function pointsLeft() {
  const budget = routeSettings().budget;
  return budget === null || budget === undefined ? Infinity : budget - totalSpent();
}

let order = null;

function currentBoard() {
  const key = classKey();
  if (!variant.class_ids.includes(key)) return null;
  const boards = D.classBoards(variant, key);
  if (!boards.some((b) => b.order === order)) order = initialOrder(key, boards, currentSet());
  if (order === null) return null;
  return variant.board_by_class_order.get(`${key}:${order}`) || null;
}

function gridOf(board) { return variant.nodes_by_board.get(board.id) || new Map(); }

function skipSet(board) {
  return new Set(routeSettings().skip[boardKey(board)] || []);
}

function highlightedIds(board, grid) {
  const skipped = skipSet(board);
  const checked = filterChecked().filter((k) => !skipped.has(k));
  const ids = new Set();
  if (!checked.length) return ids;
  const groups = D.buildFilterGroups(grid, classSkillsById(classKey()));
  for (const fullKey of checked) {
    const i = fullKey.indexOf("|");
    const entry = (groups[fullKey.slice(0, i)] || {})[fullKey.slice(i + 1)];
    if (entry) for (const id of entry.ids) ids.add(id);
  }
  return ids;
}

// ── canvas (DaevanionBoardCanvas.paintEvent) ────────────────────────────────

function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function usedArea(grid) {
  const used = [...grid.values()].filter((n) => n.g !== "empty");
  if (!used.length) return { span: D.GRID_SIZE, r0: 1, c0: 1 };
  const rows = used.map((n) => n.r), cols = used.map((n) => n.c);
  const nRows = Math.max(...rows) - Math.min(...rows) + 1;
  const nCols = Math.max(...cols) - Math.min(...cols) + 1;
  const span = Math.max(nRows, nCols);
  return { span, r0: Math.min(...rows) - (span - nRows) / 2, c0: Math.min(...cols) - (span - nCols) / 2 };
}

export function baseSide(grid) {
  const { span } = usedArea(grid);
  return PAD * 2 + span * CELL + (span - 1) * GAP;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function elide(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(s + "…").width > maxWidth) s = s.slice(0, -1);
  return s.length ? s + "…" : "";
}

function withAlpha(hex, alpha) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex);
  if (!m) return hex;
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})`;
}

// Draws `board` of `variant` with `activeSet` into `canvas` (a new one when
// null) and returns the canvas. options: {side: CSS px (default 600), zoom,
// highlighted: Set, showLabels, hideBorders, hovered: "r,c", skillsById}.
export function renderBoard(canvas, variant, board, activeSet, options = {}) {
  canvas = canvas || document.createElement("canvas");
  const grid = variant.nodes_by_board.get(board.id) || new Map();
  const { span, r0, c0 } = usedArea(grid);
  const base = PAD * 2 + span * CELL + (span - 1) * GAP;
  const zoom = options.zoom || (options.side || 600) / base;
  const side = Math.round(base * zoom);
  const dpr = options.dpr || window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(side * dpr) || canvas.height !== Math.round(side * dpr)) {
    canvas.width = Math.round(side * dpr);
    canvas.height = Math.round(side * dpr);
  }
  canvas.style.width = `${side}px`;
  canvas.style.height = `${side}px`;
  const cell = CELL * zoom, gap = GAP * zoom, pad = PAD * zoom;
  canvas._daevanion = { r0, c0, span, zoom, cell, gap, pad, side, board, grid };
  const rectOf = (r, c) => ({ x: pad + (c - c0) * (cell + gap), y: pad + (r - r0) * (cell + gap), w: cell, h: cell });

  const bg = cssVar("--bg", "#0f172a"), fg = cssVar("--fg", "#e2e8f0"), muted = cssVar("--muted", "#94a3b8");
  const accent = cssVar("--accent", "#22d3ee"), accentHover = "#67e8f9", warn = cssVar("--warn", "#fbbf24");
  const font = cssVar("--font", "Segoe UI, system-ui, sans-serif");
  const skillsById = options.skillsById || classSkillsById(board.classId);
  const { icons, labels } = boardOverlays(grid, skillsById);
  const showLabels = options.showLabels !== false;
  const highlighted = options.highlighted || new Set();
  const added = options.added || new Set(), removed = options.removed || new Set();
  const success = cssVar("--success", "#34d399"), danger = cssVar("--danger", "#f87171");
  const byId = new Map();
  for (const n of grid.values()) byId.set(n.id, n);

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, side, side);

  ctx.strokeStyle = withAlpha(accent, 90 / 255);
  ctx.lineWidth = Math.max(1.2, 2 * zoom);
  ctx.lineCap = "round";
  for (const nid of activeSet) {
    const n = byId.get(nid);
    if (!n) continue;
    for (const [r, c] of [[n.r + 1, n.c], [n.r, n.c + 1]]) {
      const nb = grid.get(D.gridKey(r, c));
      if (nb && activeSet.has(nb.id)) {
        const a = rectOf(n.r, n.c), b = rectOf(r, c);
        ctx.beginPath();
        ctx.moveTo(a.x + a.w / 2, a.y + a.h / 2);
        ctx.lineTo(b.x + b.w / 2, b.y + b.h / 2);
        ctx.stroke();
      }
    }
  }

  const iconSide = cell * 0.62;
  const fontPx = Math.max(7, Math.round(cell * 0.17));
  const labelH = Math.round(fontPx * 1.25) + 2;
  ctx.font = `bold ${fontPx}px ${font}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  for (const n of grid.values()) {
    const rect = rectOf(n.r, n.c);
    const isActive = activeSet.has(n.id);
    const grade = n.g;
    if (grade !== "empty") {
      const color = D.gradeColor(grade, accent);
      const img = sprite(grade, isActive);
      if (img) {
        const scale = Math.min(rect.w / img.width, rect.h / img.height);
        const w = img.width * scale, h = img.height * scale;
        ctx.globalAlpha = isActive ? 1 : INACTIVE_OPACITY;
        ctx.drawImage(img, rect.x + (rect.w - w) / 2, rect.y + (rect.h - h) / 2, w, h);
        ctx.globalAlpha = 1;
      } else if (isActive) {
        roundRect(ctx, rect.x, rect.y, rect.w, rect.h, 8);
        ctx.fillStyle = withAlpha(color, grade === "start" ? 0.9 : 0.85);
        ctx.fill();
        ctx.strokeStyle = accent;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      } else {
        roundRect(ctx, rect.x, rect.y, rect.w, rect.h, 8);
        ctx.fillStyle = withAlpha(color, 0.06);
        ctx.fill();
        ctx.strokeStyle = withAlpha(muted, 46 / 255);
        ctx.lineWidth = 1.4;
        ctx.stroke();
      }

      const label = showLabels ? labels.get(n.id) || "" : "";
      const icon = icons.get(n.id);
      if (icon) {
        ctx.globalAlpha = isActive ? 1 : INACTIVE_OPACITY;
        const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2 - (label ? labelH * 0.45 : 0);
        ctx.drawImage(icon, cx - iconSide / 2, cy - iconSide / 2, iconSide, iconSide);
        ctx.globalAlpha = 1;
      }
      if (label) {
        const sx = rect.x + 1, sy = rect.y + rect.h - labelH - 1, sw = rect.w - 2;
        roundRect(ctx, sx, sy, sw, labelH, 3);
        ctx.fillStyle = withAlpha(bg, 190 / 255);
        ctx.fill();
        ctx.fillStyle = isActive ? fg : muted;
        ctx.fillText(elide(ctx, label, Math.round(sw) - 4), sx + sw / 2, sy + labelH / 2 + 0.5);
      } else if (grade !== "start" && !img) {
        ctx.beginPath();
        ctx.arc(rect.x + rect.w / 2, rect.y + rect.h / 2, 4 * zoom, 0, Math.PI * 2);
        ctx.fillStyle = withAlpha(color, isActive ? 0.9 : 0.35);
        ctx.fill();
      }
    }

    if (options.hideBorders) continue;
    if (highlighted.has(n.id)) {
      roundRect(ctx, rect.x - 2, rect.y - 2, rect.w + 4, rect.h + 4, 9);
      ctx.strokeStyle = warn;
      ctx.lineWidth = 2.2;
      ctx.stroke();
    }
    if (added.has(n.id) || removed.has(n.id)) {
      roundRect(ctx, rect.x - 2.5, rect.y - 2.5, rect.w + 5, rect.h + 5, 10);
      ctx.strokeStyle = added.has(n.id) ? success : danger;
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    if (options.hovered === D.gridKey(n.r, n.c)) {
      roundRect(ctx, rect.x - 1.5, rect.y - 1.5, rect.w + 3, rect.h + 3, 9);
      ctx.strokeStyle = accentHover;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }
  return canvas;
}

// The node under CSS-pixel (x, y) of a canvas drawn by renderBoard, or null.
export function hitTest(canvas, x, y) {
  const g = canvas._daevanion;
  if (!g) return null;
  const step = g.cell + g.gap;
  const c = Math.floor((x - g.pad) / step + g.c0);
  const r = Math.floor((y - g.pad) / step + g.r0);
  if (r < 1 || r > D.GRID_SIZE || c < 1 || c > D.GRID_SIZE) return null;
  const rx = g.pad + (c - g.c0) * step, ry = g.pad + (r - g.r0) * step;
  if (x < rx || x > rx + g.cell || y < ry || y > ry + g.cell) return null;
  return g.grid.get(D.gridKey(r, c)) || null;
}

// ── tooltip (DaevanionNodeTooltip) ──────────────────────────────────────────

let tip = null;

function tipElement() {
  if (!tip) {
    tip = document.createElement("div");
    tip.className = "daev-tip";
    tip.hidden = true;
    document.body.appendChild(tip);
    installTooltipGuards();
  }
  return tip;
}

export function hideTooltip() { if (tip) tip.hidden = true; }

let tooltipGuardsInstalled = false;

function installTooltipGuards() {
  if (tooltipGuardsInstalled) return;
  tooltipGuardsInstalled = true;
  window.addEventListener("blur", hideTooltip);
  window.addEventListener("mouseout", (e) => { if (!e.relatedTarget) hideTooltip(); });
  window.addEventListener("scroll", hideTooltip, { capture: true, passive: true });
  document.addEventListener("mouseleave", hideTooltip);
  document.documentElement.addEventListener("mouseleave", hideTooltip);
  document.addEventListener("visibilitychange", hideTooltip);
  document.addEventListener("pointermove", (e) => {
    if (tip && !tip.hidden && !(e.target && e.target._daevanion)) hideTooltip();
  }, { passive: true });
}

// options: {board, activeSet, pointsLeft (default Infinity), x, y, skillsById}
export function showTooltip(node, options) {
  const { board, activeSet: active } = options;
  const grid = gridOf(board);
  const skillsById = options.skillsById || classSkillsById(board.classId);
  const isActive = active.has(node.id);
  const reachable = !isActive && D.isReachable(node, grid, active);
  const left = options.pointsLeft === undefined ? Infinity : options.pointsLeft;
  const gradeLabel = D.GRADE_LABEL[node.g] || node.g;
  const name = node.name || gradeLabel;
  const itemGrade = D.GRADE_TO_ITEM_GRADE[node.g] || "";
  let status, text;
  if (node.g === "start") [status, text] = ["start", T.status_start];
  else if (isActive) [status, text] = ["active", T.status_active];
  else if (!reachable) [status, text] = ["locked", T.status_locked];
  else if (node.cost > left) [status, text] = ["no_points", T.status_no_points];
  else [status, text] = ["available", T.status_available];
  const rows = D.effectLines(node, skillsById).map(([label, value]) =>
    `<div class="effect"><span class="label">${esc(label)}</span><span class="value">${esc(value)}</span></div>`).join("");
  const el = tipElement();
  el.innerHTML = `<div class="pill grade ${itemGrade ? `grade-${itemGrade}` : "grade-start"}">${esc(gradeLabel.toUpperCase())}</div>
    <div class="title">${esc(name)}</div>
    <div class="meta">Cost: ${node.cost} pt${node.cost !== 1 ? "s" : ""} · Required level: ${node.lvl ?? 0}</div>
    ${rows ? `<div class="effects">${rows}</div>` : ""}
    <div class="status" data-status="${status}">${esc(text)}</div>`;
  el.hidden = false;
  let x = options.x + 16, y = options.y + 16;
  const w = el.offsetWidth, h = el.offsetHeight;
  if (x + w > window.innerWidth) x = options.x - w - 16;
  if (y + h > window.innerHeight) y = options.y - h - 16;
  el.style.left = `${Math.max(0, x)}px`;
  el.style.top = `${Math.max(0, y)}px`;
}

// ── board tabs, sizes (shared by the page and boardTabsWidget) ──────────────

function readStore(key) {
  try { return JSON.parse(localStorage.getItem(key) || "{}") || {}; } catch { return {}; }
}

function writeStore(key, values) {
  try { localStorage.setItem(key, JSON.stringify({ ...readStore(key), ...values })); } catch { }
}

function clampSide(side) { return Math.round(Math.max(SIDE_MIN, Math.min(SIDE_MAX, side))); }

function storedSide(which) {
  const side = Number(readStore(SIZE_STORE)[which]);
  return side > 0 ? clampSide(side) : null;
}

function rememberOrder(dataKey, boardOrder) { writeStore(BOARD_STORE, { [dataKey]: boardOrder }); }

// The remembered board of the class, else the first one with nodes taken, else the first.
function initialOrder(dataKey, boards, set) {
  const remembered = readStore(BOARD_STORE)[dataKey];
  if (boards.some((b) => b.order === remembered)) return remembered;
  const used = boards.find((b) => D.spentCost(activeOf(set, b), variant.node_by_id) > 0);
  return (used || boards[0] || { order: null }).order;
}

function boardTabsHtml(boards, set, current, disabledKeys = []) {
  return boards.map((b) => {
    const spent = D.spentCost(activeOf(set, b), variant.node_by_id);
    const off = disabledKeys.includes(boardKey(b));
    const selected = b.order === current;
    return `<button type="button" role="tab" class="daev-tab${selected ? " active" : ""}${off ? " off" : ""}" aria-selected="${selected}" data-order="${b.order}" title="${esc(T.tab_tooltip(b.name, spent))}">`
      + `<span class="dot${spent ? " on" : ""}"></span><span class="name">${esc(off ? T.board_off(b.name) : b.name)}</span><span class="pts">${spent}</span></button>`;
  }).join("");
}

function resizeHandleHtml() {
  return `<div class="daev-resize" tabindex="0" role="separator" aria-orientation="horizontal" title="${esc(T.resize_tooltip)}"></div>`;
}

function wireResize(handle, getSide, setSide, done) {
  handle.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    hideTooltip();
    const start = getSide(), x0 = e.clientX, y0 = e.clientY;
    handle.setPointerCapture(e.pointerId);
    handle.classList.add("dragging");
    const move = (ev) => {
      const dx = ev.clientX - x0, dy = ev.clientY - y0;
      setSide(clampSide(start + (Math.abs(dx) > Math.abs(dy) ? dx : dy)));
    };
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      handle.classList.remove("dragging");
      done(getSide());
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  });
  handle.addEventListener("keydown", (e) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    setSide(clampSide(getSide() + step * SIDE_KEY_STEP));
    done(getSide());
  });
}

function linkedSetOf(classKeyAny) {
  const lower = String(classKeyAny || "").trim().toLowerCase();
  const className = BUILDS_CLASS_BY_DATA_KEY[lower] || lower;
  const builds = (bp().daevanion_builds_data || {})[className] || {};
  return builds[linkedSetName(equipBuildOf(className), className)] || {};
}

// One deity board of `classKey` at a time behind a tab bar, in a resizable
// frame, with the node tooltip on hover. Shows the set the class's current
// equip build links to and follows profile changes. `side` is the initial
// frame size in CSS px (a size the user dragged to wins); `onChange` gets
// {board, key, spent, activeSet} when another tab is picked. Call
// `el.destroy()` when the host unmounts.
// `fit`: the board follows the element's width instead of a stored, hand-resized size.
export function boardTabsWidget(classKeyAny, { side = 520, onChange = null, preset = null, fit = false } = {}) {
  const setOf = () => {
    if (!preset) return linkedSetOf(classKeyAny);
    const lower = String(classKeyAny || "").trim().toLowerCase();
    const className = BUILDS_CLASS_BY_DATA_KEY[lower] || lower;
    const equip = ((bp().equip_builds_data || {})[className] || {})[preset] || null;
    return ((bp().daevanion_builds_data || {})[className] || {})[linkedSetName(equip, className)] || {};
  };
  const el = document.createElement("div");
  el.className = "daev-widget";
  el.innerHTML = `<div class="muted small">${T.loading}</div>`;
  const dataKey = D.skillsDataClassKey(String(classKeyAny || "").trim().toLowerCase());
  let size = fit ? clampSide(el.clientWidth || side) : (storedSide("widget") || clampSide(side));
  let current = null, hoveredKey = null, alive = true, unsubscribe = null, observer = null;
  let tabs = null, box = null, canvasEl = null;
  const boards = () => D.classBoards(variant, dataKey);
  const boardNow = () => boards().find((b) => b.order === current) || null;
  const viewNow = () => bp().daevanion_view || {};

  function paint() {
    const board = boardNow();
    if (!board || !canvasEl) return;
    const v = viewNow();
    renderBoard(canvasEl, variant, board, activeOf(setOf(), board), {
      side: size - 2, hovered: hoveredKey, showLabels: v.show_labels !== false, hideBorders: !!v.hide_borders,
    });
  }

  function render() {
    const list = boards();
    if (!list.length) { el.innerHTML = `<div class="muted small">${T.no_board_for_class}</div>`; tabs = box = canvasEl = null; return; }
    const set = setOf();
    if (!list.some((b) => b.order === current)) current = initialOrder(dataKey, list, set);
    tabs.innerHTML = boardTabsHtml(list, set, current);
    paint();
  }

  function build() {
    el.innerHTML = `<div class="daev-tabs" role="tablist"></div>
      <div class="daev-board-box" style="--daev-side: ${size}px"><div class="daev-canvas-frame"><canvas></canvas></div>${fit ? "" : resizeHandleHtml()}</div>`;
    tabs = el.querySelector(".daev-tabs");
    box = el.querySelector(".daev-board-box");
    canvasEl = el.querySelector("canvas");
    tabs.addEventListener("click", (e) => {
      const button = e.target.closest("[data-order]");
      if (!button) return;
      const picked = Number(button.dataset.order);
      if (picked === current) return;
      current = picked;
      hoveredKey = null;
      rememberOrder(dataKey, picked);
      hideTooltip();
      render();
      const board = boardNow();
      if (onChange && board) {
        const active = activeOf(setOf(), board);
        onChange({ board, key: boardKey(board), spent: D.spentCost(active, variant.node_by_id), activeSet: active });
      }
    });
    canvasEl.addEventListener("mousemove", (e) => {
      const board = boardNow();
      if (!board) return;
      const rect = canvasEl.getBoundingClientRect();
      const node = hitTest(canvasEl, e.clientX - rect.left, e.clientY - rect.top);
      const rc = node && node.g !== "empty" ? D.gridKey(node.r, node.c) : null;
      if (rc !== hoveredKey) { hoveredKey = rc; paint(); }
      if (!rc) { hideTooltip(); return; }
      showTooltip(node, { board, activeSet: activeOf(setOf(), board), x: e.clientX, y: e.clientY });
    });
    const leave = () => {
      if (hoveredKey) { hoveredKey = null; paint(); }
      hideTooltip();
    };
    canvasEl.addEventListener("mouseleave", leave);
    canvasEl.addEventListener("pointerleave", leave);
    if (fit) {
      let frame = 0;
      observer = new ResizeObserver(() => {
        if (frame) return;
        frame = requestAnimationFrame(() => {
          frame = 0;
          const next = clampSide(Math.floor(el.clientWidth));
          if (!alive || !el.clientWidth || next === size) return;
          size = next;
          box.style.setProperty("--daev-side", `${next}px`);
          paint();
        });
      });
      observer.observe(el);
    } else {
      wireResize(el.querySelector(".daev-resize"), () => size, (next) => {
        size = next;
        box.style.setProperty("--daev-side", `${next}px`);
        paint();
      }, (final) => writeStore(SIZE_STORE, { widget: final }));
    }
    unsubscribe = onProfileChange(() => { if (tabs) render(); });
    render();
  }

  prepare(classKeyAny).then(() => { if (alive) build(); });
  el.destroy = () => {
    alive = false;
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    if (observer) { observer.disconnect(); observer = null; }
    hideTooltip();
  };
  return el;
}

// ── page ────────────────────────────────────────────────────────────────────

let root = null;
let pageSide = null;
let canvas = null;
let fitZoom = 1, userZoom = 1;
let hovered = null;
let statusText = "";
const openSections = new Set(["stats", "substats"]);
let menu = null;

function statusSet(text) {
  statusText = text;
  const el = root && root.querySelector(".daev-status");
  if (el) el.textContent = text;
}

function fitFor(board) {
  return Math.max(FIT_ZOOM_MIN, (pageSide - 4) / baseSide(gridOf(board)));
}

function defaultPageSide() {
  const top = root ? root.getBoundingClientRect().top : 0;
  const width = (root ? root.clientWidth : window.innerWidth) - 380 - 16 - 8;
  const height = window.innerHeight - top - 150;
  return clampSide(Math.min(width, height));
}

function setPageSide(side) {
  pageSide = side;
  const body = root && root.querySelector(".daev-body");
  if (body) body.style.setProperty("--daev-side", `${side}px`);
  const board = currentBoard();
  if (!board) return;
  fitZoom = fitFor(board);
  drawCanvas();
}

function zoomTo(zoom) {
  const frame = root && root.querySelector(".daev-canvas-frame");
  if (!frame || !canvas) return;
  const oldW = Math.max(1, canvas.offsetWidth), oldH = Math.max(1, canvas.offsetHeight);
  const anchorX = (frame.scrollLeft + frame.clientWidth / 2) / oldW;
  const anchorY = (frame.scrollTop + frame.clientHeight / 2) / oldH;
  userZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom));
  drawCanvas();
  frame.scrollLeft = Math.round(anchorX * canvas.offsetWidth - frame.clientWidth / 2);
  frame.scrollTop = Math.round(anchorY * canvas.offsetHeight - frame.clientHeight / 2);
  const slider = root.querySelector("#daev-zoom");
  if (slider) slider.value = String(Math.round(userZoom * 100));
  const label = root.querySelector(".daev-zoom .val");
  if (label) label.textContent = `${Math.round(userZoom * 100)}%`;
}

function drawCanvas() {
  if (!root || !canvas) return;
  const board = currentBoard();
  if (!board) return;
  const grid = gridOf(board);
  const v = view();
  renderBoard(canvas, variant, board, activeSet(board), {
    zoom: fitZoom * userZoom, highlighted: highlightedIds(board, grid),
    showLabels: v.show_labels, hideBorders: v.hide_borders, hovered,
  });
}

function onWheel(e) {
  e.preventDefault();
  zoomTo(userZoom * (e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP));
}

function canvasPoint(e) {
  const rect = canvas.getBoundingClientRect();
  return [e.clientX - rect.left, e.clientY - rect.top];
}

function onCanvasMove(e) {
  const node = hitTest(canvas, ...canvasPoint(e));
  const rc = node ? D.gridKey(node.r, node.c) : null;
  if (rc !== hovered) { hovered = rc; drawCanvas(); }
  if (!node || node.g === "empty") { hideTooltip(); return; }
  showTooltip(node, { board: currentBoard(), activeSet: activeSet(currentBoard()), pointsLeft: pointsLeft(), x: e.clientX, y: e.clientY });
}

function onCanvasLeave() {
  if (hovered !== null) { hovered = null; drawCanvas(); }
  hideTooltip();
}

function onCanvasClick(e) {
  const board = currentBoard();
  const node = hitTest(canvas, ...canvasPoint(e));
  if (!board || !node || node.g === "start" || node.g === "empty") return;
  const grid = gridOf(board);
  const active = activeSet(board);
  if (active.has(node.id)) {
    active.delete(node.id);
    D.pruneUnreachable(grid, active, variant.node_by_id);
  } else if (D.isReachable(node, grid, active)) {
    if (node.cost <= pointsLeft()) active.add(node.id);
    else statusSet(T.status_no_points);
  }
  storeActive(board, active);
  persist();
  draw();
  showTooltip(node, { board, activeSet: activeSet(board), pointsLeft: pointsLeft(), x: e.clientX, y: e.clientY });
}

function setButtonsHtml() {
  const builds = buildsOf(classLower());
  const current = currentSetName();
  const names = Object.keys(builds).length ? Object.keys(builds) : ["Default"];
  return `<select id="daev-set" title="${esc(T.set_tooltip)}">${names.map((n) => `<option ${n === current ? "selected" : ""}>${esc(n)}</option>`).join("")}</select>
    <button class="icon-btn" data-set="add" title="${T.add_new_build}">${ICONS.plus}</button>
    <button class="icon-btn" data-set="duplicate" title="${T.duplicate_current_build}">${ICONS.duplicate}</button>
    <button class="icon-btn" data-set="rename" title="${T.rename_current_build}">${ICONS.edit}</button>
    <button class="icon-btn" data-set="delete" title="${T.delete_current_build}" ${names.length > 1 ? "" : "disabled"}>${ICONS.trash}</button>
    <button class="daev-plan" data-set="plan" title="Start a new board set as a copy of this one, to plan the next step without touching it">Plan a new set…</button>
    <button class="daev-plan" data-set="compare" title="Compare this set with another one: nodes, points, stats and skill bonuses side by side" ${names.length > 1 ? "" : "disabled"}>Compare…</button>`;
}

function switchSet(name) {
  const className = classLower();
  const equip = equipBuildOf(className);
  if (equip) equip.linked_daevanion_build = name;
  bp().current_daevanion_build_name = name;
  statusSet("");
  persist();
  draw();
}

// Picks another set and opens the Diff page for the two sets' presets.
function compareDialog(className, current) {
  const p = bp();
  const others = Object.keys(buildsOf(className)).filter((n) => n !== current);
  if (!others.length) return;
  const presetOf = (name) => presetsOfBuild(p, className, name)[0] || null;
  const dialog = document.createElement("dialog");
  dialog.className = "builds-dialog daev-compare";
  dialog.innerHTML = `<form method="dialog" class="stack">
      <h3>Compare "${esc(current)}" with</h3>
      <select class="daev-compare-pick">${others.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join("")}</select>
      <div class="muted small">The Diff page shows both sets board by board, with added nodes green and removed ones red, plus the points, stats and skill bonuses of each set.</div>
      <div class="row builds-dialog-actions"><span class="grow"></span><button type="button" class="cancel">Cancel</button><button type="submit" class="primary">Compare</button></div>
    </form>`;
  document.body.appendChild(dialog);
  let picked = null;
  dialog.querySelector("form").addEventListener("submit", (e) => { e.preventDefault(); picked = dialog.querySelector(".daev-compare-pick").value; dialog.close(); });
  dialog.querySelector(".cancel").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => {
    dialog.remove();
    if (!picked) return;
    const a = presetOf(current), b = presetOf(picked);
    if (!a || !b) { statusSet("One of the sets has no preset to compare; create one in the roster."); return; }
    navigate(`diff/${encodeURIComponent(className)}/${encodeURIComponent(a)}/${encodeURIComponent(b)}`);
  });
  dialog.showModal();
}

function onSetAction(action) {
  const className = classLower();
  const builds = buildsOf(className);
  const current = currentSetName();
  if (action === "add") {
    const name = (prompt(T.name_colon) || "").trim();
    if (!name || builds[name]) return;
    if (newBuild(className, name) === false) return;
    switchSet(name);
  } else if (action === "duplicate" || action === "plan") {
    const name = (prompt(action === "plan" ? "Name of the planned set:" : T.name_colon, action === "plan" ? `${current} (plan)` : T.duplicate_default_name(current)) || "").trim();
    if (!name || builds[name]) return;
    const source = D.routeSettingsToJson(routeSettings());
    if (duplicateBuild(className, current, name) === false) return;
    bp().daevanion_build_settings[className][name] = D.routeSettingsFromJson(source);
    switchSet(name);
  } else if (action === "compare") {
    compareDialog(className, current);
  } else if (action === "rename") {
    const name = (prompt(T.name_colon, current) || "").trim();
    if (!name || name === current || builds[name] || !builds[current]) return;
    builds[name] = builds[current];
    delete builds[current];
    const settings = (bp().daevanion_build_settings || {})[className] || {};
    if (settings[current]) { settings[name] = settings[current]; delete settings[current]; }
    for (const equip of Object.values((bp().equip_builds_data || {})[className] || {})) {
      if (equip.linked_daevanion_build === current) equip.linked_daevanion_build = name;
    }
    switchSet(name);
  } else if (action === "delete") {
    if (Object.keys(builds).length <= 1 || !builds[current]) return;
    if (!confirm(T.delete_confirm(current))) return;
    delete builds[current];
    const settings = (bp().daevanion_build_settings || {})[className] || {};
    delete settings[current];
    const replacement = Object.keys(builds)[0];
    for (const equip of Object.values((bp().equip_builds_data || {})[className] || {})) {
      if (equip.linked_daevanion_build === current) equip.linked_daevanion_build = replacement;
    }
    switchSet(replacement);
  }
}

function filterEntries(board, grid) {
  const skillsById = classSkillsById(classKey());
  const set = currentSet();
  const groups = {};
  for (const [cat] of D.FILTER_SECTIONS) groups[cat] = {};
  const active = new Set();
  for (const classBoard of classBoardsHere()) {
    for (const id of activeOf(set, classBoard)) active.add(id);
    for (const [cat, entries] of Object.entries(D.buildFilterGroups(gridOf(classBoard), skillsById))) {
      for (const [key, entry] of Object.entries(entries)) {
        const merged = groups[cat][key] || (groups[cat][key] = { ...entry, ids: new Set(), grades: new Set() });
        for (const id of entry.ids) merged.ids.add(id);
        for (const g of entry.grades) merged.grades.add(g);
      }
    }
  }
  const here = D.buildFilterGroups(grid, skillsById);
  return { groups, here, active };
}

function sidebarHtml(board, grid) {
  const { groups, here, active } = filterEntries(board, grid);
  const checked = new Set(filterChecked());
  const counts = filterCounts();
  const skipped = skipSet(board);
  let html = "";
  for (const [cat, title] of D.FILTER_SECTIONS) {
    const entries = Object.entries(groups[cat]).sort((a, b) => {
      const ha = a[0] in here[cat] ? 0 : 1, hb = b[0] in here[cat] ? 0 : 1;
      return ha - hb || (a[1].label < b[1].label ? -1 : a[1].label > b[1].label ? 1 : 0);
    });
    html += `<details class="daev-acc" data-section="${cat}" ${openSections.has(cat) ? "open" : ""}><summary>${title} (${entries.length})</summary><div class="body">`;
    let dividerAdded = false;
    for (const [key, entry] of entries) {
      if (!(key in here[cat]) && !dividerAdded) { html += `<div class="divider">${T.other_boards}</div>`; dividerAdded = true; }
      const fullKey = `${cat}|${key}`;
      const activeCount = [...entry.ids].filter((id) => active.has(id)).length;
      let text = `${entry.label} (${activeCount}/${entry.ids.size})`;
      if (skipped.has(fullKey) && key in here[cat]) text += "  " + T.skipped_here;
      const requiredCount = [...entry.ids].filter((id) => variant.node_by_id.get(id).g !== "common").length;
      const grade = D.entryAccentGrade(entry.grades);
      const icon = entry.skill && entry.skill.iconFile ? `<img class="skill-icon" src="assets/skill_icons/${esc(entry.skill.iconFile)}" alt="">` : "";
      const isChecked = checked.has(fullKey);
      html += `<div class="daev-entry" data-key="${esc(fullKey)}" title="${esc(text + "\n" + T.skip_hint)}">
        <label class="grow ${grade ? `grade-${grade}` : ""}"><input type="checkbox" ${isChecked ? "checked" : ""}>${icon}<span class="text">${esc(text)}</span></label>
        <input type="number" class="count" min="0" max="${requiredCount}" value="${counts[fullKey] || ""}" placeholder="${T.count_all}" title="${esc(T.count_tooltip)}" ${isChecked && requiredCount ? "" : "hidden"}>
      </div>`;
    }
    html += "</div></details>";
  }
  return html;
}

function statsHtml(board) {
  const entries = D.activeStatSummary(variant.node_by_id, activeSet(board));
  if (!entries.length) return `<div class="disclaimer">${T.stat_summary_empty}</div>`;
  return entries.map(([label, value, isPercent]) =>
    `<div class="stat"><span class="name">${esc(label)}</span><span class="value">+${D.formatNumber(value, isPercent ? 1 : 0)}${isPercent ? "%" : ""}</span></div>`).join("");
}

function onFilterToggled(fullKey, on) {
  const list = filterChecked();
  const i = list.indexOf(fullKey);
  if (on && i < 0) list.push(fullKey);
  if (!on && i >= 0) list.splice(i, 1);
  statusSet("");
  persist();
  draw();
}

function onCountChanged(fullKey, value) {
  const counts = filterCounts();
  if (value > 0) counts[fullKey] = value; else delete counts[fullKey];
  persist();
}

function closeMenu() {
  if (menu) { menu.remove(); menu = null; }
}

function onEntryContextMenu(e, fullKey) {
  e.preventDefault();
  const board = currentBoard();
  if (!board) return;
  closeMenu();
  const settings = routeSettings();
  const key = boardKey(board);
  const skipped = (settings.skip[key] || []).includes(fullKey);
  menu = document.createElement("div");
  menu.className = "daev-menu";
  menu.innerHTML = `<button>${esc(skipped ? T.unskip_on_board(board.name) : T.skip_on_board(board.name))}</button>`;
  menu.style.left = `${e.clientX}px`;
  menu.style.top = `${e.clientY}px`;
  menu.querySelector("button").addEventListener("click", () => {
    const list = settings.skip[key] || (settings.skip[key] = []);
    if (skipped) settings.skip[key] = list.filter((k) => k !== fullKey);
    else if (!list.includes(fullKey)) list.push(fullKey);
    if (!settings.skip[key].length) delete settings.skip[key];
    closeMenu();
    persist();
    draw();
  });
  document.body.appendChild(menu);
  setTimeout(() => document.addEventListener("click", closeMenu, { once: true }), 0);
}

function onReset() {
  const board = currentBoard();
  if (!board) return;
  storeActive(board, new Set());
  statusSet("");
  persist();
  draw();
}

// _daevanion_on_route: ticked coloured nodes are required (all, or the wanted
// number), ticked plain 1-point nodes are preferred.
function onRoute() {
  if (!currentBoard()) return;
  const checked = filterChecked();
  if (!checked.length) { statusSet(T.route_pick_value); return; }
  const nodeById = variant.node_by_id;
  const settings = routeSettings();
  const counts = filterCounts();
  const skillsById = classSkillsById(classKey());
  const set = currentSet();
  const boards = [];
  let offSpent = 0;
  const groupNodes = {};
  for (const fk of checked) groupNodes[fk] = {};
  const groupLabels = {};
  const preferred = {};
  for (const board of classBoardsHere()) {
    const key = boardKey(board);
    const grid = gridOf(board);
    const active = activeOf(set, board);
    const enabled = !settings.disabled_boards.includes(key);
    if (!enabled) offSpent += D.spentCost(active, nodeById);
    boards.push({ key, grid, start_id: D.startIdOf(grid), enabled, active });
    const skipped = new Set(settings.skip[key] || []);
    const boardGroups = D.buildFilterGroups(grid, skillsById);
    for (const fullKey of checked) {
      const i = fullKey.indexOf("|");
      const entry = (boardGroups[fullKey.slice(0, i)] || {})[fullKey.slice(i + 1)];
      if (!entry) continue;
      groupLabels[fullKey] = entry.label;
      if (skipped.has(fullKey)) continue;
      const plain = new Set([...entry.ids].filter((id) => nodeById.get(id).g === "common"));
      const pref = preferred[key] || (preferred[key] = new Set());
      for (const id of plain) pref.add(id);
      const coloured = new Set([...entry.ids].filter((id) => !plain.has(id)));
      if (coloured.size) groupNodes[fullKey][key] = coloured;
    }
  }
  const groups = Object.entries(groupNodes).filter(([, nodes]) => Object.keys(nodes).length)
    .map(([fk, nodes]) => ({ key: fk, count: counts[fk] || null, nodes }));
  const budget = settings.budget ?? null;
  const points = budget === null ? Infinity : Math.max(0, budget - offSpent);
  const result = D.planRoute(boards, nodeById, groups, preferred, points);
  if (result.over_budget) {
    statusSet(T.route_over_budget({ needed: result.required_cost + offSpent, budget }));
    return;
  }
  const needed = result.cost + offSpent;
  for (const [key, tree] of Object.entries(result.trees)) {
    const board = classBoardsHere().find((b) => boardKey(b) === key);
    if (board) storeActive(board, tree);
  }
  const budgetText = budget === null ? "∞" : budget;
  const routed = boards.filter((b) => b.enabled).length;
  if (Object.keys(result.unmet).length) {
    const items = Object.entries(result.unmet).sort().map(([fk, missing]) => `${groupLabels[fk] || fk} (${missing})`).join(", ");
    statusSet(T.route_unmet({ spent: needed, budget: budgetText, items }));
  } else {
    statusSet(T.route_ok({ boards: routed, spent: needed, budget: budgetText, taken: result.preferred_taken, total: result.preferred_total }));
  }
  persist();
  draw();
}

export function draw() {
  if (!root || !variant) return;
  hideTooltip();
  closeMenu();
  const board = currentBoard();
  const v = view();
  const settings = board ? routeSettings() : null;
  const budget = settings ? settings.budget ?? null : null;
  const boards = board ? classBoardsHere() : [];
  const deityTabs = board ? boardTabsHtml(boards, currentSet(), order, settings.disabled_boards) : "";
  if (!pageSide) pageSide = storedSide("page") || defaultPageSide();
  const zoomPercent = Math.round(userZoom * 100);
  const pointsLabel = board
    ? T.points_total_label({ total: totalSpent(), budget: budget === null ? "∞" : budget, board: D.spentCost(activeSet(board), variant.node_by_id) })
    : T.no_board_for_class;

  root.innerHTML = `<div class="daev">
    <div class="row daev-sets">${setButtonsHtml()}</div>
    <div class="row daev-header">
      <span class="section-label daev-points">${esc(pointsLabel)}</span>
      <span class="grow"></span>
      <label class="daev-zoom" title="${esc(T.zoom_tooltip)}">${T.zoom}<input type="range" id="daev-zoom" min="${ZOOM_MIN * 100}" max="${ZOOM_MAX * 100}" step="1" value="${zoomPercent}"><span class="val">${zoomPercent}%</span></label>
      <button data-view="hide_borders" aria-pressed="${!!v.hide_borders}">${T.hide_borders}</button>
      <button data-view="show_labels" aria-pressed="${!!v.show_labels}">${T.show_labels}</button>
      <button id="daev-reset">${T.reset_board}</button>
    </div>
    <div class="daev-tabs" role="tablist">${deityTabs}</div>
    <div class="daev-body" style="--daev-side: ${pageSide}px">
      <div class="daev-board-box"><div class="daev-canvas-frame"><canvas></canvas></div>${board ? resizeHandleHtml() : ""}</div>
      <aside class="daev-side">
        <div class="row daev-budget"><span class="section-label">${T.budget_label}</span>
          <input type="number" id="daev-budget" min="0" max="9999" value="${budget ?? ""}" placeholder="∞" title="${esc(T.budget_tooltip)}"></div>
        <label class="daev-use"><input type="checkbox" id="daev-use-board" ${board && !settings.disabled_boards.includes(boardKey(board)) ? "checked" : ""} title="${esc(T.use_board_tooltip)}">${T.use_board}</label>
        <button class="daev-route" title="${esc(T.find_route_tooltip)}">${T.find_route}</button>
        <div class="daev-status">${esc(statusText)}</div>
        <details class="daev-acc" data-section="stats" ${openSections.has("stats") ? "open" : ""}><summary>${T.stat_summary_title}</summary><div class="body stats">${board ? statsHtml(board) : ""}</div></details>
        <div class="daev-filters">${board ? sidebarHtml(board, gridOf(board)) : ""}</div>
      </aside>
    </div></div>`;

  root.querySelector("#daev-set").addEventListener("change", (e) => switchSet(e.target.value));
  root.querySelectorAll("[data-set]").forEach((b) => b.addEventListener("click", () => onSetAction(b.dataset.set)));
  root.querySelectorAll("[data-order]").forEach((b) => b.addEventListener("click", () => {
    const o = Number(b.dataset.order);
    if (o === order) return;
    order = o;
    hovered = null;
    rememberOrder(classKey(), o);
    draw();
  }));
  root.querySelector("#daev-zoom").addEventListener("input", (e) => zoomTo(Number(e.target.value) / 100));
  root.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => {
    const key = b.dataset.view;
    view()[key] = !view()[key];
    persist();
    draw();
  }));
  root.querySelector("#daev-reset").addEventListener("click", onReset);
  root.querySelector("#daev-budget").addEventListener("change", (e) => {
    const value = Math.max(0, Math.min(9999, parseInt(e.target.value, 10) || 0));
    routeSettings().budget = value || null;
    persist();
    draw();
  });
  root.querySelector("#daev-use-board").addEventListener("change", (e) => {
    if (!board) return;
    const key = boardKey(board);
    const s = routeSettings();
    if (e.target.checked) s.disabled_boards = s.disabled_boards.filter((k) => k !== key);
    else if (!s.disabled_boards.includes(key)) s.disabled_boards.push(key);
    persist();
    draw();
  });
  root.querySelector(".daev-route").addEventListener("click", onRoute);
  root.querySelectorAll("details.daev-acc").forEach((d) => d.addEventListener("toggle", () => {
    if (d.open) openSections.add(d.dataset.section); else openSections.delete(d.dataset.section);
  }));
  root.querySelectorAll(".daev-entry").forEach((row) => {
    const fullKey = row.dataset.key;
    const box = row.querySelector("input[type=checkbox]");
    const count = row.querySelector(".count");
    box.addEventListener("change", () => {
      if (Number(count.max) > 0) count.hidden = !box.checked;
      onFilterToggled(fullKey, box.checked);
    });
    count.addEventListener("change", () => onCountChanged(fullKey, Math.max(0, Math.min(Number(count.max), parseInt(count.value, 10) || 0))));
    row.addEventListener("contextmenu", (e) => onEntryContextMenu(e, fullKey));
  });

  canvas = root.querySelector("canvas");
  const frame = root.querySelector(".daev-canvas-frame");
  if (board) {
    canvas.addEventListener("mousemove", onCanvasMove);
    canvas.addEventListener("mouseleave", onCanvasLeave);
    canvas.addEventListener("pointerleave", onCanvasLeave);
    canvas.addEventListener("click", onCanvasClick);
    frame.addEventListener("wheel", onWheel, { passive: false });
    wireResize(root.querySelector(".daev-resize"), () => pageSide, setPageSide, (final) => writeStore(SIZE_STORE, { page: final }));
    fitZoom = fitFor(board);
    drawCanvas();
  }
}

export function mount(main) {
  root = main;
  root.innerHTML = `<div class="muted">${T.loading}</div>`;
  prepare(classDisplay()).then(() => { if (root === main) { order = null; draw(); } });
}

export function unmount() {
  if (redrawRequested) { cancelAnimationFrame(redrawRequested); redrawRequested = null; }
  hideTooltip();
  closeMenu();
  canvas = null;
  root = null;
  hovered = null;
  pageSide = null;
}

// [{board, key, spent, activeSet}] for the boards with nodes taken in the
// set the class's current equip build links to (needs prepare() first).
// classKey may be the display name ("Spiritmaster"), its lowercase form or
// the data key ("elementalist").
export function boardsInUse(classKey = classDisplay()) {
  if (!variant) return [];
  const dataKey = D.skillsDataClassKey(String(classKey || "").trim().toLowerCase());
  const set = linkedSetOf(classKey);
  const out = [];
  for (const board of D.classBoards(variant, dataKey)) {
    const active = activeOf(set, board);
    const spent = D.spentCost(active, variant.node_by_id);
    if (spent) out.push({ board, key: boardKey(board), spent, activeSet: active });
  }
  return out;
}

export function variantData() { return variant; }

// Stat Info contribution of the viewed deity board (app.py _daevanion_stat_totals).
export function currentBoardStatTotals() {
  if (!variant) return {};
  const board = currentBoard();
  if (!board) return {};
  return D.statTotals(variant.node_by_id, activeOf(currentSet(), board));
}
