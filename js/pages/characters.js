// Character page: a header for the selected character (class, name, Build
// tabs and preset chips with their menu, checklist progress, page buttons)
// above the "character" widget area. The widgets live in
// js/widgets/character/ and are shared with the Dashboard.

import { mountArea } from "../widgets.js";
import { linkedGeniusBuild, linkedSkillBuild } from "../builds.js";
import { bp, CLASSES, currentCharacter, onChange, renameCharacter, selectCharacter } from "../state.js";
import { currentBuild, deleteBuild, deletePreset, duplicateBuild, duplicatePreset, newBuild, newPreset, renameBuild, renamePreset, selectBuild } from "../builds.js";
import { askConfirm, askText, defaultDiffPair, diffHash } from "../roster.js";
import { askCharacter, escapeHtml, navigate, pickProfile } from "../app.js";
import { className, kindChipsHtml, ODYLE_MAX, odyleLevel, progressOf } from "../widgets/character/common.js";

const WIDGETS = ["summary", "checklist", "layout", "skills", "daevanion", "equipment", "arcana", "genius"];
await Promise.all(WIDGETS.map((name) => import(`../widgets/character/${name}.js`).catch((err) => console.warn(`Character widget ${name} unavailable:`, err))));

const PAGE_BUTTONS = [["equipment", "Equipment"], ["arcana", "Arcana"], ["pantheon", "Pantheon"], ["genius", "Genius Insight"]];
const WIDE = 1800;

let host = null;
let area = null;
let shown = null;
let stopWatching = null;
let pending = 0;
let openMenu = null;

// The first-run layout for the width the page opens at; once the player
// moves or resizes anything the stored layout wins.
// Widgets that would only show "nothing yet" for this preset stay out of the
// first-run layout; the Add widget menu still offers them.
function widgetsWithData(entry) {
  const p = bp();
  const cls = entry.class;
  const equip = ((p.equip_builds_data || {})[cls] || {})[entry.preset] || {};
  const skillBuild = ((p.skill_builds_data || {})[cls] || {})[linkedSkillBuild(p, cls, entry.preset)] || {};
  const genius = (p.genius_builds_data || {})[linkedGeniusBuild(p, cls, entry.preset)] || {};
  const boards = ((p.daevanion_builds_data || {})[cls] || {})[equip.linked_daevanion_build] || {};
  const layout = skillBuild.layout || {};
  const has = new Set(["checklist", "skills"]);
  if (Object.values(equip.equipped || {}).some(Boolean)) has.add("equipment");
  if (Object.values(skillBuild.arcana_cards || {}).some((card) => card && (card.theme || (card.slots || []).some(Boolean)))) has.add("arcana");
  if (Object.values(genius).some((lines) => Object.values(lines || {}).some((line) => line && Number(line.value) > 0))) has.add("genius");
  if (Object.values(boards).some((ids) => Array.isArray(ids) && ids.length > 1)) has.add("daevanion");
  if (Object.values(layout.slots || {}).some(Boolean) || (layout.macro || []).length) has.add("layout");
  return has;
}

function defaultLayout(width, entry) {
  const item = (name, cols, rows = "auto") => ({ id: `character.${name}`, cols, rows });
  const plan = width >= WIDE
    ? [item("checklist", 1), item("equipment", 2), item("arcana", 1),
      item("genius", 1), item("layout", 3),
      item("daevanion", 2), item("skills", 2)]
    : [item("checklist", 2), item("equipment", 2),
      item("arcana", 1), item("genius", 1),
      item("layout", 4),
      item("daevanion", 2),
      item("skills", 4)];
  const has = widgetsWithData(entry);
  return plan.filter((w) => has.has(w.id.slice("character.".length)));
}

const identity = (entry) => (entry ? `${entry.key}|${bp().current_build_name}` : "");

// ── builds menu ─────────────────────────────────────────────────────────────

function closeMenu() {
  if (!openMenu) return;
  openMenu.remove();
  openMenu = null;
  document.removeEventListener("pointerdown", onOutside, true);
  document.removeEventListener("keydown", onMenuKey, true);
}

