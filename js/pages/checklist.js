// Checklist: server tasks, per-character checklists with Odyle energy.
// Ticks are stored with their time; daily/weekly/portal ticks count until
// the next reset (CEST schedule), "when available" entries are reminders.

import { bp, newId, plannerServer, save, syncPlannerCharacters, characters } from "../state.js";
import { PLANNER_KINDS, ODYLE_MAX, ODYLE_PER_TICK, isDone, nextReset, nextOdyleTick, odyleEnergy, countdown } from "../engine/planner.js";
import { localClock } from "../engine/timers.js";
import { escapeHtml } from "../app.js";

let timer = null;
let root = null;

const KIND_LABEL = {
  daily: (now) => `Daily (resets ${localClock(nextReset("daily", now))})`,
  weekly: (now) => `Weekly (resets ${nextReset("weekly", now).toLocaleDateString([], { weekday: "short" })} ${localClock(nextReset("weekly", now))})`,
  portals: (now) => `Abyss portals (resets Mon, Thu, Sat ${localClock(nextReset("portals", now))})`,
  available: () => "When available (info)",
};

function doneAt(planner, scopeId, taskId) {
  const stamp = planner.done[`${scopeId}:${taskId}`];
  return stamp ? new Date(stamp) : null;
}

function taskDone(planner, scopeId, task, now) {
  return isDone(task.kind, doneAt(planner, scopeId, task.id), now);
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

function addTask(scope, kind) {
  const name = (prompt("Task:") || "").trim();
  if (!name) return;
  bp().planner.tasks[scope].push({ id: newId("t"), name, kind });
  save();
  draw();
}

function characterMenu(server, character) {
  const choice = prompt(`${character.name}\n\n1 = rename, 2 = remove from the planner`, "1");
  if (choice === "1") {
    const name = (prompt("Name:", character.name) || "").trim();
    if (name) character.name = name;
  } else if (choice === "2") {
    server.characters = server.characters.filter((c) => c !== character);
    const planner = bp().planner;
    for (const key of Object.keys(planner.done)) if (key.startsWith(character.id + ":")) delete planner.done[key];
    delete planner.odyle[character.id];
  } else return;
  save();
  draw();
}

function grid(scope, columns, tasks, now, server) {
  const planner = bp().planner;
  let html = `<table class="planner"><tr><th></th>${columns.map((c) => `<th>${c.icon ? `<img class="class-icon" src="assets/class_icons/${c.icon}.png" alt=""> ` : ""}${escapeHtml(c.label)}${scope === "character" ? ` <button class="icon small" data-char="${c.id}" title="Rename or remove">&#8943;</button>` : ""}</th>`).join("")}</tr>`;
  const tracked = tasks.filter((t) => t.kind !== "available");
  html += `<tr class="info"><td></td>${columns.map((c) => `<td class="muted">${tracked.filter((t) => taskDone(planner, c.id, t, now)).length}/${tracked.length}</td>`).join("")}</tr>`;
  if (scope === "character") {
    html += `<tr><td class="accent">Odyle energy (+${ODYLE_PER_TICK} at ${localClock(nextOdyleTick(now))}, max ${ODYLE_MAX})</td>${columns.map((c) => {
      const entry = planner.odyle[c.id];
      const value = entry ? odyleEnergy(Number(entry.value), new Date(entry.since), now) : 0;
      return `<td><input type="number" min="0" max="${ODYLE_MAX}" value="${value}" data-odyle="${c.id}" onfocus="this.select()"></td>`;
    }).join("")}</tr>`;
  }
  for (const kind of PLANNER_KINDS) {
    const kindTasks = tasks.filter((t) => t.kind === kind);
    if (kind === "portals" && scope === "server" && !kindTasks.length) continue;
    html += `<tr class="kind"><td colspan="${columns.length + 1}">${KIND_LABEL[kind](now)} <button class="icon small" data-add="${scope}:${kind}" title="Add task">+</button></td></tr>`;
    for (const task of kindTasks) {
      const cells = kind === "available" ? "" : columns.map((c) => `<td><input type="checkbox" data-task="${c.id}:${task.id}" ${taskDone(planner, c.id, task, now) ? "checked" : ""}></td>`).join("");
      html += `<tr class="${kind === "available" ? "info" : ""}"><td>${escapeHtml(task.name)} <button class="icon small" data-menu="${scope}:${task.id}" title="Rename, change reset, remove">&#8943;</button></td>${cells}</tr>`;
    }
  }
  return html + "</table>";
}

export function draw() {
  if (!root) return;
  syncPlannerCharacters();
  const now = new Date();
  const planner = bp().planner;
  const server = plannerServer();
  const roster = characters().filter((c) => c.name).map((c) => c.name.toLowerCase());
  const chars = [...server.characters].sort((a, b) => {
    const ia = roster.indexOf(a.name.toLowerCase()), ib = roster.indexOf(b.name.toLowerCase());
    return (ia < 0 ? roster.length : ia) - (ib < 0 ? roster.length : ib);
  });
  root.innerHTML = `
    <div class="row" style="margin-bottom:8px"><h1>Planner</h1>
      <span class="accent small">Daily reset in ${countdown(nextReset("daily", now) - now)} (${localClock(nextReset("daily", now))}) · Weekly reset in ${countdown(nextReset("weekly", now) - now)} (${nextReset("weekly", now).toLocaleDateString([], { weekday: "short" })} ${localClock(nextReset("weekly", now))}) · Abyss portals reset in ${countdown(nextReset("portals", now) - now)} (${localClock(nextReset("portals", now))})</span>
      <span class="grow"></span><button id="add-planner-char">Add character</button></div>
    <div class="muted small" style="margin-bottom:10px">Tick what you have done; ticks clear at the game's reset times, shown in your local time zone. "When available" entries are reminders. Odyle energy: enter a character's current value and it keeps counting up by itself.</div>
    <div class="card stack">
      ${grid("server", [{ id: server.id, label: "Server", icon: null }], planner.tasks.server, now)}
      ${chars.length ? grid("character", chars.map((c) => ({ id: c.id, label: c.name, icon: (c.class || "").toLowerCase() || null })), planner.tasks.character, now, server) : '<div class="muted">No characters yet.</div>'}
    </div>`;
  root.querySelectorAll("[data-task]").forEach((box) => box.addEventListener("change", (e) => {
    const [scopeId, taskId] = e.target.dataset.task.split(":");
    toggle(scopeId, taskId, e.target.checked);
  }));
  root.querySelectorAll("[data-odyle]").forEach((input) => input.addEventListener("change", (e) => {
    const id = e.target.dataset.odyle;
    const value = Math.max(0, Math.min(ODYLE_MAX, Number(e.target.value) || 0));
    const current = planner.odyle[id] ? odyleEnergy(Number(planner.odyle[id].value), new Date(planner.odyle[id].since), new Date()) : 0;
    if (value !== current) { planner.odyle[id] = { value, since: new Date().toISOString() }; save(); }
    draw();
  }));
  root.querySelectorAll("[data-add]").forEach((btn) => btn.addEventListener("click", () => { const [scope, kind] = btn.dataset.add.split(":"); addTask(scope, kind); }));
  root.querySelectorAll("[data-menu]").forEach((btn) => btn.addEventListener("click", () => {
    const [scope, taskId] = btn.dataset.menu.split(":");
    tasksMenu(scope, planner.tasks[scope].find((t) => t.id === taskId));
  }));
  root.querySelectorAll("[data-char]").forEach((btn) => btn.addEventListener("click", () => characterMenu(server, server.characters.find((c) => c.id === btn.dataset.char))));
  root.querySelector("#add-planner-char").addEventListener("click", () => {
    const name = (prompt("Name:") || "").trim();
    if (!name) return;
    const cls = (prompt("Class (optional):") || "").trim();
    server.characters.push({ id: newId("ch"), name, class: cls ? cls[0].toUpperCase() + cls.slice(1).toLowerCase() : "" });
    save();
    draw();
  });
}

export function mount(main) {
  root = main;
  draw();
  timer = setInterval(() => { if (!root.querySelector("input:focus")) draw(); }, 30000);
}

export function unmount() {
  clearInterval(timer);
  root = null;
}
