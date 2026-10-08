# Aion 2 Armory — web

The Aion 2 Armory as a website: https://adrianoae.github.io/aion2-armory-web/

No install, no account. Your profile is kept in the browser; **Export profile** saves it as the same JSON the desktop app uses, **Import profile** loads one.

## What works today

- **Timers** — event timeline and countdowns (Spacetime Rift, Shugo Festival, Dimensional Invasion, Abyss bosses, resets) in your local time zone, with region selection.
- **Field bosses** — per-server respawn state ("Spawned" / "Time left"), the bosses that drop yellow Artwork, a tracked list with "Done" marks, Artwork icons with their Pantheon effect.
- **Planner** — daily / weekly / Abyss-portal checklists per character and for the server, Odyle energy that counts up by itself (15 every 3 hours, max 840).
- **Characters** — the roster with their planner progress.

Coming in later stages: equipment, Daevanion boards with the route planner, skill planner, skill bar, exports.

## How the live data gets here

Browsers cannot read shugo.gg's schedule or aion2timers.com's kill feed directly (no CORS headers). The workflow in `.github/workflows/feeds.yml` fetches them every few minutes and publishes the JSON on the `data` branch, which the site reads. The bundled copies in `data/` are the fallback.

## Development

Plain HTML/CSS/JS modules, no build step: serve the folder (`python -m http.server`) and open it. Engine logic is ported 1:1 from the desktop app's `armory_engine`; `node --test tests/` runs the same checks the desktop's Python tests make.
