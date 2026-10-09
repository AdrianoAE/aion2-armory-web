# Architecture

Plain ES modules served as static files. No bundler, no framework, no npm
dependencies; GitHub Pages serves the repository as it is.

```
index.html          shell markup: sidebar, #main, stylesheets, early theme
js/app.js           router, sidebar, profile import/export, theme startup
js/state.js         the profile (game data) and its change listeners
js/ui.js            per-browser UI preferences
js/theme.js         System / Dark / Light
js/widgets.js       widget registry and widget areas
js/roster.js        sidebar character roster
js/builds.js        builds and presets model
js/pages/*.js       one module per page
js/widgets/<page>/  widgets registered by a page
js/engine/*.js      pure maths, no DOM, covered by tests/
css/app.css         tokens (both themes) and shared components
css/<page>.css      page styles
data/               bundled game data and feed fallbacks
assets/             icons and images
```

## Shell and routing

`js/app.js` owns the sidebar and `#main`. Routes are hash routes
(`#timers`, `#diff/<class>/<a>/<b>`); the first path segment picks an entry
of `PAGES`:

```js
const PAGES = {
  timers: { title: "Timers", desc: "…", color: "--warn", icon: "<svg…>", load: () => import("./pages/timers.js") },
  …
};
```

Pages load on first use, so a page that fails to load only breaks itself.
A page module exports `mount(host)` and `unmount()`: `mount` renders into
the element it is given and wires its events, `unmount` stops its timers
and destroys its widget areas. On every route change the shell unmounts the
current page, clears `#main` and mounts the next one. Pages under the
character (Skill Planner, Equipment, Build diff, …) get a "Back to
Characters" row; Dashboard, Timers, Checklist, Character and Settings do
not.

The home page (empty hash or unknown route) is the Dashboard once the user
has saved a dashboard with at least one widget, otherwise the Character
page. `#planner` is an old name of `#checklist` and redirects there.

The sidebar lists the Tools (Dashboard, Checklist, Timers: `TOOLS` in
`app.js`, each with an icon and an accent colour from `PAGES`), the roster
(`renderRoster(page)` from `js/roster.js`), Add character, Export images,
and a footer with the Export / Import profile links and the Settings
button. It re-renders after every profile `save()`.

## Profile and preferences

Two stores, both in `localStorage`, both read and written inside
`try/catch` so blocked storage only means nothing persists.

| | profile — `js/state.js` | preferences — `js/ui.js` |
|---|---|---|
| key | `aion2-armory-profile` | `aion2-armory-ui` |
| holds | game data: characters, builds, presets, checklist, Odyle, tracked bosses | theme, widget layouts, alert and timer options |
| travels | yes, Export / Import profile | no, this browser only |
| API | `bp()`, `save()`, `onChange(fn)` | `prefs()`, `setPref("a.b", value)`, `onPrefs(fn)` |

`bp()` returns the `build_planner` object with defaults merged in; change
it and call `save()`. The key names and shapes stay compatible with older
Armory profile files, so those import unchanged.

`prefs()` returns the preferences with defaults merged in (`theme`,
`areas`, `alerts`, `timers`, `dashboard`). `setPref(path, value)` writes
one value (`undefined` deletes it), persists and calls every `onPrefs`
listener. A change made in another tab arrives through the `storage`
event and notifies the listeners too.

## Theme

Every colour is a CSS custom property on `:root` (dark) and
`:root[data-theme="light"]` in `css/app.css`: surfaces (`--bg`,
`--surface`, `--overlay`, `--border`, `--border-soft`), text (`--fg`,
`--muted`), `--accent`, `--accent-soft`, `--on-accent`, `--accent-2`,
states (`--warn`, `--danger`, `--ok`, `--success`, `--info`,
`--secondary`), game accents (`--elyos`, `--asmos`, `--daily`, `--weekly`,
`--portals`, `--class-<class>` for the eight classes), canvas helpers
(`--track`, `--grid-line`) and `--shadow`, `--backdrop`, `--hover`.
Canvas drawing reads them with `getComputedStyle` at draw time.

`applyTheme(name)` from `js/theme.js` sets `data-theme` on `<html>`;
"system" follows `prefers-color-scheme` and keeps following it. It fires
a `themechange` window event so canvases can redraw. A small inline script
in `index.html` sets the theme before the stylesheets apply, so a light
visit does not flash dark.

Shared accent components: `.tag` chips (`.tag.daily`, `.tag.elyos`,
`.tag.class-cleric`, …), `.class-<class>` (sets `--class-color`),
`button.primary`, `button.link`, `button.danger`.

## Widgets

A widget is a card that can live in any widget area: the Dashboard, the
Timers page, the Character page. Pages register their widgets when their
module loads; the Dashboard imports those modules so every widget is
available there.

