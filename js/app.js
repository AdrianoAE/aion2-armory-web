// Shell: sidebar (Tools, Characters), hash router, profile import/export, theme.

import { bp, currentCharacter, exportProfile, importProfile, onChange, plannerCharacterNamed, renameCharacter, save } from "./state.js";
import { askCharacter, renderRoster } from "./roster.js";
import { ODYLE_MAX, isDone, odyleEnergy } from "./engine/planner.js";
import { prefs, onPrefs } from "./ui.js";
import { applyTheme } from "./theme.js";

const ICON = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

// Pages load on first use, so a page that fails to load only breaks itself.
const PAGES = {
  dashboard: { title: "Dashboard", desc: "Your own page of widgets from every tool", color: "--accent", icon: ICON('<rect x="3" y="3" width="8" height="10" rx="1.5"/><rect x="13" y="3" width="8" height="6" rx="1.5"/><rect x="13" y="11" width="8" height="10" rx="1.5"/><rect x="3" y="15" width="8" height="6" rx="1.5"/>'), load: () => import("./pages/dashboard.js") },
  character: { title: "Character", load: () => import("./pages/characters.js") },
  timers: { title: "Timers", desc: "Event timeline, field bosses and countdowns", color: "--warn", icon: ICON('<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9 2h6"/>'), load: () => import("./pages/timers.js") },
  checklist: { title: "Checklist", desc: "Daily, weekly and portal tasks, Odyle energy", color: "--daily", icon: ICON('<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M7.5 12.5l3 3 6-7"/>'), load: () => import("./pages/checklist.js") },
  settings: { title: "Settings", load: () => import("./pages/settings.js") },
  diff: { title: "Build diff", load: () => import("./pages/diff.js") },
  skills: { title: "Skill Planner", load: () => import("./pages/skills.js") },
  layout: { title: "Skill Layout", load: () => import("./pages/layout.js") },
  daevanion: { title: "Daevanion Board", load: () => import("./pages/daevanion.js") },
  equipment: { title: "Equipment", load: () => import("./pages/equipment.js") },
  arcana: { title: "Arcana", load: () => import("./pages/arcana.js") },
  pantheon: { title: "Pantheon", load: () => import("./pages/pantheon.js") },
  genius: { title: "Genius Insight", load: () => import("./pages/genius.js") },
};
const TOOLS = ["dashboard", "checklist", "timers"];
const NO_BACK_ROW = new Set(["dashboard", "settings", "timers", "checklist", "character"]);

let current = null;
let renderSeq = 0;

export function homePage() {
  const dashboard = (prefs().areas || {}).dashboard;
  return dashboard && Array.isArray(dashboard.items) && dashboard.items.length ? "dashboard" : "character";
}

export function route() {
  const hash = location.hash.slice(1);
  const [name] = hash.split("/");
  if (name === "planner") return "checklist";
  return PAGES[name] ? name : homePage();
}

export function navigate(name) {
  if (location.hash.slice(1) === name) render(); else location.hash = name;
}

async function render() {
  const name = route();
  const seq = ++renderSeq;
  if (current && current.module && current.module.unmount) current.module.unmount();
  current = PAGES[name];
  const main = document.getElementById("main");
  main.innerHTML = "";
  main.className = "";
  renderSidebar();
  let module;
  try {
    module = await current.load();
  } catch (err) {
    console.error(err);
    main.innerHTML = `<div class="card"><h2>${current.title}</h2><div class="muted">This page could not be loaded: ${escapeHtml(err.message)}</div></div>`;
    return;
  }
  if (seq !== renderSeq) return;
  current.module = module;
  main.innerHTML = NO_BACK_ROW.has(name) ? "" :
    `<div class="row" style="margin-bottom:10px"><button id="back-home">Back to Characters</button><h1>${current.title}</h1></div>`;
  const host = document.createElement("div");
  main.appendChild(host);
  const backBtn = main.querySelector("#back-home");
  if (backBtn) backBtn.addEventListener("click", () => navigate("character"));
  await module.mount(host);
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
  for (const key of TOOLS) {
    const tool = PAGES[key];
    const row = document.createElement("div");
    row.className = "card clickable side-row tool-row" + (page === key ? " current" : "");
    row.dataset.tool = key;
    row.style.setProperty("--tool-color", `var(${tool.color})`);
    row.innerHTML = `<span class="tool-icon">${tool.icon}</span><div class="grow"><div class="name">${tool.title}</div><div class="lines">${tool.desc}</div></div>`;
    row.addEventListener("click", () => navigate(key));
    tools.appendChild(row);
  }
  document.getElementById("open-settings").classList.toggle("current", page === "settings");
  renderRoster(page);
}

export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function pickProfile() {
  document.getElementById("import-file").click();
}

document.getElementById("add-character").addEventListener("click", askCharacter);
document.getElementById("export-profile").addEventListener("click", exportProfile);
document.getElementById("export-images").addEventListener("click", async (e) => {
  const button = e.currentTarget;
  if (!currentCharacter()) { alert("Add a character first."); return; }
  button.disabled = true;
  try {
    const { exportImages } = await import("./export.js");
    const count = await exportImages();
    button.textContent = `Exported ${count} images`;
    setTimeout(() => { button.textContent = "Export images"; }, 2500);
  } catch (err) {
    console.error(err);
    alert("Could not export the images: " + err.message);
  } finally { button.disabled = false; }
});
document.getElementById("import-profile").addEventListener("click", pickProfile);
document.getElementById("import-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try { await importProfile(file); } catch (err) { alert("Could not read that profile: " + err.message); }
  e.target.value = "";
  render();
});
document.getElementById("open-settings").addEventListener("click", () => navigate("settings"));
applyTheme(prefs().theme);
onPrefs((p) => applyTheme(p.theme));
window.addEventListener("hashchange", render);
onChange(renderSidebar);
bp();
render();
export { renameCharacter, save, askCharacter };
