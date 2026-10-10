// Checklist: server-wide tasks, per-character tasks with Odyle energy, and
// the week's Odyle plan. Ticks are stored with their time and count until the
// next reset of their kind (CEST schedule); "Info" entries are reminders
// without a tick. The main character does the server-wide share.

import { bp, characters, newId, plannerCharacterNamed, plannerServer, save, syncPlannerCharacters } from "../state.js";
import { isExcluded, setExcluded,
  KIND_TITLES, ODYLE_MAX, ODYLE_PER_TICK, ODYLE_PURCHASE_TASKS, PLANNER_KINDS, capMoment, durationText, isTaskDone, lastReset, migratePlannerTasks,
  nextOdyleTick, nextReset, odyleCapText, odyleEnergy, taskProgress,
  NIGHTMARE_MAX, NIGHTMARE_PER_DAY, nightmareCapText, nightmareEntries,
} from "../engine/planner.js";
import {
  CONQUEST_TIERS, CUBE_COST, ENERGY_PER_ITEM, KINA_CUTS, ROLES, ROLE_TITLES, TRANSCENDENCE_STAGES, WEEKLY_CUBES,
  kinaPercent, planWeek, purchaseLimit, purchasesThisWeek,
} from "../engine/odyleplan.js";
import { localClock } from "../engine/timers.js";
import { escapeHtml } from "../app.js";

const REFRESH_MS = 30000;
const ODYLE_WARN = 0.9;
const RESET_KINDS = ["daily", "weekly", "portals"];
const INFO_ICON = '<svg class="cl-info-icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="7.25" y="7" width="1.5" height="5" rx="0.75" fill="currentColor"/><circle cx="8" cy="4.75" r="1" fill="currentColor"/></svg>';

let timer = null;
let root = null;
let redrawAt = Infinity;

function resetMoment(at) {
  return `${at.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })}, ${localClock(at)}`;
}

function resetSpan(kind, now, prefix) {
  const at = nextReset(kind, now);
  if (!at) return "";
  return `<span class="cl-reset" data-reset="${kind}" data-prefix="${escapeHtml(prefix)}" title="Next reset: ${escapeHtml(resetMoment(at))} (your time)">${escapeHtml(prefix)} ${durationText(at - now)}</span>`;
}

function menuButton(scope, task) {
  return `<button class="icon small cl-menu" data-menu="${scope}:${task.id}" title="Rename, change reset, remove">&#8943;</button>`;
}

function toggle(scopeId, taskId, checked) {
  const planner = bp().planner;
  if (checked) planner.done[`${scopeId}:${taskId}`] = new Date().toISOString();
  else delete planner.done[`${scopeId}:${taskId}`];
  save();
  draw();
}

function tasksMenu(scope, task) {
  const choice = prompt(`${task.name}\n\n1 = rename, 2 = change reset kind (${PLANNER_KINDS.join(", ")}), 3 = remove`, "1");
  const planner = bp().planner;
  if (choice === "1") {
    const name = (prompt("Task:", task.name) || "").trim();
    if (name) task.name = name;
  } else if (choice === "2") {
    const kind = (prompt(`Resets (${PLANNER_KINDS.join(", ")}):`, task.kind) || "").trim();
    if (PLANNER_KINDS.includes(kind)) task.kind = kind;
  } else if (choice === "3") {
    planner.tasks[scope] = planner.tasks[scope].filter((t) => t !== task);
    for (const key of Object.keys(planner.done)) if (key.endsWith(":" + task.id)) delete planner.done[key];
  } else return;
  save();
  draw();
}