function onOutside(e) { if (openMenu && !openMenu.contains(e.target) && !e.target.closest(".char-menu-btn")) closeMenu(); }
function onMenuKey(e) { if (e.key === "Escape") closeMenu(); }

const takenIn = (object, kind) => (name) => (object && Object.prototype.hasOwnProperty.call(object, name) ? `A ${kind} named "${name}" already exists.` : "");
const reload = () => navigate("character");

function askDiff(entry) {
  const [a, b] = defaultDiffPair(entry);
  const options = (selected) => entry.builds2.filter((x) => x.presets.length).map((x) => `<optgroup label="${escapeHtml(x.name)}">${x.presets
    .map((name) => `<option value="${escapeHtml(name)}" ${name === selected ? "selected" : ""}>${escapeHtml(name)}</option>`).join("")}</optgroup>`).join("");
  const dialog = document.createElement("dialog");
  dialog.className = "builds-dialog";
  dialog.innerHTML = `<form method="dialog" class="stack">
      <h3>Compare presets</h3>
      <label class="stack small muted">Preset A<select class="diff-a">${options(a)}</select></label>
      <label class="stack small muted">Preset B<select class="diff-b">${options(b)}</select></label>
      <div class="row builds-dialog-actions"><span class="grow"></span><button type="button" class="cancel">Cancel</button><button type="submit" class="primary">Compare</button></div>
    </form>`;
  document.body.appendChild(dialog);
  let pair = null;
  dialog.querySelector("form").addEventListener("submit", (e) => {
    e.preventDefault();
    pair = [dialog.querySelector(".diff-a").value, dialog.querySelector(".diff-b").value];
    dialog.close();
  });
  dialog.querySelector(".cancel").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => { dialog.remove(); if (pair) navigate(diffHash(entry.class, pair[0], pair[1])); });
  dialog.showModal();
}

function menuItems(entry) {
  const cls = entry.class, who = entry.name;
  const build = currentBuild(cls, who);
  const preset = entry.preset;
  const buildEntry = entry.builds2.find((b) => b.name === build);
  const sets = () => (bp().daevanion_builds_data || {})[cls];
  const equips = () => (bp().equip_builds_data || {})[cls];
  return [
    { label: "New build", run: async () => {
      const name = await askText("New build", "Build name", "", takenIn(sets(), "build"));
      if (name && newBuild(cls, name, who) !== false) reload();
    } },
    { label: "Duplicate build", run: async () => {
      const name = await askText(`Duplicate build "${build}"`, "Name of the copy", `${build} (Copy)`, takenIn(sets(), "build"));
      if (name && duplicateBuild(cls, build, name, who) !== false) reload();
    } },
    { label: "Rename build", run: async () => {
      const name = await askText(`Rename build "${build}"`, "Build name", build, (n) => (n === build ? "" : takenIn(sets(), "build")(n)));
      if (name && name !== build && renameBuild(cls, build, name) !== false) reload();
    } },
    { label: "Delete build", disabled: entry.builds2.length <= 1, run: async () => {
      const count = buildEntry ? buildEntry.presets.length : 0;
      if (await askConfirm("Delete build", `Delete the build "${build}" with its Daevanion boards and its ${count} preset${count === 1 ? "" : "s"}? This cannot be undone.`)
        && deleteBuild(cls, build, who) !== false) reload();
    } },
    { separator: true },
    { label: "New preset", run: async () => {
      const name = await askText(`New preset in "${build}"`, "Preset name", "", takenIn(equips(), "preset"));
      if (name && newPreset(cls, build, name, who) !== false) reload();
    } },
    { label: "Duplicate preset", disabled: !preset, run: async () => {
      const name = await askText(`Duplicate preset "${preset}"`, "Name of the copy", `${preset} (Copy)`, takenIn(equips(), "preset"));
      if (name && duplicatePreset(cls, preset, name) !== false) reload();
    } },
    { label: "Rename preset", disabled: !preset, run: async () => {
      const name = await askText(`Rename preset "${preset}"`, "Preset name", preset, (n) => (n === preset ? "" : takenIn(equips(), "preset")(n)));
      if (name && name !== preset && renamePreset(cls, preset, name) !== false) reload();
    } },
    { label: "Delete preset", disabled: !buildEntry || buildEntry.presets.length <= 1, run: async () => {
      if (await askConfirm("Delete preset", `Delete the preset "${preset}" with its equipment, skills and genius profile? This cannot be undone.`)
        && deletePreset(cls, preset) !== false) reload();
    } },
    { separator: true },
    { label: "Diff…", disabled: !preset, run: () => askDiff(entry) },
  ];
}

