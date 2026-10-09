"""Adds each skill's in-game learn level (shugo.gg per-class data) to
data/skills_all.json as `learnLevel` / `acquire`, which the Skill Planner
uses to list skills in the game's order."""
import json, sys, time, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36"}
CLASSES = ["gladiator", "templar", "assassin", "ranger", "sorcerer", "elementalist", "spiritmaster", "cleric", "chanter"]

def fetch(cls):
    url = f"https://shugo.gg/data/skills/{cls}.json"
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
            return json.load(r)["skills"]
    except Exception as exc:
        print(cls, "failed:", exc)
        return {}

learn = {}
for cls in CLASSES:
    skills = fetch(cls)
    for sid, s in skills.items():
        info = s.get("learn") or {}
        if isinstance(info, dict) and info.get("lv") is not None:
            learn[str(sid)] = {"learnLevel": int(info["lv"]), "acquire": info.get("acquire") or "", "icon": s.get("icon") or ""}
    print(cls, len(skills), "skills,", sum(1 for s in skills.values() if (s.get("learn") or {}).get("lv") is not None), "with a learn level")
    time.sleep(0.5)

path = ROOT / "data" / "skills_all.json"
data = json.loads(path.read_text(encoding="utf-8"))
hit = 0
for s in data["skills"]:
    info = learn.get(str(s["id"]))
    if info:
        s["learnLevel"] = info["learnLevel"]
        s["acquire"] = info["acquire"]
        hit += 1
    else:
        s.pop("learnLevel", None); s.pop("acquire", None)
path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print(f"{hit}/{len(data['skills'])} skills got a learn level")
