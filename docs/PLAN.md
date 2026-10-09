# Armory web — dashboard, builds, alerts: the plan

Requested on 2026-10-09. Everything below ships; nothing is a placeholder.
The desktop app is no longer a reference for the UI: the web app is the
product. Profiles still import from the old desktop JSON (same keys), but
texts, docs and code no longer mention a desktop app.

## Phases and owners

Phase 1 runs in parallel; phase 2 starts when phase 1 is merged.

| phase | agent | owns (only these files) | delivers |
|---|---|---|---|
| 1 | **core** | `js/ui.js`, `js/widgets.js`, `js/theme.js`, `css/app.css`, `css/widgets.css`, `index.html`, `js/app.js`, `js/pages/dashboard.js`, `js/pages/settings.js`, `README.md`, `docs/ARCHITECTURE.md` | widget framework, dashboard page, settings page, themes + accent colours, no desktop references |
| 1 | **builds** | `js/state.js`, `js/roster.js`, `js/builds.js`, `js/pages/diff.js`, `css/builds.css`, `tests/builds.test.mjs`, `js/engine/skills.js` (levels per preset only) | full builds + presets model, roster UI, Diff page |
| 1 | **checklist** | `js/pages/checklist.js`, `js/engine/planner.js`, `css/checklist.css`, `tests/engine.test.mjs` (planner part) | renames, server-wide redesign, add button in the title, no "add character" |
| 1 | **fixes** | `js/pages/layout.js`, `js/pages/daevanion.js`, `css/layout.css`, `css/daevanion.css` | key editing UI, small drag image, tooltip closes, one board at a time with tabs, resizable |
| 2 | **timers** | `js/pages/timers.js`, `js/widgets/timers/*.js`, `js/engine/timers.js`, `js/engine/fieldboss.js`, `css/timers.css`, `data/field_bosses.json`, `assets/field_boss_maps/*`, `.github/workflows/feeds.yml` | timers as widgets: timeline with hover cards, tracked bosses (pinnable), boss list with faction colours, map button, customize popup, feed age |
| 2 | **notify** | `js/notify.js`, `js/widgets/alerts/*.js`, `js/pages/settings.js` (alerts section), `css/alerts.css`, `tests/notify.test.mjs` | alert sounds with lead time, custom timed events, Odyle cap and weekly reminders, browser notifications |
| 2 | **characters** | `js/pages/characters.js`, `js/widgets/character/*.js`, `css/characters.css` | character page as widgets (reorder, resize), one Daevanion board at a time, build/preset switcher, Diff link |

The integrator (the session) wires PAGES entries, links CSS, runs the
harness, and commits. Agents never run git. An agent that needs a change in
a file it does not own writes the exact change in its report.

## Contracts

### UI preferences — `js/ui.js` (core)

Per-browser settings, separate from the profile (the profile is game data
and travels with export/import; UI preferences do not).

```js
import { prefs, setPref, onPrefs } from "./ui.js";
prefs()                     // the object, defaults merged in
setPref("theme", "light")   // path "a.b.c" allowed; persists and notifies
onPrefs(fn)                 // fn(prefs) after every change; returns unsubscribe
```

Keys: `theme` ("system" | "dark" | "light"), `areas[areaId]` (widget
layout per area, see below), `alerts` (see notify), `timers` (region,
server, widget settings), `dashboard` (which widgets).

### Widgets — `js/widgets.js` (core)

A widget is a self-contained card that can live in any area (Dashboard,
Timers, Characters). The area persists order, size, pin and collapse.

```js
import { registerWidget, mountArea } from "./widgets.js";

registerWidget({
  id: "timers.tracked",                 // "<page>.<name>"
  title: "Tracked bosses",
  group: "Timers",                      // shown in the "Add widget" menu
  accent: "warn",                       // token name used for the header stripe
  defaultSize: { cols: 2, rows: 1 },    // grid units; cols 1..4, rows 1..4 (auto height when rows is "auto")
  settings: [                           // optional; the gear button opens a popup form built from this
    { key: "hours", label: "Look ahead", type: "select", options: [[1, "1 h"], [2, "2 h"]], default: 1 },
    { key: "onlyArtwork", label: "Only yellow Artwork bosses", type: "checkbox", default: true },
    { key: "bosses", label: "Bosses", type: "multiselect", options: () => [...], default: [] },
    { key: "server", label: "Server", type: "text", default: "" },
  ],
  render(el, ctx) {                     // fills el; returns a cleanup fn (or nothing)
    // ctx.settings (defaults merged), ctx.setSetting(key, value), ctx.now (Date), ctx.refresh()
  },
  compact(el, ctx) {                    // optional: the one-line form shown when pinned to a bar
  },
});

const area = mountArea(container, "timers", {
  defaults: ["timers.timeline", "timers.tracked", "timers.bosses"],   // first-run layout
  allowed: (id) => id.startsWith("timers."),                          // what the Add menu offers
});
area.refresh();   // re-renders every widget (call from onTick)
area.destroy();
```

Area features: drag handle to reorder; resize handle (persists cols/rows);
header buttons: settings (gear, only if `settings`), pin to top / pin to
bottom / unpin, collapse, remove; "Add widget" button at the end. Pinned
widgets render their `compact` form (or `render` if none) in a sticky bar
at the top or bottom of the page, in the order pinned. The grid is CSS
grid with 4 columns on wide screens, 2 on medium, 1 on phones.

Layout is stored at `prefs().areas[areaId] = { items: [{ id, cols, rows, pinned: null|"top"|"bottom", collapsed, settings }] }`.

