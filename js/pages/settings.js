// Settings: theme, widget layouts, profile export/import and, when the
// alerts module is present, its settings.

import { prefs, setPref } from "../ui.js";
import { exportProfile } from "../state.js";
import { escapeHtml, pickProfile } from "../app.js";
import { DEFAULT_RELAY, searchUrl } from "../engine/official.js";

const THEMES = [["system", "System", "Follows your device"], ["dark", "Dark", "Always dark"], ["light", "Light", "Always light"]];
const AREA_NAMES = { dashboard: "Dashboard", timers: "Timers", character: "Character", characters: "Character" };

let root = null;
let mounted = 0;

function areaName(id) {
  return AREA_NAMES[id] || id.charAt(0).toUpperCase() + id.slice(1);
}

function savedAreas() {
  return Object.entries(prefs().areas || {}).filter(([, area]) => area && Array.isArray(area.items));
}

function armed(button, label, action) {
  let timer = null;
  const idle = button.textContent;
  button.addEventListener("click", () => {
    if (!button.classList.contains("danger")) {
      button.classList.add("danger");
      button.textContent = label;
      timer = setTimeout(() => { button.classList.remove("danger"); button.textContent = idle; }, 4000);
      return;
    }
    clearTimeout(timer);
    action();
  });
}

function drawLayouts() {
  const box = root.querySelector("#layouts");
  const areas = savedAreas();
  box.innerHTML = areas.length
    ? `<div class="layout-list">${areas.map(([id, area]) => `<div class="row"><b>${escapeHtml(areaName(id))}</b>
        <span class="muted small">${area.items.length} widget${area.items.length === 1 ? "" : "s"}${area.items.some((i) => i.pinned) ? ", some pinned" : ""}</span>
        <span class="grow"></span><button type="button" data-reset-area="${escapeHtml(id)}">Reset</button></div>`).join("")}</div>
      <div class="row"><button type="button" id="reset-layouts">Reset widget layouts</button><span class="muted small">Every page goes back to its first-run widgets; the Dashboard starts empty.</span></div>`
    : `<div class="muted small">Every page shows its standard widgets. Rearranged, resized or pinned widgets are listed here so you can reset them.</div>`;
  box.querySelectorAll("[data-reset-area]").forEach((button) => armed(button, "Click again to reset", () => {
    const areas = { ...(prefs().areas || {}) };
    delete areas[button.dataset.resetArea];
    setPref("areas", areas);
    drawLayouts();
  }));
  const all = box.querySelector("#reset-layouts");
  if (all) armed(all, "Click again to reset every layout", () => { setPref("areas", {}); drawLayouts(); });
}

function relaySetting() {
  return String(((prefs().official || {}).relay) || "").trim() || DEFAULT_RELAY;
}

function wireRelay(main) {
  const input = main.querySelector("#official-relay");
  const status = main.querySelector("#official-relay-status");
  const store = () => {
    const value = input.value.trim();
    setPref("official.relay", value && value !== DEFAULT_RELAY ? value : undefined);
    input.value = relaySetting();
  };
  input.addEventListener("change", store);
  main.querySelector("#official-relay-reset").addEventListener("click", () => { input.value = ""; store(); status.textContent = ""; });
  main.querySelector("#official-relay-test").addEventListener("click", async (e) => {
    const button = e.currentTarget;
    store();
    button.disabled = true;
    status.className = "muted small";
    status.textContent = "Testing…";
    try {
      const { fetchViaRelay } = await import("../official.js");
      const json = await fetchViaRelay(searchUrl({ keyword: "a", size: 1 }));
      if (!Array.isArray(json.list)) throw new Error("The relay answered, but not with the site's search results.");
      status.className = "official-ok small";
      status.textContent = "The relay works.";
    } catch (err) {
      status.className = "official-bad small";
      status.textContent = err.message;
    } finally { button.disabled = false; }
  });
}

async function drawAlerts(seq) {
  let notify = null;
  try { notify = await import("../notify.js"); } catch (err) { return; }
  if (seq !== mounted || !root || !notify || typeof notify.renderAlertSettings !== "function") return;
  const section = document.createElement("section");
  section.className = "card";
  section.style.setProperty("--section-color", "var(--accent-2)");
  section.innerHTML = `<h2>Alerts</h2><div class="alert-settings"></div>`;
  root.querySelector(".settings").appendChild(section);
  await notify.renderAlertSettings(section.querySelector(".alert-settings"));
}

export async function mount(main) {
  const seq = ++mounted;
  root = main;
  const theme = prefs().theme || "system";
  main.innerHTML = `<div class="row page-head"><h1>Settings</h1><span class="muted small">Kept in this browser, separate from your profile.</span></div>
    <div class="settings stack">
      <section class="card">
        <h2>Theme</h2>
        <div class="choice-row" role="radiogroup" aria-label="Theme">${THEMES.map(([value, label, hint]) => `<label class="choice">
          <input type="radio" name="theme" value="${value}" ${value === theme ? "checked" : ""}><span class="swatch ${value}"></span>
          <span><b>${label}</b><br><span class="muted small">${hint}</span></span></label>`).join("")}</div>
      </section>
      <section class="card" style="--section-color: var(--warn)">
        <h2>Widget layouts</h2>
        <div id="layouts" class="stack"></div>
      </section>
      <section class="card" style="--section-color: var(--daily)">
        <h2>Profile</h2>
        <div class="muted small">Your characters, builds and checklist live in this browser. Export the profile to keep a copy or to move it to another browser; importing replaces the profile here.</div>
        <div class="row"><button type="button" id="settings-export">Export profile</button><button type="button" id="settings-import">Import profile</button></div>
      </section>
      <section class="card official-settings" style="--section-color: var(--info)">
        <h2>Official site</h2>
        <div class="muted small">Character imports from aion2.plaync.com go through a CORS relay; to run your own, deploy <a href="docs/relay-worker.js" target="_blank" rel="noopener">docs/relay-worker.js</a> as a free Cloudflare Worker and paste its URL ending in <code>?url=</code>.</div>
        <label class="stack small muted">Relay URL<input type="url" id="official-relay" spellcheck="false" placeholder="${escapeHtml(DEFAULT_RELAY)}" value="${escapeHtml(relaySetting())}"></label>
        <div class="row"><button type="button" id="official-relay-reset">Reset</button><button type="button" id="official-relay-test">Test</button><span class="muted small" id="official-relay-status"></span></div>
      </section>
    </div>`;
  main.querySelectorAll('input[name="theme"]').forEach((input) => input.addEventListener("change", () => { if (input.checked) setPref("theme", input.value); }));
  main.querySelector("#settings-export").addEventListener("click", exportProfile);
  main.querySelector("#settings-import").addEventListener("click", pickProfile);
  wireRelay(main);
  drawLayouts();
  await drawAlerts(seq);
}

export function unmount() {
  mounted += 1;
  root = null;
}
