import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as core from "../js/widgets/alerts/core.js";
import { SHOP_SPECIAL_TASK, defaultPlannerTasks } from "../js/engine/planner.js";

const utc = (...a) => new Date(Date.UTC(...a));
const MIN = 60000;
const HOUR = 60 * MIN;
const feed = JSON.parse(readFileSync(new URL("../data/shugo_timers.json", import.meta.url)));
const EU = feed.regions.find((r) => r.id === "global-eu");
const settings = (patch = {}) => core.mergeAlertSettings(patch);

test("settings merge defaults and clamp values", () => {
  const s = settings();
  assert.equal(s.enabled, true);
  assert.equal(s.sound, "chime");
  assert.equal(s.leadMinutes, 5);
  assert.deepEqual(s.odyle, { enabled: true, percent: 90 });
  assert.deepEqual(s.weekly, { enabled: true, hoursBefore: 12 });
  const odd = settings({ sound: "kazoo", leadMinutes: -4, odyle: { percent: 250 }, customEvents: [{ name: "  ", at: "nope", repeat: "yearly", leadMinutes: "" }] });
  assert.equal(odd.sound, "chime");
  assert.equal(odd.leadMinutes, 0);
  assert.equal(odd.odyle.percent, 100);
  assert.equal(odd.odyle.enabled, true);
  assert.deepEqual(odd.customEvents[0], { id: "ev1", name: "Custom event", at: null, repeat: "none", leadMinutes: null });
  assert.equal(settings({ customEvents: [{ id: "x", at: utc(2026, 9, 9, 18), leadMinutes: 0 }] }).customEvents[0].leadMinutes, 0);
});

test("fire keys are per occurrence and dedupe", () => {
  const at = utc(2026, 9, 9, 18, 0);
  const a = core.makeAlert({ source: "custom", id: "ev1", title: "Raid", at, leadMs: 5 * MIN });
  assert.equal(a.key, `custom:ev1@${at.getTime()}`);
  assert.equal(core.makeAlert({ source: "custom", id: "ev1", title: "Raid", at: new Date(at.getTime() + 86400000) }).key === a.key, false);
  const now = new Date(at.getTime() - 4 * MIN);
  const fired = {};
  assert.equal(core.dueAlerts([a], now, fired).length, 1);
  core.markFired(fired, a, now);
  assert.equal(core.dueAlerts([a], now, fired).length, 0);
  assert.equal(core.dueAlerts([a], new Date(now.getTime() + MIN), fired).length, 0);
});

test("boss spawns that drift a few minutes count as the same occurrence", () => {
  const at = utc(2026, 9, 9, 18, 0);
  const first = core.makeAlert({ source: "boss", id: "elyos20", title: "Boss", at, tolerance: core.BOSS_TOLERANCE_MS });
  const drifted = core.makeAlert({ source: "boss", id: "elyos20", title: "Boss", at: new Date(at.getTime() + 4 * MIN), tolerance: core.BOSS_TOLERANCE_MS });
  const nextCycle = core.makeAlert({ source: "boss", id: "elyos20", title: "Boss", at: new Date(at.getTime() + 3 * HOUR), tolerance: core.BOSS_TOLERANCE_MS });
  const fired = core.markFired({}, first, at);
  assert.equal(core.isFired(fired, drifted), true);
  assert.equal(core.isFired(fired, nextCycle), false);
  core.forgetFired(fired, drifted);
  assert.deepEqual(fired, {});
});

test("fired keys are pruned after two days", () => {
  const now = utc(2026, 9, 9, 12);
  const fired = {
    old: { group: "custom:a", at: 0, fired: now.getTime() - 49 * HOUR },
    fresh: { group: "custom:b", at: 0, fired: now.getTime() - 47 * HOUR },
  };
  assert.deepEqual(Object.keys(core.pruneFired(fired, now)), ["fresh"]);
});

test("lead time opens the window, grace closes it", () => {
  const at = utc(2026, 9, 9, 18, 0);
  const a = core.makeAlert({ source: "timer", id: "rift", title: "Rift", at, leadMs: 5 * MIN });
  const due = (t) => core.dueAlerts([a], t).length === 1;
  assert.equal(due(new Date(at.getTime() - 5 * MIN - 1000)), false);
  assert.equal(due(new Date(at.getTime() - 5 * MIN)), true);
  assert.equal(due(at), true);
  assert.equal(due(new Date(at.getTime() + core.GRACE_MS - 1000)), true);
  assert.equal(due(new Date(at.getTime() + core.GRACE_MS)), false);
  const zero = core.makeAlert({ source: "custom", id: "x", title: "X", at, leadMs: 0 });
  assert.equal(core.dueAlerts([zero], new Date(at.getTime() - 1000)).length, 0);
  assert.equal(core.dueAlerts([zero], at).length, 1);
});

