import { characterWidget, loadPage } from "./common.js";

characterWidget({
  id: "character.genius",
  title: "Genius Insight",
  description: "Totals of the genius profile the preset counts.",
  accent: "ok",
  defaultSize: { cols: 2, rows: "auto" },
  page: "genius",
  pageTitle: "Genius Insight",
  async fill(box, target) {
    const mod = await loadPage("genius");
    const html = mod.geniusSummaryHtml(target.cls, target.preset);
    box.innerHTML = html.includes("genius-summary-row") ? html : `${html}<div class="muted small">No lines picked yet.</div>`;
  },
});
