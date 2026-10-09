// Sidebar roster: one row per character with its Build tabs and the current
// Build's preset chips, a row menu for Builds and presets, drag to reorder,
// and the inline "add character" row.

import { addCharacter, bp, characters, CLASSES, currentCharacter, moveCharacter, renameCharacter, reorderCharacter, selectCharacter, syncPlannerCharacters } from "./state.js";
import { currentBuild, deleteBuild, deletePreset, duplicateBuild, duplicatePreset, newBuild, newPreset, renameBuild, renamePreset, selectBuild } from "./builds.js";
import { escapeHtml, navigate } from "./app.js";
import { kindChipsHtml, odyleLevel, progressOf, ODYLE_MAX } from "./widgets/character/common.js";

let openMenu = null;

function closeMenu() {
  if (!openMenu) return;
  openMenu.remove();
  openMenu = null;
  document.removeEventListener("pointerdown", onOutside, true);
  document.removeEventListener("keydown", onMenuKey, true);
}

function onOutside(e) { if (openMenu && !openMenu.contains(e.target)) closeMenu(); }
function onMenuKey(e) { if (e.key === "Escape") closeMenu(); }

function rerender() {
  navigate(location.hash.slice(1) || "character");
}

function showCharacter() {
  navigate("character");
}

// ── dialogs ─────────────────────────────────────────────────────────────────

function dialogShell(title, bodyHtml, okLabel) {
  const dialog = document.createElement("dialog");
  dialog.className = "builds-dialog";
  dialog.innerHTML = `<form method="dialog" class="stack">
      <h3>${escapeHtml(title)}</h3>
      ${bodyHtml}
      <div class="builds-dialog-error" hidden></div>
      <div class="row builds-dialog-actions"><span class="grow"></span><button type="button" class="cancel">Cancel</button><button type="submit" class="primary ok">${escapeHtml(okLabel)}</button></div>
    </form>`;
  document.body.appendChild(dialog);
  return dialog;
}

function runDialog(dialog, collect) {
  return new Promise((resolve) => {
    const form = dialog.querySelector("form");
    const error = dialog.querySelector(".builds-dialog-error");
    let result = null;
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const outcome = collect();
      if (outcome && outcome.error) { error.textContent = outcome.error; error.hidden = false; return; }
      result = outcome ? outcome.value : null;
      dialog.close();
    });
    dialog.querySelector(".cancel").addEventListener("click", () => dialog.close());
    dialog.addEventListener("close", () => { dialog.remove(); resolve(result); });
    dialog.showModal();
    const first = dialog.querySelector("input, select");
    if (first) { first.focus(); if (first.select) first.select(); }
  });
}

export function askText(title, label, initial = "", validate = () => "") {
  const dialog = dialogShell(title, `<label class="stack small muted">${escapeHtml(label)}<input type="text" maxlength="40" value="${escapeHtml(initial)}"></label>`, "OK");
  const input = dialog.querySelector("input");
  return runDialog(dialog, () => {
    const value = input.value.trim();
    if (!value) return { error: "Enter a name." };
    const problem = validate(value);
    return problem ? { error: problem } : { value };
  });
}

export function askConfirm(title, text, okLabel = "Delete") {
  const dialog = dialogShell(title, `<div>${escapeHtml(text)}</div>`, okLabel);
  return runDialog(dialog, () => ({ value: true })).then(Boolean);
}

function presetOptions(entry, selected) {
  return entry.builds2.filter((b) => b.presets.length).map((b) => `<optgroup label="${escapeHtml(b.name)}">${b.presets
    .map((name) => `<option value="${escapeHtml(name)}" ${name === selected ? "selected" : ""}>${escapeHtml(name)}</option>`).join("")}</optgroup>`).join("");
}

export function defaultDiffPair(entry) {
  const a = entry.preset;
  const mine = entry.builds2.find((b) => b.presets.includes(a));
  const other = entry.builds2.find((b) => b !== mine && b.presets.length);
  const b = other ? other.presets[0] : (mine && mine.presets.find((name) => name !== a)) || a;
  return [a, b];
}

export function diffHash(cls, a, b) {
  return `diff/${encodeURIComponent(cls)}/${encodeURIComponent(a)}/${encodeURIComponent(b)}`;
}

