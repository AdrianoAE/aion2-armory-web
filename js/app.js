// Shell: sidebar (Tools, Characters), hash router, profile import/export.

import { addCharacter, bp, characters, CLASSES, currentCharacter, exportProfile, importProfile, moveCharacter,
  onChange, plannerCharacterNamed, renameCharacter, save, selectCharacter, syncPlannerCharacters } from "./state.js";
import { ODYLE_MAX, isDone, odyleEnergy } from "./engine/planner.js";
import * as timersPage from "./pages/timers.js";
import * as plannerPage from "./pages/planner.js";
import * as charactersPage from "./pages/characters.js";

const PAGES = {
  timers: { title: "Timers", desc: "Event timeline, field bosses and countdowns", module: timersPage },
  planner: { title: "Planner", desc: "Daily, weekly and portal checklists, Odyle energy", module: plannerPage },
  character: { title: "Character", desc: "", module: charactersPage },
};

let current = null;

export function route() {
  const hash = location.hash.slice(1) || "character";
  const [name] = hash.split("/");
  return PAGES[name] ? name : "character";
}

export function navigate(name) {
  if (location.hash.slice(1) === name) render(); else location.hash = name;
}

function render() {
  const name = route();
  if (current && current.module.unmount) current.module.unmount();
  current = PAGES[name];
  const main = document.getElementById("main");
  main.innerHTML = "";
  current.module.mount(main);
  renderSidebar();
}

export function progressLine(name) {
  const character = plannerCharacterNamed(name);
  if (!character) return ["", ""];
  const planner = bp().planner;
  const now = new Date();
  const parts = [];
  for (const kind of ["daily", "weekly", "portals"]) {
    const tasks = planner.tasks.character.filter((t) => t.kind === kind);
    if (!tasks.length) continue;
    const done = tasks.filter((t) => isDone(kind, planner.done[`${character.id}:${t.id}`] ? new Date(planner.done[`${character.id}:${t.id}`]) : null, now)).length;
    parts.push(`${{ daily: "Daily", weekly: "Weekly", portals: "Portals" }[kind]} ${done}/${tasks.length}`);
  }
  const odyle = planner.odyle[character.id];
  const energy = odyle ? odyleEnergy(Number(odyle.value), new Date(odyle.since), now) : "—";
  return [`Odyle ${energy}/${ODYLE_MAX}`, parts.join(" · ")];
}

function renderSidebar() {
  const page = route();
  const tools = document.getElementById("tools");
  tools.innerHTML = "";
  for (const key of ["planner", "timers"]) {
    const row = document.createElement("div");
    row.className = "card clickable side-row" + (page === key ? " current" : "");
    row.innerHTML = `<div class="name">${PAGES[key].title}</div><div class="lines">${PAGES[key].desc}</div>`;
    row.addEventListener("click", () => navigate(key));
    tools.appendChild(row);
  }
  syncPlannerCharacters();
  const roster = document.getElementById("roster");
  roster.innerHTML = "";
  const active = currentCharacter();
  for (const entry of characters()) {
    const row = document.createElement("div");
    const isCurrent = page === "character" && active && active.key === entry.key;
    row.className = "card clickable side-row" + (isCurrent ? " current" : "");
    const [odyle, progress] = progressLine(entry.name);
    const cls = entry.class[0].toUpperCase() + entry.class.slice(1);
    row.innerHTML = `
      <div class="row" style="gap:8px"><img class="class-icon" src="assets/class_icons/${entry.class}.png" alt="">
        <div class="grow"><div class="name">${entry.name ? escapeHtml(entry.name) : "Unnamed"}</div>
        <div class="lines">${cls}</div>
        ${odyle ? `<div class="lines accent">${odyle}</div>` : ""}${progress ? `<div class="lines">${progress}</div>` : ""}</div>
        <div class="stack" style="gap:2px"><button class="icon small" data-move="-1" title="Move up">&#9650;</button><button class="icon small" data-move="1" title="Move down">&#9660;</button></div></div>`;
    if (entry.builds.length > 1) {
      const builds = document.createElement("div");
      builds.className = "builds";
      for (const build of entry.builds) {
        const b = document.createElement("button");
        b.textContent = build;
        if (entry.current === build) b.className = "active";
        b.addEventListener("click", (e) => { e.stopPropagation(); selectCharacter(entry.class, build); navigate("character"); });
        builds.appendChild(b);
      }
      row.appendChild(builds);
    }
    row.querySelectorAll("[data-move]").forEach((btn) => btn.addEventListener("click", (e) => { e.stopPropagation(); moveCharacter(entry, Number(btn.dataset.move)); }));
    row.addEventListener("click", () => { selectCharacter(entry.class, entry.current || entry.builds[0]); navigate("character"); });
    roster.appendChild(row);
  }
}

export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function askCharacter() {
  const name = (prompt("Character name:") || "").trim();
  if (!name) return;
  const cls = prompt(`Class (${CLASSES.join(", ")}):`, "Gladiator");
  const picked = CLASSES.find((c) => c.toLowerCase() === (cls || "").trim().toLowerCase());
  if (!picked) { alert("Unknown class."); return; }
  addCharacter(name, picked);
  navigate("character");
}

document.getElementById("add-character").addEventListener("click", askCharacter);
document.getElementById("export-profile").addEventListener("click", exportProfile);
document.getElementById("import-profile").addEventListener("click", () => document.getElementById("import-file").click());
document.getElementById("import-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try { await importProfile(file); } catch (err) { alert("Could not read that profile: " + err.message); }
  e.target.value = "";
  render();
});
window.addEventListener("hashchange", render);
onChange(renderSidebar);
bp();
render();
export { renameCharacter, save };