function addTaskDialog(scope = "character", kind = "daily") {
  const dialog = document.createElement("dialog");
  dialog.className = "cl-dialog";
  dialog.innerHTML = `
    <form method="dialog" class="stack">
      <h2>Add task</h2>
      <label class="stack">Task<input type="text" name="name" required autocomplete="off"></label>
      <label class="stack">For<select name="scope">
        <option value="character" ${scope === "character" ? "selected" : ""}>Each character</option>
        <option value="server" ${scope === "server" ? "selected" : ""}>Server-wide</option>
      </select></label>
      <label class="stack">Resets<select name="kind">
        ${PLANNER_KINDS.map((k) => `<option value="${k}" ${k === kind ? "selected" : ""}>${k === "available" ? "Info (no reset)" : KIND_TITLES[k]}</option>`).join("")}
      </select></label>
      <div class="row"><span class="grow"></span><button value="cancel" formnovalidate>Cancel</button><button value="add" class="active">Add</button></div>
    </form>`;
  document.body.appendChild(dialog);
  dialog.addEventListener("close", () => {
    const form = dialog.querySelector("form");
    const name = form.elements.name.value.trim();
    if (dialog.returnValue === "add" && name) {
      bp().planner.tasks[form.elements.scope.value].push({ id: newId("t"), name, kind: form.elements.kind.value });
      save();
    }
    dialog.remove();
    draw();
  });
  dialog.showModal();
}

function serverCard(planner, server, now) {
  const tasks = planner.tasks.server;
  const progress = taskProgress(planner, server.id, tasks, now);
  const kinds = PLANNER_KINDS.filter((kind) => kind !== "portals" || tasks.some((t) => t.kind === kind));
  const groups = kinds.map((kind) => {
    const kindTasks = tasks.filter((t) => t.kind === kind);
    const rows = kindTasks.map((task) => {
      if (kind === "available") {
        return `<div class="cl-item info">${INFO_ICON}<span class="cl-name">${escapeHtml(task.name)}</span>${menuButton("server", task)}</div>`;
      }
      const done = isTaskDone(planner, server.id, task, now);
      return `<div class="cl-item${done ? " done" : ""}">
        <label><input type="checkbox" data-task="${server.id}:${task.id}" ${done ? "checked" : ""}><span class="cl-name" title="${escapeHtml(task.name)}">${escapeHtml(task.name)}</span></label>
        ${resetSpan(kind, now, "resets in")}${menuButton("server", task)}</div>`;
    }).join("") || '<div class="muted small cl-empty">No tasks</div>';
    return `<div class="cl-group kind-${kind}">
      <div class="cl-group-head"><span class="cl-kind-name">${KIND_TITLES[kind]}</span><span class="grow"></span><button class="icon small" data-add="server:${kind}" title="Add a server-wide ${KIND_TITLES[kind].toLowerCase()} task">+</button></div>
      ${rows}</div>`;
  }).join("");
  return `<section class="card cl-server" style="--groups:${kinds.length}">
    <div class="cl-card-head"><h2>Server-wide</h2><span class="muted small">Done ${progress.done}/${progress.total}</span></div>
    <div class="cl-groups">${groups}</div>
  </section>`;
}

function rosterColumns() {
  const seen = new Set();
  const columns = [];
  for (const entry of characters()) {
    const character = entry.name && plannerCharacterNamed(entry.name);
    if (!character || seen.has(character.id)) continue;
    seen.add(character.id);
    columns.push({ id: character.id, name: character.name, cls: entry.class, key: entry.key, preset: entry.preset });
  }
  return columns;
}

function odyleValue(planner, id, now) {
  const entry = planner.odyle[id];
  return entry ? odyleEnergy(Number(entry.value), new Date(entry.since), now) : 0;
}

function odyleExtra(planner, id) {
  return Math.max(0, Math.round(Number((planner.odyle[id] || {}).extra) || 0));
}

function setOdyleExtra(planner, id, extra) {
  const entry = planner.odyle[id] || { value: 0, since: new Date().toISOString() };
  planner.odyle[id] = { ...entry, extra: Math.max(0, Math.round(extra)) };
}

// The main is the one marked so, else the first character still played.
function mainId(planner, columns) {
  const roles = planner.roles || {};
  const marked = columns.find((c) => roles[c.id] === "main");
  return (marked || columns.find((c) => roles[c.id] !== "off") || {}).id || null;
}

function roleOf(planner, columns, id) {
  if (id === mainId(planner, columns)) return "main";
  return (planner.roles || {})[id] === "off" ? "off" : "alt";
}

function setRole(planner, columns, id, role) {
  planner.roles = planner.roles || {};
  if (role === "main") for (const c of columns) if (planner.roles[c.id] === "main") planner.roles[c.id] = "alt";
  planner.roles[id] = role;
}