async function askDiff(entry) {
  const [a, b] = defaultDiffPair(entry);
  const dialog = dialogShell("Compare presets", `
    <label class="stack small muted">Preset A<select class="diff-a">${presetOptions(entry, a)}</select></label>
    <label class="stack small muted">Preset B<select class="diff-b">${presetOptions(entry, b)}</select></label>`, "Compare");
  const pair = await runDialog(dialog, () => ({ value: [dialog.querySelector(".diff-a").value, dialog.querySelector(".diff-b").value] }));
  if (pair) navigate(diffHash(entry.class, pair[0], pair[1]));
}

// ── row menu ────────────────────────────────────────────────────────────────

const takenIn = (object, kind) => (name) => (object && Object.prototype.hasOwnProperty.call(object, name) ? `A ${kind} named "${name}" already exists.` : "");

function menuItems(entry, index, count) {
  const cls = entry.class, who = entry.name;
  const build = currentBuild(cls, who);
  const preset = entry.preset;
  const buildEntry = entry.builds2.find((b) => b.name === build);
  const sets = () => (bp().daevanion_builds_data || {})[cls];
  const equips = () => (bp().equip_builds_data || {})[cls];
  return [
    { label: "New build", run: async () => {
      const name = await askText("New build", "Build name", "", takenIn(sets(), "build"));
      if (name && newBuild(cls, name, who) !== false) showCharacter();
    } },
    { label: "Duplicate build", run: async () => {
      const name = await askText(`Duplicate build "${build}"`, "Name of the copy", `${build} (Copy)`, takenIn(sets(), "build"));
      if (name && duplicateBuild(cls, build, name, who) !== false) showCharacter();
    } },
    { label: "Rename build", run: async () => {
      const name = await askText(`Rename build "${build}"`, "Build name", build, (n) => (n === build ? "" : takenIn(sets(), "build")(n)));
      if (name && name !== build && renameBuild(cls, build, name) !== false) rerender();
    } },
    { label: "Delete build", disabled: entry.builds2.length <= 1, run: async () => {
      const count = buildEntry ? buildEntry.presets.length : 0;
      if (await askConfirm("Delete build", `Delete the build "${build}" with its Daevanion boards and its ${count} preset${count === 1 ? "" : "s"}? This cannot be undone.`)
        && deleteBuild(cls, build, who) !== false) showCharacter();
    } },
    { separator: true },
    { label: "New preset", run: async () => {
      const name = await askText(`New preset in "${build}"`, "Preset name", "", takenIn(equips(), "preset"));
      if (name && newPreset(cls, build, name, who) !== false) showCharacter();
    } },
    { label: "Duplicate preset", disabled: !preset, run: async () => {
      const name = await askText(`Duplicate preset "${preset}"`, "Name of the copy", `${preset} (Copy)`, takenIn(equips(), "preset"));
      if (name && duplicatePreset(cls, preset, name) !== false) showCharacter();
    } },
    { label: "Rename preset", disabled: !preset, run: async () => {
      const name = await askText(`Rename preset "${preset}"`, "Preset name", preset, (n) => (n === preset ? "" : takenIn(equips(), "preset")(n)));
      if (name && name !== preset && renamePreset(cls, preset, name) !== false) rerender();
    } },
    { label: "Delete preset", disabled: !buildEntry || buildEntry.presets.length <= 1, run: async () => {
      if (await askConfirm("Delete preset", `Delete the preset "${preset}" with its equipment, skills and genius profile? This cannot be undone.`)
        && deletePreset(cls, preset) !== false) rerender();
    } },
    { label: "Diff…", disabled: !preset, run: () => askDiff(entry) },
    { separator: true },
    { label: "Rename character", run: async () => {
      const name = await askText("Rename character", "Character name", entry.name);
      if (name && name !== entry.name) { renameCharacter(entry, name); rerender(); }
    } },
    { label: "Move up", disabled: index === 0, run: () => moveCharacter(entry, -1) },
    { label: "Move down", disabled: index >= count - 1, run: () => moveCharacter(entry, 1) },
  ];
}

