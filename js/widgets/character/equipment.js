import { characterWidget, loadPage } from "./common.js";

characterWidget({
  id: "character.equipment",
  title: "Equipment",
  description: "Equipped items with enchant levels and the GearScore.",
  accent: "warn",
  defaultSize: { cols: 2, rows: "auto" },
  page: "equipment",
  pageTitle: "Equipment",
  async fill(box, target) {
    const mod = await loadPage("equipment");
    await mod.ready();
    box.innerHTML = mod.equipmentSummaryHtml(target.cls, target.preset) || '<div class="muted small">No equipment yet.</div>';
  },
});
