// Genius Insight: the Pet Genus system's 5 boards, 9 Lines each with a
// property pick + rolled value + lock, named profiles, the Owned Effects
// sidebar and the all-boards total. Account-wide state in
// bp().genius_builds_data / current_genius_build_name. Desktop:
// _build_genius_insight_tab and the _genius_* methods.

import { bp, save } from "../state.js";

export const BOARDS = ["Cogni", "Fera", "Natura", "Varian", "Special"];
const BOARD_COLORS = { Cogni: "#3ba7f2", Fera: "#ef4444", Natura: "#22c55e", Varian: "#f2b90c", Special: "#2dd4bf" };

// (stat_key, label, min, max, is_percent)
const COMMON = [
  ["AccuracyBonus", "Accuracy Bonus", 20, 40, false],
  ["CriticalHit", "Critical Hit", 15, 30, false],
  ["BossAttack", "Boss Attack", 10, 20, false],
  ["EvasionBonus", "Evasion Bonus", 20, 40, false],
  ["CriticalHitResist", "Critical Hit Resist", 15, 30, false],
  ["Block", "Block", 25, 50, false],
  ["BackAttackCriticalHit", "Back Attack Critical Hit", 25, 50, false],
  ["FrontAttackCriticalHit", "Front Attack Critical Hit", 25, 50, false],
  ["BackAttackCriticalHitResist", "Back Attack Critical Hit Resist", 20, 40, false],
  ["FrontAttackCriticalHitResist", "Front Attack Critical Hit Resist", 20, 40, false],
  ["HP", "HP", 100, 200, false],
  ["MP", "MP", 50, 100, false],
];
const DEF_EXTRA = [
  ["DefenseBonus", "Defense Bonus", 80, 160, false],
  ["CriticalDamageDefense", "Critical Damage Defense", 100, 200, false],
  ["BackDefense", "Back Defense", 100, 200, false],
  ["FrontDefense", "Front Defense", 100, 200, false],
  ["PvEDefense", "PvE Defense", 100, 200, false],
];
const ATK_EXTRA = [
  ["AttackBonus", "Attack Bonus", 8, 16, false],
  ["MaxAttack", "Max Attack", 10, 20, false],
  ["CriticalAttack", "Critical Attack", 10, 20, false],
  ["BackAttack", "Back Attack", 10, 20, false],
  ["FrontAttack", "Front Attack", 10, 20, false],
  ["PvEAttack", "PvE Attack", 10, 20, false],
];
const DMG_EXTRA = [
  ["DamageBoost", "Damage Boost", 1.2, 2.4, true],
  ["Smite", "Smite", 1.2, 2.4, true],
  ["PerfectChance", "Perfect Chance", 1.2, 2.4, true],
  ["__SELF__", "{board} Damage Boost", 2.4, 4.8, true],
  ["WeaponDamageBoost", "Weapon Damage Boost", 1.2, 2.4, true],
  ["CriticalDamageBoost", "Critical Damage Boost", 1.5, 3.0, true],
  ["BackAttackDamageBoost", "Back Attack Damage Boost", 1.5, 3.0, true],
  ["FrontAttackDamageBoost", "Front Attack Damage Boost", 1.5, 3.0, true],
  ["PvEDamageBoost", "PvE Damage Boost", 1.5, 3.0, true],
];
const TOL_EXTRA = [
  ["DamageTolerance", "Damage Tolerance", 1.2, 2.4, true],
  ["Endurance", "Endurance", 1.2, 2.4, true],
  ["Regeneration", "Regeneration", 1.2, 2.4, true],
  ["__SELF__", "{board} Damage Tolerance", 2.4, 4.8, true],
  ["WeaponDamageTolerance", "Weapon Damage Tolerance", 1.2, 2.4, true],
  ["CriticalDamageTolerance", "Critical Damage Tolerance", 1.3, 2.6, true],
  ["BackAttackDamageTolerance", "Back Attack Damage Tolerance", 1.3, 2.6, true],
  ["FrontAttackDamageTolerance", "Front Attack Damage Tolerance", 1.3, 2.6, true],
  ["PvEDamageTolerance", "PvE Damage Tolerance", 1.5, 3.0, true],
];
const SPECIAL_ATK = [
  ["AttackBonus", "Attack Bonus", 8, 16, false],
  ["MaxAttack", "Max Attack", 10, 20, false],
  ["Penetration", "Penetration", 80, 160, false],
  ["PowerShardDamageBonus", "Power Shard Damage Bonus", 8, 16, false],
  ["CriticalAttack", "Critical Attack", 10, 20, false],
  ["BackAttack", "Back Attack", 10, 20, false],
  ["FrontAttack", "Front Attack", 10, 20, false],
  ["PvEAttack", "PvE Attack", 10, 20, false],
  ["HP", "HP", 100, 200, false],
  ["MP", "MP", 50, 100, false],
];

