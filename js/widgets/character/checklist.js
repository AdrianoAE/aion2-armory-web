import { characterWidget, escapeHtml, loadPage } from "./common.js";
import { bp, plannerCharacterNamed, save } from "../../state.js";
import { KIND_TITLES, characterTasks, durationText, isTaskDone, nextReset } from "../../engine/planner.js";

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
    box.innerHTML = `<div class="cw-kinds">${groups || '<div class="muted small">No character tasks.</div>'}</div><div class="cw-task-foot"><button type="button" class="cw-link" data-choose>Choose tasks…</button></div>`;
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
