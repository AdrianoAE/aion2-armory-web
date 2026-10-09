// node --test tests/official.test.mjs   (aion2.plaync.com import mapping)
import { test } from "node:test";
import assert from "node:assert/strict";
import * as O from "../js/engine/official.js";

const WHO = { region: "eu", characterId: "ZOFzGjNorPtjdJSy8Gneu3flJ2e0LMFysPgf87lT8KM=", serverId: 1303 };

const SEARCH = {
  list: [
    { characterId: "ZOFzGjNorPtjdJSy8Gneu3flJ2e0LMFysPgf87lT8KM%3D", name: "<strong>Calvora</strong>", race: 1, pcId: 6, level: 32, serverId: 1303, serverName: "Vaizel", region: "eu" },
    { characterId: "abc%2Bdef%3D", name: "<strong>Cal</strong>ix &amp; Co", race: 2, pcId: 30, level: 45, serverId: 1201, serverName: "Siel", region: "eu" },
  ],
  pagination: { page: 1, size: 10, total: 2, endPage: 1 },
};

const EQUIPMENT = {
  equipment: {
    equipmentList: [
      { id: 110150026, name: "Wind Breeze Greatsword", grade: "Rare", enchantLevel: 3, exceedLevel: 0, slotPos: 1, slotPosName: "MainHand" },
      { id: 210750027, name: "Wind Breeze Cloak", grade: "Rare", enchantLevel: 0, exceedLevel: 0, slotPos: 19, slotPosName: "Cape" },
      { id: 215250001, name: "Noble Belt", grade: "Rare", enchantLevel: 0, exceedLevel: 0, slotPos: 17, slotPosName: "Belt" },
      { id: 310360005, name: "Dawn Ring", grade: "Common", enchantLevel: 10, exceedLevel: 2, slotPos: 13, slotPosName: "Ring1" },
      { id: 999, name: "Mystery Ring", grade: "Rare", enchantLevel: 0, exceedLevel: 0, slotPos: 14, slotPosName: "Ring2" },
    ],
    skinList: [{ id: 1, slotPosName: "Torso" }],
  },
  petwing: { pet: { id: 1299, level: 3, name: "Two" }, wing: { id: 30200500, name: "Intermediate Daeva Wings", enchantLevel: 1, grade: "Rare" } },
  skill: {
    skillList: [
      { id: 11020000, name: "Keen Strike", category: "Active", skillLevel: 10, acquired: 1, equip: 1 },
      { id: 11280000, name: "Unequipped", category: "Active", skillLevel: 1, acquired: 1, equip: 0 },
      { id: 11240000, name: "Locked", category: "Dp", skillLevel: 0, acquired: 0, equip: 0 },
      { id: 11340000, name: "Acquired at 0", category: "Dp", skillLevel: 0, acquired: 1, equip: 0 },
    ],
  },
};

const ITEMS = {
  110150026: { id: 110150026, name: "Wind Breeze Greatsword", grade: "Rare" },
  210750027: { id: 210750027, name: "Wind Breeze Cloak", grade: "Rare" },
  310360005: { id: 310360005, name: "Dawn Ring", grade: "Common" },
};
const WINGS = { 30200500: { id: 30200500, name: "Intermediate Daeva Wings (Elyos)", categoryName: "Wings Equip" } };

test("URLs carry the region, the decoded character id once encoded, and the language", () => {
  assert.equal(O.searchUrl({ keyword: "Cal", region: "eu" }),
    "https://api-search.plaync.com/aion2global/search/v2/character?keyword=Cal&region=eu&localeInfo=en-US&size=40&page=1");
  assert.match(O.searchUrl({ keyword: "Cal", region: "naw", serverId: 1303 }), /region=naw&serverId=1303&/);
  assert.equal(O.infoUrl(WHO),
    "https://aion2.plaync.com/api/character/info?lang=en-US&region=eu&characterId=ZOFzGjNorPtjdJSy8Gneu3flJ2e0LMFysPgf87lT8KM%3D&serverId=1303");
  assert.equal(O.equipmentUrl(WHO), O.infoUrl(WHO).replace("/info?", "/equipment?"));
  assert.equal(O.itemUrl(WHO, { itemId: 110150026, enchantLevel: 3, slotPos: 1 }),
    `${O.equipmentUrl(WHO).replace("/equipment?", "/equipment/item?")}&id=110150026&enchantLevel=3&slotPos=1`);
  assert.equal(O.daevanionUrl(WHO, 11), `${O.infoUrl(WHO).replace("/info?", "/daevanion/detail?")}&boardId=11`);
  assert.equal(O.relayUrl("https://relay.example/?url=", "https://a.b/c?d=1&e=2"), "https://relay.example/?url=https%3A%2F%2Fa.b%2Fc%3Fd%3D1%26e%3D2");
  assert.equal(O.relayUrl("", "x"), `${O.DEFAULT_RELAY}x`);
});