const limitFor = (role) => purchaseLimit(role === "main" ? "main" : "alt");

// A tick from before the counters means everything was bought.
function purchaseCount(planner, id, task, limit, now) {
  const entry = (planner.purchases || {})[`${id}:${task.id}`];
  if (entry && new Date(entry.at) >= lastReset("weekly", now)) return Math.min(limit, purchasesThisWeek(entry, now));
  return isTaskDone(planner, id, task, now) ? limit : 0;
}

function setPurchaseCount(planner, id, task, limit, count) {
  const now = new Date();
  const before = purchaseCount(planner, id, task, limit, now);
  const key = `${id}:${task.id}`;
  planner.purchases = planner.purchases || {};
  planner.purchases[key] = { count, at: now.toISOString() };
  setOdyleExtra(planner, id, odyleExtra(planner, id) + (count - before) * ENERGY_PER_ITEM);
  if (count >= limit) planner.done[key] = now.toISOString();
  else delete planner.done[key];
}

function weekRuns(planner, now) {
  const entry = planner.week_runs;
  if (!entry || !entry.at || new Date(entry.at) < lastReset("weekly", now)) return { conquest: 0, transcendence: 0 };
  return { conquest: Math.max(0, Number(entry.conquest) || 0), transcendence: Math.max(0, Number(entry.transcendence) || 0) };
}

let gearScoreOf = null;
let gearScoreLoading = false;

function loadGearScore() {
  if (gearScoreOf || gearScoreLoading) return;
  gearScoreLoading = true;
  import("./equipment.js").then(async (mod) => { await mod.ready(); gearScoreOf = mod.gearScore; if (root && !editing()) draw(); })
    .catch(() => { gearScoreLoading = false; });
}

function autoItemLevel(column) {
  const official = (bp().official_characters || {})[column.key];
  if (official && Number(official.itemLevel)) return { value: Number(official.itemLevel), source: "aion2.plaync.com" };
  if (gearScoreOf) {
    const gs = Math.round(gearScoreOf(column.cls, column.preset) || 0);
    if (gs) return { value: gs, source: "GearScore of the current preset" };
  }
  loadGearScore();
  return { value: 0, source: "" };
}

function itemLevelOf(planner, column) {
  const manual = Number((planner.item_level || {})[column.id]);
  return manual > 0 ? manual : autoItemLevel(column).value;
}

