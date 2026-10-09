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
    { key: "show", label: "Show", type: "select", options: [["soon", "Spawned or spawning within 1 h"], ["all", "All bosses"]], default: "soon" },
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
    const showAll = ctx.settings.show === "all";
    const shown = sortStatuses(showAll ? every : every.filter((s) => isSoon(s, now)), ctx.settings.sort, now);
    const tracked = new Set(SHARED.tracked.get());
    const groups = FACTIONS.map(([faction, label]) => {
      const items = shown.filter((s) => (s.boss.faction === "asmo" ? "asmo" : "elyos") === faction);
      const total = every.filter((s) => (s.boss.faction === "asmo" ? "asmo" : "elyos") === faction).length;
      const empty = !feed ? "" : showAll ? "No bosses." : "Nothing spawned or spawning within the hour.";
      return `<section class="tm-faction faction-${faction}">
        <h4 class="tm-faction-head"><span>${label}</span><span class="tm-faction-count">${items.length}${showAll ? "" : ` of ${total}`}</span></h4>
        ${items.length ? `<div class="tm-boss-grid">${items.map((s) => bossCardHtml(s, { tracked: tracked.has(s.boss.id) })).join("")}</div>` : `<div class="tm-empty">${empty}</div>`}
      </section>`;
    }).join("");
    el.innerHTML = `<div class="tm-list-head">${feedLineHtml(server, now)}
        <button type="button" class="tm-show-all" data-show-all aria-pressed="${showAll}">${showAll ? "Within 1 h only" : `Show all (${every.length})`}</button></div>
      <div class="tm-factions">${groups}</div>`;
    el.querySelector("[data-show-all]").addEventListener("click", () => ctx.setSetting("show", showAll ? "soon" : "all"));
    const unwire = wireBosses(el);
    return () => { unwatch(); unwire(); };
  },
});
