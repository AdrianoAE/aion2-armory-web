// node --test tests/   (the same facts the desktop's Python tests pin)
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
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

test("nextReset is the first reset strictly after now, per kind", () => {
  assert.deepEqual(planner.nextReset("daily", utc(2026, 9, 9, 6, 59)), utc(2026, 9, 9, 7, 0));
  assert.deepEqual(planner.nextReset("daily", utc(2026, 9, 9, 7, 0)), utc(2026, 9, 10, 7, 0));
  assert.deepEqual(planner.nextReset("weekly", utc(2026, 9, 14, 8, 59)), utc(2026, 9, 14, 9, 0));
  assert.deepEqual(planner.nextReset("weekly", utc(2026, 9, 14, 9, 0)), utc(2026, 9, 21, 9, 0));
  assert.deepEqual(planner.nextReset("portals", utc(2026, 9, 10, 19, 0)), utc(2026, 9, 12, 19, 0));
  assert.deepEqual(planner.nextReset("portals", utc(2026, 9, 12, 19, 0)), utc(2026, 9, 15, 19, 0));
  assert.deepEqual(planner.nextReset("daily", utc(2026, 11, 31, 22, 0)), utc(2027, 0, 1, 7, 0));
  assert.equal(planner.nextReset("available", utc(2026, 9, 9)), null);
  for (const kind of ["daily", "weekly", "portals"]) {
    const now = utc(2026, 9, 9, 12, 34);
    assert.ok(planner.nextReset(kind, now) > now);
    assert.deepEqual(planner.lastReset(kind, planner.nextReset(kind, now)), planner.nextReset(kind, now));
  }
});

test("durations read as days, hours and minutes", () => {
  assert.equal(planner.durationText(3 * 3600000 + 12 * 60000), "3 h 12 min");
  assert.equal(planner.durationText(2 * 3600000), "2 h");
  assert.equal(planner.durationText(59 * 1000), "1 min");
  assert.equal(planner.durationText(-5000), "0 min");
  assert.equal(planner.durationText((2 * 24 + 4) * 3600000 + 5 * 60000), "2 d 4 h");
});

test("default tasks use the Buy Shop(H) → Special label on both scopes", () => {
  const tasks = planner.defaultPlannerTasks();
  assert.equal(planner.SHOP_SPECIAL_TASK, "Buy Shop(H) → Special");
  assert.deepEqual(tasks.server.find((t) => t.id === "s2"), { id: "s2", name: "Buy Shop(H) → Special", kind: "weekly" });
  assert.deepEqual(tasks.character.find((t) => t.id === "c3"), { id: "c3", name: "Buy Shop(H) → Special", kind: "weekly" });
  assert.ok(!JSON.stringify(tasks).includes("Buy shop Odyle"));
});

test("the old shop label is renamed in place, ticks kept, merge copies folded in", () => {
  const saved = () => ({
    tasks: {
      server: [{ id: "s1", name: "Duty", kind: "daily" }, { id: "s2", name: "Buy shop Odyle", kind: "weekly" }],
      character: [{ id: "c2", name: "Buy shop Odyle", kind: "weekly" }, { id: "t13", name: "Buy Shop(H) → Special", kind: "weekly" }],
    },
    done: { "sv1:s2": "2026-10-08T22:31:45Z", "ch1:c2": "2026-10-08T10:00:00Z", "ch1:t13": "2026-10-09T10:00:00Z", "ch2:t13": "2026-10-09T11:00:00Z" },
    defaults_seen: ["server:Buy shop Odyle", "character:Buy shop Odyle"],
  });
  const p = saved();
  assert.equal(planner.migratePlannerTasks(p), true);
  assert.deepEqual(p.tasks.server[1], { id: "s2", name: "Buy Shop(H) → Special", kind: "weekly" });
  assert.deepEqual(p.tasks.character, [{ id: "c2", name: "Buy Shop(H) → Special", kind: "weekly" }]);
  assert.deepEqual(p.done, { "sv1:s2": "2026-10-08T22:31:45Z", "ch1:c2": "2026-10-09T10:00:00Z", "ch2:c2": "2026-10-09T11:00:00Z" });
  assert.ok(p.defaults_seen.includes("server:Buy Shop(H) → Special") && p.defaults_seen.includes("character:Buy Shop(H) → Special"));
  assert.equal(planner.migratePlannerTasks(p), false);
  const fresh = { tasks: planner.defaultPlannerTasks(), done: {}, defaults_seen: [] };
  planner.migratePlannerTasks(fresh);
  assert.deepEqual(fresh.tasks, planner.defaultPlannerTasks());
});

