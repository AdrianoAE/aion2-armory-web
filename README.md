# Aion 2 Armory — web

The Aion 2 Armory as a website: https://adrianoae.github.io/aion2-armory-web/

No install, no account. Your profile is kept in the browser; **Export profile** saves it as the same JSON the desktop app uses, **Import profile** loads one.

## What works today

- **Timers** — event timeline and countdowns (Spacetime Rift, Shugo Festival, Dimensional Invasion, Abyss bosses, resets) in your local time zone, with region selection.
- **Field bosses** — per-server respawn state ("Spawned" / "Time left"), the bosses that drop yellow Artwork, a tracked list with "Done" marks, Artwork icons with their Pantheon effect.
- **Planner** — daily / weekly / Abyss-portal checklists per character and for the server, Odyle energy that counts up by itself (15 every 3 hours, max 840).
- **Characters** — the roster (drag to reorder, several builds per character) and, per character, the skill bar, skills with their specializations, the Daevanion boards in use and the equipment summary, each with a button to its editor.
- **Skill Planner** — skill levels, specializations, arcana and Daevanion bonuses.
- **Skill Layout** — the skill bar and macro, drag and drop from the skill list.
- **Daevanion Board** — every board of the class, route planner, filters, named sets.
- **Equipment** — item picker, enchant, substats, stat panel, GearScore, EQ priority, build compare.
- **Arcana**, **Pantheon**, **Genius Insight** — as in the desktop app.
- **Export images** — the Daevanion boards, skills and skill layout of the current character as PNGs in one zip, like the desktop export folder.

## How the live data gets here

Browsers cannot read shugo.gg's schedule or aion2timers.com's kill feed directly (no CORS headers). The workflow in `.github/workflows/feeds.yml` fetches them every few minutes and publishes the JSON on the `data` branch, which the site reads. The bundled copies in `data/` are the fallback.

## Development

Plain HTML/CSS/JS modules, no build step: serve the folder (`python -m http.server`) and open it. Engine logic is ported 1:1 from the desktop app's `armory_engine`; `node --test tests/*.test.mjs` runs the same checks the desktop's Python tests make.
