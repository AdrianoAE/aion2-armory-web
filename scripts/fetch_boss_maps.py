"""Adds map images to data/field_bosses.json: each boss's wikily.gg page
leads with a map crop centred on the boss (saved as
assets/field_boss_maps/<bossId>.jpg) and embeds the zone's point map (the
whole region preview, saved once per region, plus the boss's spot on it).

    python -I scripts/fetch_boss_maps.py
"""

from __future__ import annotations

import base64
import html
import json
import re
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "field_bosses.json"
MAPS = ROOT / "assets" / "field_boss_maps"
WIKILY = "https://wikily.gg"
PROXY = "https://img.wikily.gg/unsafe/w:{width}/{token}"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
DELAY = 1.0
WIDTH = 1200

_HERO_IMG = re.compile(r'<img[^>]*fetchPriority="high"[^>]*src="([^"]+)"')
_POINT_MAP = re.compile(
    r'\\"width\\":(\d+),\\"height\\":(\d+),\\"imageUrl\\":\\"([^"\\]+)\\",\\"sourceKind\\":\\"tiles\\",'
    r'\\"tileUrlTemplate\\":\\"[^"\\]*/map-tiles/([0-9a-f-]+)/'
)
_LABEL = re.compile(r'\\"label\\":\\"([^"\\]+)\\"')
_POINTS = re.compile(r'\\"x\\":\[([\d.,-]+)\],\\"y\\":\[([\d.,-]+)\]')


def fetch(url: str) -> tuple[bytes, str]:
    request = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read(), response.headers.get("Content-Type", "")


def slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def proxied(media_url: str, width: int = WIDTH) -> str:
    token = base64.urlsafe_b64encode(media_url.encode()).decode().rstrip("=")
    return PROXY.format(width=width, token=token)


def hero_url(src: str) -> str | None:
    match = _HERO_IMG.search(src)
    if not match:
        return None
    return re.sub(r"/unsafe/w:\d+/", f"/unsafe/w:{WIDTH}/", html.unescape(match.group(1)))


def save(url: str, stem: str) -> str | None:
    data, kind = fetch(url)
    if not kind.startswith("image/"):
        return None
    ext = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}.get(kind.split(";")[0], ".jpg")
    MAPS.mkdir(parents=True, exist_ok=True)
    name = stem + ext
    (MAPS / name).write_bytes(data)
    return name


def point_map(src: str) -> dict | None:
    match = _POINT_MAP.search(src)
    if not match:
        return None
    width, height, preview, tiles = int(match.group(1)), int(match.group(2)), match.group(3), match.group(4)
    tail = src[match.end(): match.end() + 6000]
    label = _LABEL.search(tail)
    points = _POINTS.search(tail)
    if not points:
        return None
    xs = [float(v) for v in points.group(1).split(",")]
    ys = [float(v) for v in points.group(2).split(",")]
    # The tile map's y axis points up (Leaflet CRS.Simple), images count rows down.
    spots = [[round(x / width, 4), round(1 - y / height, 4)] for x, y in zip(xs, ys)]
    return {"tiles": tiles, "label": html.unescape(label.group(1)) if label else "", "preview": preview, "points": spots}


def boss_page(boss: dict, known: set[str]) -> str:
    """Bosses that both factions have share a name; the Asmodian one's page
    carries the region as a suffix (silent-dartan-altgard)."""
    base = slug(boss["name"])
    suffix = "altgard" if boss["faction"] == "asmo" else "verteron"
    path = f"{base}-{suffix}" if f"{base}-{suffix}" in known else base
    return f"{WIKILY}/aion-2/bosses/{path}"


def main() -> int:
    table = json.loads(DATA.read_text(encoding="utf-8"))
    known = set(re.findall(r"/aion-2/bosses/([a-z0-9-]+)", fetch(f"{WIKILY}/aion-2/bosses")[0].decode("utf-8", "replace")))
    regions: dict[str, str] = {}
    found = 0
    for boss in table["bosses"]:
        boss["map"] = None
        boss["map_region"] = None
        boss["map_points"] = []
        boss["page"] = boss_page(boss, known)
        try:
            src = fetch(boss["page"])[0].decode("utf-8", "replace")
        except Exception as exc:
            print(f"{boss['id']:8} page failed: {exc}")
            time.sleep(DELAY)
            continue
        hero = hero_url(src)
        if hero:
            try:
                boss["map"] = save(hero, boss["id"])
            except Exception as exc:
                print(f"{boss['id']:8} map image failed: {exc}")
        spot = point_map(src)
        if spot:
            if spot["tiles"] not in regions:
                stem = "region_" + (slug(spot["label"]) or spot["tiles"][:8])
                try:
                    regions[spot["tiles"]] = save(proxied(spot["preview"], 1024), stem)
                except Exception as exc:
                    print(f"  region map failed: {exc}")
                    regions[spot["tiles"]] = None
            boss["map_region"] = regions[spot["tiles"]]
            boss["map_points"] = spot["points"] if boss["map_region"] else []
        found += bool(boss["map"])
        print(f"{boss['id']:8} {boss['name']:32} map={boss['map'] or '-':12} region={boss['map_region'] or '-'} points={len(boss['map_points'])}")
        time.sleep(DELAY)
    DATA.write_text(json.dumps(table, indent=1, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
    print(f"{found}/{len(table['bosses'])} bosses with a map, {len([r for r in regions.values() if r])} region maps -> {MAPS}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
