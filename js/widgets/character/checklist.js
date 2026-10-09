import { characterWidget, escapeHtml, loadPage } from "./common.js";
import { bp, plannerCharacterNamed, save } from "../../state.js";
import { KIND_TITLES, NIGHTMARE_MAX, ODYLE_MAX, characterTasks, durationText, isTaskDone, nextReset, nightmareCapText, nightmareEntries, odyleCapText, odyleEnergy } from "../../engine/planner.js";

const KINDS = ["daily", "weekly", "portals", "available"];

characterWidget({
  id: "character.checklist",
  title: "Checklist",
  description: "This character's daily, weekly and portal tasks, ready to tick.",
  accent: "daily",
  defaultSize: { cols: 1, rows: "auto" },
  live: true,
  page: "checklist",
  pageTitle: "Checklist",
  async fill(box, target, ctx) {
    const character = plannerCharacterNamed(target.name);
    const planner = bp().planner;
    if (!character) { box.innerHTML = '<div class="muted small">This character is not in the checklist yet.</div>'; return; }
    const now = (ctx && ctx.now) || new Date();
    const groups = KINDS.map((kind) => {
      const tasks = characterTasks(planner, character.id, kind);
      if (!tasks.length) return "";
      const reset = nextReset(kind, now);
      const done = kind === "available" ? null : tasks.filter((t) => isTaskDone(planner, character.id, t, now)).length;
      const rows = tasks.map((t) => {
        if (kind === "available") return `<div class="cw-task info"><span class="cw-task-info" title="Info only">i</span><span class="cw-task-name">${escapeHtml(t.name)}</span></div>`;
        const checked = isTaskDone(planner, character.id, t, now);
        return `<label class="cw-task${checked ? " done" : ""}"><input type="checkbox" data-task="${escapeHtml(t.id)}" ${checked ? "checked" : ""}><span class="cw-task-name">${escapeHtml(t.name)}</span></label>`;
      }).join("");
      const count = done == null ? "" : `<span class="cw-kind-count${done >= tasks.length ? " complete" : ""}">${done}/${tasks.length}</span>`;
      const resetText = reset ? `<span class="cw-kind-reset" title="Resets ${reset.toLocaleString()}">resets in ${durationText(reset - now)}</span>` : "";
      return `<div class="cw-kind cw-kind-${kind}"><div class="cw-kind-head"><span class="cw-kind-name">${KIND_TITLES[kind]}</span>${count}${resetText}</div>${rows}</div>`;
    }).join("");
    const odyle = planner.odyle[character.id];
    const cap = odyle ? odyleCapText(odyle, now) : "";
    const odyleLine = odyle ? `<div class="cw-odyle-line ${cap === "full" ? "full" : ""}"><span class="cw-odyle-label">Odyle</span><b>${odyleEnergy(Number(odyle.value), new Date(odyle.since), now)}/${ODYLE_MAX}</b>${cap ? `<span class="muted small">${cap}</span>` : ""}</div>` : "";
    const nightmare = (planner.nightmare || {})[character.id];
    const nightmareCap = nightmare ? nightmareCapText(nightmare, now) : "";
    const nightmareLine = nightmare ? `<div class="cw-odyle-line cw-nightmare-line ${nightmareCap === "full" ? "full" : ""}"><span class="cw-odyle-label">Nightmare</span><b>${nightmareEntries(nightmare.value, nightmare.since, now)}/${NIGHTMARE_MAX}</b>${nightmareCap ? `<span class="muted small">${nightmareCap}</span>` : ""}</div>` : "";
    box.innerHTML = `${odyleLine}${nightmareLine}<div class="cw-kinds">${groups || '<div class="muted small">No character tasks.</div>'}</div><div class="cw-task-foot"><button type="button" class="cw-link" data-choose>Choose tasks…</button></div>`;
    box.querySelector("[data-choose]").addEventListener("click", async () => {
      const page = await loadPage("checklist");
      await page.openCharacterTasksDialog(character.id, character.name);
    });
    box.addEventListener("change", (e) => {
      const input = e.target.closest("input[data-task]");
      if (!input) return;
      const key = `${character.id}:${input.dataset.task}`;
      if (input.checked) bp().planner.done[key] = new Date().toISOString();
      else delete bp().planner.done[key];
      save();
    });
  },
});
