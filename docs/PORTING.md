# Porting the desktop Armory to the web — contract for every page

The desktop app is `C:\repos\AION2\Aion2-TM-DesktopApp` (PySide6). Its Armory
lives in `ItemDatabase/app.py` (class `LoadoutWindow`, ~25 000 lines) with the
Qt-free maths in `ItemDatabase/armory_engine/*.py` and tests in `tests/`.
This site re-creates it feature for feature. Read the Python before writing
JS: the desktop is the specification, including its texts and layouts.

## Ground rules

- Plain ES modules, no bundler, no framework, no npm dependencies. Serve the
  folder with `python -m http.server` to run it.
- One page = one module in `js/pages/<name>.js` exporting `mount(main)` and
  `unmount()`. `mount` renders into the given element and wires events;
  `unmount` clears timers. Pages re-render themselves with their own
  `draw()`; the sidebar re-renders on every `save()`.
- Engine maths = one module in `js/engine/<name>.js`, a 1:1 port of the
  Python module of the same name, pure functions, no DOM. Port the Python
  tests of that module into `tests/<name>.test.mjs` (`node --test tests/`,
  Node is at `C:\Program Files\nodejs\node.exe`). Same inputs → same outputs
  as Python; the golden fixtures in the desktop `tests/` are the oracle.
- State: `js/state.js`. `bp()` returns the profile's `build_planner` object —
  the SAME dict the desktop saves (`ItemDatabase/armory_engine/model.py`
  `BuildState` lists every key; `LoadoutWindow.get_persistable_state` /
  `apply_persisted_state` show the shapes). Read and write those keys with
  the desktop's exact names and shapes, call `save()` after a change, and
  never invent a parallel schema: a profile exported here must load in the
  desktop app and vice versa.
- Current character = `bp().character_class` (capitalised, e.g. "Spiritmaster")
  + `bp().current_build_name` (its equip set). Skill builds hang off
  `skill_builds_data[class_lower][build_name]`, Daevanion sets off
  `daevanion_builds_data[class_lower][set_name]`, linked from the equip set via
  `linked_skill_build` / `linked_daevanion_build` (see
  `_sync_daevanion_build_to_equip_build`, `_load_current_equip_build_state`).
- Data: everything from `ItemDatabase/data/*.json` is in `data/`, every
  image folder from `ItemDatabase/assets/` is in `assets/`. Item icons that
  the desktop downloads at runtime are loaded from their original URLs
  (`item.image`). Fetch JSON once, cache in the module.
- Look: `css/app.css` tokens (`--accent`, `--warn`, `--muted`, `--surface`,
  `--border`, …) and the existing components (`.card`, `.row`, `.grid`,
  `button.active`, `h3` section headers). Match the desktop's layout (see its
  tab code) rather than inventing a new one; dark theme only. Add page CSS
  to `css/app.css` under a `/* <page> */` comment.
- Texts: English only, taken from `core/translations.py` (`arm_*` keys of the
  `en` block) so both apps read the same.
- Register the page in `js/app.js` `PAGES` and, if it belongs to a character
  section, link it from `js/pages/characters.js` (section header "Open …"
  button) like the desktop's Characters page does.
- Do not run git commands; the integrator commits. Do not edit files owned by
  another page except `js/app.js` (PAGES entry) and `css/app.css` (append).
- Verify in a browser: `C:\Users\adria\AppData\Local\Temp\claude\c--repos-AION2-Aion2-TM-DesktopApp\f4af1588-bcf0-484b-9585-dc411d067486\scratchpad\web_shot.py`
  shows how to drive the site offscreen with QtWebEngine from
  `C:\repos\AION2\Aion2-TM-DesktopApp\.python\python.exe` (serve on a port,
  load `#<page>`, `runJavaScript`, `grab()` screenshots). Copy and adapt it;
  a page is done when it renders with no console errors and its main
  interactions work in that harness.

## Pages and their desktop sources

| page | desktop (app.py) | engine | data |
|---|---|---|---|
| characters (home) | `_build_summary_tab`, `_refresh_summary*`, `_character_roster_*` | – | – |
| skills (Skill Planner) | `_build_skill_planner_tab`, `_build_skill_description_card`, `_skill_card_specs_html`, `_on_skill_level_*`, `_recompute_skill_bonus`, arcana wish | `arcana.py` (skill bonus) | `skills_all.json`, `assets/skill_icons`, `assets/skill_spec_icons` |
| layout (Skill Layout) | `_build_skill_layout_tab`, `_SkillLayoutSlot`, `_skill_layout_*`, `_render_skill_layout` | – | same |
| daevanion | `_build_daevanion_board_tab`, `DaevanionBoardCanvas`, `_daevanion_*` | `daevanion.py` (`_daevanion_plan_route`, reachability, costs) | `daevanion_boards_s.json`, `daevanion_boards_a.json`, `assets/daevanion_nodes` |
| equipment | `_build_weapon_armor_column`, item picker (`_open_item_picker`), `equip_detail_widget`, stat panel, gearscore, EQ priority, Build compare | `enchant.py`, `stats.py`, `substats.py`, `score.py`, `recommend.py`, `explain.py` | `items_all.json`, `dungeon_sets.json`, `stat_priority_options.json`, `shop_items.json`, `data/details/*` (per-item details, 43 MB — load per item from the desktop's cache URL pattern or bundle) |
| arcana | `_build_arcana_tab`, `_refresh_arcana_cards`, calculator | `arcana.py` | `arcana_info.json`, `arcana_class_skills.json`, `assets/arcana_icons`, `assets/Arcana_Set_background` |
| pantheon | `_build_pantheon_tab` | – | `pantheon_items.json` |
| genius (Genius Insight) | `_build_genius_insight_tab` | – | – |
| export | `_daevanion_on_export`, `_daevanion_render_board`, `_daevanion_render_skills`, `_render_skill_layout` | – | – |