```js
import { registerWidget, mountArea, widgetSettings, setWidgetSetting } from "./widgets.js";

registerWidget({
  id: "timers.tracked",                 // "<page>.<name>", one instance per area
  title: "Tracked bosses",
  group: "Timers",                      // heading in the Add widget menu
  description: "…",                     // optional, shown in the Add widget menu
  accent: "warn",                       // token name (or "--token", or a colour) for the header stripe
  defaultSize: { cols: 2, rows: 1 },    // cols 1..4, rows 1..4 or "auto"
  live: true,                           // false: clock ticks skip it (it only changes with the profile)
  settings: [                           // the gear opens a form built from this
    { key: "hours", label: "Look ahead", type: "select", options: [[1, "1 h"], [2, "2 h"]], default: 1 },
    { key: "onlyArtwork", label: "Only Artwork bosses", type: "checkbox", default: true },
    { key: "bosses", label: "Bosses", type: "multiselect", options: () => [["id", "Name"]], default: [] },
    { key: "count", label: "Rows", type: "number", min: 1, max: 9, default: 3 },
    { key: "server", label: "Server", type: "text", default: "" },
  ],
  render(el, ctx) { … return cleanup; },   // ctx: settings, setSetting(key, value), now, refresh(), areaId, widgetId, pinned
  compact(el, ctx) { … },                  // optional one-line form for the pinned bars
});

const area = mountArea(container, "timers", {
  defaults: ["timers.timeline", "timers.tracked"],   // first-run layout (ids or { id, cols, rows, pinned })
  allowed: (id) => id.startsWith("timers."),         // what the Add widget menu offers
  empty: "<b>…</b> …",                               // optional HTML for the empty state
});
area.refresh();                    // re-render every widget body
area.refresh({ passive: true });   // clock tick: skips live: false widgets and the one under the pointer
area.destroy();                    // in unmount()
widgetSettings("timers", "timers.tracked");         // settings with defaults, outside render
setWidgetSetting("timers", "timers.tracked", "hours", 2);
```

`options` may be an array of `[value, label]` pairs (or plain values) or a
function returning one (or a promise of one). `render` may be async;
whatever cleanup it returns runs before the next render and on removal.
`ctx.refresh()` re-renders the whole area, `ctx.setSetting()` stores a
setting and re-renders that widget. A refresh never re-renders a widget
whose input has focus, and keeps each body's scroll position.

The layout is stored at `prefs().areas[areaId]`:

```js
{ items: [{ id, cols, rows, pinned: null | "top" | "bottom", collapsed, settings }] }
```

Item order is the grid order; pinned items show in their bar in the order
they were pinned (pinning moves an item to the end of the list). Until the
user changes something the area uses its `defaults` and stores nothing, so
a page can change its defaults later. Items whose widget is not registered
stay in the layout and appear once the widget registers.

Grid: CSS grid with 4 columns, 2 when the area is narrower than 1000 px
and 1 below 560 px (container queries, so the sidebar width counts). A row
unit is 136 px plus a 12 px gap; tracks are 4 px high so "auto" cards
(measured with a `ResizeObserver`) pack under shorter neighbours. Card
chrome: accent stripe, drag handle (pointer events, so touch works;
arrow keys move it too), settings gear, pin to top / bottom, collapse,
remove, and a corner resize handle that snaps to grid units (double-click:
automatic height; arrow keys resize). Dropping a card on a pinned bar pins
it. Pinned bars are sticky at the top and bottom of `#main`.

## Engines and tests

`js/engine/*.js` hold the game maths as pure functions without DOM access
(timers, field bosses, checklist resets and Odyle, Daevanion routes,
enchant, stats, substats, scores, recommendations, skills, arcana). Each
has Node tests in `tests/`, with golden fixtures in `tests/fixtures/`:

```
node --test tests/
```

## Live feeds

`.github/workflows/feeds.yml` mirrors shugo.gg's schedule and
aion2timers.com's per-server kill feeds every few minutes to the `data`
branch, because neither sends CORS headers. The pages read
`https://raw.githubusercontent.com/AdrianoAE/aion2-armory-web/data/…` and
fall back to the copies bundled in `data/`.

## Harness

Pages are checked in a real browser engine without a window: a short
PySide6 script serves the folder over HTTP, loads routes in a
`QWebEngineView`, runs JavaScript in the page, collects console messages
and saves screenshots. A page is done when it renders with zero console
errors and its main interactions work in the harness.

```python
import functools, http.server, os, sys, threading
from PySide6.QtCore import QUrl, QTimer, QEventLoop
from PySide6.QtWidgets import QApplication
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWebEngineCore import QWebEnginePage

ROOT, PORT = os.path.abspath("."), 8765

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass

server = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), functools.partial(Quiet, directory=ROOT))
threading.Thread(target=server.serve_forever, daemon=True).start()
app = QApplication(sys.argv)
messages = []

class Page(QWebEnginePage):
    def javaScriptConsoleMessage(self, level, message, line, source):
        messages.append(f"[{getattr(level, 'value', level)}] {source.split('/')[-1]}:{line} {message}")

view = QWebEngineView(); page = Page(view); view.setPage(page); view.resize(1600, 1000); view.show()

def wait(ms):
    loop = QEventLoop(); QTimer.singleShot(ms, loop.quit); loop.exec()

def load(url):
    loop = QEventLoop(); page.loadFinished.connect(loop.quit); page.load(QUrl(url)); loop.exec()
    page.loadFinished.disconnect(loop.quit); wait(1200)

def run_js(expr):
    loop = QEventLoop(); out = {}
    page.runJavaScript(f"JSON.stringify((() => {{ return ({expr}); }})())", lambda r: (out.update(v=r), loop.quit()))
    loop.exec(); return out.get("v")

load(f"http://127.0.0.1:{PORT}/#dashboard")
run_js("(location.hash = 'timers', true)"); wait(1000)
view.grab().save("timers.png")
print([m for m in messages if m.startswith("[2]")])   # level 2 = errors
server.shutdown()
```