test("task progress counts tracked kinds only", () => {
  const p = { done: { "ch1:a": "2026-10-09T08:00:00Z", "ch1:b": "2026-10-01T08:00:00Z", "ch1:c": "2026-10-09T08:00:00Z" } };
  const tasks = [{ id: "a", kind: "daily" }, { id: "b", kind: "weekly" }, { id: "c", kind: "available" }];
  assert.deepEqual(planner.taskProgress(p, "ch1", tasks, utc(2026, 9, 9, 12, 0)), { done: 1, total: 2 });
  assert.equal(planner.isTaskDone(p, "ch1", tasks[1], utc(2026, 9, 9, 12, 0)), false);
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

test("upcoming occurrences and the events a region still has ahead", () => {
  const now = utc(2026, 9, 7, 10, 5);
  const next = timers.upcomingOccurrences(event("shugo-festival"), EU, now, 3);
  assert.deepEqual(next.map((o) => o.start), [utc(2026, 9, 7, 10, 0), utc(2026, 9, 7, 11, 0), utc(2026, 9, 7, 12, 0)]);
  assert.equal(timers.isRunning(next[0], now), true);
  assert.deepEqual(timers.upcomingOccurrences(event("daily-reset"), EU, now, 2).map((o) => o.start), [utc(2026, 9, 8, 7, 0), utc(2026, 9, 9, 7, 0)]);
  const ids = timers.regionEvents(feed.events, EU, utc(2026, 9, 20)).map((e) => e.id);
  assert.ok(ids.includes("rift") && ids.includes("weekly-reset"));
  assert.ok(!ids.includes("global-launch"));
});

test("done marks clear when the boss is seen again; sorting by next spawn, name or zone", () => {
  const NOW = utc(2026, 9, 8, 17, 0);
  const stamp = (d) => Math.floor(d.getTime() / 1000);
  const [kasia, kutar, korin] = ["Phantasm Kasia", "Rotten Kutar", "Blooming Korin"].map((n) => bosses.find((b) => b.name === n));
  const statuses = fieldboss.bossStatuses([kasia, kutar, korin], { ok: true, kills: {
    [kasia.id]: { st: "dead", t: stamp(utc(2026, 9, 8, 16, 0)), ns: stamp(utc(2026, 9, 8, 19, 0)) },
    [kutar.id]: { st: "up", us: stamp(utc(2026, 9, 8, 16, 40)) },
  } }, NOW);
  const byName = (name) => statuses.find((s) => s.boss.name === name);
  assert.equal(fieldboss.isMarkedDone(byName("Phantasm Kasia"), "2026-10-08T16:30:00Z"), true);
  assert.equal(fieldboss.isMarkedDone(byName("Phantasm Kasia"), "2026-10-08T15:30:00Z"), false);
  assert.equal(fieldboss.isMarkedDone(byName("Rotten Kutar"), "2026-10-08T16:30:00Z"), false);
  assert.equal(fieldboss.isMarkedDone(byName("Blooming Korin"), "2026-10-08T16:30:00Z"), true);
  assert.equal(fieldboss.isMarkedDone(byName("Blooming Korin"), null), false);
  assert.deepEqual(fieldboss.sortStatuses(statuses, "next", NOW).map((s) => s.boss.name), ["Rotten Kutar", "Phantasm Kasia", "Blooming Korin"]);
  assert.deepEqual(fieldboss.sortStatuses(statuses, "name", NOW).map((s) => s.boss.name), ["Blooming Korin", "Phantasm Kasia", "Rotten Kutar"]);
  assert.deepEqual(fieldboss.sortStatuses(statuses, "zone", NOW).map((s) => s.boss.zone), [korin.zone, kutar.zone, kasia.zone].sort());
});

test("feed age: fresh under 15 min, a warning up to an hour, stale beyond", () => {
  const at = utc(2026, 9, 8, 17, 0);
  const age = (min) => fieldboss.feedAge(at, new Date(at.getTime() + min * 60000));
  assert.deepEqual(age(0.5), { minutes: 0, level: "fresh", text: "just now" });
  assert.equal(age(14).level, "fresh");
  assert.equal(age(15).level, "warn");
  assert.equal(age(60).level, "warn");
  assert.deepEqual(age(75), { minutes: 75, level: "stale", text: "1 h 15 min ago" });
  assert.equal(age(7).text, "7 min ago");
  assert.equal(fieldboss.feedAge(null, at), null);
  assert.equal(fieldboss.serverOptions().length, 28);
  assert.deepEqual(fieldboss.serverOptions().find(([id]) => id === "eu-vaizel"), ["eu-vaizel", "Europe · Vaizel"]);
});

test("every boss has a map or a page to open, and same-named bosses keep their own map", () => {
  for (const boss of bosses) {
    assert.match(boss.page, /^https:\/\/wikily\.gg\/aion-2\/bosses\/[a-z0-9-]+$/);
    if (boss.map) assert.ok(existsSync(new URL(`../assets/field_boss_maps/${boss.map}`, import.meta.url)), boss.map);
    if (boss.map_region) assert.ok(existsSync(new URL(`../assets/field_boss_maps/${boss.map_region}`, import.meta.url)), boss.map_region);
    for (const [x, y] of boss.map_points) assert.ok(x >= 0 && x <= 1 && y >= 0 && y <= 1);
  }
  const twins = bosses.filter((b) => b.name === "Silent Dartan");
  assert.equal(twins.length, 2);
  assert.notEqual(twins[0].page, twins[1].page);
  assert.notDeepEqual(twins[0].map_points, twins[1].map_points);
});

test("Nightmare entries gain 2 per daily reset up to 14, and the old info rows are dropped", async () => {
  const planner = await import("../js/engine/planner.js");
  const since = new Date(Date.UTC(2026, 9, 9, 8, 0));
  assert.equal(planner.nightmareEntries(4, since, new Date(Date.UTC(2026, 9, 9, 8, 30))), 4);
  assert.equal(planner.nightmareEntries(4, since, new Date(Date.UTC(2026, 9, 10, 8, 30))), 6);
  assert.equal(planner.nightmareEntries(4, since, new Date(Date.UTC(2026, 9, 20, 8, 30))), 14);
  assert.equal(planner.nightmareCapText({ value: 14, since }, new Date(Date.UTC(2026, 9, 9, 8, 30))), "full");
  assert.match(planner.nightmareCapText({ value: 12, since }, new Date(Date.UTC(2026, 9, 9, 8, 30))), /^full in /);
  const defaults = planner.defaultPlannerTasks();
  assert.ok(!defaults.character.some((t) => /Nightmare|Expedition/.test(t.name)));
  const old = { tasks: { character: [{ id: "c7", name: "Nightmare", kind: "available" }, { id: "c8", name: "Expedition / Transcendence", kind: "available" }, { id: "c1", name: "Farm", kind: "daily" }], server: [] }, done: { "ch1:c7": "2026-10-09T00:00:00Z" }, defaults_seen: [] };
  assert.equal(planner.migratePlannerTasks(old), true);
  assert.deepEqual(old.tasks.character.map((t) => t.id), ["c1"]);
  assert.deepEqual(Object.keys(old.done), []);
});
