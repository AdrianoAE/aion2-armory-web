// The upgrade-hop graph — the part of ItemDatabase/armory_engine/transfer.py
// the Equipment page needs (Quick Select's crafted tier chain), plus the
// recipe normalization app.py's _load_recipes applies before handing the
// list to the engine.

const RECIPE_PROFESSION_MAP = {
  blacksmithing: "Blacksmithing", tailoring: "Armorsmithing", jewelcrafting: "Handicrafting", alchemy: "Alchemy", cooking: "Cooking",
};
const RECIPE_GRADE_MAP = { Common: "Common", Rare: "Rare", Unique: "Unique", Heroic: "Epic", Epic: "Legend" };
const RECIPE_EXCLUDED_INPUT_NAMES = new Set(["Abyss Points", "Platinum Medal of Merit"]);

export function parseGoldCost(raw) {
  if (raw == null) return 0;
  const value = parseInt(String(raw).replace(/,/g, "").trim(), 10);
  return Number.isNaN(value) ? 0 : value;
}

export function normalizeRecipes(payload) {
  const recipes = [];
  for (const r of (payload && payload.recipes) || []) {
    if (r.learnType === "combo" || !r.inputs || !r.inputs.length) continue;
    if (r.inputs.some((i) => RECIPE_EXCLUDED_INPUT_NAMES.has(i.name))) continue;
    const profession = RECIPE_PROFESSION_MAP[r.mainCategory];
    if (!profession || !r.outputs || !r.outputs.length) continue;
    const sub = r.subCategory || "";
    recipes.push({
      id: r.id,
      profession,
      category: sub.startsWith("misc_") ? "materials" : sub,
      grade: RECIPE_GRADE_MAP[r.grade] ?? r.grade,
      method: r.inputs.some((i) => (i.name || "").includes("Transfer Stone")) ? "Transfer" : "Herstellung",
      masteryLevel: r.masteryLevel,
      goldCost: parseGoldCost(r.remoteGoldCost || r.goldCost),
      inputs: r.inputs,
      outputs: r.outputs,
    });
  }
  return recipes;
}

export function itemTypeWord(name) {
  const cleaned = String(name || "").replace(/\s*\([^)]*\)\s*$/, "").trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "";
}

function itemGrade(name, itemId, itemsById, outputIndex) {
  const item = itemId ? itemsById[itemId] : null;
  if (item && item.grade) return item.grade;
  const recipe = name ? outputIndex[name] : null;
  return recipe ? recipe.grade : null;
}

// A recipe is an upgrade hop when exactly one input is consumed at qty 1,
// is neither the Transfer Stone nor a Kinah row, shares its item-type word
// with the output and is the same grade.
export function transferSourceName(recipe, itemsById, outputIndex) {
  const candidates = recipe.inputs.filter((i) => (i.qty || 1) === 1 && i.name && !i.name.includes("Transfer Stone") && !i.name.includes("Kina"));
  if (candidates.length !== 1) return null;
  const candidate = candidates[0];
  const outputName = recipe.outputs[0].name || "";
  if (itemTypeWord(candidate.name) !== itemTypeWord(outputName)) return null;
  const candidateGrade = itemGrade(candidate.name, candidate.id, itemsById, outputIndex);
  const outputGrade = recipe.grade;
  if (candidateGrade && outputGrade && candidateGrade !== outputGrade) return null;
  return candidate.name;
}

export function buildRecipeOutputIndex(recipes) {
  const index = {};
  for (const r of recipes) for (const output of r.outputs) if (!(output.name in index)) index[output.name] = r;
  return index;
}

export function buildTransferSourceIndex(recipes, itemsById, outputIndex) {
  const index = {};
  for (const r of recipes) {
    const source = transferSourceName(r, itemsById, outputIndex);
    if (source) (index[source] || (index[source] = [])).push(r);
  }
  return index;
}

// BFS from the root, every reachable output with its trailing type word
// stripped, in visitation order: the natural tier progression.
export function orderedTierChain(rootName, typeWord, transferSourceIndex) {
  const strip = (name) => (name.endsWith(" " + typeWord) ? name.slice(0, -(typeWord.length + 1)) : name);
  const order = [strip(rootName)];
  const queue = [rootName];
  const visited = new Set([rootName]);
  while (queue.length) {
    const current = queue.shift();
    for (const recipe of transferSourceIndex[current] || []) {
      const outputName = recipe.outputs[0].name;
      if (visited.has(outputName)) continue;
      visited.add(outputName);
      order.push(strip(outputName));
      queue.push(outputName);
    }
  }
  return order;
}
