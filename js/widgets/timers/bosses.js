// timers.bosses: every field boss of the chosen server, Elyos and
// Asmodians apart, spawned first and then by time left.

import { registerWidget } from "../../widgets.js";
import { FACTIONS, bossStatuses, dropsYellowArtwork, isSoon, serverOptions, sortStatuses } from "../../engine/fieldboss.js";
import { adoptShared, bosses, bossFeed, serverId, SHARED, sharedField, watch } from "./feed.js";
import { bossCardHtml, feedLineHtml, wireBosses } from "./bosscard.js";

const SORTS = [["next", "Next spawn"], ["name", "Name"], ["zone", "Zone"]];

registerWidget({
  id: "timers.bosses",
  title: "Field bosses",
  group: "Timers",
  description: "Every field boss of your server, Elyos and Asmodians, with spawn countdowns and map locations.",
  accent: "secondary",
  defaultSize: { cols: 4, rows: "auto" },
  live: true,
  settings: [
    sharedField("server", { label: "Server", type: "select", options: serverOptions }),
    sharedField("onlyArtwork", { label: "Only bosses that drop a yellow Artwork", type: "checkbox" }),
    { key: "hours", label: "Show bosses spawned or spawning within", type: "select",
      options: [[1, "1 hour"], [2, "2 hours"], [3, "3 hours"], [4, "4 hours"], [6, "6 hours"], [8, "8 hours"], [12, "12 hours"], [24, "24 hours"], [0, "Any time (all bosses)"]], default: 1 },
    { key: "sort", label: "Sort by", type: "select", options: SORTS, default: "next" },
  ],
  render(el, ctx) {
    adoptShared(ctx, ["server", "onlyArtwork"]);
    const unwatch = watch(ctx, { feed: true });
    const list = bosses();
    if (!list) {
      el.innerHTML = '<div class="muted small">Loading the bosses…</div>';
      return unwatch;
    }
    const now = ctx.now;
    const server = serverId();
    const feed = bossFeed(server);
    const pool = SHARED.onlyArtwork.get() ? list.filter(dropsYellowArtwork) : list;
    const every = bossStatuses(pool, feed, now);
    const hours = Number(ctx.settings.hours ?? 1);
    const showAll = ctx.settings.show === "all" || hours <= 0;
    const window = `${hours} h`;
    const shown = sortStatuses(showAll ? every : every.filter((s) => isSoon(s, now, hours * 3600 * 1000)), ctx.settings.sort, now);
    const tracked = new Set(SHARED.tracked.get());
    const groups = FACTIONS.map(([faction, label]) => {
      const items = shown.filter((s) => (s.boss.faction === "asmo" ? "asmo" : "elyos") === faction);
      const total = every.filter((s) => (s.boss.faction === "asmo" ? "asmo" : "elyos") === faction).length;
      const empty = !feed ? "" : showAll ? "No bosses." : `Nothing spawned or spawning within ${window}.`;
      return `<section class="tm-faction faction-${faction}">
        <h4 class="tm-faction-head"><span>${label}</span><span class="tm-faction-count">${items.length}${showAll ? "" : ` of ${total}`}</span></h4>
        ${items.length ? `<div class="tm-boss-grid">${items.map((s) => bossCardHtml(s, { tracked: tracked.has(s.boss.id) })).join("")}</div>` : `<div class="tm-empty">${empty}</div>`}
      </section>`;
    }).join("");
    el.innerHTML = `<div class="tm-list-head">${feedLineHtml(server, now)}
        <label class="tm-window small muted">Within <select data-hours>${[1, 2, 3, 4, 6, 8, 12, 24].map((h) => `<option value="${h}" ${!showAll && h === hours ? "selected" : ""}>${h} h</option>`).join("")}<option value="0" ${showAll ? "selected" : ""}>any time</option></select></label>
        <button type="button" class="tm-show-all" data-show-all aria-pressed="${showAll}">${showAll ? "Only the next hours" : `Show all (${every.length})`}</button></div>
      <div class="tm-factions">${groups}</div>`;
    el.querySelector("[data-show-all]").addEventListener("click", () => { if (showAll && hours <= 0) ctx.setSetting("hours", 1); ctx.setSetting("show", showAll ? undefined : "all"); });
    el.querySelector("[data-hours]").addEventListener("change", (e) => { ctx.setSetting("show", undefined); ctx.setSetting("hours", Number(e.target.value)); });
    const unwire = wireBosses(el);
    return () => { unwatch(); unwire(); };
  },
});