test("search results lose their markup and percent-encoding, and get a class from pcId", () => {
  const results = O.parseSearch(SEARCH);
  assert.deepEqual(results.map((r) => [r.name, r.characterId, r.className, r.serverName, r.level]), [
    ["Calvora", "ZOFzGjNorPtjdJSy8Gneu3flJ2e0LMFysPgf87lT8KM=", "Gladiator", "Vaizel", 32],
    ["Calix & Co", "abc+def=", "Cleric", "Siel", 45],
  ]);
  assert.deepEqual(O.filterByServer(results, "vaizel").map((r) => r.name), ["Calvora"]);
  assert.equal(O.filterByServer(results, "").length, 2);
  assert.deepEqual(O.parseSearch({}), []);
});

test("pcId blocks and class names map onto the Armory's classes", () => {
  assert.deepEqual([6, 10, 14, 18, 22, 26, 30, 34, 36].map(O.classOfPcId),
    ["Gladiator", "Templar", "Ranger", "Assassin", "Spiritmaster", "Sorcerer", "Cleric", "Chanter", "Chanter"]);
  assert.equal(O.classOfPcId(0), null);
  assert.equal(O.className("gladiator"), "Gladiator");
  assert.equal(O.className("Elementalist"), "Spiritmaster");
  assert.equal(O.className("Painter"), null);
});

test("regions offer the field boss servers, Europe first with Vaizel", () => {
  assert.deepEqual(O.REGIONS.map((r) => r.id), ["eu", "naw", "nae", "la", "as"]);
  assert.ok(O.regionOf("eu").servers.includes("Vaizel"));
  assert.ok(O.regionOf("eu").servers.includes("Agnita"));
  assert.equal(O.regionOf("nope").id, "eu");
});

test("equipment maps slots (Cape is the Cloak), skips the Belt and unknown items, adds the wings", () => {
  const mapped = O.mapEquipment(EQUIPMENT, ITEMS, WINGS);
  assert.deepEqual(Object.keys(mapped.equipped).sort(), ["Cloak", "MainHand", "Ring1", "Wings1"]);
  assert.equal(mapped.equipped.Cloak.id, 210750027);
  assert.equal(mapped.equipped.Wings1.name, "Intermediate Daeva Wings (Elyos)");
  assert.deepEqual(mapped.enchant, { MainHand: 3, Ring1: 12, Wings1: 1 });
  assert.deepEqual(mapped.skipped, ["Noble Belt (Belt)"]);
  assert.deepEqual(mapped.missing.map((m) => [m.slotId, m.entry.name]), [["Ring2", "Mystery Ring"]]);
  O.placeMissing(mapped, mapped.missing[0], null);
  assert.deepEqual(mapped.skipped, ["Noble Belt (Belt)", "Mystery Ring (not in the Armory's item list)"]);
  const sheet = { id: 5, name: "Mystery Ring", grade: "Unique", icon: "x.png", categoryName: "Ring", classNames: [], mainStats: [{ id: "Attack", name: "Attack", value: "16" }], subStats: [{ id: "STR", name: "Might", value: "10" }] };
  const built = O.itemFromDetail(sheet);
  assert.deepEqual([built.id, built.name, built.image, built.options], [5, "Mystery Ring", "x.png", ["Attack 16", "Might 10"]]);
  const again = O.mapEquipment(EQUIPMENT, ITEMS);
  O.placeMissing(again, again.missing[0], built);
  assert.equal(again.equipped.Ring2.id, 5);
  assert.ok(again.rolls.some((r) => r.slotId === "Ring2"));
  assert.ok(O.gameconstItemUrl(5).includes("/en-us/api/gameconst/item?id=5&enchantLevel=0"));
  assert.deepEqual(mapped.rolls.map((r) => [r.slotId, r.itemId, r.slotPos, r.enchantLevel]),
    [["MainHand", 110150026, 1, 3], ["Cloak", 210750027, 19, 0], ["Ring1", 310360005, 13, 10]]);
  assert.equal(O.mapEquipment(EQUIPMENT, {}, {}, { "Mystery Ring": { id: 5, name: "Mystery Ring" } }).equipped.Ring2.id, 5);
  assert.deepEqual(O.mapEquipment({}, ITEMS).equipped, {});
});

