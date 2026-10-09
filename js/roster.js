// Sidebar roster: one row per character with its builds, drag to reorder,
// and the inline "add character" row.

import { addCharacter, characters, CLASSES, currentCharacter, reorderCharacter, selectCharacter, syncPlannerCharacters } from "./state.js";
import { escapeHtml, navigate, progressLine } from "./app.js";

export function renderRoster(page) {
  syncPlannerCharacters();
  const roster = document.getElementById("roster");
  roster.innerHTML = "";
  const active = currentCharacter();
  for (const entry of characters()) {
    const row = document.createElement("div");
    const isCurrent = page === "character" && active && active.key === entry.key;
    row.className = "card clickable side-row" + (isCurrent ? " current" : "");
    row.draggable = true;
    const [odyle, progress] = progressLine(entry.name);
    const cls = entry.class[0].toUpperCase() + entry.class.slice(1);
    row.innerHTML = `
      <div class="row" style="gap:8px"><img class="class-icon" src="assets/class_icons/${entry.class}.png" alt="">
        <div class="grow"><div class="name">${entry.name ? escapeHtml(entry.name) : "Unnamed"}</div>
        <div class="lines">${cls}</div>
        ${odyle ? `<div class="lines accent">${odyle}</div>` : ""}${progress ? `<div class="lines">${progress}</div>` : ""}</div>
        <span class="grip" title="Drag to reorder">&#8942;&#8942;</span></div>`;
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
    row.addEventListener("dragstart", (e) => { e.dataTransfer.setData("text/plain", entry.key); e.dataTransfer.effectAllowed = "move"; row.classList.add("dragging"); });
    row.addEventListener("dragend", () => row.classList.remove("dragging"));
    row.addEventListener("dragover", (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; row.classList.add("drop-target"); });
    row.addEventListener("dragleave", () => row.classList.remove("drop-target"));
    row.addEventListener("drop", (e) => { e.preventDefault(); row.classList.remove("drop-target"); reorderCharacter(e.dataTransfer.getData("text/plain"), entry.key); });
    row.addEventListener("click", () => { selectCharacter(entry.class, entry.current || entry.builds[0]); navigate("character"); });
    roster.appendChild(row);
  }
}

// An inline placeholder row at the end of the roster: name + class.
export function askCharacter() {
  const roster = document.getElementById("roster");
  const existing = roster.querySelector(".new-character");
  if (existing) { existing.querySelector("input").focus(); return; }
  const row = document.createElement("div");
  row.className = "card side-row new-character stack";
  row.innerHTML = `<input type="text" placeholder="Character name" maxlength="40">
    <select>${CLASSES.map((c) => `<option>${c}</option>`).join("")}</select>
    <div class="row"><button class="save grow">Add</button><button class="cancel">Cancel</button></div>`;
  roster.appendChild(row);
  const input = row.querySelector("input");
  const finish = () => {
    const name = input.value.trim();
    if (!name) { input.focus(); return; }
    addCharacter(name, row.querySelector("select").value);
    navigate("character");
  };
  row.querySelector(".save").addEventListener("click", finish);
  row.querySelector(".cancel").addEventListener("click", () => row.remove());
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") finish(); if (e.key === "Escape") row.remove(); });
  input.focus();
}

