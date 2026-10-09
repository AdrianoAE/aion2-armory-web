// aion2.plaync.com character API: URLs, response parsing and the mapping of
// a character's equipment, skills and Daevanion boards onto Armory data.

import { SERVERS } from "./fieldboss.js";

export const SITE = "https://aion2.plaync.com";
export const SEARCH_SITE = "https://api-search.plaync.com";
export const DEFAULT_RELAY = "https://aion2-armory-relay.aion2-armory-relay.workers.dev/?url=";
export const DEFAULT_REGION = "eu";
export const DEFAULT_SERVER = "Vaizel";
export const LANG = "en-US";

// The search API knows these servers in Europe beyond the field boss list.
const MORE_SERVERS = {
  eu: ["Agnita", "Atiel", "Baba", "Daminu", "Gauss", "Hadala", "Hithanya", "Indnath", "Ishtar", "Kasaka", "Kochi", "Kromede", "Lamuatan", "Ludra",
    "Luteros", "Meslamtaeda", "Munin", "Nania", "Nathara", "Nemon", "Odar", "Phernos", "Tahavatha", "Tassin", "Tiamat", "Tsenka", "Ulgorn", "Zemurru"],
};
const FIELDBOSS_REGION = { eu: "Europe", nae: "NA East", naw: "NA West", la: "South America" };

function serversOf(region) {
  const entry = SERVERS.find(([label]) => label === FIELDBOSS_REGION[region]);
  const names = entry ? entry[1].map(([, name]) => name) : [];
  for (const name of MORE_SERVERS[region] || []) if (!names.includes(name)) names.push(name);
  return names;
}

export const REGIONS = [
  ["eu", "Europe"], ["naw", "North America - West"], ["nae", "North America - East"], ["la", "South America"], ["as", "Asia"],
].map(([id, label]) => ({ id, label, servers: serversOf(id) }));

export const regionOf = (id) => REGIONS.find((r) => r.id === id) || REGIONS[0];

export const SLOT_IDS = ["MainHand", "SubHand", "Helmet", "Shoulder", "Torso", "Gloves", "Pants", "Boots", "Cloak", "Wings1",
  "Earring1", "Earring2", "Necklace", "Amulet", "Ring1", "Ring2", "Bracelet1", "Bracelet2", "Rune1", "Rune2"];

export const SLOT_MAP = { ...Object.fromEntries(SLOT_IDS.map((id) => [id, id])), Cape: "Cloak", Wings: "Wings1", Wing: "Wings1" };

// pcId comes in blocks of four per class (gender and race variants).
const PC_CLASSES = [null, null, "Gladiator", "Templar", "Ranger", "Assassin", "Spiritmaster", "Sorcerer", "Cleric", "Chanter"];
const CLASS_ALIASES = { elementalist: "Spiritmaster" };

export function classOfPcId(pcId) {
  const n = Number(pcId);
  return n > 0 ? PC_CLASSES[Math.ceil(n / 4)] || null : null;
}

export function className(name) {
  const key = String(name || "").trim().toLowerCase();
  return CLASS_ALIASES[key] || PC_CLASSES.find((c) => c && c.toLowerCase() === key) || null;
}

// ── URLs ────────────────────────────────────────────────────────────────────

const query = (params) => new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "")).toString();

export function searchUrl({ keyword, region = DEFAULT_REGION, serverId, page = 1, size = 40 }) {
  return `${SEARCH_SITE}/aion2global/search/v2/character?${query({ keyword, region, serverId, localeInfo: LANG, size, page })}`;
}

const characterQuery = ({ region, characterId, serverId }, extra = {}) => query({ lang: LANG, region, characterId, serverId, ...extra });

export const infoUrl = (who) => `${SITE}/api/character/info?${characterQuery(who)}`;
export const equipmentUrl = (who) => `${SITE}/api/character/equipment?${characterQuery(who)}`;
export const itemUrl = (who, { itemId, enchantLevel = 0, slotPos }) =>
  `${SITE}/api/character/equipment/item?${characterQuery(who, { id: itemId, enchantLevel, slotPos })}`;
