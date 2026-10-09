import { characterWidget, loadPage } from "./common.js";

// The bar keeps its fixed slot size and scales down as a whole when the card is narrower.
function fitToWidth(box, content) {
  let natural = 0;
  const fit = () => {
    if (!box.isConnected) return;
    if (!natural) {
      content.style.zoom = "1";
      natural = content.offsetWidth;
      if (!natural) return;
    }
    const zoom = Math.min(1, box.clientWidth / natural);
    content.style.zoom = zoom >= 0.999 ? "" : zoom.toFixed(3);
  };
  let frame = 0;
  const observer = new ResizeObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(fit); });
  observer.observe(box);
  fit();
  return () => { cancelAnimationFrame(frame); observer.disconnect(); };
}

characterWidget({
  id: "character.layout",
  title: "Skill layout",
  description: "The skill bar and macro; drop skills here from the Skills widget.",
  accent: "info",
  defaultSize: { cols: 4, rows: "auto" },
  page: "layout",
  pageTitle: "Skill Layout",
  async fill(box, target) {
    const mod = await loadPage("layout");
    await mod.ready();
    const bar = mod.skillBarWidget(target.cls, target.skillBuild, { interactive: true });
    box.appendChild(bar);
    let stopFit = () => {};
    box.afterAttach = () => { stopFit = fitToWidth(box, bar); };
    return () => { stopFit(); bar.destroy(); };
  },
});