function showMenu(button, entry) {
  if (openMenu) { closeMenu(); return; }
  const menu = document.createElement("div");
  menu.className = "roster-menu char-menu";
  menu.setAttribute("role", "menu");
  for (const item of menuItems(entry)) {
    if (item.separator) { menu.appendChild(document.createElement("hr")); continue; }
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = item.label;
    b.disabled = !!item.disabled;
    b.setAttribute("role", "menuitem");
    b.addEventListener("click", () => { closeMenu(); item.run(); });
    menu.appendChild(b);
  }
  document.body.appendChild(menu);
  const rect = button.getBoundingClientRect();
  const height = menu.offsetHeight, width = menu.offsetWidth;
  menu.style.left = `${Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8))}px`;
  menu.style.top = `${rect.bottom + height + 4 > window.innerHeight ? Math.max(8, rect.top - height - 4) : rect.bottom + 4}px`;
  openMenu = menu;
  document.addEventListener("pointerdown", onOutside, true);
  document.addEventListener("keydown", onMenuKey, true);
}

// ── header ──────────────────────────────────────────────────────────────────

function progressHtml(entry) {
  const progress = progressOf(entry.name);
  if (!progress) return "";
  const odyle = progress.odyle == null ? ""
    : `<span class="tag ${{ full: "danger", high: "warn" }[odyleLevel(progress.odyle)] || "info"}" title="Odyle energy">Odyle ${progress.odyle}/${ODYLE_MAX}</span>`;
  return odyle + kindChipsHtml(progress.kinds);
}

const BUILD_BUTTONS = `<button type="button" class="char-diff" title="Compare two presets side by side">Diff…</button>
    <button type="button" class="char-menu-btn" title="New, duplicate, rename or delete Builds and presets" aria-haspopup="menu">&#8943;</button>`;

function singleBuild(entry) {
  return entry.builds2.length <= 1 && entry.builds2.every((b) => b.presets.length <= 1);
}

// The Build row only exists when there is something to switch between;
// with one Build and one preset its buttons sit in the header row instead.
function buildsHtml(entry) {
  if (singleBuild(entry)) return "";
  const buildName = currentBuild(entry.class, entry.name);
  const current = entry.builds2.find((b) => b.name === buildName);
  const tabs = entry.builds2.map((b) => `<button type="button" role="tab" class="char-build-tab${b.name === buildName ? " active" : ""}" aria-selected="${b.name === buildName}"
      data-build="${escapeHtml(b.name)}" title="Build: ${escapeHtml(b.name)}">${escapeHtml(b.name)}</button>`).join("");
  const chips = (current ? current.presets : []).map((name) => `<button type="button" class="char-preset-chip${name === entry.preset ? " active" : ""}"
      data-preset="${escapeHtml(name)}" title="Preset: ${escapeHtml(name)}">${escapeHtml(name)}</button>`).join("");
  return `<span class="char-label">Build</span><div class="char-build-tabs" role="tablist">${tabs}</div>
    <span class="char-label">Preset</span><div class="char-preset-chips">${chips}</div>
    <span class="grow"></span>${BUILD_BUTTONS}`;
}

