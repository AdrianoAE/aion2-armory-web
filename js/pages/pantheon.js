// Pantheon: the 17-slot board (12 Artwork ring, 4 Statue ring, 1 Colossus),
// the item browser with category/search/grade/Lord filters, and the Lord
// Points panel. Account-wide state in bp().pantheon_slots.

import { bp, save } from "../state.js";
import { lordBarHtml, GRADE_COLORS } from "./arcana.js";

const CANVAS_SIZE = 660;
// (slot id, catalog name prefix, diameter, ring radius, start angle; 0 = up, clockwise)
const SLOT_DEFS = [
  ...Array.from({ length: 12 }, (_, i) => [`Artwork${i + 1}`, "Artwork: ", 72, 258, i * 30]),
  ...Array.from({ length: 4 }, (_, i) => [`Statue${i + 1}`, "Statue: ", 66, 154, 45 + i * 90]),
  ["Colossus1", "Colossus: ", 108, 0, 0],
];
const BOARD_CATEGORIES = new Set(["Pantheon", "Pantheon Decor"]);
export const LORD_DISPLAY = {
  life: "Life", wisdom: "Wisdom", illusion: "Illusion", destiny: "Destiny", death: "Death",
  freedom: "Freedom", justice: "Justice", space: "Space", time: "Time", destruction: "Destruction",
};
const RARITY_ORDER = ["Common", "Rare", "Legend", "Unique", "Epic"];

const T = {
  title: "Pantheon",
  hint: "Fill in Artwork, Statue, and Colossus slots — each grants real Lord points, same as Arcana cards.",
  slotEmpty: "Empty — click to choose", lordPoints: "Lord Points", lordFilter: "Lord filter:",
  inventory: "Available Items", selectSlot: "Select a slot on the board to browse and assign matching items.",
  assigningTo: (slot) => `Assigning to: ${slot}`, clearSlot: "Clear slot", all: "All", search: "Search…", name: "Name",
};

const esc = (text) => String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const formatNumber = (v) => String(Math.round(v));

let items = null;
let itemsById = null;
let pantheonData = null;
let placeholders = null;

async function loadData() {
  if (items) return;
  const [catalog, stats] = await Promise.all([
    fetch("data/items_all.json").then((r) => r.json()),
    fetch("data/pantheon_items.json").then((r) => r.json()),
  ]);
  items = catalog.items.filter((it) => BOARD_CATEGORIES.has(it.categoryName));
  itemsById = new Map(items.map((it) => [it.id, it]));
  pantheonData = {};
  for (const entry of stats) if (entry.stats && Object.keys(entry.stats).length) pantheonData[String(entry.id)] = entry.stats;
  placeholders = {};
  for (const prefix of ["Artwork: ", "Statue: ", "Colossus: "]) {
    const match = items.find((it) => (it.name || "").startsWith(prefix));
    if (match) placeholders[prefix] = match;
  }
}

export function pantheonSlots() {
  const p = bp();
  if (!p.pantheon_slots) p.pantheon_slots = {};
  for (const [slotId] of SLOT_DEFS) if (p.pantheon_slots[slotId] === undefined || p.pantheon_slots[slotId] === null) p.pantheon_slots[slotId] = "";
  return p.pantheon_slots;
}

// {Lord: points} across every filled slot, keyed by display name like the
// Arcana and gear Lord totals. Requires the page's data;
// call loadPantheonData() first from another page.
export function pantheonLordTotals() {
  const totals = {};
  if (!pantheonData) return totals;
  for (const itemId of Object.values(pantheonSlots())) {
    if (!itemId) continue;
    for (const [key, value] of Object.entries(pantheonData[String(itemId)] || {})) {
      const lord = LORD_DISPLAY[key] || key;
      totals[lord] = (totals[lord] || 0) + value;
    }
  }
  return totals;
}

export async function loadPantheonData() {
  if (!pantheonData) {
    pantheonData = {};
    for (const entry of await fetch("data/pantheon_items.json").then((r) => r.json())) {
      if (entry.stats && Object.keys(entry.stats).length) pantheonData[String(entry.id)] = entry.stats;
    }
  }
  return pantheonData;
}