export function poolForLine(board, line) {
  const resolve = (entries) => entries.map(([key, label, lo, hi, pct]) => (key === "__SELF__"
    ? [label.includes("Boost") ? `${board}DamageBoost` : `${board}DamageTolerance`, label.replace("{board}", board), lo, hi, pct]
    : [key, label, lo, hi, pct]));
  if (board === "Special" && [1, 2, 4, 5, 7, 8].includes(line)) return [...SPECIAL_ATK];
  if ([1, 4, 7].includes(line)) return resolve(DEF_EXTRA.concat(COMMON));
  if ([2, 5, 8].includes(line)) return resolve(ATK_EXTRA.concat(COMMON));
  if ([3, 9].includes(line)) return resolve(DMG_EXTRA.concat(COMMON));
  if (line === 6) return resolve(TOL_EXTRA.concat(COMMON));
  return [];
}

export function defaultState() {
  const state = {};
  for (const board of BOARDS) {
    const lines = {};
    for (let line = 1; line <= 9; line += 1) {
      const pool = poolForLine(board, line);
      if (!pool.length) continue;
      lines[String(line)] = { stat: pool[0][0], value: pool[0][3], locked: false };
    }
    state[board] = lines;
  }
  return state;
}

function formatRange(lo, hi, pct) { return pct ? `${lo}% - ${hi}%` : `${lo} - ${hi}`; }

const OWNED_TOTAL_GROUPS = [
  ["Attributes", [["Might", "56"], ["Dexterity", "92"], ["Intelligence", "147"], ["Constitution", "49"], ["Willpower", "105"], ["Precision", "56"]]],
  ["Combat", [["Accuracy Bonus", "432"], ["Evasion Bonus", "242"], ["Critical Hit", "266"], ["Critical Hit Resist", "273"]]],
  ["Vitals & Mount", [["HP", "3220"], ["MP", "1645"], ["Mount Ground Move Speed", "524"], ["Mount Sprint Stamina Cost Reduction Rate", "29.1%"]]],
  ["Board Damage Boost", [["Cogni Damage Boost", "4.2%"], ["Fera Damage Boost", "6.6%"], ["Natura Damage Boost", "4.9%"], ["Varian Damage Boost", "4.6%"]]],
];
const OWNED_PETS_EXAMPLE = {
  Cogni: ["Krall Laborer", [["HP", "60"], ["Critical Hit", "5"], ["Might", "1"], ["Intelligence", "1"], ["Cogni Damage Boost", "0.1%"]]],
  Fera: ["Fossa", [["Mount Ground Move Speed", "6"], ["Accuracy Bonus", "5"], ["Dexterity", "1"], ["Intelligence", "1"], ["Fera Damage Boost", "0.1%"]]],
  Natura: ["Forest Specter", [["MP", "30"], ["Critical Hit Resist", "5"], ["Precision", "1"], ["Willpower", "1"], ["Natura Damage Boost", "0.1%"]]],
  Varian: ["Swarm", [["Mount Sprint Stamina Cost Reduction Rate", "0.6%"], ["Evasion Bonus", "5"], ["Constitution", "1"], ["Willpower", "1"], ["Varian Damage Boost", "0.1%"]]],
};
// Genius stat_key -> real item stat id, where one exists.
export const STAT_ID_MAP = {
  CriticalHit: "Critical", CriticalHitResist: "CriticalResist", Block: "Block", HP: "HPMax", MP: "MPMax",
  DamageBoost: "AmplifyAllDamage", WeaponDamageBoost: "AmplifyWeaponDamage", CriticalDamageBoost: "AmplifyCriticalDamage",
  BackAttackDamageBoost: "AmplifyBackAttack", FrontAttackDamageBoost: "AmplifyFrontAttack", Smite: "HardHit",
  PvEDamageBoost: "PvEAmplifyDamage", PvEDamageTolerance: "PvEDecreaseDamage", Endurance: "IronWall",
  Regeneration: "Restoration", Penetration: "DefensePierce", PowerShardDamageBonus: "SealStoneAddDamage",
};