test("snooze delays an alert by 15 minutes and keeps it alive past its grace", () => {
  const at = utc(2026, 9, 9, 18, 0);
  const a = core.makeAlert({ source: "custom", id: "x", title: "X", at, leadMs: 0 });
  const until = at.getTime() + core.SNOOZE_MS;
  const snoozed = { [a.key]: until };
  assert.equal(core.dueAlerts([a], new Date(until - 1000), {}, snoozed).length, 0);
  assert.equal(core.dueAlerts([a], new Date(until), {}, snoozed).length, 1);
  assert.equal(core.upcomingList([a], new Date(at.getTime() + MIN), {}, snoozed)[0].status, "snoozed");
});

test("timer alerts take the next start per event in the region", () => {
  const now = utc(2026, 9, 9, 10, 52);
  const list = core.timerAlerts(feed, EU, settings({ timers: true }), now);
  const shugo = list.find((a) => a.id === "shugo-festival");
  assert.deepEqual(shugo.at, utc(2026, 9, 9, 11, 0));
  assert.deepEqual(shugo.fireAt, utc(2026, 9, 9, 10, 55));
  const only = core.timerAlerts(feed, EU, settings({ timers: true, timerEvents: ["rift"] }), now);
  assert.deepEqual(only.map((a) => a.id), ["rift"]);
  const justStarted = core.timerAlerts(feed, EU, settings(), utc(2026, 9, 9, 11, 3)).find((a) => a.id === "shugo-festival");
  assert.deepEqual(justStarted.at, utc(2026, 9, 9, 11, 0));
});

test("tracked boss alerts follow the feed's next spawn", () => {
  const bosses = [{ id: "b1", name: "Boss One", zone: "Zone", faction: "asmo", cycle_minutes: 120 }, { id: "b2", name: "Boss Two", cycle_minutes: 120 }];
  const now = utc(2026, 9, 9, 12, 0);
  const spawn = utc(2026, 9, 9, 12, 30);
  const bossFeed = { kills: { b1: { st: "dead", t: (now.getTime() - HOUR) / 1000, ns: spawn.getTime() / 1000 }, b2: { st: "dead", ns: spawn.getTime() / 1000 } } };
  const list = core.bossAlerts(bosses, bossFeed, ["b1"], settings(), now);
  assert.equal(list.length, 1);
  assert.deepEqual(list[0].at, spawn);
  assert.equal(list[0].accent, "--asmos");
  assert.equal(core.bossAlerts(bosses, bossFeed, ["b1"], settings(), new Date(spawn.getTime() + MIN)).length, 1);
});

test("custom events repeat daily and weekly on the local wall clock", () => {
  const first = new Date(2026, 9, 5, 20, 0);
  const now = new Date(2026, 9, 9, 21, 0);
  assert.equal(core.customOccurrence({ at: first.toISOString(), repeat: "none" }, now), null);
  assert.deepEqual(core.customOccurrence({ at: first.toISOString(), repeat: "daily" }, now), new Date(2026, 9, 10, 20, 0));
  assert.deepEqual(core.customOccurrence({ at: first.toISOString(), repeat: "weekly" }, now), new Date(2026, 9, 12, 20, 0));
  assert.deepEqual(core.customOccurrence({ at: first.toISOString(), repeat: "daily" }, new Date(2026, 9, 9, 20, 5)), new Date(2026, 9, 9, 20, 0));
  assert.deepEqual(core.customOccurrence({ at: first.toISOString(), repeat: "daily" }, new Date(2026, 11, 1, 19, 0)), new Date(2026, 11, 1, 20, 0));
  assert.deepEqual(core.customOccurrence({ at: first.toISOString(), repeat: "weekly" }, new Date(2026, 9, 3)), first);
  const s = settings({ leadMinutes: 10, customEvents: [{ id: "a", name: "A", at: new Date(2026, 9, 9, 22).toISOString(), leadMinutes: 0 }, { id: "b", name: "B", at: new Date(2026, 9, 9, 22).toISOString() }] });
  const [a, b] = core.customAlerts(s, now);
  assert.equal(a.at - a.fireAt, 0);
  assert.equal(b.at - b.fireAt, 10 * MIN);
});

