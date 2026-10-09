import { characterWidget, loadPage } from "./common.js";

const MAX_SIDE = 520;

characterWidget({
  id: "character.daevanion",
  title: "Daevanion boards",
  description: "One deity board at a time with tabs; drag the corner to resize the board.",
  accent: "secondary",
  defaultSize: { cols: 2, rows: "auto" },
  page: "daevanion",
  pageTitle: "Daevanion Board",
  async fill(box, target, ctx, el) {
    const mod = await loadPage("daevanion");
    await mod.prepare(target.cls);
    const style = getComputedStyle(el);
    const room = el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const widget = mod.boardTabsWidget(target.cls, { side: room > 0 ? Math.min(MAX_SIDE, Math.floor(room)) : MAX_SIDE, preset: target.preset });
    box.appendChild(widget);
    return () => widget.destroy();
  },
});
