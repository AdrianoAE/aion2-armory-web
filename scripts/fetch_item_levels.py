"""Refreshes every item's level and enchant cap in data/details_index.json
from the global game data (aion2.plaync.com), which differs from the Korean
numbers the index was first built from. Run from the repo root:

    python -I scripts/fetch_item_levels.py

It resumes: ids already refreshed in this run's log are skipped."""
import json, sys, time, urllib.request, urllib.error
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
      "Accept": "application/json", "Referer": "https://aion2.plaync.com/en-us/characters/index"}
INDEX = ROOT / "data" / "details_index.json"
LOG = ROOT / "data" / "details_index.refresh.log"

index = json.loads(INDEX.read_text(encoding="utf-8"))
done = set(LOG.read_text(encoding="utf-8").split()) if LOG.exists() else set()
ids = [i for i in index if i not in done]
print(f"{len(ids)} items to refresh ({len(done)} already done)")
changed = 0
with LOG.open("a", encoding="utf-8") as log:
    for n, item_id in enumerate(ids, 1):
        url = f"https://aion2.plaync.com/en-us/api/gameconst/item?id={item_id}&enchantLevel=0&lang=en-US&region=eu"
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
                sheet = json.loads(r.read())
        except urllib.error.HTTPError as exc:
            if exc.code in (400, 404):
                log.write(item_id + "\n"); continue
            print(item_id, "HTTP", exc.code); time.sleep(5); continue
        except Exception as exc:
            print(item_id, "failed:", exc); time.sleep(5); continue
        row = index[item_id]
        level, cap = sheet.get("level"), sheet.get("maxEnchantLevel")
        if isinstance(level, int) and level > 0 and (row[0] != level or (isinstance(cap, int) and row[2] != cap)):
            row[0] = level
            if isinstance(cap, int): row[2] = cap
            changed += 1
        log.write(item_id + "\n")
        if n % 200 == 0:
            INDEX.write_text(json.dumps(index, separators=(",", ":")), encoding="utf-8")
            log.flush(); print(f"{n}/{len(ids)} refreshed, {changed} changed", flush=True)
        time.sleep(0.12)
INDEX.write_text(json.dumps(index, separators=(",", ":")), encoding="utf-8")
print(f"done: {changed} levels changed")