function characterCard(planner, columns, now) {
  if (!columns.length) {
    return '<section class="card cl-chars"><h2>Characters</h2><div class="muted">No characters yet. Add them to the roster in the sidebar and they show up here.</div></section>';
  }
  const tasks = planner.tasks.character;
  const span = columns.length;
  const head = columns.map((c) => {
    const progress = taskProgress(planner, c.id, tasks, now);
    const complete = progress.total && progress.done === progress.total;
    const role = roleOf(planner, columns, c.id);
    return `<th class="cl-char cl-class-${escapeHtml(c.cls)}" scope="col">
      <div class="cl-char-name"><img class="class-icon" src="assets/class_icons/${escapeHtml(c.cls)}.png" alt=""><span>${escapeHtml(c.name)}</span></div>
      ${role === "alt" ? "" : `<div class="cl-role role-${role}" title="${role === "main" ? "Does the server-wide tasks and buys the server's Odyle share" : "Left out of the Odyle plan"}">${ROLE_TITLES[role]}</div>`}
      <div class="cl-char-progress${complete ? " complete" : ""}">Done ${progress.done}/${progress.total}</div>
      <button class="icon small cl-char-tasks" data-char-tasks="${c.id}" title="Choose which tasks apply to ${escapeHtml(c.name)}">&#9881;</button></th>`;
  }).join("");
  let body = `<tr class="cl-odyle"><th scope="row"><span class="cl-odyle-label">Odyle energy</span> <span class="muted small">+${ODYLE_PER_TICK} at ${localClock(nextOdyleTick(now))} · max ${ODYLE_MAX}</span></th>${columns.map((c) => {
    const value = odyleValue(planner, c.id, now);
    const cap = odyleCapText(planner.odyle[c.id], now);
    return `<td><div class="cl-odyle-pair"><input type="number" min="0" max="${ODYLE_MAX}" value="${value}" data-odyle="${c.id}" class="${value >= ODYLE_MAX * ODYLE_WARN ? "near-cap" : ""}" title="Enter the current value; it keeps counting up by itself">
        <span class="cl-extra-wrap" title="Additional energy, the game's (+N): from Energy crystals and crafting, it does not refill">(+<input type="number" min="0" value="${odyleExtra(planner, c.id)}" data-odyle-extra="${c.id}" class="cl-extra">)</span></div>${cap ? `<div class="cl-odyle-cap ${cap === "full" ? "full" : ""}">${cap}</div>` : ""}</td>`;
  }).join("")}</tr>`;
  planner.nightmare = planner.nightmare || {};
  body += `<tr class="cl-odyle cl-nightmare"><th scope="row"><span class="cl-odyle-label">Nightmare entries</span> <span class="muted small">+${NIGHTMARE_PER_DAY} at the daily reset · max ${NIGHTMARE_MAX}</span></th>${columns.map((c) => {
    const entry = planner.nightmare[c.id];
    const value = entry ? nightmareEntries(entry.value, entry.since, now) : 0;
    const cap = nightmareCapText(entry, now);
    return `<td><input type="number" min="0" max="${NIGHTMARE_MAX}" value="${value}" data-nightmare="${c.id}" class="${value >= NIGHTMARE_MAX ? "near-cap" : ""}" title="Enter the entries you have now; it gains ${NIGHTMARE_PER_DAY} at every daily reset">${cap ? `<div class="cl-odyle-cap ${cap === "full" ? "full" : ""}">${cap}</div>` : ""}</td>`;
  }).join("")}</tr>`;
  for (const kind of PLANNER_KINDS) {
    const kindTasks = tasks.filter((t) => t.kind === kind);
    if (!kindTasks.length && (kind === "portals" || kind === "available")) continue;
    body += `<tr class="cl-kind kind-${kind}"><th scope="rowgroup"><span class="cl-kind-name">${KIND_TITLES[kind]}</span>${resetSpan(kind, now, "resets in")}<button class="icon small" data-add="character:${kind}" title="Add a ${KIND_TITLES[kind].toLowerCase()} task for every character">+</button></th><td colspan="${span}"></td></tr>`;
    for (const task of kindTasks) {
      if (kind === "available") {
        body += `<tr class="cl-row info kind-${kind}"><th scope="row"><span class="cl-task">${INFO_ICON}<span class="cl-name">${escapeHtml(task.name)}</span>${menuButton("character", task)}</span></th><td colspan="${span}"></td></tr>`;
        continue;
      }
      body += `<tr class="cl-row kind-${kind}"><th scope="row"><span class="cl-task"><span class="cl-name">${escapeHtml(task.name)}</span>${menuButton("character", task)}</span></th>${columns.map((c) => {
        if (isExcluded(planner, c.id, task.id)) return `<td class="excluded" title="${escapeHtml(c.name)} skips ${escapeHtml(task.name)}"><span class="cl-skip">—</span></td>`;
        if (ODYLE_PURCHASE_TASKS.includes(task.name)) {
          const limit = limitFor(roleOf(planner, columns, c.id));
          const count = purchaseCount(planner, c.id, task, limit, now);
          return `<td class="cl-buy${count >= limit ? " done" : ""}"><input type="number" min="0" max="${limit}" value="${count}" data-buy="${c.id}:${task.id}" data-limit="${limit}" title="${escapeHtml(c.name)}: ${escapeHtml(task.name)}, ${limit} a week, +${ENERGY_PER_ITEM} Odyle each"><span class="cl-buy-limit">/${limit}</span></td>`;
        }
        const done = isTaskDone(planner, c.id, task, now);
        return `<td class="${done ? "done" : ""}"><input type="checkbox" data-task="${c.id}:${task.id}" ${done ? "checked" : ""} title="${escapeHtml(c.name)}: ${escapeHtml(task.name)}"></td>`;
      }).join("")}</tr>`;
    }
  }
  return `<section class="card cl-chars" style="--cols:${span}">
    <div class="cl-scroll"><table class="cl-grid">
      <colgroup><col class="cl-label-col">${columns.map(() => "<col>").join("")}</colgroup>
      <thead><tr><th class="cl-corner" scope="col"><h2>Characters</h2></th>${head}</tr></thead>
      <tbody>${body}</tbody>
    </table></div>
  </section>`;
}