test("Odyle reaches the threshold and the cap on the 3-hour ticks", () => {
  const since = utc(2026, 9, 9, 7, 30);
  assert.deepEqual(core.odyleReachAt(700, since, 756), utc(2026, 9, 9, 19, 0));
  assert.deepEqual(core.odyleReachAt(700, since, 840), utc(2026, 9, 10, 13, 0));
  assert.deepEqual(core.odyleReachAt(800, since, 756), since);
  assert.equal(core.odyleTarget(90), 756);
  assert.equal(core.odyleTarget(100), 840);
  const s = settings();
  const [alert] = core.odyleAlerts([{ id: "ch1", name: "Calvora" }], { ch1: { value: 700, since: since.toISOString() } }, s);
  assert.equal(alert.key, `odyle:ch1@${utc(2026, 9, 9, 19, 0).getTime()}`);
  assert.equal(core.dueAlerts([alert], utc(2026, 9, 9, 18, 59)).length, 0);
  assert.equal(core.dueAlerts([alert], utc(2026, 9, 10, 3, 0)).length, 1);
  assert.equal(core.alertText(alert, utc(2026, 9, 9, 19, 0)).body, "Calvora Odyle at 760/840 — spend it before the cap (full in 18 h)");
});

test("weekly reminder opens hoursBefore the Wednesday reset while the shop task is unticked", () => {
  const tasks = defaultPlannerTasks();
  const shopChar = tasks.character.find((t) => t.name === SHOP_SPECIAL_TASK);
  const reset = utc(2026, 9, 14, 9, 0);
  const planner = { tasks, done: { [`ch1:${shopChar.id}`]: utc(2026, 9, 8, 12).toISOString() }, odyle: {} };
  const scopes = [{ scope: "server", id: "sv1", name: "My server" }, { scope: "character", id: "ch1", name: "Calvora" }, { scope: "character", id: "ch2", name: "Solenne" }];
  const s = settings();
  const before = utc(2026, 9, 13, 20, 59);
  const alert = core.weeklyAlert(planner, scopes, s, before);
  assert.deepEqual(alert.at, reset);
  assert.deepEqual(alert.fireAt, utc(2026, 9, 13, 21, 0));
  assert.deepEqual(alert.pending, ["Solenne"]);
  assert.equal(core.dueAlerts([alert], before).length, 0);
  const inside = utc(2026, 9, 13, 22, 0);
  assert.equal(core.dueAlerts([core.weeklyAlert(planner, scopes, s, inside)], inside).length, 1);
  assert.equal(core.alertText(alert, inside).body, `Weekly resets in 11 h — ${SHOP_SPECIAL_TASK} not done for: Solenne`);
  planner.done[`ch2:${shopChar.id}`] = inside.toISOString();
  assert.equal(core.weeklyAlert(planner, scopes, s, inside), null);
});

test("collectAlerts respects the master and per-source switches", () => {
  const now = utc(2026, 9, 9, 10, 52);
  const custom = [{ id: "a", name: "A", at: utc(2026, 9, 9, 11).toISOString() }];
  const base = { now, schedule: feed, region: EU, planner: { tasks: defaultPlannerTasks(), done: {}, odyle: {} }, scopes: [] };
  assert.deepEqual(core.collectAlerts({ ...base, settings: settings({ enabled: false, timers: true, customEvents: custom }) }), []);
  const sources = (s) => [...new Set(core.collectAlerts({ ...base, settings: settings(s) }).map((a) => a.source))].sort();
  assert.deepEqual(sources({ customEvents: custom }), ["custom"]);
  assert.deepEqual(sources({ timers: true, customEvents: custom }), ["custom", "timer"]);
});

test("upcoming lists the next 24 hours sorted, with status", () => {
  const now = utc(2026, 9, 9, 12, 0);
  const soon = core.makeAlert({ source: "custom", id: "a", title: "Soon", at: new Date(now.getTime() + 20 * MIN), leadMs: 5 * MIN });
  const later = core.makeAlert({ source: "custom", id: "b", title: "Later", at: new Date(now.getTime() + 23 * HOUR) });
  const far = core.makeAlert({ source: "custom", id: "c", title: "Far", at: new Date(now.getTime() + 25 * HOUR) });
  const firedOne = core.makeAlert({ source: "custom", id: "d", title: "Fired", at: new Date(now.getTime() - MIN) });
  const fired = core.markFired({}, firedOne, now);
  const list = core.upcomingList([later, far, soon, firedOne], now, fired, {});
  assert.deepEqual(list.map((a) => [a.title, a.status]), [["Fired", "fired"], ["Soon", "pending"], ["Later", "pending"]]);
  assert.equal(core.relativeText(soon.at, now), "in 20 min");
});