export const daevanionUrl = (who, boardId) => `${SITE}/api/character/daevanion/detail?${characterQuery(who, { boardId })}`;
// The site's own item sheet: the same shape as data/details/<id>.json.
export const gameconstItemUrl = (itemId, region = DEFAULT_REGION) =>
  `${SITE}/en-us/api/gameconst/item?${new URLSearchParams({ id: String(itemId), enchantLevel: "0", lang: LANG, region })}`;

const statLine = (stat) => `${stat.name || stat.id || ""} ${stat.value || stat.minValue || ""}`.trim();

// An item list entry built from the site's item sheet, for items the Armory's list lacks.
export function itemFromDetail(detail) {
  if (!detail || !detail.id) return null;
  return {
    id: Number(detail.id), name: detail.name || String(detail.id), image: detail.icon || "", grade: detail.grade || "",
    options: [...(detail.mainStats || []), ...(detail.subStats || [])].map(statLine).filter(Boolean),
    favorite: false, tradable: !!detail.tradable, categoryName: detail.categoryName || "", classNames: detail.classNames || [],
    fromSite: true,
  };
}

export function relayUrl(relay, url) {
  return `${String(relay || DEFAULT_RELAY).trim()}${encodeURIComponent(url)}`;
}

// ── parsing ─────────────────────────────────────────────────────────────────

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'" };