let root = null;
let activeSlot = null;
let category = "";
let query = "";
let gradeFilter = "All";
let lordFilter = new Set();

export async function mount(main) {
  root = main;
  root.innerHTML = `<div class="muted">Loading…</div>`;
  await loadData();
  if (root !== main) return;
  draw();
}

export function unmount() { root = null; }

function slotTitle(slotId) {
  const m = /([A-Za-z]+)(\d+)/.exec(slotId);
  return m ? `${m[1]} ${m[2]}` : slotId;
}

function prefixOf(slotId) { return SLOT_DEFS.find((d) => d[0] === slotId)[1]; }

function iconHtml(item, size, faded) {
  if (!item || !item.image) return "";
  const color = GRADE_COLORS[item.grade] || "var(--border)";
  return `<img src="${item.image}" alt="" style="width:${size}px;height:${size}px;border:1px solid ${color};border-radius:6px;${faded ? "opacity:0.35;" : ""}" loading="lazy">`;
}

function slotHtml(slotId, prefix, size, radius, angleDeg) {
  const angle = (angleDeg * Math.PI) / 180;
  const center = CANVAS_SIZE / 2;
  const x = center + radius * Math.sin(angle) - size / 2;
  const y = center - radius * Math.cos(angle) - size / 2;
  const kind = slotId.startsWith("Colossus") ? "colossus" : slotId.startsWith("Statue") ? "statue" : "artwork";
  const itemId = pantheonSlots()[slotId];
  const item = itemId ? itemsById.get(itemId) : null;
  const iconSize = Math.round(size * 0.68);
  let title = T.slotEmpty;
  let icon = iconHtml(placeholders[prefix], iconSize, true);
  if (item) {
    icon = iconHtml(item, iconSize, false);
    const lines = Object.entries(pantheonData[String(itemId)] || {}).map(([k, v]) => `${LORD_DISPLAY[k] || k}: ${formatNumber(v)}`);
    title = [item.name, ...lines].join("\n");
  }
  return `<button type="button" class="pantheon-slot ${kind}${activeSlot === slotId ? " active" : ""}${item ? " filled" : ""}" data-slot="${slotId}" title="${esc(title)}"
    style="left:${Math.round(x)}px;top:${Math.round(y)}px;width:${size}px;height:${size}px">${icon}</button>`;
}

