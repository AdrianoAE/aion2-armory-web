// node --test tests/   (the same facts the desktop's Python tests pin)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as planner from "../js/engine/planner.js";
import * as timers from "../js/engine/timers.js";
import * as fieldboss from "../js/engine/fieldboss.js";

const utc = (...a) => new Date(Date.UTC(...a));
const feed = JSON.parse(readFileSync(new URL("../data/shugo_timers.json", import.meta.url)));
const bosses = JSON.parse(readFileSync(new URL("../data/field_bosses.json", import.meta.url))).bosses;
const EU = feed.regions.find((r) => r.id === "global-eu");
const NAE = feed.regions.find((r) => r.id === "global-nae");
const event = (id) => feed.events.find((e) => e.id === id);

test("daily reset is 09:00 CEST = 07:00 UTC all year", () => {
  assert.deepEqual(planner.lastReset("daily", utc(2026, 6, 1, 6, 59)), utc(2026, 5, 30, 7, 0));
  assert.deepEqual(planner.lastReset("daily", utc(2026, 6, 1, 7, 0)), utc(2026, 6, 1, 7, 0));
  assert.deepEqual(planner.lastReset("daily", utc(2026, 11, 1, 7, 30)), utc(2026, 11, 1, 7, 0));
  assert.deepEqual(planner.nextReset("daily", utc(2026, 6, 1, 12, 0)), utc(2026, 6, 2, 7, 0));
});

test("weekly resets Wednesday 11:00 CEST, portals Mon/Thu/Sat 21:00 CEST", () => {
  assert.deepEqual(planner.lastReset("weekly", utc(2026, 9, 7, 8, 59)), utc(2026, 8, 30, 9, 0));
  assert.deepEqual(planner.lastReset("weekly", utc(2026, 9, 7, 9, 0)), utc(2026, 9, 7, 9, 0));
  assert.deepEqual(planner.nextReset("weekly", utc(2026, 9, 22, 12, 0)), utc(2026, 9, 28, 9, 0));
  assert.deepEqual(planner.lastReset("portals", utc(2026, 9, 7, 10, 0)), utc(2026, 9, 5, 19, 0));
  assert.deepEqual(planner.nextReset("portals", utc(2026, 9, 7, 10, 0)), utc(2026, 9, 8, 19, 0));
  assert.deepEqual(planner.nextReset("portals", utc(2026, 9, 8, 19, 0)), utc(2026, 9, 10, 19, 0));
  assert.deepEqual(planner.nextReset("portals", utc(2026, 11, 1, 12, 0)), utc(2026, 11, 3, 19, 0));
});

test("done until the next reset of its kind", () => {
  const ticked = utc(2026, 9, 7, 10, 0);
  assert.equal(planner.isDone("daily", ticked, utc(2026, 9, 8, 6, 59)), true);
  assert.equal(planner.isDone("daily", ticked, utc(2026, 9, 8, 7, 0)), false);
  assert.equal(planner.isDone("weekly", ticked, utc(2026, 9, 14, 8, 59)), true);
  assert.equal(planner.isDone("weekly", ticked, utc(2026, 9, 14, 9, 0)), false);
  assert.equal(planner.isDone("available", ticked, utc(2027, 0, 1)), true);
  assert.equal(planner.isDone("daily", null, ticked), false);
});

test("odyle charges 15 every 3 hours on the CEST grid, capped at 840", () => {
  const entered = utc(2026, 9, 7, 10, 0);
  assert.equal(planner.odyleEnergy(100, entered, utc(2026, 9, 7, 12, 59)), 100);
  assert.equal(planner.odyleEnergy(100, entered, utc(2026, 9, 7, 13, 0)), 115);
  assert.equal(planner.odyleEnergy(100, entered, utc(2026, 9, 8, 10, 0)), 100 + 15 * 8);
  assert.equal(planner.odyleEnergy(7, utc(2026, 9, 7, 11, 10), utc(2026, 9, 7, 13, 0)), 22);
  assert.equal(planner.odyleEnergy(800, entered, utc(2026, 9, 9, 10, 0)), 840);
  assert.deepEqual(planner.nextOdyleTick(utc(2026, 9, 7, 10, 0)), utc(2026, 9, 7, 13, 0));
  assert.deepEqual(planner.nextOdyleTick(utc(2026, 11, 1, 7, 30)), utc(2026, 11, 1, 10, 0));
});