const T = {
  title: "Genius Insight", ownedTitle: "Owned Effects", ownedHint: "From farming/leveling pets — separate from the Insight rolls",
  total: "Total", individual: "Individual",
  ownedTotalNote: "Example account-wide sum across every owned pet — reference values, not tracked live here yet.",
  provenance: "Data point from the TW server at a mid-game state, where 80%+ of players have their pets at Lv. 5 — actual numbers will vary by progress.",
  perBoard: (board) => `Per ${board} Monster`,
  specialNote: "Special pets are bought pre-leveled (Lv. 5) and grant no Owned Effect — this section doesn't apply here.",
  petNote: "Every pet grants a fixed set of bonuses once fully leveled (Lv. 5 MAX) — one example pet shown per board, not the full range of pets that board has.",
  analysis: "Analysis Effect", lockTooltip: "Lock this Line — protects the property and value from accidental changes",
  lockAllTooltip: "Lock/unlock all 9 Lines of this board at once", sync: "Sync matching stats",
  syncTooltip: "When on: changing one Line's value automatically applies the same value to every other Line (on any board) holding the same property",
  footnote: "Pick which property each Line holds (only stats known to be eligible on that Line, per real in-game data, are offered) and enter the value you actually rolled — ranges shown are the real Heroic-grade Lv.10 min/max.",
  totalTitle: "Total", totalHint: "Summed across all 5 boards",
  totalFootnote: "Reflects the current pick on every Line across all 5 boards, summed by stat — updates live as you change any board.",
  search: "Search…", addBuild: "Add new build", duplicateBuild: "Duplicate current build", renameBuild: "Rename current build",
  deleteBuild: "Delete current build", newBuild: "New Build", renameTitle: "Rename Build", duplicateTitle: "Duplicate Build",
  nameColon: "Name:", deleteConfirm: (name) => `Really delete "${name}"? This cannot be undone.`, duplicateDefault: (name) => `${name} (Copy)`,
};

const esc = (text) => String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---- state -----------------------------------------------------------------------

// _merge_genius_build: a saved profile merged onto a fresh default.
function mergeBuild(saved) {
  const merged = defaultState();
  for (const [board, lines] of Object.entries(saved || {})) {
    if (!(board in merged)) continue;
    for (const [lineStr, entry] of Object.entries(lines || {})) {
      if (lineStr in merged[board] && entry && typeof entry === "object" && "stat" in entry && "value" in entry) {
        merged[board][lineStr] = { stat: entry.stat, value: entry.value, locked: Boolean(entry.locked) };
      }
    }
  }
  return merged;
}

const merged = new WeakSet();

export function geniusBuilds() {
  const p = bp();
  if (!p.genius_builds_data || !Object.keys(p.genius_builds_data).length) p.genius_builds_data = { Default: defaultState() };
  if (!(p.current_genius_build_name in p.genius_builds_data)) p.current_genius_build_name = Object.keys(p.genius_builds_data)[0];
  for (const name of Object.keys(p.genius_builds_data)) {
    if (!merged.has(p.genius_builds_data[name])) {
      p.genius_builds_data[name] = mergeBuild(p.genius_builds_data[name]);
      merged.add(p.genius_builds_data[name]);
    }
  }
  return p.genius_builds_data;
}

