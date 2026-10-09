# Aion 2 Armory

A planner and companion for Aion 2, as a website: https://adrianoae.github.io/aion2-armory-web/

No install, no account, works on desktop and phone browsers.

## What it does

- **Dashboard** — your own page: pick widgets from every tool (timers, characters, alerts), drag them into order, resize them from the corner, collapse them, and pin the ones you always want in view to a bar at the top or bottom of the page.
- **Timers** — event timeline and countdowns (Spacetime Rift, Shugo Festival, Dimensional Invasion, Abyss bosses, resets) in your local time zone, with region selection; field bosses per server with their respawn state, the bosses that drop yellow Artwork and a tracked list.
- **Checklist** — daily / weekly / Abyss-portal tasks per character and for the server, and Odyle energy that counts up by itself (15 every 3 hours, max 840).
- **Characters** — the roster (drag to reorder, several builds and presets per character) and, per character, the skill bar, skills with their specializations, the Daevanion boards and the equipment summary, each with a button to its editor.
- **Build diff** — two presets side by side: equipment, skills, layout, arcana, genius and the Daevanion nodes added or removed.
- **Skill Planner**, **Skill Layout**, **Daevanion Board**, **Equipment**, **Arcana**, **Pantheon**, **Genius Insight** — the build editors.
- **Export images** — the Daevanion boards, skills and skill layout of the current character as PNGs in one zip.
- **Settings** — System / Dark / Light theme, widget layout reset, profile export and import, alerts.

## Where your data lives

Everything stays in your browser's `localStorage`; nothing is sent anywhere.

- **Profile** (`aion2-armory-profile`) — characters, builds, presets, checklist ticks, Odyle energy, tracked bosses. **Export profile** saves it as a JSON file and **Import profile** loads one, so you can keep a backup or move to another browser or device. Older Armory profile files import as they are.
- **UI preferences** (`aion2-armory-ui`) — theme, widget layouts and alert settings. They belong to this browser and do not travel with the profile.

## How the live data gets here

Browsers cannot read shugo.gg's schedule or aion2timers.com's kill feed directly (no CORS headers). The workflow in `.github/workflows/feeds.yml` fetches them every few minutes and publishes the JSON on the `data` branch, which `raw.githubusercontent.com` serves with CORS and the site reads. GitHub runs scheduled workflows on a best-effort basis, so a mirror can be late; the Timers page shows how old the feed is. The copies bundled in `data/` are the fallback when the mirror cannot be reached.

## Development

Plain HTML, CSS and ES modules: no build step, no npm dependencies.

```
python -m http.server        # then open http://localhost:8000/
node --test tests/           # engine tests
```

`docs/ARCHITECTURE.md` describes the shell, the pages, the widget framework, preferences versus profile, the engines and the offscreen browser harness used to check pages.
