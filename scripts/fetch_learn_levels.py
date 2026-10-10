"""Brings data/skills_all.json in line with shugo.gg's per-class data, which
follows the live Global client: each skill's in-game learn level
(`learnLevel` / `acquire`, the Skill Planner's order) and the text and
unlock level of every specialization, matched by specialization id."""
import json, sys, time, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36"}
CLASSES = ["gladiator", "templar", "assassin", "ranger", "sorcerer", "elementalist", "cleric", "chanter"]

def fetch(cls):
    url = f"https://shugo.gg/data/skills/{cls}.json"
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
            return json.load(r)["skills"]
    except Exception as exc:
        print(cls, "failed:", exc)
        return {}

learn = {}
specs = {}
failed = []
for cls in CLASSES:
    skills = fetch(cls)
    if not skills:
        failed.append(cls)
    for sid, s in skills.items():
        info = s.get("learn") or {}
        if isinstance(info, dict) and info.get("lv") is not None:
            learn[str(sid)] = {"learnLevel": int(info["lv"]), "acquire": info.get("acquire") or "", "icon": s.get("icon") or ""}
        for part in s.get("parts") or []:
            if part.get("id") is not None and part.get("desc"):
                specs[int(part["id"])] = part
    print(cls, len(skills), "skills,", sum(1 for s in skills.values() if (s.get("learn") or {}).get("lv") is not None), "with a learn level")
    time.sleep(0.5)

if failed:
    sys.exit(f"Nothing written: no data for {', '.join(failed)}")

path = ROOT / "data" / "skills_all.json"
data = json.loads(path.read_text(encoding="utf-8"))
hit = 0
spec_text = spec_level = spec_missing = 0
for s in data["skills"]:
    info = learn.get(str(s["id"]))
    if info:
        s["learnLevel"] = info["learnLevel"]
        s["acquire"] = info["acquire"]
        hit += 1
    else:
        s.pop("learnLevel", None); s.pop("acquire", None)
    for spec in s.get("specializations") or []:
        part = specs.get(int(spec["id"]))
        if not part:
            spec_missing += 1
            continue
        if spec.get("specialized") != part["desc"]:
            spec["specialized"] = part["desc"]
            spec_text += 1
        if part.get("lv") is not None and spec.get("parentSkillLvl") != int(part["lv"]):
            spec["parentSkillLvl"] = int(part["lv"])
            spec_level += 1
path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print(f"{hit}/{len(data['skills'])} skills got a learn level")
print(f"specializations: {spec_text} texts and {spec_level} unlock levels updated, {spec_missing} not on shugo.gg")