function currentState() {
  return geniusBuilds()[bp().current_genius_build_name];
}

// _linked_genius_build_name_for: the profile an equip set counts.
export function linkedGeniusBuildName(classKey, equipSetName) {
  const builds = geniusBuilds();
  const equip = ((bp().equip_builds_data || {})[classKey] || {})[equipSetName] || {};
  if (equip.linked_genius_build in builds) return equip.linked_genius_build;
  return bp().current_genius_build_name in builds ? bp().current_genius_build_name : Object.keys(builds)[0];
}

// {stat_id: value} of one profile's Line picks (_genius_stat_totals_for).
export function geniusStatTotals(geniusBuildName) {
  const builds = geniusBuilds();
  const insight = builds[geniusBuildName];
  if (!insight) return {};
  const totals = {};
  for (const [board, lines] of Object.entries(insight)) {
    for (const [lineStr, entry] of Object.entries(lines)) {
      const match = poolForLine(board, Number(lineStr)).find((p) => p[0] === entry.stat);
      if (!match) continue;
      const statId = STAT_ID_MAP[match[0]] || match[0];
      totals[statId] = (totals[statId] || 0) + (Number(entry.value) || 0);
    }
  }
  return totals;
}

// {label: [total, is_percent]} as the Total panel shows it.
function labelSums(state) {
  const sums = {};
  for (const [board, lines] of Object.entries(state)) {
    for (const [lineStr, entry] of Object.entries(lines)) {
      const match = poolForLine(board, Number(lineStr)).find((p) => p[0] === entry.stat);
      if (!match) continue;
      const [, label, , , pct] = match;
      if (!sums[label]) sums[label] = [0, pct];
      sums[label][0] += Number(entry.value) || 0;
    }
  }
  return sums;
}

const formatTotal = (total, pct) => (pct ? `${total.toFixed(1)}%` : String(Math.round(total)));

// Compact HTML of the profile an equip set counts, for summaries elsewhere.
export function geniusSummaryHtml(classKey, equipSetName) {
  const name = linkedGeniusBuildName(classKey, equipSetName);
  const sums = labelSums(geniusBuilds()[name]);
  const rows = Object.entries(sums).map(([label, [total, pct]]) => `<div class="genius-summary-row"><span class="owned-name">${esc(label)}</span><span class="owned-value">${formatTotal(total, pct)}</span></div>`);
  return `<div class="genius-summary"><div class="muted small">${esc(name)}</div>${rows.join("")}</div>`;
}

// ---- page ----------------------------------------------------------------------------

let root = null;
let activeBoard = "Cogni";
let ownedMode = "total";
let syncSameStat = false;
let popup = null;

export function mount(main) {
  root = main;
  draw();
}

export function unmount() {
  closePopup();
  root = null;
}

function draw() {
  if (!root) return;
  closePopup();
  const builds = geniusBuilds();
  const current = bp().current_genius_build_name;
  root.innerHTML = `<div class="genius-page">
    <div class="genius-title">${T.title}</div>
    <div class="row build-row">
      <select class="build-select">${Object.keys(builds).map((n) => `<option ${n === current ? "selected" : ""}>${esc(n)}</option>`).join("")}</select>
      <button type="button" class="icon" data-act="add" title="${T.addBuild}">＋</button>
      <button type="button" class="icon" data-act="dup" title="${T.duplicateBuild}">⧉</button>
      <button type="button" class="icon" data-act="rename" title="${T.renameBuild}">✎</button>
      <button type="button" class="icon" data-act="delete" title="${T.deleteBuild}" ${Object.keys(builds).length > 1 ? "" : "disabled"}>🗑</button>
    </div>
    <div class="genius-content">
      <div class="genius-panel owned"></div>
      <div class="genius-main">
        <div class="genius-panel board"></div>
        <div class="genius-panel total"></div>
      </div>
    </div>
  </div>`;
  root.querySelector(".build-select").addEventListener("change", (e) => { bp().current_genius_build_name = e.target.value; save(); draw(); });
  root.querySelectorAll(".build-row [data-act]").forEach((b) => b.addEventListener("click", () => onBuildAction(b.dataset.act)));
  drawOwned();
  drawBoard();
  drawTotal();
}