const number = (n) => Math.round(n).toLocaleString();

function planCharacters(planner, columns, now) {
  const purchaseTasks = planner.tasks.character.filter((t) => ODYLE_PURCHASE_TASKS.includes(t.name));
  return columns.map((c) => {
    const role = roleOf(planner, columns, c.id);
    const limit = limitFor(role);
    const purchasesLeft = purchaseTasks.filter((t) => !isExcluded(planner, c.id, t.id))
      .reduce((sum, t) => sum + limit - purchaseCount(planner, c.id, t, limit, now), 0);
    return { id: c.id, name: c.name, role, itemLevel: itemLevelOf(planner, c), base: odyleValue(planner, c.id, now), extra: odyleExtra(planner, c.id), purchasesLeft };
  });
}

function planChips(row) {
  const chips = [];
  if (row.transcendence) chips.push(`<span class="cl-plan-chip transcendence" title="Transcendence stage ${row.stage.stage} (item level ${number(row.stage.itemLevel)}+)">Transcendence ★${row.stage.stage} × ${row.transcendence}</span>`);
  if (row.conquest) chips.push(`<span class="cl-plan-chip expedition" title="Expedition, Conquest: ${escapeHtml(row.tier.dungeons.join(" or "))} (item level ${number(row.tier.itemLevel)}+)">Conquest ★${row.tier.tier} × ${row.conquest}</span>`);
  if (!chips.length) {
    if (!row.tier) return `<span class="muted small">Needs item level ${number(CONQUEST_TIERS[0].itemLevel)} for Conquest</span>`;
    return `<span class="muted small">Not enough energy for a cube</span>`;
  }
  if (row.main) return `<span class="cl-plan-counted" title="The main does what it needs; the plan counts it at full use, every cube its energy pays for, and the alts adapt">Counted at full use</span>${chips.join("")}`;
  if (row.fromExtra) chips.push(`<span class="muted small" title="Cubes paid with additional energy once the base energy is used up">${row.fromExtra} from additional</span>`);
  return chips.join("");
}

function keptText(row) {
  const parts = [];
  if (row.baseLost >= ODYLE_PER_TICK) parts.push(`<div class="cl-lost" title="Base energy the weekly cube limits leave unspent stops refilling at ${ODYLE_MAX}">loses ${number(row.baseLost)} to the cap</div>`);
  if (row.extraKept > 0) parts.push(`<div class="muted" title="Additional energy never expires: it waits for a week with free cubes at full Kina">(+${number(row.extraKept)}) kept</div>`);
  return parts.join("") || '<span class="muted">—</span>';
}

function cutText(mode, after) {
  const share = kinaPercent(mode, after);
  const next = KINA_CUTS[mode].find(([at]) => at > after);
  if (share === 100 && next) return `${next[0] - after} more at full Kina`;
  return `further runs pay ${share}% Kina${next ? ` until run ${next[0]}` : ""}`;
}