export function stripTags(text) {
  return String(text || "").replace(/<[^>]*>/g, "").replace(/&(amp|lt|gt|quot|#39|apos);/g, (_, e) => ENTITIES[e]).trim();
}

function decodeOnce(value) {
  try { return decodeURIComponent(String(value || "")); } catch (e) { return String(value || ""); }
}

export function parseSearch(json) {
  return ((json && json.list) || []).map((row) => ({
    characterId: decodeOnce(row.characterId),
    name: stripTags(row.name),
    level: Number(row.level) || 0,
    serverId: row.serverId,
    serverName: row.serverName || "",
    region: row.region || "",
    pcId: row.pcId,
    race: row.race,
    className: classOfPcId(row.pcId),
  }));
}

export function filterByServer(results, serverName) {
  if (!serverName) return results;
  const wanted = serverName.trim().toLowerCase();
  return results.filter((r) => r.serverName.toLowerCase() === wanted);
}

export function isNotFound(json) {
  return !!json && typeof json === "object" && (json.status === 404 || json.code === "resource.not_found");
}

// ── equipment ───────────────────────────────────────────────────────────────

// equipped/enchant in the equip set's shapes; `rolls` lists what to ask the
// item endpoint for each slot's rolled substats.
export function mapEquipment(json, itemsById, wingsById = {}, itemsByName = {}) {
  const equipped = {}, enchant = {}, skipped = [], rolls = [], missing = [];
  const find = (id, name) => itemsById[id] || itemsById[String(id)] || wingsById[id] || wingsById[String(id)] || itemsByName[name] || null;
  const place = (slotId, entry, roll) => {
    const item = find(entry.id, entry.name);
    if (!item) { missing.push({ slotId, entry, roll }); return; }
    equipped[slotId] = item;
    const level = (Number(entry.enchantLevel) || 0) + (Number(entry.exceedLevel) || 0);
    if (level > 0) enchant[slotId] = level;
    if (roll) rolls.push({ slotId, itemId: entry.id, slotPos: entry.slotPos, enchantLevel: Number(entry.enchantLevel) || 0, name: entry.name || "" });
  };
  for (const entry of ((json && json.equipment) || {}).equipmentList || []) {
    const slotId = SLOT_MAP[entry.slotPosName];
    if (!slotId) { skipped.push(`${entry.name || entry.id} (${entry.slotPosName || "unknown slot"})`); continue; }
    place(slotId, entry, true);
  }
  const wing = ((json && json.petwing) || {}).wing;
  if (wing && wing.id) place("Wings1", wing, false);
  return { equipped, enchant, skipped, rolls, missing };
}

// Places an item the list lacked once its sheet arrived (or records the skip).
export function placeMissing(mapped, miss, item) {
  if (!item) { mapped.skipped.push(`${miss.entry.name || miss.entry.id} (not in the Armory's item list)`); return; }
  mapped.equipped[miss.slotId] = item;
  const level = (Number(miss.entry.enchantLevel) || 0) + (Number(miss.entry.exceedLevel) || 0);
  if (level > 0) mapped.enchant[miss.slotId] = level;
  if (miss.roll) mapped.rolls.push({ slotId: miss.slotId, itemId: miss.entry.id, slotPos: miss.entry.slotPos, enchantLevel: Number(miss.entry.enchantLevel) || 0, name: miss.entry.name || "" });
}

const norm = (text) => String(text || "").trim().toLowerCase();

// Indices into our item's substat options for the substats the site reports.
export function matchSubstats(apiSubStats, ourOptions) {
  const options = ourOptions || [];
  const used = new Set();
  const pick = (test) => options.findIndex((o, i) => !used.has(i) && test(o));
  for (const stat of apiSubStats || []) {
    const sameId = (o) => stat.id && norm(o.id) === norm(stat.id);
    const sameName = (o) => stat.name && norm(o.name) === norm(stat.name);
    const sameValue = (o) => String(o.value) === String(stat.value);
    let index = pick((o) => sameId(o) && sameValue(o));
    if (index < 0) index = pick(sameId);
    if (index < 0) index = pick((o) => sameName(o) && sameValue(o));
    if (index < 0) index = pick(sameName);
    if (index >= 0) used.add(index);
  }
  return [...used].sort((a, b) => a - b);
}

// Writes an import into an equip set. A slot whose item stayed keeps its
// substats unless new ones matched; a changed or emptied slot loses them.
export function mergeEquipSet(set, mapped, substatsBySlot = {}) {
  const before = set.equipped || {};
  set.equipped = { ...mapped.equipped };
  set.enchant = { ...mapped.enchant };
  set.substats = set.substats || {};
  set.philosopher_stone = set.philosopher_stone || {};
  for (const slotId of new Set([...Object.keys(set.substats), ...Object.keys(set.philosopher_stone), ...Object.keys(mapped.equipped)])) {
    const item = mapped.equipped[slotId];
    const same = !!item && !!before[slotId] && String(before[slotId].id) === String(item.id);
    const matched = substatsBySlot[slotId];
    if (matched && matched.length) set.substats[slotId] = [...matched];
    else if (!same) delete set.substats[slotId];
    if (!same) delete set.philosopher_stone[slotId];
  }
  return set;
}

// ── skills ──────────────────────────────────────────────────────────────────

// The site reports effective levels; the Armory stores what was invested and
// adds the Daevanion and Arcana bonus itself.
export function investedLevels(skillList, bonus = {}) {
  const levels = {}, cleared = [];
  for (const skill of skillList || []) {
    const id = String(skill.id);
    const level = Number(skill.acquired) === 1 ? Math.max(0, (Number(skill.skillLevel) || 0) - (Number(bonus[id]) || 0)) : 0;
    if (level > 0) levels[id] = level; else cleared.push(id);
  }
  return { levels, cleared };
}

export function mergeSkillLevels(levels, mapped) {
  for (const id of mapped.cleared) delete levels[id];
  Object.assign(levels, mapped.levels);
  return levels;
}

// ── Daevanion ───────────────────────────────────────────────────────────────

// Boards the character has opened nodes on; the others stay as planned.
export function boardPlan(info) {
  return (((info && info.daevanion) || {}).boardList || [])
    .filter((board) => Number(board.open) === 1 && Number(board.openNodeCount) > 0)
    .map((board) => ({ id: String(board.id), name: board.name || `Board ${board.id}`, open: Number(board.openNodeCount) }));
}

// The open node ids of one board as the Armory stores them: sorted strings,
// with the start node (which the site reports as closed).
export function mapBoard(detailJson, startId = null) {
  const ids = new Set(((detailJson && detailJson.nodeList) || []).filter((n) => Number(n.open) === 1).map((n) => String(n.nodeId)));
  if (ids.size && startId) ids.add(String(startId));
  return [...ids].sort();
}

// Overwrites only the boards with open nodes; returns their ids.
export function mergeBoards(set, boards) {
  const updated = [];
  for (const [id, ids] of Object.entries(boards)) {
    if (ids.length <= 1) continue;
    set[`s:${id}`] = [...ids];
    updated.push(id);
  }
  return updated;
}