### Theme — `js/theme.js` + `css/app.css` (core)

`applyTheme(prefs().theme)` sets `data-theme` on `<html>`; "system"
follows `prefers-color-scheme`. Every colour is a token in `:root` (dark)
and `:root[data-theme="light"]`. New accent tokens, used everywhere they
make sense (widget header stripes, roster class icons, checklist kinds,
boss factions, timeline event kinds):

```
--elyos: #60a5fa  --asmos: #a78bfa
--daily: #34d399  --weekly: #fbbf24  --portals: #f472b6
--class-gladiator … --class-chanter (8 tokens)
--accent-2: #f472b6  --success: #34d399  --info: #60a5fa
```

### Builds and presets — `js/builds.js` (builds)

Vocabulary, used in every text:

- **Character** = class + name.
- **Build** = a full plan for that character at one stage of progression:
  its Daevanion boards plus any number of presets. A Build is identified
  by its Daevanion set: `daevanion_builds_data[class][buildName]`.
- **Preset** = everything except the Daevanion boards: equipment set
  (`equip_builds_data[class][presetName]`, which links the skill build,
  genius build and its Build via `linked_daevanion_build`), skill levels,
  specializations, skill layout, arcana cards, genius profile.

```js
import { builds, currentBuild, currentPreset, newBuild, duplicateBuild, renameBuild, deleteBuild,
         newPreset, duplicatePreset, renamePreset, deletePreset, selectPreset, diff } from "./builds.js";
builds(classKey)            // [{ name, presets: [presetName], daevanionSet }]
diff(classKey, presetA, presetB) // { equipment: [...], skills: [...], layout: [...], arcana: [...], genius: [...], daevanion: { boards: [{ board, added: [nodeId], removed: [nodeId], spentA, spentB }] } }
```

Migration (in `bp()` defaults): skill levels and active specializations
move from the profile-wide `skill_levels` / `skill_active_specs` into
each skill build (`skill_builds_data[class][build].levels` /
`.specs`); the old keys stay as the fallback for builds without their own.
An imported old profile gets one Build per Daevanion set with its linked
equip sets as presets.

Roster row: character → Build tabs → preset chips; "New build",
"Duplicate build", "New preset", "Duplicate preset", "Diff…" in a row
menu. The Diff page (`#diff/<class>/<a>/<b>`) shows every section side
by side with added (green) / removed (red) / changed (amber), and the
Daevanion boards drawn with added nodes highlighted green and removed
ones red (`renderBoard` gains `added` and `removed` sets).

### Alerts — `js/notify.js` (notify)

```js
import { scheduleAlerts, alertSettings, playSound, SOUNDS } from "./notify.js";
```

Settings in `prefs().alerts`: `{ enabled, sound: "chime"|"bell"|"alarm"|"custom", customSoundUrl, leadMinutes, browser: bool,
timers: bool, trackedBosses: bool, customEvents: [{ id, name, at: ISO, repeat: "none"|"daily"|"weekly", leadMinutes }],
odyle: { enabled, percent: 90 }, weekly: { enabled, hoursBefore: 12 } }`.
Sounds are synthesized with WebAudio (no files), custom = a URL. A ticker
(every 15 s while the page is open) fires each alert once (fired keys kept
in `localStorage` with the occurrence time) and shows an in-page toast
plus a browser Notification when allowed. Odyle: "X characters reach the
cap within N hours". Weekly: "Weekly resets in N h, unchecked: Buy
Shop(H) → Special for …".

## Items and where they land

- Skill layout keys customizable — fixes (click a key label to edit; menu for mouse keys; "Reset keys").
- Widget order + space — core (framework) + characters (page as widgets).
- Daevanion one board at a time with tabs, resizable — fixes (page) + characters (section widget).
- Daevanion tooltip not closing when the pointer leaves the window — fixes.
- Skill layout drag image enormous — fixes (`setDragImage` with a 40 px canvas).
- Timers descriptions as hover cards — timers.
- Planner → Checklist — done by the integrator (route `checklist`, old `#planner` redirects); page texts — checklist.
- Pin tracked bosses top/bottom with next spawn — core (pin) + timers (`compact`).
- Colour accents — core (tokens) + every page uses them.
- "Buy Shop(H) → Special" — checklist (task label; task ids unchanged so ticks survive).
- Server-wide section redesign — checklist (one compact card: task list with checkboxes and reset countdown, no empty column).
- Presets + full builds + diff — builds.
- Map location button — timers (map image per boss zone; investigate wikily.gg / aion2timers for zone maps and bundle them under `assets/field_boss_maps/`, else link to the boss page).
- Alert sounds, custom timed events, Odyle/weekly reminders — notify.
- Elyos blue / Asmos purple — timers.
- Feed freshness — timers: show "updated N min ago" with a warning tint after 15 min; GitHub's 5-minute cron is best effort and often delayed, so the label must make the age obvious.
- Boss options → customize popup — timers (widget settings).
- Custom dashboard, system/dark/light theme — core.
- No desktop references — core (texts, README, docs) + every agent in its own files.
- Checklist "add character" removed, add button next to the title — checklist (characters come from the roster; the title row gets "Add task").
- Odyle cap / weekly reminders — notify.

## Verification

Each agent verifies its pages in the QtWebEngine harness (see
`docs/ARCHITECTURE.md`, "Harness") with zero console errors and takes
screenshots named `agent_<name>_*.png` in the scratchpad. Engine changes
come with Node tests (`node --test tests/<file>.test.mjs`).
