// Widget areas: a grid of cards the player arranges (order, size, pin,
// collapse, per-widget settings). Pages register widgets once and mount an
// area; the layout lives in prefs().areas[areaId].

import { prefs, setPref, onPrefs } from "./ui.js";

const registry = new Map();
const registryListeners = new Set();
const areaDefaults = new Map();

const UNIT = 136;
const GAP = 12;
// Rows are spans of a fine 4 px track so auto-height cards pack tightly
// under shorter neighbours instead of reserving whole row units.

const SVG = (body, fill = false) => `<svg viewBox="0 0 16 16" aria-hidden="true" ${fill ? 'fill="currentColor" stroke="none"' : 'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"'}>${body}</svg>`;
const ICON = {
  grip: SVG('<circle cx="5.5" cy="3.5" r="1.3"/><circle cx="10.5" cy="3.5" r="1.3"/><circle cx="5.5" cy="8" r="1.3"/><circle cx="10.5" cy="8" r="1.3"/><circle cx="5.5" cy="12.5" r="1.3"/><circle cx="10.5" cy="12.5" r="1.3"/>', true),
  gear: SVG('<circle cx="8" cy="8" r="2.4"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4"/>'),
  pinTop: SVG('<path d="M3 2.5h10M8 13.5V6M5 8.5l3-3 3 3"/>'),
  pinBottom: SVG('<path d="M3 13.5h10M8 2.5V10M5 7.5l3 3 3-3"/>'),
  unpin: SVG('<path d="M6 3.5 3 6.5l3 3M3 6.5h7a3 3 0 0 1 0 6H8"/>'),
  collapse: SVG('<path d="M4 10l4-4 4 4"/>'),
  expand: SVG('<path d="M4 6l4 4 4-4"/>'),
  remove: SVG('<path d="M4 4l8 8M12 4l-8 8"/>'),
  plus: SVG('<path d="M8 3v10M3 8h10"/>'),
};

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
const clampInt = (value, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(value) || lo)));
const esc = (text) => String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function registerWidget(def) {
  if (!def || !def.id || typeof def.render !== "function") throw new Error("registerWidget needs an id and a render function");
  registry.set(def.id, def);
  for (const fn of [...registryListeners]) fn(def.id);
  return def;
}

// "character.summary#2" is a second instance of "character.summary".
function defOf(id) { return registry.get(String(id || "").split("#")[0]); }

export function registeredWidgets() {
  return [...registry.values()];
}

function accentValue(accent) {
  if (!accent) return "var(--accent)";
  if (accent.startsWith("--")) return `var(${accent})`;
  if (/^[a-z0-9-]+$/i.test(accent)) return `var(--${accent})`;
  return accent;
}

function normalizeItem(entry) {
  const raw = typeof entry === "string" ? { id: entry } : { ...(entry || {}) };
  return {
    id: String(raw.id || ""),
    cols: raw.cols == null ? null : clampInt(raw.cols, 1, 4),
    rows: raw.rows == null ? null : raw.rows === "auto" ? "auto" : clampInt(raw.rows, 1, 4),
    pinned: raw.pinned === "top" || raw.pinned === "bottom" ? raw.pinned : null,
    collapsed: !!raw.collapsed,
    settings: isPlainObject(raw.settings) ? { ...raw.settings } : {},
  };
}

function storedArea(areaId) {
  const areas = prefs().areas;
  const stored = areas && areas[areaId];
  return stored && Array.isArray(stored.items) ? stored : null;
}

function readItems(areaId) {
  const stored = storedArea(areaId);
  const source = stored ? stored.items : areaDefaults.get(areaId) || [];
  const seen = new Set();
  return source.map(normalizeItem).filter((item) => item.id && !seen.has(item.id) && seen.add(item.id));
}

function sizeOf(item) {
  const def = defOf(item.id);
  const size = (def && def.defaultSize) || {};
  const defRows = size.rows == null || size.rows === "auto" ? "auto" : clampInt(size.rows, 1, 4);
  return { cols: item.cols ?? clampInt(size.cols ?? 2, 1, 4), rows: item.rows ?? defRows };
}

function writeItems(areaId, items) {
  const layout = {
    items: items.map((item) => {
      const size = sizeOf(item);
      return { id: item.id, cols: size.cols, rows: size.rows, pinned: item.pinned, collapsed: item.collapsed, settings: item.settings };
    }),
  };
  setPref("areas", { ...(prefs().areas || {}), [areaId]: layout });
}

