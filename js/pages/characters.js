// Character page: identity and the planner summary. The build parts
// (skill bar, skills, Daevanion boards, equipment) arrive in later stages.

import { bp, characters, CLASSES, currentCharacter, renameCharacter, save, selectCharacter } from "../state.js";
import { escapeHtml, progressLine, askCharacter } from "../app.js";

export function mount(main) {
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
      <span class="muted">Set: ${escapeHtml(p.current_build_name)}</span>
      <span class="grow"></span>
      <button id="go-planner">Planner</button><button id="go-timers">Timers</button>
    </div>
    <div class="grid cols-3">
      <div class="card stack"><h3>Planner</h3><div class="accent">${odyle || "—"}</div><div>${progress || "No checklist yet"}</div>
        <div class="muted small">Tick tasks on the Planner page; Odyle energy counts up by itself.</div></div>
      <div class="card stack"><h3>Builds</h3><div>${entry.builds.map((b) => escapeHtml(b)).join(" · ")}</div>
        <div class="muted small">Equipment, skills, Daevanion boards and the skill bar are coming in the next stages of the web version. Use the desktop app for them meanwhile; profiles can be exchanged with Export / Import.</div></div>
    </div>`;
  main.querySelector("#name-input").addEventListener("change", (e) => renameCharacter(entry, e.target.value.trim()));
  main.querySelector("#class-select").addEventListener("change", (e) => {
    // Changing the class moves to that class's first set (a new character per class).
    const chosen = e.target.value;
    const p2 = bp();
    const key = chosen.toLowerCase();
    p2.equip_builds_data[key] = p2.equip_builds_data[key] || { Default: { equipped: {}, substats: {}, enchant: {}, philosopher_stone: {}, priority: {}, priority_progress: {} } };
    selectCharacter(chosen, Object.keys(p2.equip_builds_data[key])[0]);
    mount(main);
  });
  main.querySelector("#go-planner").addEventListener("click", () => { location.hash = "planner"; });
  main.querySelector("#go-timers").addEventListener("click", () => { location.hash = "timers"; });
}

export function unmount() {}
