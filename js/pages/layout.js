// Skill Layout page: the in-game skill bar (5 rows x 12 columns, the bottom
// row being the key row) and the macro chain, stored per skill build, with
// drag-and-drop from the Active / Stigma palettes. Port of the desktop's
// _build_skill_layout_tab / _SkillLayoutSlot / _SkillLayoutPalette /
// _render_skill_layout.

import { bp, onChange, save } from "../state.js";
import {
  KEY_ROW, MOUSE_KEY_LABELS, SKILL_LAYOUT_COLS, SKILL_LAYOUT_ROWS, SKILL_MACRO_MAX, barContents, currentSkillBuildName, data,
  dropped, escapeHtml, ready, removeAt, skillBuild, skillContext, skillIconUrl, twoLineLabel,
} from "../engine/skills.js";

export const SKILL_LAYOUT_MIME = "application/x-aion2-skill-layout-slot";
const SLOT_SIZE = 76;
const EXPORT_SLOT = 64;

const TEXT = {
  title: "Skill Layout",
  build: (name) => `Skill build: ${name}`,
  hint: "Drag skills from the list onto the bar or the macro, drag slots to move or swap them, and drag a slot back onto the list to remove it. The bottom row shows the lowest skill of each column, like in-game; right-click it to set its key. The macro casts its skills top to bottom, up to 4.",
  bar: "Skill bar",
  macro: "Macro",
  sections: { active: "Active Skills", stigma: "Stigma Skills" },
  onBar: (slot) => `Already on the skill bar (${slot}). Drag it from that slot to move it.`,
  setKey: "Set key label...",
  keyPrompt: "Key label (e.g. Ctrl+1), empty to remove:",
  mouse: "Mouse button",
  mouseLabels: { "@mouse_left": "Left click", "@mouse_right": "Right click", "@mouse_forward": "Side button (forward)", "@mouse_back": "Side button (back)" },
  clear: "Clear slot",
  removeMacro: "Remove from macro",
};

// ── colours and icons ───────────────────────────────────────────────────────