function showMenu(button, entry, index, count) {
  closeMenu();
  const menu = document.createElement("div");
  menu.className = "roster-menu";
  menu.setAttribute("role", "menu");
  for (const item of menuItems(entry, index, count)) {
    if (item.separator) { menu.appendChild(document.createElement("hr")); continue; }
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = item.label;
    b.disabled = !!item.disabled;
    b.setAttribute("role", "menuitem");
    b.addEventListener("click", (e) => { e.stopPropagation(); closeMenu(); item.run(); });
    menu.appendChild(b);
  }
  document.body.appendChild(menu);
  const rect = button.getBoundingClientRect();
  const height = menu.offsetHeight, width = menu.offsetWidth;
  menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`;
  menu.style.top = `${rect.bottom + height + 4 > window.innerHeight ? Math.max(8, rect.top - height - 4) : rect.bottom + 4}px`;
  openMenu = menu;
  document.addEventListener("pointerdown", onOutside, true);
  document.addEventListener("keydown", onMenuKey, true);
}

// ── rows ────────────────────────────────────────────────────────────────────

export function renderRoster(page) {
  closeMenu();
  syncPlannerCharacters();
  const roster = document.getElementById("roster");
  roster.innerHTML = "";
  const active = currentCharacter();
  const list = characters();
  list.forEach((entry, index) => {
    const row = document.createElement("div");
    const isCurrent = page === "character" && active && active.key === entry.key;
    row.className = "card clickable side-row roster-row" + (isCurrent ? " current" : "");
    row.dataset.class = entry.class;
    row.draggable = true;
    const progress = progressOf(entry.name);
    const odyleTag = progress && progress.odyle != null
      ? `<span class="tag ${{ full: "danger", high: "warn" }[odyleLevel(progress.odyle)] || "info"}" title="Odyle energy${progress.odyleCap ? ` · ${progress.odyleCap}` : ""}">Odyle ${progress.odyle}/${ODYLE_MAX}</span>` : "";
    const chips = odyleTag + (progress ? kindChipsHtml(progress.kinds) : "");
    const cls = entry.class[0].toUpperCase() + entry.class.slice(1);
    row.innerHTML = `
      <div class="row" style="gap:8px"><img class="class-icon" src="assets/class_icons/${entry.class}.png" alt="">
        <div class="grow"><div class="name">${entry.name ? escapeHtml(entry.name) : "Unnamed"}</div>
        <div class="lines">${cls}</div>
        ${chips ? `<div class="roster-chips">${chips}</div>` : ""}</div>
        <button type="button" class="roster-menu-btn" title="Builds, presets and character" aria-haspopup="menu">&#8943;</button>
        <span class="grip" title="Drag to reorder">&#8942;&#8942;</span></div>`;
    row.querySelectorAll("[data-build]").forEach((b) => b.addEventListener("click", (e) => {
      e.stopPropagation();
      selectBuild(entry.class, b.dataset.build, entry.name);
      showCharacter();
    }));
    row.querySelectorAll("[data-preset]").forEach((b) => b.addEventListener("click", (e) => {
      e.stopPropagation();
      selectCharacter(entry.class, b.dataset.preset, entry.name);
      showCharacter();
    }));
    const menuButton = row.querySelector(".roster-menu-btn");
    menuButton.addEventListener("click", (e) => {
      e.stopPropagation();
      if (openMenu) { closeMenu(); return; }
      showMenu(menuButton, entry, index, list.length);
    });
    row.addEventListener("dragstart", (e) => { e.dataTransfer.setData("text/plain", entry.key); e.dataTransfer.effectAllowed = "move"; row.classList.add("dragging"); });
    row.addEventListener("dragend", () => row.classList.remove("dragging"));
    row.addEventListener("dragover", (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; row.classList.add("drop-target"); });
    row.addEventListener("dragleave", () => row.classList.remove("drop-target"));
    row.addEventListener("drop", (e) => { e.preventDefault(); row.classList.remove("drop-target"); reorderCharacter(e.dataTransfer.getData("text/plain"), entry.key); });
    row.addEventListener("click", () => { selectCharacter(entry.class, entry.preset, entry.name); showCharacter(); });
    roster.appendChild(row);
  });
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

export function openOfficialImport(options) {
  return import("./official.js").then((m) => m.importCharacterDialog(options)).catch((err) => { console.error(err); alert(`The import could not start: ${err.message}`); });
}

const officialButton = document.getElementById("import-official");
if (officialButton) officialButton.addEventListener("click", () => openOfficialImport());
const syncAllButton = document.getElementById("sync-official");
if (syncAllButton) syncAllButton.addEventListener("click", () => import("./official.js").then((m) => m.syncAllCharacters()).catch((err) => { console.error(err); alert(`The sync could not start: ${err.message}`); }));