function onBuildAction(action) {
  const builds = geniusBuilds();
  const current = bp().current_genius_build_name;
  if (action === "add") {
    const name = (prompt(`${T.newBuild}\n${T.nameColon}`) || "").trim();
    if (!name || name in builds) return;
    builds[name] = defaultState();
    bp().current_genius_build_name = name;
  } else if (action === "dup") {
    const name = (prompt(`${T.duplicateTitle}\n${T.nameColon}`, T.duplicateDefault(current)) || "").trim();
    if (!name || name in builds) return;
    builds[name] = JSON.parse(JSON.stringify(builds[current]));
    bp().current_genius_build_name = name;
  } else if (action === "rename") {
    const name = (prompt(`${T.renameTitle}\n${T.nameColon}`, current) || "").trim();
    if (!name || name === current || name in builds) return;
    builds[name] = builds[current];
    delete builds[current];
    bp().current_genius_build_name = name;
  } else if (action === "delete") {
    if (Object.keys(builds).length <= 1 || !confirm(T.deleteConfirm(current))) return;
    delete builds[current];
    bp().current_genius_build_name = Object.keys(builds)[0];
  }
  save();
  draw();
}

function tileGrid(rows, { plainNames = false, boardColorLast = null } = {}) {
  return `<div class="owned-grid">${rows.map(([label, value], i) => {
    const color = boardColorLast && i === rows.length - 1 ? `style="color:${boardColorLast}"` : "";
    return `<div class="owned-tile"><span class="owned-name${plainNames ? " plain" : ""}" ${color}>${esc(label)}</span><span class="owned-value" ${color}>${esc(value)}</span></div>`;
  }).join("")}</div>`;
}

function drawOwned() {
  const panel = root.querySelector(".genius-panel.owned");
  let body;
  if (ownedMode === "total") {
    body = OWNED_TOTAL_GROUPS.map(([title, rows]) => `<div class="owned-group-title">${title}</div>${tileGrid(rows, { plainNames: title !== "Board Damage Boost" })}`).join("")
      + `<div class="owned-total-note">${T.ownedTotalNote}</div><div class="disclaimer">${T.provenance}</div>`;
  } else {
    body = Object.entries(OWNED_PETS_EXAMPLE).map(([board, [, rows]]) => `<div class="pet-title${board === activeBoard ? " active" : ""}" style="color:${BOARD_COLORS[board]}">${T.perBoard(board)}</div>${tileGrid(rows, { boardColorLast: BOARD_COLORS[board] })}`).join("")
      + `<div class="genius-hint">${T.specialNote}</div><div class="genius-hint">${T.petNote}</div>`;
  }
  panel.innerHTML = `<div class="section-title">${T.ownedTitle}</div><div class="genius-hint">${T.ownedHint}</div>
    <div class="row seg-row"><button type="button" class="seg${ownedMode === "total" ? " active" : ""}" data-mode="total">${T.total}</button><button type="button" class="seg${ownedMode === "individual" ? " active" : ""}" data-mode="individual">${T.individual}</button></div>
    <div class="owned-body">${body}</div>`;
  panel.querySelectorAll(".seg").forEach((b) => b.addEventListener("click", () => { ownedMode = b.dataset.mode; drawOwned(); }));
}

function allLocked(boardState, board) {
  for (let line = 1; line <= 9; line += 1) {
    if (poolForLine(board, line).length && !(boardState[String(line)] || {}).locked) return false;
  }
  return true;
}