Run it with
`QTWEBENGINE_CHROMIUM_FLAGS="--disable-gpu --disable-software-rasterizer" QT_QPA_PLATFORM=offscreen PYTHONIOENCODING=utf-8`.
Notes:

- `run_js` takes one expression; chain statements as `(a, b, true)`.
  An async expression returns before it finishes, so `wait()` after it.
- Navigate with `location.hash = '…'`; reload with `location.reload()`
  rather than calling `load()` on the same URL again.
- Modules imported from `run_js` must use the same URL as the app
  (`import(location.origin + '/js/state.js')`) to share its state, for
  example to seed characters with `addCharacter()` or to register test
  widgets with `registerWidget()`.
- The default `QWebEngineProfile` is off the record, so every run starts
  with empty `localStorage`.

## Timers data and alerts

The timers widgets share `js/widgets/timers/feed.js`: it loads the bundled schedule and boss data, polls the mirrored kill feed once a minute while a timers widget is mounted, and shows each feed's age. The mirror workflow keeps a server's previous file when its fetch fails, so an age is always honest. `scripts/fetch_boss_maps.py` adds `map`, `map_region`, `map_points` and `page` to each boss in `data/field_bosses.json` from its wikily.gg page.

Alert rules live in `js/widgets/alerts/core.js` as pure functions (tested by `tests/notify.test.mjs`); `js/notify.js` runs the ticker, sounds, toasts and browser notifications.

A widget id can carry an instance suffix (`character.summary#2`) so one area can show the same widget twice with different settings.

## Official import

`js/official.js` imports a character from aion2.plaync.com (sidebar
"Import from aion2.plaync.com", the Character page's "Sync…" button and
its ⋯ menu); `js/engine/official.js` holds the URLs and the mapping as pure
functions (tested by `tests/official.test.mjs`).

| step | endpoint |
|---|---|
| search | `https://api-search.plaync.com/aion2global/search/v2/character?keyword=&region=&localeInfo=en-US&size=40&page=1` |
| profile, class, boards | `https://aion2.plaync.com/api/character/info?lang=en-US&region=&characterId=&serverId=` |
| equipment, wings, skills | `…/api/character/equipment?…` (same parameters) |
| one item's rolled substats | `…/api/character/equipment/item?…&id=&enchantLevel=&slotPos=` |
| one Daevanion board | `…/api/character/daevanion/detail?…&boardId=` |

Regions are `eu`, `naw`, `nae`, `la` and `as`. Search names carry
`<strong>` tags and the character id comes percent-encoded; both are
cleaned before use. Item, skill, board and node ids are the Armory's own.
Slot names match ours except `Cape` (the Cloak) and `Belt` (no slot); the
wings come from `petwing.wing`. Requests run one at a time, 150 ms apart,
with two retries on relay timeouts; nothing is cached.

An import writes, for one preset: the equip set (`equipped`, `enchant` =
enchant + exceed level, `substats` matched against the item's options),
the linked skill build's `levels` (the site reports effective levels, so
the bonus levels of the boards opened in game are subtracted), the linked Build's `s:<boardId>` node lists for boards with
open nodes (every other board is a planned one and stays as it is), and
`official_characters["<class>|<name>"] = { region, serverId, serverName,
characterId, level, importedAt }`, which "Sync…" uses later. Skill layout,
specializations, Arcana, Genius Insight and Pantheon are not on the site
and stay as they are. A skill build or Build shared with another
character's preset is copied first so the other character keeps its own.

### Relay

Browsers on another origin get `403 Invalid CORS request` from the site,
so every call goes to `relay + encodeURIComponent(url)`. The relay prefix
is `prefs().official.relay`, edited in Settings → Official site; the
default is `https://api.allorigins.win/raw?url=`. Public relays are slow
and sometimes time out, so the Armory ships `docs/relay-worker.js`, a
Cloudflare Worker that relays only the character API and search, adds
`Access-Control-Allow-Origin: *` and sends a browser User-Agent and the
site's Referer. It takes `?url=` like allorigins, so the same prefix form
works. Deploying it takes about two minutes on the free plan:

- Dashboard: Workers & Pages → Create → Create Worker → name it (for
  example `aion2-relay`) → Deploy → Edit code → replace the code with
  `docs/relay-worker.js` → Deploy.
- Wrangler: `npm create cloudflare@latest aion2-relay -- --type hello-world`,
  replace `src/index.js` with `docs/relay-worker.js`, then
  `npx wrangler deploy`.

Then paste `https://aion2-relay.<account>.workers.dev/?url=` into
Settings → Official site → Relay URL and press Test.
