// Character page (home): identity, planner summary, and the build sections
// with a button to the page that edits each — like the desktop's Characters
// page. Sections come from the other page modules; one that is missing or
// broken only hides its own section.

import { bp, CLASSES, currentCharacter, renameCharacter, selectCharacter } from "../state.js";
import { escapeHtml, progressLine, askCharacter, navigate } from "../app.js";

let root = null;
let widgets = [];

const SECTIONS = [
  { key: "layout", title: "Skill layout", page: "layout", pageTitle: "Skill Layout" },
  { key: "skills", title: "Skills & specializations", page: "skills", pageTitle: "Skill Planner" },
  { key: "daevanion", title: "Daevanion boards", page: "daevanion", pageTitle: "Daevanion Board" },
  { key: "equipment", title: "Equipment", page: "equipment", pageTitle: "Equipment" },
];

async function loadModule(name) {
  try { return await import(`./${name}.js`); } catch (err) { console.warn(`${name} section unavailable:`, err.message); return null; }
}

function sectionShell(section) {
  return `<section class="card stack char-section" data-section="${section.key}">
    <div class="row"><h3>${section.title}</h3><button data-open="${section.page}">Open ${section.pageTitle}</button><span class="grow"></span><span class="muted small section-note"></span></div>
    <div class="section-body"><span class="muted small">Loading…</span></div>
  </section>`;
}

async function fillLayout(body, entry) {
  const mod = await loadModule("layout");
  if (!mod || !mod.skillBarWidget) { body.innerHTML = '<span class="muted small">Not available.</span>'; return; }
  const widget = mod.skillBarWidget(entry.class, null, { interactive: true });
  body.innerHTML = "";
  body.appendChild(widget);
  widgets.push(widget);
}

async function fillSkills(body, entry) {
  const mod = await loadModule("skills");
  const layout = await loadModule("layout");
  if (!mod || !mod.skillCardsHtml) { body.innerHTML = '<span class="muted small">Not available.</span>'; return; }
  if (mod.ready) await mod.ready();
  body.innerHTML = mod.skillCardsHtml(entry.class, null, { columns: 3 }) || '<span class="muted small">No skills for this class.</span>';
  if (layout && layout.wireSkillCardDrag) layout.wireSkillCardDrag(body);
  if (layout && layout.makeRemoveDropZone) layout.makeRemoveDropZone(body, entry.class, null);
}

async function fillDaevanion(body, entry) {
  const mod = await loadModule("daevanion");
  if (!mod || !mod.boardsInUse || !mod.renderBoard) { body.innerHTML = '<span class="muted small">Not available.</span>'; return; }
  await mod.prepare(entry.class);
  const variant = mod.variantData();
  const boards = mod.boardsInUse(entry.class);
  if (!boards || !boards.length) { body.innerHTML = '<span class="muted small">No Daevanion nodes taken yet.</span>'; return; }
  body.innerHTML = "";
  const row = document.createElement("div");
  row.className = "boards-row";
  for (const item of boards) {
    const col = document.createElement("div");
    col.className = "stack";
    col.innerHTML = `<div class="accent small">${escapeHtml(item.board.name)} · ${item.spent} points</div>`;
    const canvas = mod.renderBoard(null, variant, item.board, item.activeSet, { side: 520 });
    canvas.style.width = "100%"; canvas.style.maxWidth = "520px"; canvas.style.height = "auto";
    canvas.addEventListener("mousemove", (e) => {
      const rect = canvas.getBoundingClientRect();
      const node = mod.hitTest(canvas, e.clientX - rect.left, e.clientY - rect.top);
      if (node && node.g !== "empty") mod.showTooltip(node, { board: item.board, activeSet: item.activeSet, x: e.clientX, y: e.clientY });
      else mod.hideTooltip();
    });
    canvas.addEventListener("mouseleave", () => mod.hideTooltip());
    col.appendChild(canvas);
    row.appendChild(col);
  }
  body.appendChild(row);
}

async function fillEquipment(body, entry) {
  const mod = await loadModule("equipment");
  if (!mod || !mod.equipmentSummaryHtml) { body.innerHTML = '<span class="muted small">Not available.</span>'; return; }
  if (mod.ready) await mod.ready();
  body.innerHTML = await mod.equipmentSummaryHtml(entry.class, bp().current_build_name);
}

const FILL = { layout: fillLayout, skills: fillSkills, daevanion: fillDaevanion, equipment: fillEquipment };

export async function mount(main) {
  root = main;
  const entry = currentCharacter();
  const p = bp();
  if (!entry) {
    main.innerHTML = `<div class="card stack"><h2>No character yet</h2>
      <div class="muted">Add one with the button in the sidebar, or import your desktop profile.</div>
      <div><button id="first-add">Add character</button></div></div>`;
    main.querySelector("#first-add").addEventListener("click", askCharacter);
    return;
  }
  const [odyle, progress] = progressLine(entry.name);
  const cls = entry.class[0].toUpperCase() + entry.class.slice(1);
  main.innerHTML = `
    <div class="row" style="margin-bottom:12px">
      <select id="class-select">${CLASSES.map((c) => `<option ${c === cls ? "selected" : ""}>${c}</option>`).join("")}</select>
      <input id="name-input" type="text" placeholder="Character name" value="${escapeHtml(entry.name)}" style="width:180px">
      <span class="muted small">Set: ${escapeHtml(p.current_build_name)}${odyle ? ` · ${odyle}` : ""}${progress ? ` · ${progress}` : ""}</span>
      <span class="grow"></span>
      ${["equipment", "arcana", "pantheon", "genius"].map((pg) => `<button data-open="${pg}">${{ equipment: "Equipment", arcana: "Arcana", pantheon: "Pantheon", genius: "Genius Insight" }[pg]}</button>`).join("")}
    </div>
    <div class="stack" style="gap:12px">${SECTIONS.map(sectionShell).join("")}</div>`;
  main.querySelector("#name-input").addEventListener("change", (e) => renameCharacter(entry, e.target.value.trim()));
  main.querySelector("#class-select").addEventListener("change", (e) => {
    const chosen = e.target.value;
    const key = chosen.toLowerCase();
    const p2 = bp();
    p2.equip_builds_data[key] = p2.equip_builds_data[key] || { Default: { equipped: {}, substats: {}, enchant: {}, philosopher_stone: {}, priority: {}, priority_progress: {} } };
    selectCharacter(chosen, Object.keys(p2.equip_builds_data[key])[0]);
    unmount(); mount(main);
  });
  main.querySelectorAll("[data-open]").forEach((b) => b.addEventListener("click", () => navigate(b.dataset.open)));
  const mine = root;
  await Promise.all(SECTIONS.map(async (section) => {
    const body = main.querySelector(`[data-section="${section.key}"] .section-body`);
    try { await FILL[section.key](body, entry); } catch (err) { console.error(err); body.innerHTML = `<span class="muted small">Could not load: ${escapeHtml(err.message)}</span>`; }
    if (root !== mine) return;
  }));
}

export function unmount() {
  for (const w of widgets) if (w.destroy) w.destroy();
  widgets = [];
  root = null;
}