function drawBoard() {
  const panel = root.querySelector(".genius-panel.board");
  const board = activeBoard;
  const state = currentState();
  const boardState = state[board];
  const rows = [];
  for (let line = 1; line <= 9; line += 1) {
    const pool = poolForLine(board, line);
    if (!pool.length) continue;
    const entry = boardState[String(line)];
    const match = pool.find((p) => p[0] === entry.stat) || pool[0];
    const [, label, lo, hi, pct] = match;
    const picker = pool.length === 1
      ? `<span class="line-name grow">${esc(pool[0][1])}</span>`
      : `<button type="button" class="line-combo grow" data-line="${line}" ${entry.locked ? "disabled" : ""}><span class="combo-text">${esc(label)}</span><span class="combo-range">${formatRange(lo, hi, pct)}</span></button>`;
    rows.push(`<div class="row line-row" data-line="${line}">
      <span class="line-index">${line}</span>
      <button type="button" class="lock" data-line="${line}" title="${T.lockTooltip}">${entry.locked ? "🔒" : "🔓"}</button>
      ${picker}
      <span class="value-wrap"><input type="number" class="line-value" data-line="${line}" min="${lo}" max="${hi}" step="${pct ? 0.1 : 1}" value="${pct ? Number(entry.value).toFixed(1) : Math.round(entry.value)}" ${entry.locked ? "disabled" : ""}>${pct ? '<span class="suffix">%</span>' : ""}</span>
    </div>`);
  }
  const locked = allLocked(boardState, board);
  panel.innerHTML = `<div class="row tabs-row">${BOARDS.map((b) => `<button type="button" class="board-tab${b === board ? " active" : ""}" data-board="${b}">${b}</button>`).join("")}</div>
    <label class="row sync-row" title="${esc(T.syncTooltip)}"><input type="checkbox" class="sync" ${syncSameStat ? "checked" : ""}> ${T.sync}</label>
    <div class="row head-row"><span class="board-title">${board} Insight</span><span class="grow"></span><span class="lvl-badge">Lv. 10 (MAX)</span></div>
    <div class="row section-row"><button type="button" class="lock master-lock" title="${T.lockAllTooltip}">${locked ? "🔒" : "🔓"}</button><span class="section-title">${T.analysis}</span></div>
    <div class="line-list">${rows.join("")}</div>
    <div class="genius-hint">${T.footnote}</div>`;
  panel.querySelectorAll(".board-tab").forEach((b) => b.addEventListener("click", () => { activeBoard = b.dataset.board; drawBoard(); if (ownedMode === "individual") drawOwned(); }));
  panel.querySelector(".sync").addEventListener("change", (e) => { syncSameStat = e.target.checked; });
  panel.querySelector(".master-lock").addEventListener("click", () => {
    const lockAll = !allLocked(boardState, board);
    for (const entry of Object.values(boardState)) entry.locked = lockAll;
    save();
    drawBoard();
  });
  panel.querySelectorAll(".line-row .lock").forEach((b) => b.addEventListener("click", () => {
    const entry = boardState[b.dataset.line];
    entry.locked = !entry.locked;
    save();
    drawBoard();
  }));
  panel.querySelectorAll(".line-combo").forEach((b) => b.addEventListener("click", () => openStatPicker(b, Number(b.dataset.line))));
  panel.querySelectorAll(".line-value").forEach((input) => input.addEventListener("change", () => onValueChanged(Number(input.dataset.line), input)));
}

function clamp(value, lo, hi) { return Math.max(lo, Math.min(hi, value)); }

function onValueChanged(line, input) {
  const board = activeBoard;
  const entry = currentState()[board][String(line)];
  const match = poolForLine(board, line).find((p) => p[0] === entry.stat);
  const [, , lo, hi, pct] = match;
  let value = Number(input.value);
  if (Number.isNaN(value)) value = hi;
  value = clamp(pct ? Math.round(value * 10) / 10 : Math.round(value), lo, hi);
  entry.value = value;
  if (syncSameStat) syncSameStatLines(entry.stat, value, board, line);
  save();
  drawBoard();
  drawTotal();
}