function draw() {
  if (!root) return;
  const slots = pantheonSlots();
  const gradeCounts = {};
  for (const it of items) if (it.grade) gradeCounts[it.grade] = (gradeCounts[it.grade] || 0) + 1;
  const totalCount = Object.values(gradeCounts).reduce((a, b) => a + b, 0);
  const totals = pantheonLordTotals();
  const activeHasItem = activeSlot && slots[activeSlot];
  root.innerHTML = `<div class="pantheon-page">
    <div class="pantheon-title">${T.title}</div>
    <div class="pantheon-hint">${T.hint}</div>
    <div class="pantheon-content">
      <div class="pantheon-panel inventory">
        <div class="panel-title">${T.inventory}</div>
        <div class="pantheon-hint inv-hint">${activeSlot ? esc(T.assigningTo(slotTitle(activeSlot))) : T.selectSlot}</div>
        <button type="button" class="filter-btn clear-slot" ${activeHasItem ? "" : "hidden"}>${T.clearSlot}</button>
        <div class="row cat-row">${[["", T.all], ["Artwork: ", "Artwork"], ["Statue: ", "Statue"], ["Colossus: ", "Colossus"]].map(([prefix, label]) => `<button type="button" class="filter-btn${category === prefix ? " active" : ""}" data-prefix="${prefix}">${label}</button>`).join("")}</div>
        <input type="text" class="search" placeholder="${T.search}" value="${esc(query)}">
        <select class="grade"><option value="All" ${gradeFilter === "All" ? "selected" : ""}>${T.all} (${totalCount})</option>${RARITY_ORDER.filter((g) => gradeCounts[g]).map((g) => `<option value="${g}" style="color:${GRADE_COLORS[g]}" ${gradeFilter === g ? "selected" : ""}>${g} (${gradeCounts[g]})</option>`).join("")}</select>
        <div class="section-label">${T.lordFilter}</div>
        <div class="lord-grid">${Object.entries(LORD_DISPLAY).map(([key, label]) => `<label><input type="checkbox" data-lord="${key}" ${lordFilter.has(key) ? "checked" : ""}> ${label}</label>`).join("")}</div>
        <div class="inv-table"><table><thead><tr><th></th><th>${T.name}</th></tr></thead><tbody></tbody></table></div>
      </div>
      <div class="pantheon-canvas-wrap"><div class="pantheon-canvas" style="width:${CANVAS_SIZE}px;height:${CANVAS_SIZE}px">${SLOT_DEFS.map((d) => slotHtml(...d)).join("")}</div></div>
      <div class="pantheon-panel lords">
        <div class="panel-title">${T.lordPoints}</div>
        ${Object.values(LORD_DISPLAY).map((lord) => `<div class="row lord-row"><span class="lord-name">${lord}</span><span class="grow"></span><span class="lord-value${totals[lord] ? " has-points" : ""}">${formatNumber(totals[lord] || 0)}</span></div>`).join("")}
      </div>
    </div>
    ${lordBarHtml()}
  </div>`;
  root.querySelectorAll(".pantheon-slot").forEach((b) => b.addEventListener("click", () => onSlotClicked(b.dataset.slot)));
  root.querySelectorAll(".cat-row .filter-btn").forEach((b) => b.addEventListener("click", () => { category = b.dataset.prefix; draw(); }));
  root.querySelector(".search").addEventListener("input", (e) => { query = e.target.value; refreshInventory(); });
  root.querySelector(".grade").addEventListener("change", (e) => { gradeFilter = e.target.value; refreshInventory(); });
  root.querySelectorAll(".lord-grid input").forEach((cb) => cb.addEventListener("change", () => {
    if (cb.checked) lordFilter.add(cb.dataset.lord); else lordFilter.delete(cb.dataset.lord);
    refreshInventory();
  }));
  root.querySelector(".clear-slot").addEventListener("click", () => {
    if (!activeSlot) return;
    slots[activeSlot] = "";
    save();
    draw();
  });
  refreshInventory();
}

function refreshInventory() {
  const slots = pantheonSlots();
  const q = query.trim().toLowerCase();
  const usedElsewhere = new Set(Object.entries(slots).filter(([sid, id]) => id && sid !== activeSlot).map(([, id]) => id));
  const matched = items.filter((it) => !usedElsewhere.has(it.id)
    && (!category || (it.name || "").startsWith(category))
    && (gradeFilter === "All" || it.grade === gradeFilter)
    && (!q || (it.name || "").toLowerCase().includes(q))
    && (!lordFilter.size || [...lordFilter].every((lord) => lord in (pantheonData[String(it.id)] || {}))))
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  const tbody = root.querySelector(".inv-table tbody");
  tbody.innerHTML = matched.map((it) => `<tr data-id="${it.id}" title="${esc(it.name || "")}"><td class="icon-cell">${iconHtml(it, 30, false)}</td><td style="color:${GRADE_COLORS[it.grade] || "inherit"}">${esc(it.name || "")}</td></tr>`).join("");
  tbody.querySelectorAll("tr").forEach((tr) => tr.addEventListener("click", () => assignActive(itemsById.get(Number(tr.dataset.id)))));
}

function onSlotClicked(slotId) {
  activeSlot = slotId;
  category = prefixOf(slotId);
  draw();
}

function assignActive(item) {
  if (!activeSlot || !item) return;
  const slots = pantheonSlots();
  const prefix = prefixOf(activeSlot);
  slots[activeSlot] = item.id;
  save();
  const next = SLOT_DEFS.find(([sid, pfx]) => pfx === prefix && !slots[sid]);
  if (next) onSlotClicked(next[0]);
  else { activeSlot = null; draw(); }
}
