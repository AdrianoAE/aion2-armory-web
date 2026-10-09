// Dashboard: one widget area the player composes from every registered
// widget (timers, characters, alerts).

import { mountArea } from "../widgets.js";
import { onChange } from "../state.js";

const WIDGET_SOURCES = [() => import("./timers.js"), () => import("./characters.js"), () => import("../notify.js")];

let area = null;
let ticker = null;
let stopWatching = null;
let mounted = 0;

const EMPTY = `<div class="dash-empty-art" aria-hidden="true"><span style="--c:var(--warn)"></span><span style="--c:var(--daily)"></span><span style="--c:var(--accent-2)"></span><span style="--c:var(--info)"></span></div>
  <b>Build your own page.</b>
  <div>Add widgets from Timers, Characters and Alerts. Drag a widget by its handle to reorder it, pull its corner to resize it,
  and pin the ones you always want in view to the top or bottom of the page.</div>`;

export async function mount(main) {
  const seq = ++mounted;
  main.innerHTML = `<div class="row page-head"><h1>Dashboard</h1><span class="muted small">Everything you want to watch, on one page.</span></div><div class="dash-area"></div>`;
  await Promise.all(WIDGET_SOURCES.map((load) => load().catch(() => null)));
  if (seq !== mounted) return;
  area = mountArea(main.querySelector(".dash-area"), "dashboard", { defaults: [], allowed: () => true, empty: EMPTY });
  ticker = setInterval(() => area && area.refresh({ passive: true }), 5000);
  stopWatching = onChange(() => area && area.refresh());
}

export function unmount() {
  mounted += 1;
  clearInterval(ticker);
  ticker = null;
  if (stopWatching) stopWatching();
  stopWatching = null;
  if (area) area.destroy();
  area = null;
}