test("substats match by id (value first), then by name, each option once", () => {
  const options = [
    { id: "STR", name: "Might", value: "21" }, { id: "MPMax", name: "MP", value: "38" },
    { id: "Critical", name: "Critical Hit", value: "40" }, { id: "Critical", name: "Critical Hit", value: "80" },
  ];
  assert.deepEqual(O.matchSubstats([{ id: "STR", name: "Might", value: "10" }, { id: "MPMax", name: "MP", value: "38" }], options), [0, 1]);
  assert.deepEqual(O.matchSubstats([{ id: "Critical", value: "80" }, { id: "Critical", value: "80" }], options), [2, 3]);
  assert.deepEqual(O.matchSubstats([{ id: "Other", name: "might", value: "1" }], options), [0]);
  assert.deepEqual(O.matchSubstats([{ id: "Nope", name: "Nope" }], options), []);
  assert.deepEqual(O.matchSubstats(undefined, options), []);
});

test("merging an import keeps substats of unchanged items and drops those of replaced or emptied slots", () => {
  const set = {
    equipped: { MainHand: { id: 1 }, Ring1: { id: 2 }, Necklace: { id: 3 }, Helmet: { id: 4 } },
    enchant: { MainHand: 9, Necklace: 4 },
    substats: { MainHand: [0, 2], Ring1: [1], Necklace: [0], Helmet: [3] },
    philosopher_stone: { MainHand: true, Necklace: true },
    priority: { keep: 1 },
  };
  const mapped = { equipped: { MainHand: { id: 1 }, Ring1: { id: 22 }, Helmet: { id: 4 }, Boots: { id: 5 } }, enchant: { MainHand: 3 } };
  O.mergeEquipSet(set, mapped, { Helmet: [0, 1], Boots: [2] });
  assert.deepEqual(set.equipped, mapped.equipped);
  assert.notEqual(set.equipped, mapped.equipped);
  assert.deepEqual(set.enchant, { MainHand: 3 });
  assert.deepEqual(set.substats, { MainHand: [0, 2], Helmet: [0, 1], Boots: [2] });
  assert.deepEqual(set.philosopher_stone, { MainHand: true });
  assert.deepEqual(set.priority, { keep: 1 });
});

test("skills: acquired skills keep their level minus the bonus levels, the rest are cleared", () => {
  const mapped = O.investedLevels(EQUIPMENT.skill.skillList);
  assert.deepEqual(mapped.levels, { 11020000: 10, 11280000: 1 });
  assert.deepEqual(mapped.cleared, ["11240000", "11340000"]);
  const withBonus = O.investedLevels(EQUIPMENT.skill.skillList, { 11020000: 2, 11280000: 3, 11240000: 1 });
  assert.deepEqual(withBonus.levels, { 11020000: 8 });
  assert.deepEqual(withBonus.cleared, ["11280000", "11240000", "11340000"]);
  const levels = O.mergeSkillLevels({ 11240000: 4, 11999999: 2, 11020000: 1 }, mapped);
  assert.deepEqual(levels, { 11999999: 2, 11020000: 10, 11280000: 1 });
});

test("Daevanion: only open boards with nodes are fetched and overwritten; planned boards stay", () => {
  const info = { daevanion: { boardList: [
    { id: 11, name: "Nezekan", open: 1, openNodeCount: 53 }, { id: 13, name: "Vaizel", open: 1, openNodeCount: 0 },
    { id: 14, name: "Triniel", open: 0, openNodeCount: 0 },
  ] } };
  assert.deepEqual(O.boardPlan(info), [{ id: "11", name: "Nezekan", open: 53 }]);
  assert.deepEqual(O.boardPlan({}), []);
  const detail = { nodeList: [
    { boardId: 11, nodeId: 110081, open: 0 }, { boardId: 11, nodeId: 110113, open: 0, type: "Start" },
    { boardId: 11, nodeId: 110034, open: 1 }, { boardId: 11, nodeId: 110033, open: 1 },
  ] };
  assert.deepEqual(O.mapBoard(detail, "110113"), ["110033", "110034", "110113"]);
  assert.deepEqual(O.mapBoard(detail), ["110033", "110034"]);
  assert.deepEqual(O.mapBoard({ nodeList: [] }, "110113"), []);
  const set = { "s:11": ["110001"], "s:12": ["120001", "120002"], "s:13": ["130001", "130002"], "s:16": ["160001", "160002"] };
  assert.deepEqual(O.mergeBoards(set, { 11: ["110033", "110113"], 12: ["120113"] }), ["11"]);
  assert.deepEqual(set, { "s:11": ["110033", "110113"], "s:12": ["120001", "120002"], "s:13": ["130001", "130002"], "s:16": ["160001", "160002"] });
});

test("a 404 body reads as not found", () => {
  assert.equal(O.isNotFound({ status: 404, code: "resource.not_found" }), true);
  assert.equal(O.isNotFound({ profile: {} }), false);
  assert.equal(O.isNotFound(null), false);
});
