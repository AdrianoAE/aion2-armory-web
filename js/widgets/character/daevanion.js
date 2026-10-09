import { characterWidget, loadPage } from "./common.js";

characterWidget({
  id: "character.daevanion",
  title: "Daevanion boards",
  description: "One deity board at a time with tabs; the board fills the card.",
  accent: "secondary",
  defaultSize: { cols: 1, rows: "auto" },
  page: "daevanion",
  pageTitle: "Daevanion Board",
  async fill(box, target) {
    const mod = await loadPage("daevanion");
    await mod.prepare(target.cls);
    const widget = mod.boardTabsWidget(target.cls, { fit: true, preset: target.preset });
    box.appendChild(widget);
    return () => widget.destroy();
  },
});
