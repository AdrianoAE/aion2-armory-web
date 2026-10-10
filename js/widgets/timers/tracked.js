// timers.tracked: the bosses the player follows, soonest spawn first, with
// Done marks that clear themselves on the next spawn. The cards always sit in
// a single row that scrolls sideways.

import { registerWidget } from "../../widgets.js";
import { bossStatuses, isSoon, serverOptions, sortStatuses } from "../../engine/fieldboss.js";
import { adoptShared, bosses, bossFeed, esc, loadBosses, serverId, SHARED, sharedField, until, watch, feedStatus } from "./feed.js";
import { bossCardHtml, factionClass, feedLineHtml, isDone, wireBosses } from "./bosscard.js";

const SHARED_KEYS = ["server", "tracked"];

function bossOptions() {
  return loadBosses().then((list) => list.map((b) => [b.id, `${b.name} · ${b.faction === "asmo" ? "Asmodian" : "Elyos"} · ${b.zone}`]));
}

function trackedStatuses(ctx) {
  const list = bosses();
  if (!list) return null;
  const ids = new Set(SHARED.tracked.get());
  const now = ctx.now;
  let statuses = sortStatuses(bossStatuses(list.filter((b) => ids.has(b.id)), bossFeed(serverId()), now), "next", now);
  if (ctx.settings.onlySoon) {
    const horizon = Math.max(1, Number(ctx.settings.hours) || 1) * 3600000;
    statuses = statuses.filter((s) => isSoon(s, now, horizon));
  }
  return { all: ids.size, statuses: [...statuses.filter((s) => !isDone(s)), ...statuses.filter(isDone)] };
}

registerWidget({
  id: "timers.tracked",
  title: "Tracked bosses",
  group: "Timers",
  description: "The field bosses you follow, with Done marks; pin it to keep the next spawns in view.",
  accent: "accent-2",
  defaultSize: { cols: 2, rows: 2 },
  live: true,
  settings: [
    sharedField("server", { label: "Server", type: "select", options: serverOptions }),
    sharedField("tracked", { label: "Bosses", type: "multiselect", options: bossOptions }),
    { key: "onlySoon", label: "Only bosses spawning within the hours below", type: "checkbox", default: false },
    { key: "hours", label: "Hours ahead", type: "number", min: 1, max: 24, step: 1, default: 1 },
  ],
  render(el, ctx) {
    adoptShared(ctx, SHARED_KEYS);
    const unwatch = watch(ctx, { feed: true });
    const state = trackedStatuses(ctx);
    if (!state) {
      el.innerHTML = '<div class="muted small">Loading the bosses…</div>';
      return unwatch;
    }
    const { all, statuses } = state;
    const tracked = new Set(SHARED.tracked.get());
    let body;
    if (!all) body = '<div class="tm-empty">No bosses tracked yet. <button type="button" class="link" data-choose>Choose bosses</button> or star them in the boss list.</div>';
    else if (!statuses.length) body = `<div class="tm-empty">None of your ${all} tracked bosses spawns within ${Number(ctx.settings.hours) || 1} h.</div>`;
    else body = `<div class="tm-boss-row">${statuses.map((s) => bossCardHtml(s, { tracked: tracked.has(s.boss.id), showDone: true })).join("")}</div>`;
    el.innerHTML = `${feedLineHtml(serverId(), ctx.now)}${body}`;
    const unwire = wireBosses(el);
    const row = el.querySelector(".tm-boss-row");
    const onWheel = (e) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      const max = row.scrollWidth - row.clientWidth;
      if (max <= 0 || (e.deltaY < 0 && row.scrollLeft <= 0) || (e.deltaY > 0 && row.scrollLeft >= max - 1)) return;
      e.preventDefault();
      row.scrollLeft += e.deltaY;
    };
    if (row) row.addEventListener("wheel", onWheel, { passive: false });
    return () => { unwatch(); unwire(); if (row) row.removeEventListener("wheel", onWheel); };
  },
});

