import { characterWidget, loadPage } from "./common.js";

characterWidget({
  id: "character.arcana",
  title: "Arcana",
  description: "The five card slots of the preset's skill build.",
  accent: "accent-2",
  defaultSize: { cols: 2, rows: "auto" },
  page: "arcana",
  pageTitle: "Arcana",
  async fill(box, target) {
    const mod = await loadPage("arcana");
    await mod.loadArcanaData();
    box.innerHTML = mod.arcanaSummaryHtml(target.cls, mod.linkedSkillBuildName(target.cls, target.preset)) || '<div class="muted small">No Arcana data.</div>';
  },
});
