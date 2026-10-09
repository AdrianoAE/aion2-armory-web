import { characterWidget, loadPage } from "./common.js";

const COLUMN_WIDTH = 230;
const MAX_COLUMNS = 6;

function plainText(html) {
  const div = document.createElement("div");
  div.innerHTML = String(html || "").replace(/<br\s*\/?>/gi, "\n");
  return div.textContent.replace(/\n{3,}/g, "\n\n").trim();
}

async function addTooltips(box, cls, skillBuild) {
  const engine = await import("../../engine/skills.js");
  const { bp } = await import("../../state.js");
  const context = engine.skillContext(bp(), cls, skillBuild);
  for (const card of box.querySelectorAll("[data-skill-drag]")) {
    const skill = engine.data.byId[card.dataset.skillDrag];
    if (!skill) continue;
    const level = context.effective(skill.id);
    const hint = card.getAttribute("draggable") === "true" ? "\n\nDrag onto the skill bar." : "";
    card.title = `${skill.name || ""} · Lv. ${level}\n${plainText(engine.describeSkill(skill, Math.max(1, level)))}${hint}`;
  }
}

characterWidget({
  id: "character.skills",
  title: "Skills & specializations",
  description: "Skill levels and specializations; drag a skill onto the skill bar.",
  accent: "accent",
  defaultSize: { cols: 4, rows: "auto" },
  page: "skills",
  pageTitle: "Skill Planner",
  settings: [
    { key: "columns", label: "Columns", type: "select", options: [["auto", "Automatic"], [2, "2"], [3, "3"], [4, "4"]], default: "auto" },
  ],
  async fill(box, target, ctx) {
    const [skills, layout] = await Promise.all([loadPage("skills"), loadPage("layout")]);
    await skills.ready();
    const draw = (columns) => {
      box.innerHTML = skills.skillCardsHtml(target.cls, target.skillBuild, { columns }) || '<div class="muted small">No skills for this class.</div>';
      layout.wireSkillCardDrag(box);
      addTooltips(box, target.cls, target.skillBuild).catch((err) => console.warn(err));
    };
    const chosen = Number(ctx.settings.columns);
    const fitting = () => Math.max(1, Math.min(MAX_COLUMNS, Math.floor(box.clientWidth / COLUMN_WIDTH)));
    let columns = chosen || 3;
    draw(columns);
    layout.makeRemoveDropZone(box, target.cls, target.skillBuild);
    if (chosen) return null;
    let frame = 0;
    const update = () => {
      if (!box.clientWidth) return;
      const next = fitting();
      if (next !== columns) { columns = next; draw(columns); }
    };
    const observer = new ResizeObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(update); });
    box.afterAttach = () => { update(); observer.observe(box); };
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  },
});