function mergedSettings(def, overrides) {
  const out = {};
  for (const field of (def && def.settings) || []) if (field && field.key) out[field.key] = clone(field.default);
  return Object.assign(out, overrides || {});
}

export function widgetSettings(areaId, widgetId) {
  const item = readItems(areaId).find((i) => i.id === widgetId);
  return mergedSettings(defOf(widgetId), item && item.settings);
}

export function setWidgetSetting(areaId, widgetId, key, value) {
  const items = readItems(areaId);
  const item = items.find((i) => i.id === widgetId);
  if (!item) return false;
  item.settings = { ...item.settings, [key]: value };
  writeItems(areaId, items);
  return true;
}

async function resolveOptions(field) {
  let options = typeof field.options === "function" ? field.options() : field.options;
  if (options && typeof options.then === "function") options = await options;
  return (options || []).map((o) => (Array.isArray(o) ? [o[0], o.length > 1 ? o[1] : o[0]] : [o, o]));
}

// One popup at a time across every area: settings forms and the Add menu.
let openPopup = null;

function closePopup() {
  if (openPopup) openPopup.close();
}

function showPopup(anchor, className) {
  if (openPopup && openPopup.anchor === anchor) { closePopup(); return null; }
  closePopup();
  const el = document.createElement("div");
  el.className = `wa-popup ${className}`;
  el.setAttribute("role", "dialog");
  document.body.appendChild(el);
  const position = () => {
    const r = anchor.getBoundingClientRect();
    const w = el.offsetWidth, h = el.offsetHeight;
    const left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8));
    let top = r.bottom + 6;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  };
  const onDown = (e) => { if (!el.contains(e.target) && !anchor.contains(e.target)) close(); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  function close() {
    el.remove();
    anchor.classList.remove("active");
    document.removeEventListener("pointerdown", onDown, true);
    document.removeEventListener("keydown", onKey);
    window.removeEventListener("resize", position);
    window.removeEventListener("scroll", position, true);
    if (openPopup && openPopup.el === el) openPopup = null;
  }
  document.addEventListener("pointerdown", onDown, true);
  document.addEventListener("keydown", onKey);
  window.addEventListener("resize", position);
  window.addEventListener("scroll", position, true);
  anchor.classList.add("active");
  openPopup = { el, anchor, close, position };
  return openPopup;
}

let fieldSeq = 0;

function fieldControl(field, value, options, onChange) {
  const wrap = document.createElement("div");
  wrap.className = "wa-field";
  const id = `wa-field-${++fieldSeq}`;
  const label = esc(field.label || field.key);
  const help = field.help ? `<div class="muted small">${esc(field.help)}</div>` : "";
  if (field.type === "checkbox") {
    wrap.innerHTML = `<label class="row wa-check"><input type="checkbox" id="${id}" ${value ? "checked" : ""}> ${label}</label>${help}`;
    wrap.querySelector("input").addEventListener("change", (e) => onChange(e.target.checked));
  } else if (field.type === "select") {
    const current = options.findIndex(([v]) => String(v) === String(value));
    wrap.innerHTML = `<label for="${id}">${label}</label><select id="${id}">${options.map(([, text], i) => `<option value="${i}" ${i === current ? "selected" : ""}>${esc(text)}</option>`).join("")}</select>${help}`;
    wrap.querySelector("select").addEventListener("change", (e) => onChange(options[Number(e.target.value)][0]));
  } else if (field.type === "multiselect") {
    const chosen = new Set((Array.isArray(value) ? value : []).map(String));
    wrap.innerHTML = `<div class="row"><span class="wa-label">${label}</span><span class="grow"></span>
        <button type="button" class="link" data-all>All</button><button type="button" class="link" data-none>None</button></div>
      ${options.length > 8 ? `<input type="text" class="wa-filter" placeholder="Filter">` : ""}
      <div class="wa-multi">${options.map(([v, text], i) => `<label class="row wa-check" data-text="${esc(String(text).toLowerCase())}"><input type="checkbox" value="${i}" ${chosen.has(String(v)) ? "checked" : ""}> ${esc(text)}</label>`).join("") || '<span class="muted small">Nothing to choose from.</span>'}</div>${help}`;
    const boxes = [...wrap.querySelectorAll(".wa-multi input")];
    const emit = () => onChange(boxes.filter((b) => b.checked).map((b) => options[Number(b.value)][0]));
    boxes.forEach((b) => b.addEventListener("change", emit));
    const visible = (b) => !b.closest("label").hidden;
    wrap.querySelector("[data-all]").addEventListener("click", () => { boxes.forEach((b) => { if (visible(b)) b.checked = true; }); emit(); });
    wrap.querySelector("[data-none]").addEventListener("click", () => { boxes.forEach((b) => { if (visible(b)) b.checked = false; }); emit(); });
    const filter = wrap.querySelector(".wa-filter");
    if (filter) filter.addEventListener("input", () => {
      const q = filter.value.trim().toLowerCase();
      for (const b of boxes) { const row = b.closest("label"); row.hidden = !!q && !row.dataset.text.includes(q); }
    });
  } else if (field.type === "number") {
    const attrs = ["min", "max", "step"].filter((k) => field[k] != null).map((k) => `${k}="${Number(field[k])}"`).join(" ");
    wrap.innerHTML = `<label for="${id}">${label}</label><input type="number" id="${id}" ${attrs} value="${esc(value ?? "")}">${help}`;
    wrap.querySelector("input").addEventListener("change", (e) => {
      let n = Number(e.target.value);
      if (e.target.value === "" || Number.isNaN(n)) return;
      if (field.min != null) n = Math.max(Number(field.min), n);
      if (field.max != null) n = Math.min(Number(field.max), n);
      e.target.value = n;
      onChange(n);
    });
  } else {
    wrap.innerHTML = `<label for="${id}">${label}</label><input type="text" id="${id}" value="${esc(value ?? "")}" ${field.placeholder ? `placeholder="${esc(field.placeholder)}"` : ""}>${help}`;
    wrap.querySelector("input").addEventListener("change", (e) => onChange(e.target.value));
  }
  return wrap;
}