function renderHeader(head, entry) {
  const cls = className(entry.class);
  head.className = `char-head class-${entry.class}`;
  head.innerHTML = `<div class="char-head-main">
      <img class="char-class-icon" src="assets/class_icons/${escapeHtml(entry.class)}.png" alt="">
      <select class="char-class" aria-label="Class">${CLASSES.map((c) => `<option ${c === cls ? "selected" : ""}>${c}</option>`).join("")}</select>
      <input class="char-name" type="text" placeholder="Character name" aria-label="Character name" maxlength="40" value="${escapeHtml(entry.name)}">
      <div class="char-progress">${progressHtml(entry)}</div>
      <span class="grow"></span>
      <div class="char-pages">${PAGE_BUTTONS.map(([page, title]) => `<button type="button" data-open="${page}">${title}</button>`).join("")}${singleBuild(entry) ? BUILD_BUTTONS : ""}</div>
    </div>
    ${singleBuild(entry) ? "" : `<div class="char-builds">${buildsHtml(entry)}</div>`}`;
  head.querySelector(".char-name").addEventListener("change", (e) => renameCharacter(entry, e.target.value.trim()));
  head.querySelector(".char-class").addEventListener("change", (e) => {
    const key = e.target.value.toLowerCase();
    const p = bp();
    p.equip_builds_data[key] = p.equip_builds_data[key] || { Default: { equipped: {}, substats: {}, enchant: {}, philosopher_stone: {}, priority: {}, priority_progress: {} } };
    selectCharacter(e.target.value, Object.keys(p.equip_builds_data[key])[0]);
    reload();
  });
  head.querySelectorAll("[data-open]").forEach((b) => b.addEventListener("click", () => navigate(b.dataset.open)));
  head.querySelectorAll("[data-build]").forEach((b) => b.addEventListener("click", () => {
    if (b.classList.contains("active")) return;
    selectBuild(entry.class, b.dataset.build, entry.name);
    reload();
  }));
  head.querySelectorAll("[data-preset]").forEach((b) => b.addEventListener("click", () => {
    if (b.classList.contains("active")) return;
    selectCharacter(entry.class, b.dataset.preset, entry.name);
    reload();
  }));
  head.querySelector(".char-diff").addEventListener("click", () => askDiff(entry));
  const menuButton = head.querySelector(".char-menu-btn");
  menuButton.addEventListener("click", () => showMenu(menuButton, entry));
}

// ── page ────────────────────────────────────────────────────────────────────

function renderEmpty(main) {
  main.innerHTML = `<div class="card stack char-empty"><h2>No character yet</h2>
    <div class="muted">Add a character with the button in the sidebar, or import a profile.</div>
    <div class="row"><button type="button" class="primary" data-act="add">Add character</button><button type="button" data-act="import">Import profile</button></div></div>`;
  main.querySelector('[data-act="add"]').addEventListener("click", askCharacter);
  main.querySelector('[data-act="import"]').addEventListener("click", pickProfile);
}

function build(main) {
  if (area) { area.destroy(); area = null; }
  closeMenu();
  const entry = currentCharacter();
  shown = identity(entry);
  if (!entry) { renderEmpty(main); return; }
  main.innerHTML = `<div class="char-page"><header class="char-head"></header><div class="char-area"></div></div>`;
  renderHeader(main.querySelector(".char-head"), entry);
  const container = main.querySelector(".char-area");
  area = mountArea(container, "character", {
    defaults: defaultLayout(container.clientWidth || main.clientWidth, entry),
    allowed: (id) => id.startsWith("character."),
    empty: "<b>No character widgets.</b><div>Add the skill layout, skills, Daevanion boards, equipment, Arcana, Genius Insight or the summary card back with the button below.</div>",
  });
}

function onProfileChange() {
  if (!host || pending) return;
  pending = requestAnimationFrame(() => {
    pending = 0;
    if (!host) return;
    const entry = currentCharacter();
    if (identity(entry) !== shown) { build(host); return; }
    const head = host.querySelector(".char-head");
    if (head && !head.contains(document.activeElement)) renderHeader(head, entry);
    if (area) area.refresh();
  });
}

export function mount(main) {
  host = main;
  build(main);
  stopWatching = onChange(onProfileChange);
}

export function unmount() {
  if (pending) cancelAnimationFrame(pending);
  pending = 0;
  if (stopWatching) stopWatching();
  stopWatching = null;
  closeMenu();
  if (area) area.destroy();
  area = null;
  host = null;
  shown = null;
}