function planCard(planner, columns, now) {
  if (!columns.length) return "";
  const chars = planCharacters(planner, columns, now);
  const runs = weekRuns(planner, now);
  const result = planWeek({ characters: chars, runsDone: runs, now });
  const rows = new Map(result.rows.map((r) => [r.id, r]));
  const roleSelect = (c) => `<select data-role="${c.id}" aria-label="Role of ${escapeHtml(c.name)}">${ROLES.map((r) => `<option value="${r}" ${r === c.role ? "selected" : ""}>${ROLE_TITLES[r]}</option>`).join("")}</select>`;
  const body = columns.map((column) => {
    const c = chars.find((x) => x.id === column.id);
    const manual = Number((planner.item_level || {})[c.id]) || "";
    const auto = autoItemLevel(column);
    const ilvl = `<input type="number" min="0" step="1" value="${manual}" placeholder="${auto.value || "item level"}" data-ilvl="${c.id}" title="${auto.value ? `Empty uses ${number(auto.value)} from the ${escapeHtml(auto.source)}` : "Enter the item level shown in game"}">`;
    const head = `<th scope="row"><span class="cl-plan-name cl-class-${escapeHtml(column.cls)}"><img class="class-icon" src="assets/class_icons/${escapeHtml(column.cls)}.png" alt=""><span>${escapeHtml(c.name)}</span></span></th><td>${roleSelect(c)}</td><td>${ilvl}</td>`;
    const row = rows.get(c.id);
    if (!row) return `<tr class="cl-plan-off">${head}<td colspan="4" class="muted small">Left out of the plan</td></tr>`;
    const cap = odyleCapText(planner.odyle[c.id], now);
    const odyle = `${number(row.base)}${row.extra ? ` <span class="muted">(+${number(row.extra)})</span>` : ""}${cap ? `<div class="cl-odyle-cap ${cap === "full" ? "full" : ""}">${cap}</div>` : ""}`;
    const week = `<span title="Base ${number(row.base)} + ${number(row.regen)} refill before the reset · additional ${number(row.extra)}${row.buyable ? ` + ${number(row.buyable)} from ${row.purchasesLeft} purchases left` : ""}">${number(row.baseEnergy)} <span class="muted">(+${number(row.extraEnergy)})</span></span><div class="muted small">${row.cubes} cube${row.cubes === 1 ? "" : "s"}</div>`;
    return `<tr>${head}<td>${odyle}</td><td>${week}</td><td><div class="cl-plan-runs">${planChips(row)}</div></td><td>${keptText(row)}</td></tr>`;
  }).join("");
  const runInput = (mode, label) => `<label class="cl-plan-count">${label} <input type="number" min="0" value="${runs[mode]}" data-runs="${mode}"></label>`;
  return `<section class="card cl-plan">
    <div class="cl-card-head"><h2>Odyle plan</h2><span class="muted small">until the weekly reset ${escapeHtml(capMoment(result.reset, now))}, in ${durationText(result.reset - now)} · every character still refills +${result.regen}</span></div>
    <div class="cl-plan-server">
      <span class="muted small">Server play counts this week, from <i>Cumulative Play Reward</i> in the dungeon window:</span>
      ${runInput("conquest", "Expedition")}${runInput("transcendence", "Transcendence")}
    </div>
    <div class="cl-plan-summary">
      <span class="cl-plan-chip expedition">Expedition +${result.planned.conquest} → ${result.after.conquest}</span><span class="muted small">${cutText("conquest", result.after.conquest)}</span>
      <span class="cl-plan-chip transcendence">Transcendence +${result.planned.transcendence} → ${result.after.transcendence}</span><span class="muted small">${cutText("transcendence", result.after.transcendence)}</span>
      ${result.planned.conquest + result.planned.transcendence ? `<span class="small">Kina on these runs: <b>${result.averagePercent}%</b> on average</span>` : ""}
    </div>
    <div class="cl-scroll"><table class="cl-plan-grid">
      <thead><tr><th scope="col">Character</th><th scope="col">Role</th><th scope="col">Item level</th><th scope="col">Odyle now</th><th scope="col">For the week</th><th scope="col">Plan</th><th scope="col">Left after</th></tr></thead>
      <tbody>${body}</tbody>
    </table></div>
    <div class="muted small cl-plan-note">The main does what it needs: it is counted at full use, every cube its base and additional energy pay for, and the alts adapt around it.
      An alt spends its base energy first, because it stops refilling at ${ODYLE_MAX}; its additional energy (+N) never expires, so it only fills cubes that still pay full Kina and the rest waits for a later week.
      Always buy and craft the full ${purchaseLimit("main")} on the main and ${purchaseLimit("alt")} on each alt.
      Every cube costs ${CUBE_COST} Odyle; a character opens at most ${WEEKLY_CUBES.conquest} Expedition and ${WEEKLY_CUBES.transcendence} Transcendence cubes a week.
      Conquest ★1–★3 needs item level ${CONQUEST_TIERS.map((t) => number(t.itemLevel)).join(" / ")}, Transcendence ★1–★4 ${TRANSCENDENCE_STAGES.map((st) => number(st.itemLevel)).join(" / ")}; higher item levels get the Transcendence runs first.
      Kina cut from the game's Cumulative Play Reward Adjustment; entry levels and cube limits from the Fextralife wiki and DaevaGuides, so check the in-game entry window.</div>
  </section>`;
}

