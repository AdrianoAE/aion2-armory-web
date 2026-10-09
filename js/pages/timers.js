// Timers: a widget area with the event timeline, the upcoming events, the
// tracked bosses and the boss list. Importing this module registers those
// widgets, which is how the Dashboard offers them too.

import { mountArea } from "../widgets.js";
import { onChange } from "../state.js";
import "../widgets/timers/timeline.js";
import "../widgets/timers/events.js";
import "../widgets/timers/tracked.js";
import "../widgets/timers/bosses.js";

const TICK_MS = 30 * 1000;
const DEFAULTS = [
  { id: "timers.timeline", cols: 4, rows: 2 },
  { id: "timers.tracked", cols: 2, rows: 2 },
  { id: "timers.events", cols: 2, rows: 2 },
  { id: "timers.bosses", cols: 4, rows: "auto" },
];

let area = null;
let ticker = null;
let stopWatching = null;

export function mount(main) {
  main.innerHTML = `<div class="row page-head"><h1>Timers</h1><span class="muted small">Events, resets and field boss spawns in your local time. Hover an event for its details; the gear on a widget holds its options.</span></div><div class="tm-area"></div>`;
  area = mountArea(main.querySelector(".tm-area"), "timers", {
    defaults: DEFAULTS,
    allowed: (id) => id.startsWith("timers."),
    empty: "<b>No timers on this page.</b> Add the event timeline, the upcoming events, your tracked bosses or the boss list.",
  });
  ticker = setInterval(() => area && area.refresh({ passive: true }), TICK_MS);
  stopWatching = onChange(() => area && area.refresh());
}

export function unmount() {
  clearInterval(ticker);
  ticker = null;
  if (stopWatching) stopWatching();
  stopWatching = null;
  if (area) area.destroy();
  area = null;
}