function columnCount(grid) {
  const width = grid.getBoundingClientRect().width;
  return width > 1000 ? 4 : width > 560 ? 2 : 1;
}

function colsOf(card) {
  const match = /\bwa-c(\d)\b/.exec(card.className);
  return match ? Number(match[1]) : 2;
}

function isEditing(el) {
  const active = document.activeElement;
  return !!active && el.contains(active) && active.matches("input, textarea, select, [contenteditable]");
}

// pinsOnly: show only this area's pinned widgets in the page's bars, so a pin
// follows the user to every page; the grid itself stays hidden.
export function mountArea(container, areaId, { defaults = [], allowed = () => true, empty = "", pinsOnly = false } = {}) {
  if (!pinsOnly) areaDefaults.set(areaId, defaults);
  const instances = new Map();
  let destroyed = false;
  let dragging = false;
  let lastSeen = null;

  const root = document.createElement("div");
  root.className = "wa";
  root.dataset.area = areaId;
  root.innerHTML = `<div class="wa-grid"></div>
    <div class="wa-empty" hidden><div class="wa-empty-text">${empty || "No widgets here yet."}</div>
      <button type="button" class="primary wa-add">${ICON.plus} Add widget</button></div>
    <div class="wa-foot"><button type="button" class="wa-add">${ICON.plus} Add widget</button></div>`;
  root.style.setProperty("--wa-unit", `${UNIT}px`);
  root.style.setProperty("--wa-gap", `${GAP}px`);
  if (pinsOnly) root.hidden = true;
  container.appendChild(root);
  const grid = root.querySelector(".wa-grid");
  const emptyEl = root.querySelector(".wa-empty");
  const footEl = root.querySelector(".wa-foot");

  const scroller = container.closest("#main");
  const docks = {};
  for (const position of ["top", "bottom"]) {
    const dock = document.createElement("div");
    dock.className = `wa-dock wa-dock-${position}`;
    dock.dataset.area = areaId;
    dock.dataset.position = position;
    dock.hidden = true;
    dock.innerHTML = `<div class="wa-dock-hint">Drop here to pin to the ${position}</div><div class="wa-dock-items"></div>`;
    docks[position] = dock;
  }
  if (scroller) {
    scroller.prepend(docks.top);
    scroller.append(docks.bottom);
    scroller.classList.add("wa-host");
  } else {
    root.prepend(docks.top);
    root.append(docks.bottom);
  }


  const mutate = (fn) => {
    const items = readItems(areaId);
    if (fn(items) === false) return;
    writeItems(areaId, items);
  };

  function setSetting(id, key, value) {
    mutate((items) => {
      const item = items.find((i) => i.id === id);
      if (!item) return false;
      item.settings = { ...item.settings, [key]: value };
    });
  }

  function runCleanup(inst) {
    const fn = inst.cleanup;
    inst.cleanup = null;
    if (typeof fn === "function") {
      try { fn(); } catch (err) { console.error(err); }
    }
  }

  function showError(inst, err) {
    console.error(`Widget ${inst.def.id} failed:`, err);
    inst.body.innerHTML = `<div class="wa-error">This widget could not be shown: ${esc(err && err.message ? err.message : err)}</div>`;
  }

  function renderBody(inst, now = new Date()) {
    runCleanup(inst);
    inst.dirty = false;
    const body = inst.body;
    const token = ++inst.token;
    if (inst.mode === "grid" && inst.item.collapsed) { body.replaceChildren(); return; }
    const scrollTop = body.scrollTop, scrollLeft = body.scrollLeft;
    body.replaceChildren();
    const ctx = {
      settings: mergedSettings(inst.def, inst.item.settings),
      setSetting: (key, value) => setSetting(inst.item.id, key, value),
      now,
      refresh: () => refresh(),
      areaId,
      widgetId: inst.item.id,
      pinned: inst.mode === "grid" ? null : inst.mode,
    };
    const fn = inst.mode !== "grid" && typeof inst.def.compact === "function" ? inst.def.compact : inst.def.render;
    try {
      const result = fn.call(inst.def, body, ctx);
      if (result && typeof result.then === "function") {
        result.then((cleanup) => {
          if (typeof cleanup !== "function") return;
          if (token === inst.token && !inst.disposed) inst.cleanup = cleanup;
          else { try { cleanup(); } catch (err) { console.error(err); } }
        }, (err) => { if (token === inst.token && !inst.disposed) showError(inst, err); });
      } else if (typeof result === "function") inst.cleanup = result;
    } catch (err) { showError(inst, err); }
    if (scrollTop) body.scrollTop = scrollTop;
    if (scrollLeft) body.scrollLeft = scrollLeft;
  }

  function toolButton(act, icon, title) {
    return `<button type="button" class="wa-btn" data-act="${act}" title="${title}" aria-label="${title}">${icon}</button>`;
  }

  function createInstance(item, def, mode) {
    const inst = { item, def, mode, cleanup: null, token: 0, dirty: true, disposed: false };
    const title = esc(def.title || def.id);
    const gear = def.settings && def.settings.length ? toolButton("settings", ICON.gear, "Settings") : "";
    const el = document.createElement(mode === "grid" ? "section" : "div");
    el.dataset.widget = def.id;
    el.style.setProperty("--wa-accent", accentValue(def.accent));
    if (mode === "grid") {
      el.className = "wa-card";
      el.innerHTML = `<header class="wa-head">
          <span class="wa-grip" tabindex="0" role="button" title="Drag to move" aria-label="Move ${title}">${ICON.grip}</span>
          <h3 class="wa-title" title="${title}">${title}</h3>
          <span class="wa-tools">${gear}${toolButton("pin-top", ICON.pinTop, "Pin to the top")}${toolButton("pin-bottom", ICON.pinBottom, "Pin to the bottom")}${toolButton("collapse", ICON.collapse, "Collapse")}${toolButton("remove", ICON.remove, "Remove")}</span>
        </header>
        <div class="wa-body"></div>
        <span class="wa-resize" tabindex="0" role="button" title="Drag to change the width" aria-label="Resize ${title}"></span>`;
      const grip = el.querySelector(".wa-grip");
      grip.addEventListener("pointerdown", (e) => startDrag(inst, e));
      grip.addEventListener("keydown", (e) => keyMove(inst, e));
      cardObserver.observe(el);
      const handle = el.querySelector(".wa-resize");
      handle.addEventListener("pointerdown", (e) => startResize(inst, e));
      handle.addEventListener("keydown", (e) => keyResize(inst, e));
    } else {
      el.className = "wa-pin";
      el.innerHTML = `<span class="wa-grip" tabindex="0" role="button" title="Drag back into the page" aria-label="Move ${title}">${ICON.grip}</span>
        <span class="wa-pin-title" title="${title}">${title}</span><div class="wa-body wa-pin-body"></div>
        <span class="wa-tools">${gear}<button type="button" class="wa-btn wa-btn-text" data-act="unpin" title="Put the widget back into the page">${ICON.unpin}<span>Unpin</span></button></span>`;
      el.querySelector(".wa-grip").addEventListener("pointerdown", (e) => startDrag(inst, e));
    }
    el.addEventListener("click", (e) => {
      const btn = e.target.closest(".wa-tools [data-act]");
      if (btn && el.contains(btn)) act(inst, btn.dataset.act, btn);
    });
    inst.el = el;
    inst.body = el.querySelector(".wa-body");
    return inst;
  }

  function dispose(inst) {
    inst.disposed = true;
    if (openPopup && inst.el.contains(openPopup.anchor)) closePopup();
    runCleanup(inst);
    cardObserver.unobserve(inst.el);
    inst.el.remove();
    requestLayout();
  }

  function applySize(inst, cols, rows) {
    const el = inst.el;
    for (let c = 1; c <= 4; c += 1) el.classList.toggle(`wa-c${c}`, c === cols);
    el.classList.add("wa-auto");
    el.style.maxHeight = "";
    requestLayout();
  }

  // Cards pack like masonry: in order, each one takes the lowest spot where
  // its columns are free, so a card can sit under a shorter neighbour.
  let layoutFrame = 0;
  function requestLayout() {
    if (layoutFrame || destroyed) return;
    layoutFrame = requestAnimationFrame(() => { layoutFrame = 0; layoutCards(); });
  }

  function layoutCards() {
    const cards = [...grid.children].filter((el) => el.classList.contains("wa-card"));
    const n = columnCount(grid);
    const width = grid.getBoundingClientRect().width;
    if (!cards.length || !width) { grid.style.height = cards.length ? "" : "0px"; return; }
    const colWidth = (width - (n - 1) * GAP) / n;
    const bottoms = new Array(n).fill(0);
    let height = 0;
    for (const card of cards) {
      const span = Math.min(colsOf(card), n);
      let bestCol = 0, bestTop = Infinity;
      for (let c = 0; c + span <= n; c += 1) {
        const top = Math.max(...bottoms.slice(c, c + span));
        if (top < bestTop) { bestTop = top; bestCol = c; }
      }
      const left = bestCol * (colWidth + GAP);
      const w = span * colWidth + (span - 1) * GAP;
      card.style.left = `${left}px`;
      card.style.top = `${bestTop}px`;
      card.style.width = `${w}px`;
      const bottom = bestTop + card.offsetHeight + GAP;
      for (let c = bestCol; c < bestCol + span; c += 1) bottoms[c] = bottom;
      height = Math.max(height, bottom);
    }
    grid.style.height = `${Math.max(0, height - GAP)}px`;
  }

  const cardObserver = new ResizeObserver(() => requestLayout());
  cardObserver.observe(grid);

  function applyChrome(inst) {
    if (inst.mode !== "grid") return;
    const size = sizeOf(inst.item);
    inst.el.classList.toggle("wa-collapsed", inst.item.collapsed);
    applySize(inst, size.cols, size.rows);
    const btn = inst.el.querySelector('[data-act="collapse"]');
    const label = inst.item.collapsed ? "Expand" : "Collapse";
    if (btn.title !== label) {
      btn.title = label;
      btn.setAttribute("aria-label", label);
      btn.innerHTML = inst.item.collapsed ? ICON.expand : ICON.collapse;
    }
  }

  function place(parent, elements) {
    elements.forEach((el, i) => { if (parent.children[i] !== el) parent.insertBefore(el, parent.children[i] || null); });
  }

  function sync() {
    if (destroyed) return;
    const items = readItems(areaId).filter((i) => !pinsOnly || i.pinned);
    lastSeen = JSON.stringify(storedArea(areaId));
    const wanted = new Map(items.map((i) => [i.id, i]));
    for (const [id, inst] of instances) {
      const item = wanted.get(id);
      if (!item || defOf(id) !== inst.def || (item.pinned || "grid") !== inst.mode) { dispose(inst); instances.delete(id); }
    }
    const lists = { grid: [], top: [], bottom: [] };
    for (const item of items) {
      const def = defOf(item.id);
      if (!def) continue;
      const mode = item.pinned || "grid";
      let inst = instances.get(item.id);
      if (!inst) {
        inst = createInstance(item, def, mode);
        instances.set(item.id, inst);
      } else if (JSON.stringify(inst.item.settings) !== JSON.stringify(item.settings) || inst.item.collapsed !== item.collapsed) {
        inst.dirty = true;
      }
      inst.item = item;
      lists[mode].push(inst);
    }
    place(grid, lists.grid.map((i) => i.el));
    requestLayout();
    place(docks.top.querySelector(".wa-dock-items"), lists.top.map((i) => i.el));
    place(docks.bottom.querySelector(".wa-dock-items"), lists.bottom.map((i) => i.el));
    const now = new Date();
    for (const inst of instances.values()) {
      applyChrome(inst);
      if (inst.dirty) renderBody(inst, now);
    }
    const nothing = !lists.grid.length && !lists.top.length && !lists.bottom.length;
    emptyEl.hidden = !nothing;
    footEl.hidden = nothing;
    updateDocks();
  }

  function updateDocks() {
    for (const dock of Object.values(docks)) {
      const has = dock.querySelector(".wa-dock-items").children.length > 0;
      dock.hidden = !has && !dragging;
      dock.classList.toggle("wa-dock-ready", dragging);
      dock.classList.toggle("wa-dock-vacant", !has);
    }
  }

  function act(inst, action, btn) {
    const id = inst.item.id;
    if (action === "settings") { openSettings(inst, btn); return; }
    closePopup();
    mutate((items) => {
      const index = items.findIndex((i) => i.id === id);
      if (index < 0) return false;
      const item = items[index];
      if (action === "pin-top" || action === "pin-bottom") {
        items.splice(index, 1);
        item.pinned = action === "pin-top" ? "top" : "bottom";
        item.collapsed = false;
        items.push(item);
      } else if (action === "unpin") item.pinned = null;
      else if (action === "collapse") item.collapsed = !item.collapsed;
      else if (action === "remove") items.splice(index, 1);
      else return false;
    });
  }

  async function openSettings(inst, anchor) {
    const pop = showPopup(anchor, "wa-settings");
    if (!pop) return;
    const def = inst.def;
    const id = inst.item.id;
    pop.el.innerHTML = `<div class="wa-pop-head"><b>${esc(def.title || def.id)}</b><span class="muted small">Settings</span></div>
      <form class="wa-form"></form>
      <div class="row wa-pop-foot"><button type="button" data-reset>Reset to defaults</button><span class="grow"></span><button type="button" class="primary" data-done>Done</button></div>`;
    const form = pop.el.querySelector(".wa-form");
    form.addEventListener("submit", (e) => e.preventDefault());
    const fill = async () => {
      const current = widgetSettings(areaId, id);
      const controls = [];
      for (const field of def.settings) {
        if (!field || !field.key) continue;
        const options = field.type === "select" || field.type === "multiselect" ? await resolveOptions(field) : [];
        controls.push(fieldControl(field, current[field.key], options, (value) => setSetting(id, field.key, value)));
      }
      if (openPopup !== pop) return;
      form.replaceChildren(...controls);
      pop.position();
    };
    pop.el.querySelector("[data-done]").addEventListener("click", closePopup);
    pop.el.querySelector("[data-reset]").addEventListener("click", () => {
      mutate((items) => { const item = items.find((i) => i.id === id); if (!item) return false; item.settings = {}; });
      fill();
    });
    pop.position();
    try { await fill(); } catch (err) { console.error(err); form.innerHTML = `<div class="wa-error">${esc(err.message)}</div>`; }
  }

  function safeAllowed(id) {
    try { return !!allowed(id); } catch (err) { return false; }
  }

  function openAddMenu(anchor) {
    const pop = showPopup(anchor, "wa-menu");
    if (!pop) return;
    const present = new Set(readItems(areaId).filter((i) => defOf(i.id)).map((i) => i.id.split("#")[0]));
    const defs = [...registry.values()].filter((d) => safeAllowed(d.id));
    const byTitle = (a, b) => String(a.group || "").localeCompare(String(b.group || "")) || String(a.title || a.id).localeCompare(String(b.title || b.id));
    const groups = new Map();
    for (const def of defs.sort(byTitle)) {
      const group = def.group || "Other";
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push(def);
    }
    const entry = (def) => {
      const added = present.has(def.id);
      return `<button type="button" class="wa-menu-item" data-add="${esc(def.id)}" style="--wa-accent:${accentValue(def.accent)}">
          <span class="wa-menu-title">${esc(def.title || def.id)}${added ? ' <span class="muted small">· add another</span>' : ""}</span>
          ${def.description ? `<span class="muted small">${esc(def.description)}</span>` : ""}</button>`;
    };
    pop.el.innerHTML = `<div class="wa-pop-head"><b>Add widget</b></div>` + (groups.size
      ? [...groups].map(([group, list]) => `<div class="wa-menu-group"><h3>${esc(group)}</h3>${list.map(entry).join("")}</div>`).join("")
      : '<div class="muted small">No widgets are available here.</div>');
    pop.el.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-add]");
      if (!btn || btn.disabled) return;
      const def = registry.get(btn.dataset.add);
      closePopup();
      if (!def) return;
      mutate((items) => {
        let id = def.id;
        for (let n = 2; items.some((i) => i.id === id); n++) id = `${def.id}#${n}`;
        const size = def.defaultSize || {};
        items.push(normalizeItem({ id, cols: size.cols ?? 2, rows: size.rows ?? "auto" }));
      });
      const inst = instances.get(def.id);
      if (inst) {
        inst.el.classList.add("wa-new");
        setTimeout(() => inst.el.classList.remove("wa-new"), 1200);
        inst.el.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    });
    pop.position();
  }

  function moveItem(id, targetId, after, pinned) {
    mutate((items) => {
      const from = items.findIndex((i) => i.id === id);
      if (from < 0) return false;
      const [item] = items.splice(from, 1);
      if (pinned !== undefined) { item.pinned = pinned; if (pinned) item.collapsed = false; }
      const to = targetId ? items.findIndex((i) => i.id === targetId) : -1;
      if (to < 0) items.push(item);
      else items.splice(to + (after ? 1 : 0), 0, item);
    });
  }

  function clearMarks() {
    root.querySelectorAll(".wa-drop-before, .wa-drop-after").forEach((el) => el.classList.remove("wa-drop-before", "wa-drop-after"));
    footEl.classList.remove("wa-drop-end");
    Object.values(docks).forEach((d) => d.classList.remove("wa-drop-over"));
  }

  function startDrag(inst, e) {
    if (e.button !== 0) return;
    e.preventDefault();
    closePopup();
    const startX = e.clientX, startY = e.clientY;
    let active = false, ghost = null, drop = null;
    const begin = () => {
      active = true;
      dragging = true;
      inst.el.classList.add("wa-dragging");
      ghost = document.createElement("div");
      ghost.className = "wa-ghost";
      ghost.style.setProperty("--wa-accent", accentValue(inst.def.accent));
      ghost.textContent = inst.def.title || inst.def.id;
      document.body.appendChild(ghost);
      document.body.classList.add("wa-moving");
      updateDocks();
    };
    const move = (ev) => {
      if (!active) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 5) return;
        begin();
      }
      ghost.style.transform = `translate(${ev.clientX + 14}px, ${ev.clientY + 10}px)`;
      clearMarks();
      drop = null;
      const hit = document.elementFromPoint(ev.clientX, ev.clientY);
      if (!hit) return;
      const dock = hit.closest(".wa-dock");
      if (dock && dock.dataset.area === areaId) {
        dock.classList.add("wa-drop-over");
        drop = { pinned: dock.dataset.position };
        return;
      }
      const card = hit.closest(".wa-card");
      if (card && card.parentElement === grid && card !== inst.el) {
        const r = card.getBoundingClientRect();
        const fullRow = Math.abs(r.width - grid.getBoundingClientRect().width) < 2;
        const after = fullRow ? ev.clientY > r.top + r.height / 2 : ev.clientX > r.left + r.width / 2;
        card.classList.add(after ? "wa-drop-after" : "wa-drop-before");
        drop = { target: card.dataset.widget, after };
      } else if (!card && (hit === grid || footEl.contains(hit))) {
        footEl.classList.add("wa-drop-end");
        drop = { target: null, after: true };
      }
    };
    const finish = (commit) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", key);
      if (!active) return;
      clearMarks();
      ghost.remove();
      document.body.classList.remove("wa-moving");
      inst.el.classList.remove("wa-dragging");
      dragging = false;
      if (commit && drop) {
        if (drop.pinned) moveItem(inst.item.id, null, true, drop.pinned);
        else moveItem(inst.item.id, drop.target, drop.after, null);
      }
      updateDocks();
    };
    const up = () => finish(true);
    const cancel = () => finish(false);
    const key = (ev) => { if (ev.key === "Escape") finish(false); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", key);
  }

  function keyMove(inst, e) {
    const delta = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.key];
    if (!delta) return;
    e.preventDefault();
    const order = [...grid.children].map((el) => el.dataset.widget);
    const target = order[order.indexOf(inst.item.id) + delta];
    if (!target) return;
    moveItem(inst.item.id, target, delta > 0);
    inst.el.querySelector(".wa-grip").focus();
  }

  function shownRows(inst) {
    const rows = sizeOf(inst.item).rows;
    if (rows !== "auto") return rows;
    return clampInt((inst.el.getBoundingClientRect().height + GAP) / (UNIT + GAP), 1, 4);
  }

  function commitSize(inst, cols, rows) {
    mutate((items) => {
      const item = items.find((i) => i.id === inst.item.id);
      if (!item) return false;
      if (cols != null) item.cols = cols;
      if (rows != null) item.rows = rows;
    });
  }

  function keyResize(inst, e) {
    const n = columnCount(grid);
    const size = sizeOf(inst.item);
    const shownCols = Math.min(size.cols, n);
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const cols = clampInt(shownCols + (e.key === "ArrowRight" ? 1 : -1), 1, n);
      if (cols !== shownCols) commitSize(inst, cols, null);
    } else return;
    inst.el.querySelector(".wa-resize").focus();
  }

  function startResize(inst, e) {
    if (e.button !== 0 || inst.item.collapsed) return;
    e.preventDefault();
    e.stopPropagation();
    closePopup();
    const rect = inst.el.getBoundingClientRect();
    const n = columnCount(grid);
    const colWidth = (grid.getBoundingClientRect().width - (n - 1) * GAP) / n;
    const size = sizeOf(inst.item);
    const startCols = Math.min(size.cols, n);
    const startRows = shownRows(inst);
    let cols = startCols, rows = startRows;
    const badge = document.createElement("span");
    badge.className = "wa-size-badge";
    inst.el.appendChild(badge);
    inst.el.classList.add("wa-resizing");
    const preview = () => {
      const rowsChanged = rows !== startRows;
      applySize(inst, cols !== startCols ? cols : size.cols, rowsChanged ? rows : size.rows);
      badge.textContent = `${cols} column${cols === 1 ? "" : "s"}`;
    };
    preview();
    const move = (ev) => {
      cols = clampInt((ev.clientX - rect.left + GAP) / (colWidth + GAP), 1, n);
      preview();
    };
    const finish = (commit) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      badge.remove();
      inst.el.classList.remove("wa-resizing");
      const colsChanged = cols !== startCols, rowsChanged = rows !== startRows;
      if (commit && (colsChanged || rowsChanged)) commitSize(inst, colsChanged ? cols : null, rowsChanged ? rows : null);
      else applyChrome(inst);
    };
    const up = () => finish(true);
    const cancel = () => finish(false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
  }

  // A passive refresh is a clock tick: it leaves alone the widgets that do
  // not change with time and the one under the pointer, so hover cards and
  // drags inside a widget survive the tick.
  function refresh({ passive = false } = {}) {
    if (destroyed) return;
    const now = new Date();
    for (const inst of instances.values()) {
      if (inst.mode === "grid" && inst.item.collapsed) continue;
      if (isEditing(inst.body)) continue;
      if (passive && (inst.def.live === false || inst.el.matches(":hover"))) continue;
      renderBody(inst, now);
    }
  }

  root.querySelectorAll(".wa-add").forEach((btn) => btn.addEventListener("click", () => openAddMenu(btn)));
  const unsubscribe = onPrefs(() => {
    if (JSON.stringify(storedArea(areaId)) !== lastSeen) sync();
  });
  const onRegister = () => sync();
  registryListeners.add(onRegister);
  const onTheme = () => refresh();
  window.addEventListener("themechange", onTheme);

  const pinTicker = pinsOnly ? setInterval(() => refresh({ passive: true }), 30000) : 0;

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    if (pinTicker) clearInterval(pinTicker);
    if (openPopup && (root.contains(openPopup.anchor) || Object.values(docks).some((d) => d.contains(openPopup.anchor)))) closePopup();
    for (const inst of instances.values()) dispose(inst);
    instances.clear();
    unsubscribe();
    registryListeners.delete(onRegister);
    window.removeEventListener("themechange", onTheme);
    root.remove();
    Object.values(docks).forEach((d) => d.remove());
    if (scroller && !scroller.querySelector(".wa-dock")) scroller.classList.remove("wa-host");
  }

  sync();
  return { refresh, destroy };
}