function editing() {
  return root.querySelector("input[type=number]:focus") || document.querySelector("dialog.cl-dialog[open]");
}

function refreshCountdowns() {
  if (!root) return;
  const now = new Date();
  if (now >= redrawAt && !editing()) { draw(); return; }
  root.querySelectorAll("[data-reset]").forEach((el) => {
    const at = nextReset(el.dataset.reset, now);
    if (at) el.textContent = `${el.dataset.prefix} ${durationText(at - now)}`;
  });
}

export function draw() {
  if (!root) return;
  syncPlannerCharacters();
  const planner = bp().planner;
  if (migratePlannerTasks(planner)) save();
  const now = new Date();
  const server = plannerServer();
  const columns = rosterColumns();
  redrawAt = Math.min(...RESET_KINDS.map((k) => nextReset(k, now).getTime()), nextOdyleTick(now).getTime());
  const scrollLeft = root.querySelector(".cl-scroll")?.scrollLeft || 0;
  root.innerHTML = `
    <div class="cl-title row">
      <h1>Checklist</h1>
      <span class="cl-chips">${RESET_KINDS.map((k) => `<span class="cl-chip kind-${k}">${resetSpan(k, now, `${KIND_TITLES[k]} resets in`)}</span>`).join("")}</span>
      <span class="grow"></span>
      <button id="cl-add-task" class="active">Add task</button>
    </div>
    <div class="muted small cl-help">Tick what you have done; ticks clear at the game's reset times, shown in your local time zone. Odyle energy: enter a character's current value and it keeps counting up by itself; the (+N) beside it is the additional energy, which grows as you log shop and craft purchases.</div>
    ${serverCard(planner, server, now)}
    ${characterCard(planner, columns, now)}
    ${planCard(planner, columns, now)}`;
  const scroller = root.querySelector(".cl-scroll");
  if (scroller) scroller.scrollLeft = scrollLeft;
  root.querySelectorAll("[data-task]").forEach((box) => box.addEventListener("change", (e) => {
    const [scopeId, taskId] = e.target.dataset.task.split(":");
    toggle(scopeId, taskId, e.target.checked);
  }));
  root.querySelectorAll("[data-odyle]").forEach((input) => {
    input.addEventListener("focus", () => {
      input.select();
      input.addEventListener("mouseup", (e) => e.preventDefault(), { once: true });
    });
    input.addEventListener("change", () => {
      const id = input.dataset.odyle;
      const value = Math.max(0, Math.min(ODYLE_MAX, Math.round(Number(input.value)) || 0));
      if (value !== odyleValue(planner, id, new Date())) { planner.odyle[id] = { ...planner.odyle[id], value, since: new Date().toISOString() }; save(); }
      draw();
    });
  });
  const selectOnFocus = (input) => input.addEventListener("focus", () => {
    input.select();
    input.addEventListener("mouseup", (e) => e.preventDefault(), { once: true });
  });
  const wholeNumber = (input, max = Infinity) => Math.max(0, Math.min(max, Math.round(Number(input.value)) || 0));
  root.querySelectorAll("[data-odyle-extra]").forEach((input) => {
    selectOnFocus(input);
    input.addEventListener("change", () => { setOdyleExtra(planner, input.dataset.odyleExtra, wholeNumber(input)); save(); draw(); });
  });
  root.querySelectorAll("[data-buy]").forEach((input) => {
    selectOnFocus(input);
    input.addEventListener("change", () => {
      const [id, taskId] = input.dataset.buy.split(":");
      const task = planner.tasks.character.find((t) => t.id === taskId);
      if (task) { setPurchaseCount(planner, id, task, Number(input.dataset.limit), wholeNumber(input, Number(input.dataset.limit))); save(); }
      draw();
    });
  });
  root.querySelectorAll("[data-role]").forEach((select) => select.addEventListener("change", () => {
    setRole(planner, columns, select.dataset.role, select.value);
    save();
    draw();
  }));
  root.querySelectorAll("[data-ilvl]").forEach((input) => {
    selectOnFocus(input);
    input.addEventListener("change", () => {
      planner.item_level = planner.item_level || {};
      const value = wholeNumber(input);
      if (value) planner.item_level[input.dataset.ilvl] = value; else delete planner.item_level[input.dataset.ilvl];
      save();
      draw();
    });
  });
  root.querySelectorAll("[data-runs]").forEach((input) => {
    selectOnFocus(input);
    input.addEventListener("change", () => {
      planner.week_runs = { ...weekRuns(planner, new Date()), [input.dataset.runs]: wholeNumber(input), at: new Date().toISOString() };
      save();
      draw();
    });
  });
  root.querySelectorAll("[data-nightmare]").forEach((input) => {
    input.addEventListener("focus", () => {
      input.select();
      input.addEventListener("mouseup", (e) => e.preventDefault(), { once: true });
    });
    input.addEventListener("change", () => {
      const id = input.dataset.nightmare;
      const value = Math.max(0, Math.min(NIGHTMARE_MAX, Math.round(Number(input.value)) || 0));
      const entry = planner.nightmare[id];
      if (!entry || value !== nightmareEntries(entry.value, entry.since, new Date())) { planner.nightmare[id] = { value, since: new Date().toISOString() }; save(); }
      draw();
    });
  });
  root.querySelectorAll("[data-add]").forEach((btn) => btn.addEventListener("click", () => {
    const [scope, kind] = btn.dataset.add.split(":");
    addTaskDialog(scope, kind);
  }));
  root.querySelectorAll("[data-menu]").forEach((btn) => btn.addEventListener("click", () => {
    const [scope, taskId] = btn.dataset.menu.split(":");
    const task = planner.tasks[scope].find((t) => t.id === taskId);
    if (task) tasksMenu(scope, task);
  }));
  root.querySelector("#cl-add-task").addEventListener("click", () => addTaskDialog());
  root.querySelectorAll("[data-char-tasks]").forEach((btn) => btn.addEventListener("click", () => {
    const column = columns.find((c) => c.id === btn.dataset.charTasks);
    if (column) openCharacterTasksDialog(column.id, column.name).then((changed) => { if (changed) draw(); });
  }));
}

