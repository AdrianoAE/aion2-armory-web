// Checklist: server-wide tasks, per-character tasks with Odyle energy.
// Ticks are stored with their time and count until the next reset of their
// kind (CEST schedule); "Info" entries are reminders without a tick.

import { bp, characters, newId, plannerCharacterNamed, plannerServer, save, syncPlannerCharacters } from "../state.js";
import { isExcluded, setExcluded,
  KIND_TITLES, ODYLE_MAX, ODYLE_PER_TICK, PLANNER_KINDS, durationText, isTaskDone, migratePlannerTasks,
  nextOdyleTick, nextReset, odyleCapText, odyleEnergy, taskProgress,
  NIGHTMARE_MAX, NIGHTMARE_PER_DAY, nightmareCapText, nightmareEntries,
} from "../engine/planner.js";
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
    columns.push({ id: character.id, name: character.name, cls: entry.class });
  }
  return columns;
}

function odyleValue(planner, id, now) {
  const entry = planner.odyle[id];
  return entry ? odyleEnergy(Number(entry.value), new Date(entry.since), now) : 0;
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
    return `<th class="cl-char cl-class-${escapeHtml(c.cls)}" scope="col">
      <div class="cl-char-name"><img class="class-icon" src="assets/class_icons/${escapeHtml(c.cls)}.png" alt=""><span>${escapeHtml(c.name)}</span></div>
      <div class="cl-char-progress${complete ? " complete" : ""}">Done ${progress.done}/${progress.total}</div>
      <button class="icon small cl-char-tasks" data-char-tasks="${c.id}" title="Choose which tasks apply to ${escapeHtml(c.name)}">&#9881;</button></th>`;
  }).join("");
  let body = `<tr class="cl-odyle"><th scope="row"><span class="cl-odyle-label">Odyle energy</span> <span class="muted small">+${ODYLE_PER_TICK} at ${localClock(nextOdyleTick(now))} · max ${ODYLE_MAX}</span></th>${columns.map((c) => {
    const value = odyleValue(planner, c.id, now);
    const cap = odyleCapText(planner.odyle[c.id], now);
    return `<td><input type="number" min="0" max="${ODYLE_MAX}" value="${value}" data-odyle="${c.id}" class="${value >= ODYLE_MAX * ODYLE_WARN ? "near-cap" : ""}" title="Enter the current value; it keeps counting up by itself">${cap ? `<div class="cl-odyle-cap ${cap === "full" ? "full" : ""}">${cap}</div>` : ""}</td>`;
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
    <div class="muted small cl-help">Tick what you have done; ticks clear at the game's reset times, shown in your local time zone. Odyle energy: enter a character's current value and it keeps counting up by itself.</div>
    ${serverCard(planner, server, now)}
    ${characterCard(planner, columns, now)}`;
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
      if (value !== odyleValue(planner, id, new Date())) { planner.odyle[id] = { value, since: new Date().toISOString() }; save(); }
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