// Pushes `value` onto every other unlocked Line (any board) holding the same stat.
function syncSameStatLines(statKey, value, skipBoard, skipLine) {
  for (const [boardName, boardState] of Object.entries(currentState())) {
    for (const [lineStr, entry] of Object.entries(boardState)) {
      if (boardName === skipBoard && lineStr === String(skipLine)) continue;
      if (entry.stat !== statKey || entry.locked) continue;
      entry.value = value;
    }
  }
}

// Sync on a STAT switch: every other unlocked Line that held the old stat
// moves to the new one too, where its own pool offers it.
function syncSameStatChange(oldKey, newKey, value, skipBoard, skipLine) {
  for (const [boardName, boardState] of Object.entries(currentState())) {
    for (const [lineStr, entry] of Object.entries(boardState)) {
      if (boardName === skipBoard && lineStr === String(skipLine)) continue;
      if (entry.stat !== oldKey || entry.locked) continue;
      const match = poolForLine(boardName, Number(lineStr)).find((p) => p[0] === newKey);
      if (!match) continue;
      entry.stat = newKey;
      entry.value = clamp(value, match[2], match[3]);
    }
  }
}

function applyLineStat(line, statKey) {
  const board = activeBoard;
  const entry = currentState()[board][String(line)];
  const oldKey = entry.stat;
  const match = poolForLine(board, line).find((p) => p[0] === statKey);
  if (!match) return;
  entry.stat = statKey;
  entry.value = match[3];
  if (syncSameStat && oldKey !== statKey) syncSameStatChange(oldKey, statKey, entry.value, board, line);
  save();
  drawBoard();
  drawTotal();
}

// _GeniusStatPickerPopup: searchable list below the Line's button, 8 rows tall.
function openStatPicker(button, line) {
  closePopup();
  const pool = poolForLine(activeBoard, line);
  const currentKey = currentState()[activeBoard][String(line)].stat;
  popup = document.createElement("div");
  popup.className = "genius-stat-popup";
  popup.innerHTML = `<input type="text" class="search" placeholder="${T.search}"><div class="options">${pool.map(([key, label, lo, hi, pct]) => `<div class="option${key === currentKey ? " current" : ""}" data-key="${key}" data-label="${esc(label.toLowerCase())}"><span class="grow">${esc(label)}</span><span class="range">${formatRange(lo, hi, pct)}</span></div>`).join("")}</div>`;
  const rect = button.getBoundingClientRect();
  popup.style.left = `${rect.left + window.scrollX}px`;
  popup.style.top = `${rect.bottom + window.scrollY}px`;
  popup.style.width = `${Math.max(rect.width, 300)}px`;
  document.body.appendChild(popup);
  const search = popup.querySelector(".search");
  search.addEventListener("input", () => {
    const q = search.value.trim().toLowerCase();
    popup.querySelectorAll(".option").forEach((o) => { o.hidden = Boolean(q) && !o.dataset.label.includes(q); });
  });
  popup.querySelectorAll(".option").forEach((o) => o.addEventListener("click", () => { const key = o.dataset.key; closePopup(); applyLineStat(line, key); }));
  setTimeout(() => {
    document.addEventListener("mousedown", onOutside);
    document.addEventListener("keydown", onEscape);
  }, 0);
  search.focus();
}

function onOutside(e) { if (popup && !popup.contains(e.target)) closePopup(); }
function onEscape(e) { if (e.key === "Escape") closePopup(); }

function closePopup() {
  if (!popup) return;
  popup.remove();
  popup = null;
  document.removeEventListener("mousedown", onOutside);
  document.removeEventListener("keydown", onEscape);
}

function drawTotal() {
  const panel = root.querySelector(".genius-panel.total");
  const sums = labelSums(currentState());
  panel.innerHTML = `<div class="section-title">${T.totalTitle}</div><div class="genius-hint">${T.totalHint}</div>
    <div class="total-grid">${Object.entries(sums).map(([label, [total, pct]]) => `<div class="row total-pair"><span class="owned-name grow">${esc(label)}</span><span class="owned-value">${formatTotal(total, pct)}</span></div>`).join("")}</div>
    <div class="genius-hint">${T.totalFootnote}</div>`;
}