// Which character tasks apply to one character. Resolves true when something changed.
export function openCharacterTasksDialog(characterId, name) {
  return new Promise((resolve) => {
    const planner = bp().planner;
    const dialog = document.createElement("dialog");
    dialog.className = "cl-dialog";
    const rows = PLANNER_KINDS.map((kind) => {
      const tasks = planner.tasks.character.filter((t) => t.kind === kind);
      if (!tasks.length) return "";
      return `<div class="cl-dialog-kind kind-${kind}"><div class="cl-kind-name">${KIND_TITLES[kind]}</div>${tasks.map((t) => `<label class="cl-dialog-task"><input type="checkbox" data-apply="${escapeHtml(t.id)}" ${isExcluded(planner, characterId, t.id) ? "" : "checked"}> ${escapeHtml(t.name)}</label>`).join("")}</div>`;
    }).join("");
    dialog.innerHTML = `<form method="dialog" class="stack">
      <h3>Tasks for ${escapeHtml(name)}</h3>
      <div class="muted small">Untick a task this character does not do; it leaves the counts and reminders for ${escapeHtml(name)}.</div>
      <div class="cl-dialog-kinds">${rows}</div>
      <div class="row"><span class="grow"></span><button type="submit" class="primary">Done</button></div>
    </form>`;
    let changed = false;
    dialog.addEventListener("change", (e) => {
      const box = e.target.closest("[data-apply]");
      if (!box) return;
      setExcluded(planner, characterId, box.dataset.apply, !box.checked);
      changed = true;
      save();
    });
    dialog.addEventListener("close", () => { dialog.remove(); resolve(changed); });
    document.body.appendChild(dialog);
    dialog.showModal();
  });
}

export function mount(main) {
  root = main;
  draw();
  timer = setInterval(refreshCountdowns, REFRESH_MS);
}

export function unmount() {
  clearInterval(timer);
  timer = null;
  root = null;
}