function cssVar(name, fallback) {
  if (typeof document === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

export function palette() {
  return {
    bg: cssVar("--bg", "#0f172a"), fg: cssVar("--fg", "#e2e8f0"), muted: cssVar("--muted", "#94a3b8"),
    border: cssVar("--border", "#3b4863"), accent: cssVar("--accent", "#22d3ee"), font: cssVar("--font", '"Segoe UI", system-ui, sans-serif'),
  };
}

function withAlpha(color, alpha) {
  const m = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return color;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

const icons = new Map();

// One shared Image per URL; `onload` callbacks fire once it can be drawn.
export function iconImage(url) {
  if (!url) return null;
  let img = icons.get(url);
  if (!img) {
    img = new Image();
    img.decoding = "async";
    img.src = url;
    icons.set(url, img);
  }
  return img;
}

function whenLoaded(img) {
  if (!img || (img.complete && img.naturalWidth)) return Promise.resolve();
  return new Promise((resolve) => { img.addEventListener("load", resolve, { once: true }); img.addEventListener("error", resolve, { once: true }); });
}

export function loadIcons(urls) {
  return Promise.all([...new Set(urls.filter(Boolean))].map((url) => whenLoaded(iconImage(url))));
}

// ── painting (shared by the live slots and the export image) ────────────────

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Small mouse with the pressed button filled, like the in-game bar.
export function drawMouseGlyph(ctx, box, button, colors) {
  const h = box.h, w = h * 0.66;
  const body = { x: box.x + (box.w - w) / 2, y: box.y, w, h };
  const radius = w / 2;
  ctx.save();
  ctx.lineWidth = Math.max(1, h / 14);
  ctx.strokeStyle = colors.fg;
  ctx.fillStyle = withAlpha(colors.bg, 160 / 255);
  roundRect(ctx, body.x, body.y, body.w, body.h, radius);
  ctx.fill();
  ctx.stroke();
  const splitY = body.y + h * 0.42;
  const cx = body.x + w / 2;
  ctx.beginPath();
  ctx.moveTo(cx, body.y); ctx.lineTo(cx, splitY);
  ctx.moveTo(body.x, splitY); ctx.lineTo(body.x + w, splitY);
  ctx.stroke();
  ctx.fillStyle = colors.fg;
  if (button === "left" || button === "right") {
    const half = { x: button === "right" ? cx : body.x, y: body.y, w: w / 2, h: splitY - body.y };
    ctx.save();
    roundRect(ctx, body.x, body.y, body.w, body.h, radius);
    ctx.clip();
    ctx.fillRect(half.x + 1, half.y + 1, half.w - 2, half.h - 2);
    ctx.restore();
  } else {
    const top = body.y + h * (button === "forward" ? 0.44 : 0.68);
    ctx.strokeStyle = withAlpha(colors.bg, 200 / 255);
    ctx.lineWidth = 1;
    roundRect(ctx, body.x - w * 0.22, top, w * 0.42, h * 0.2, 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

// content: { icon: HTMLImageElement|null, level: "Lv. 5"|"", key: "1"|"@mouse_left"|"", placeholder: "+"|"" }
export function drawSlot(ctx, x, y, size, content, { readOnly = false, hover = false, colors = palette() } = {}) {
  const rect = { x: x + 1, y: y + 1, w: size - 2, h: size - 2 };
  ctx.save();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = hover ? colors.accent : colors.border;
  ctx.fillStyle = colors.bg;
  roundRect(ctx, rect.x, rect.y, rect.w, rect.h, 6);
  ctx.fill();
  ctx.stroke();
  const icon = content.icon;
  if (icon && icon.complete && icon.naturalWidth) {
    ctx.save();
    if (readOnly) ctx.globalAlpha = 0.6;
    roundRect(ctx, rect.x + 2, rect.y + 2, rect.w - 4, rect.h - 4, 4);
    ctx.clip();
    ctx.drawImage(icon, rect.x + 2, rect.y + 2, rect.w - 4, rect.h - 4);
    ctx.restore();
  } else if (content.placeholder) {
    ctx.fillStyle = colors.muted;
    ctx.font = `${Math.max(10, Math.floor(size / 3))}px ${colors.font}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(content.placeholder, rect.x + rect.w / 2, rect.y + rect.h / 2);
  }
  ctx.font = `bold ${Math.max(9, Math.floor(size / 6))}px ${colors.font}`;
  if (MOUSE_KEY_LABELS.includes(content.key)) {
    const g = Math.max(12, Math.round(size * 0.3));
    drawMouseGlyph(ctx, { x: rect.x + 4, y: rect.y + 3, w: g, h: g }, content.key.replace("@mouse_", ""), colors);
  }
  const box = { x: rect.x + 4, y: rect.y + 2, w: rect.w - 8, h: rect.h - 4 };
  for (const [text, align] of [[content.key, "left"], [content.level, "right"]]) {
    if (!text || MOUSE_KEY_LABELS.includes(text)) continue;
    const tx = align === "left" ? box.x : box.x + box.w;
    const ty = align === "left" ? box.y : box.y + box.h;
    ctx.textAlign = align;
    ctx.textBaseline = align === "left" ? "top" : "bottom";
    ctx.fillStyle = withAlpha(colors.bg, 220 / 255);
    ctx.fillText(text, tx + 1, ty + 1);
    ctx.fillStyle = colors.fg;
    ctx.fillText(text, tx, ty);
  }
  ctx.restore();
}

// ── state helpers ───────────────────────────────────────────────────────────

function classLowerOf(classKey) { return (classKey || bp().character_class || "").trim().toLowerCase(); }

function layoutOf(classLower, buildName) { return skillBuild(bp(), classLower, buildName).layout; }

function slotContent(context, skillId, keyText = "", placeholder = "") {
  const skill = skillId ? context.byId[skillId] : null;
  if (!skill) return { icon: null, level: "", key: keyText, placeholder, tooltip: "" };
  const level = context.layoutLevel(skillId);
  return { icon: iconImage(skillIconUrl(skill)), level: level ? `Lv. ${level}` : "", key: keyText, placeholder: "", tooltip: skill.name || "" };
}

function readAddress(event) {
  try {
    const raw = event.dataTransfer.getData(SKILL_LAYOUT_MIME);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function carriesSlot(event) {
  return !!event.dataTransfer && [...(event.dataTransfer.types || [])].includes(SKILL_LAYOUT_MIME);
}

function startDrag(event, address, icon) {
  event.dataTransfer.setData(SKILL_LAYOUT_MIME, JSON.stringify(address));
  event.dataTransfer.effectAllowed = "move";
  if (icon && icon.complete && icon.naturalWidth) event.dataTransfer.setDragImage(icon, 24, 24);
}

// ── context menu ────────────────────────────────────────────────────────────

let openMenu = null;

function closeMenu() {
  if (openMenu) { openMenu.remove(); openMenu = null; }
}

function showMenu(items, x, y) {
  closeMenu();
  const menu = document.createElement("div");
  menu.className = "ctx-menu";
  for (const item of items) {
    const row = document.createElement("div");
    row.className = item.header ? "ctx-header" : "ctx-item" + (item.indent ? " indent" : "");
    row.textContent = item.label;
    if (!item.header) row.addEventListener("click", () => { closeMenu(); item.action(); });
    menu.appendChild(row);
  }
  document.body.appendChild(menu);
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, window.innerWidth - rect.width - 4)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - rect.height - 4)}px`;
  openMenu = menu;
}

if (typeof document !== "undefined") {
  document.addEventListener("mousedown", (e) => { if (openMenu && !openMenu.contains(e.target)) closeMenu(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenu(); });
}

// ── the live bar + macro block ──────────────────────────────────────────────

function makeSlot(address, size, readOnly) {
  const el = document.createElement("div");
  el.className = "layout-slot" + (readOnly ? " read-only" : "");
  el.dataset.kind = address[0];
  el.dataset.where = String(address[1]);
  const canvas = document.createElement("canvas");
  el.appendChild(canvas);
  el.address = address;
  el.readOnly = readOnly;
  el.content = { icon: null, level: "", key: "", placeholder: "" };
  el.hover = false;
  el.paint = () => {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    drawSlot(ctx, 0, 0, size, el.content, { readOnly, hover: el.hover });
  };
  el.setContent = (content) => {
    el.content = content;
    el.title = content.tooltip || "";
    el.paint();
    if (content.icon && !(content.icon.complete && content.icon.naturalWidth)) whenLoaded(content.icon).then(() => { if (el.content === content) el.paint(); });
  };
  el.paint();
  return el;
}

function wireSlot(el, handlers) {
  el.addEventListener("dragstart", (e) => {
    if (el.readOnly || !el.content.icon) { e.preventDefault(); return; }
    startDrag(e, el.address, el.content.icon);
  });
  el.addEventListener("dragover", (e) => {
    if (el.readOnly || !carriesSlot(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (!el.hover) { el.hover = true; el.classList.add("drop-hover"); el.paint(); }
  });
  el.addEventListener("dragleave", () => { if (el.hover) { el.hover = false; el.classList.remove("drop-hover"); el.paint(); } });
  el.addEventListener("drop", (e) => {
    if (el.readOnly || !carriesSlot(e)) return;
    e.preventDefault();
    el.hover = false;
    el.classList.remove("drop-hover");
    el.paint();
    const source = readAddress(e);
    if (source) handlers.dropped(source, el.address);
  });
  el.addEventListener("contextmenu", (e) => { e.preventDefault(); handlers.context(el.address, e.clientX, e.clientY); });
}

// The bar (with its key row) and the macro as live slots. Refreshes itself
// on every profile save; call `destroy()` when the host page unmounts.
export function skillBarWidget(classKey, buildName, { interactive = true } = {}) {
  const classLower = classLowerOf(classKey);
  const root = document.createElement("div");
  root.className = "skill-bar-widget";
  const barCol = document.createElement("div");
  barCol.className = "bar-col";
  barCol.innerHTML = `<div class="section-label">${TEXT.bar}</div>`;
  const grid = document.createElement("div");
  grid.className = "bar-grid";
  const barSlots = {};
  for (let r = 0; r < SKILL_LAYOUT_ROWS; r++) {
    const row = document.createElement("div");
    row.className = "bar-row" + (r === KEY_ROW ? " key-row" : "");
    for (let c = 0; c < SKILL_LAYOUT_COLS; c++) {
      const slot = makeSlot(["bar", `${r},${c}`], SLOT_SIZE, r === KEY_ROW);
      barSlots[`${r},${c}`] = slot;
      row.appendChild(slot);
    }
    grid.appendChild(row);
  }
  barCol.appendChild(grid);
  root.appendChild(barCol);

  const macroCol = document.createElement("div");
  macroCol.className = "macro-col";
  macroCol.innerHTML = `<div class="section-label">${TEXT.macro}</div>`;
  const macroRows = [];
  for (let i = 0; i < SKILL_MACRO_MAX; i++) {
    const row = document.createElement("div");
    row.className = "macro-row";
    const number = document.createElement("span");
    number.className = "macro-number";
    number.textContent = String(i + 1);
    row.appendChild(number);
    const slot = makeSlot(["macro", i], SLOT_SIZE, false);
    row.appendChild(slot);
    macroCol.appendChild(row);
    macroRows.push([row, slot]);
  }
  root.appendChild(macroCol);

  const buildOf = () => buildName || currentSkillBuildName(bp(), classLower);
  const handlers = {
    dropped(source, target) {
      const layout = layoutOf(classLower, buildOf());
      if (dropped(layout, source, target)) save();
    },
    context(address, x, y) {
      const layout = layoutOf(classLower, buildOf());
      const [kind, where] = address;
      const items = [];
      if (kind === "bar" && String(where).startsWith(`${KEY_ROW},`)) {
        items.push({ label: TEXT.setKey, action: () => {
          const current = layout.keys[where] || "";
          const text = window.prompt(TEXT.keyPrompt, MOUSE_KEY_LABELS.includes(current) ? "" : current);
          if (text === null) return;
          if (text.trim()) layout.keys[where] = text.trim(); else delete layout.keys[where];
          save();
        } });
        items.push({ label: TEXT.mouse, header: true });
        for (const label of MOUSE_KEY_LABELS) items.push({ label: TEXT.mouseLabels[label], indent: true, action: () => { layout.keys[where] = label; save(); } });
      } else if (kind === "bar" && where in layout.slots) {
        items.push({ label: TEXT.clear, action: () => { removeAt(layout, address); save(); } });
      } else if (kind === "macro" && where < layout.macro.length) {
        items.push({ label: TEXT.removeMacro, action: () => { removeAt(layout, address); save(); } });
      }
      if (items.length) showMenu(items, x, y);
    },
  };
  if (interactive) {
    for (const slot of Object.values(barSlots)) { slot.draggable = !slot.readOnly; wireSlot(slot, handlers); }
    for (const [, slot] of macroRows) { slot.draggable = true; wireSlot(slot, handlers); }
  }

  root.refresh = () => {
    const context = skillContext(bp(), classLower, buildOf());
    const layout = context.build.layout;
    for (const [key, [skillId, keyText]] of Object.entries(barContents(layout))) barSlots[key].setContent(slotContent(context, skillId, keyText));
    macroRows.forEach(([row, slot], i) => {
      row.hidden = i > layout.macro.length;
      slot.setContent(slotContent(context, layout.macro[i] || null, "", "+"));
    });
  };
  const unsubscribe = onChange(() => root.refresh());
  root.destroy = () => unsubscribe();
  ready().then(() => root.refresh());
  return root;
}

// Any element with data-skill-drag="<skill id>" inside `container` starts a
// list drag (the Characters page's skill cards).
export function wireSkillCardDrag(container) {
  for (const el of container.querySelectorAll("[data-skill-drag]")) {
    if (el.getAttribute("draggable") === "false") continue;
    el.draggable = true;
    el.addEventListener("dragstart", (e) => {
      startDrag(e, ["list", el.dataset.skillDrag], iconImage(skillIconUrl(data.byId[el.dataset.skillDrag])));
    });
  }
}

// Dropping a bar slot or macro step onto `el` takes it off again.
export function makeRemoveDropZone(el, classKey, buildName) {
  const classLower = classLowerOf(classKey);
  el.addEventListener("dragover", (e) => { if (carriesSlot(e)) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; } });
  el.addEventListener("drop", (e) => {
    if (!carriesSlot(e)) return;
    e.preventDefault();
    const source = readAddress(e);
    if (!source || source[0] === "list") return;
    const layout = layoutOf(classLower, buildName || currentSkillBuildName(bp(), classLower));
    if (removeAt(layout, source)) save();
  });
}

// ── export image ────────────────────────────────────────────────────────────

// Bar + macro as one image at the desktop's fixed geometry. Returned at
// once; `canvas.ready` resolves when the data and icons are drawn.
export function renderSkillBar(classKey, buildName, { scale = 1 } = {}) {
  const classLower = classLowerOf(classKey);
  const size = EXPORT_SLOT, gap = 4, pad = 12, titleH = 26;
  const top = pad + titleH;
  const barRight = pad + SKILL_LAYOUT_COLS * (size + gap);
  const macroX = barRight + 32;
  const width = macroX + 26 + size + pad;
  const height = top + SKILL_LAYOUT_ROWS * (size + gap) + 8 + pad;
  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;
  const draw = (context) => {
    const colors = palette();
    const ctx = canvas.getContext("2d");
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, width, height);
    const title = (text, x) => {
      ctx.font = `bold 11px ${colors.font}`;
      if ("letterSpacing" in ctx) ctx.letterSpacing = "1px";
      ctx.fillStyle = colors.accent;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(text, x, pad + 2);
      if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
    };
    title(TEXT.bar, pad);
    const layout = context.build.layout;
    for (const [key, [skillId, keyText]] of Object.entries(barContents(layout))) {
      const [r, c] = key.split(",").map(Number);
      const y = top + r * (size + gap) + (r === KEY_ROW ? 8 : 0);
      drawSlot(ctx, pad + c * (size + gap), y, size, slotContent(context, skillId, keyText), { readOnly: r === KEY_ROW, colors });
    }
    title(TEXT.macro, macroX);
    layout.macro.forEach((skillId, i) => {
      const y = top + i * (size + gap);
      ctx.font = `bold 18px ${colors.font}`;
      ctx.fillStyle = colors.fg;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(String(i + 1), macroX, y + size / 2);
      drawSlot(ctx, macroX + 26, y, size, slotContent(context, skillId), { colors });
    });
  };
  canvas.ready = ready().then(() => {
    const context = skillContext(bp(), classLower, buildName || currentSkillBuildName(bp(), classLower));
    draw(context);
    const ids = [...Object.values(context.build.layout.slots), ...context.build.layout.macro];
    return loadIcons(ids.map((id) => skillIconUrl(context.byId[id]))).then(() => { draw(context); return canvas; });
  });
  return canvas;
}

// ── the page ────────────────────────────────────────────────────────────────

let widget = null;
let unsubscribe = null;
let palettes = {};

function paletteTile(skill, placedAt) {
  const tile = document.createElement("div");
  tile.className = "palette-tile" + (placedAt ? " placed" : "");
  tile.draggable = !placedAt;
  tile.dataset.skill = skill.id;
  const name = skill.name || "";
  tile.title = placedAt ? `${name}\n${TEXT.onBar(placedAt)}` : name;
  const url = skillIconUrl(skill);
  tile.innerHTML = `${url ? `<img src="${url}" alt="" draggable="false">` : `<span class="tile-icon-empty"></span>`}<div class="tile-name">${escapeHtml(twoLineLabel(name))}</div>`;
  tile.addEventListener("dragstart", (e) => {
    if (placedAt) { e.preventDefault(); return; }
    startDrag(e, ["list", skill.id], iconImage(url));
  });
  return tile;
}

function refreshPalettes() {
  const p = bp();
  const classLower = p.character_class.toLowerCase();
  const buildName = currentSkillBuildName(p, classLower);
  const context = skillContext(p, classLower, buildName);
  const label = document.getElementById("layout-build-label");
  if (label) label.textContent = TEXT.build(buildName);
  const slotOf = {};
  for (const [key, sid] of Object.entries(context.build.layout.slots)) slotOf[sid] = key;
  for (const [type, el] of Object.entries(palettes)) {
    el.innerHTML = "";
    for (const skill of context.skills.filter((s) => s.type === type)) {
      const key = slotOf[skill.id];
      const placedAt = key ? key.split(",").map((n) => Number(n) + 1).join("-") : "";
      el.appendChild(paletteTile(skill, placedAt));
    }
  }
}

export function mount(main) {
  main.innerHTML = `<div class="layout-page">
    <div class="row"><h2>${TEXT.title}</h2><span class="grow"></span><span id="layout-build-label" class="section-label"></span></div>
    <div class="muted hint">${TEXT.hint}</div>
    <div id="layout-bar"></div>
    ${["active", "stigma"].map((type) => `<div class="section-label">${TEXT.sections[type]}</div><div class="skill-palette" data-type="${type}"></div>`).join("")}
  </div>`;
  const p = bp();
  widget = skillBarWidget(p.character_class, null, { interactive: true });
  main.querySelector("#layout-bar").appendChild(widget);
  palettes = {};
  for (const el of main.querySelectorAll(".skill-palette")) {
    palettes[el.dataset.type] = el;
    makeRemoveDropZone(el, p.character_class, null);
    el.addEventListener("dragover", (e) => { if (carriesSlot(e)) el.classList.add("drop-hover"); });
    el.addEventListener("dragleave", () => el.classList.remove("drop-hover"));
    el.addEventListener("drop", () => el.classList.remove("drop-hover"));
  }
  unsubscribe = onChange(refreshPalettes);
  ready().then(refreshPalettes);
}

export function unmount() {
  if (widget) { widget.destroy(); widget = null; }
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  palettes = {};
  closeMenu();
}

// Resolves once the skill data is loaded; the synchronous helpers below need it.
export { ready };