test("zone conversion follows each zone's rules", () => {
  assert.equal(timers.zoneOffsetMs("Europe/Berlin", utc(2026, 6, 1)), 2 * 3600000);
  assert.equal(timers.zoneOffsetMs("Europe/Berlin", utc(2026, 11, 1)), 3600000);
  assert.equal(timers.zoneOffsetMs("America/New_York", utc(2026, 2, 8, 6, 59)), -5 * 3600000);
  assert.equal(timers.zoneOffsetMs("America/New_York", utc(2026, 2, 8, 7, 0)), -4 * 3600000);
  assert.deepEqual(timers.fromZone(utc(2026, 9, 7, 12, 0), "Europe/Berlin"), utc(2026, 9, 7, 10, 0));
});

test("hourly events have one occurrence per hour; daily times are in the region zone", () => {
  const found = timers.occurrences(event("shugo-festival"), EU, utc(2026, 9, 7, 10, 0), utc(2026, 9, 8, 10, 0));
  assert.equal(found.length, 25);
  assert.deepEqual(found[0].start, utc(2026, 9, 7, 10, 0));
  const rift = timers.occurrences(event("rift"), EU, utc(2026, 9, 7, 0, 0), utc(2026, 9, 7, 12, 0));
  assert.deepEqual(rift.filter((o) => o.start.getUTCDate() === 7).map((o) => o.start.getUTCHours()), [0, 3, 6, 9, 12]);
  assert.deepEqual(rift[0].portalEnd, new Date(rift[0].start.getTime() + 600000));
});

test("weekly events land on their days; the global reset is 07:00 UTC everywhere", () => {
  assert.deepEqual(timers.nextOccurrence(event("artifact-siege"), EU, utc(2026, 9, 7, 10, 0)).start, utc(2026, 9, 8, 19, 0));
  const week = timers.occurrences(event("artifact-siege"), EU, utc(2026, 9, 5, 0, 0), utc(2026, 9, 12, 0, 0));
  assert.deepEqual(week.map((o) => (o.start.getUTCDay() + 6) % 7), [0, 3, 5]);
  for (const region of [EU, NAE]) assert.deepEqual(timers.nextOccurrence(event("daily-reset"), region, utc(2026, 9, 7, 10, 0)).start, utc(2026, 9, 8, 7, 0));
  assert.equal(timers.scheduleSummary(event("artifact-siege").schedules["global-eu"], EU), "Mon, Thu, Sat · 21:00 Berlin");
  assert.equal(timers.scheduleSummary(event("daily-reset").schedules["global-eu"], EU), "Daily · 16:00 Seoul");
  assert.equal(timers.occurrences(event("global-launch"), EU, utc(2026, 9, 1), utc(2026, 9, 31), utc(2026, 9, 20)).length, 0);
});

test("boss statuses: spawned first, then by time left, unknown last; soon = within an hour", () => {
  const NOW = utc(2026, 9, 8, 17, 0);
  const stamp = (d) => Math.floor(d.getTime() / 1000);
  const kasia = bosses.find((b) => b.name === "Phantasm Kasia");
  const lagta = bosses.find((b) => b.name === "High Commander Lagta" && b.faction === "elyos");
  const kutar = bosses.find((b) => b.name === "Rotten Kutar");
  const statuses = fieldboss.bossStatuses([kasia, lagta, kutar], { ok: true, kills: {
    [kasia.id]: { st: "dead", t: stamp(utc(2026, 9, 8, 16, 0)), ns: stamp(utc(2026, 9, 8, 19, 0)), est: 1 },
    [lagta.id]: { st: "up", us: stamp(utc(2026, 9, 8, 16, 50)) },
    [kutar.id]: { st: "dead", t: stamp(utc(2026, 9, 8, 16, 30)), ns: stamp(utc(2026, 9, 8, 17, 30)) },
  } }, NOW);
  assert.deepEqual(statuses.map((s) => s.boss.name), ["High Commander Lagta", "Rotten Kutar", "Phantasm Kasia"]);
  assert.equal(fieldboss.timeLeft(statuses[1], NOW), 30 * 60000);
  assert.equal(fieldboss.isSoon(statuses[0], NOW), true);
  assert.equal(fieldboss.isSoon(statuses[2], NOW), false);
  const overdue = fieldboss.bossStatuses([kutar], { ok: true, kills: { [kutar.id]: { st: "dead", t: stamp(utc(2026, 9, 8, 15, 0)), ns: stamp(utc(2026, 9, 8, 16, 0)) } } }, NOW)[0];
  assert.equal(overdue.up, true);
  assert.equal(bosses.filter(fieldboss.dropsYellowArtwork).length, 20);
  assert.equal(fieldboss.bossStatuses([kasia], null, NOW)[0].known, false);
});
