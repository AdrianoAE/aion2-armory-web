// Odyle plan: how many reward cubes each character can still open before the
// weekly reset, and whether each goes to an Expedition (Conquest) or to
// Transcendence so the server's Kina cut (Cumulative Play Reward Adjustment)
// costs the least. Entry item levels, cube cost and weekly cube limits from
// aion2.wiki.fextralife.com and daevaguides.com, 2026-10; the Kina cut table
// from the game's own Cumulative Play Reward Adjustment window.

import { ODYLE_MAX, ODYLE_PER_TICK, lastReset, nextOdyleTick, nextReset } from "./planner.js";

export const CUBE_COST = 40;
export const ENERGY_PER_ITEM = 40;
export const PURCHASE_LIMITS = { main: 20, alt: 4 };
export const ROLES = ["main", "alt", "off"];
export const ROLE_TITLES = { main: "Main", alt: "Alt", off: "Not played" };

export const WEEKLY_CUBES = { conquest: 21, transcendence: 14 };

export const CONQUEST_TIERS = [
  { tier: 1, itemLevel: 700, dungeons: ["Krao Cave", "Draupnir Cave"] },
  { tier: 2, itemLevel: 1400, dungeons: ["Urugugu Canyon", "Vakron Sky Island"] },
  { tier: 3, itemLevel: 2100, dungeons: ["Fire Temple", "Ferocious Horn Den"] },
];

export const TRANSCENDENCE_STAGES = [
  { stage: 1, itemLevel: 1600 },
  { stage: 2, itemLevel: 1900 },
  { stage: 3, itemLevel: 2200 },
  { stage: 4, itemLevel: 2500 },
];

// [first run count, Kina percent]: a cube opened while the server's count is
// at or above the threshold pays that share of its Kina.
export const KINA_CUTS = {
  conquest: [[0, 100], [84, 80], [105, 60], [126, 40], [147, 20]],
  transcendence: [[0, 100], [56, 80], [70, 60], [84, 40], [98, 20]],
};

export function kinaPercent(mode, count) {
  let percent = 100;
  for (const [from, share] of KINA_CUTS[mode]) if (count >= from) percent = share;
  return percent;
}

export function kinaTotal(mode, done, runs) {
  let total = 0;
  for (let i = 0; i < runs; i += 1) total += kinaPercent(mode, done + i);
  return total;
}

export function conquestTier(itemLevel) {
  return [...CONQUEST_TIERS].reverse().find((t) => itemLevel >= t.itemLevel) || null;
}

export function transcendenceStage(itemLevel) {
  return [...TRANSCENDENCE_STAGES].reverse().find((s) => itemLevel >= s.itemLevel) || null;
}

export function purchaseLimit(role) {
  return PURCHASE_LIMITS[role] || 0;
}

// Purchases count for the week they were made in.
export function purchasesThisWeek(entry, now) {
  if (!entry || !entry.at) return 0;
  return new Date(entry.at) >= lastReset("weekly", now) ? Math.max(0, Number(entry.count) || 0) : 0;
}

export function regenUntil(now, until) {
  let ticks = 0;
  for (let at = nextOdyleTick(now); at <= until; at = nextOdyleTick(at)) ticks += 1;
  return ticks * ODYLE_PER_TICK;
}

// The main is not planned: it counts at full use, every cube its base and
// additional energy pay for up to the weekly limits. The alts adapt around
// it: their base energy is spent first because it stops refilling at the
// cap, split between Expedition and Transcendence for the least Kina cut;
// their additional energy never expires, so it only fills cubes that still
// pay full Kina and the rest waits for a later week.
// characters: [{ id, name, role, itemLevel, base, extra, purchasesLeft }]
// runsDone: the server's { conquest, transcendence } counts this week.
export function planWeek({ characters, runsDone = {}, now = new Date() }) {
  const reset = nextReset("weekly", now);
  const regen = regenUntil(now, reset);
  const done = { conquest: Math.max(0, Number(runsDone.conquest) || 0), transcendence: Math.max(0, Number(runsDone.transcendence) || 0) };
  const rows = characters.filter((c) => c.role !== "off").map((c) => {
    const itemLevel = Number(c.itemLevel) || 0;
    const base = Math.max(0, Math.min(ODYLE_MAX, c.base || 0));
    const extra = Math.max(0, c.extra || 0);
    const buyable = Math.max(0, c.purchasesLeft || 0) * ENERGY_PER_ITEM;
    const baseEnergy = base + regen;
    const extraEnergy = extra + buyable;
    const tier = conquestTier(itemLevel);
    const stage = transcendenceStage(itemLevel);
    const capacity = (tier ? WEEKLY_CUBES.conquest : 0) + (stage ? WEEKLY_CUBES.transcendence : 0);
    const baseCubes = Math.min(capacity, Math.floor(baseEnergy / CUBE_COST));
    const allCubes = Math.min(capacity, Math.floor((baseEnergy + extraEnergy) / CUBE_COST));
    return {
      ...c, itemLevel, base, extra, regen, buyable, baseEnergy, extraEnergy, total: baseEnergy + extraEnergy, tier, stage,
      main: c.role === "main", baseCubes, extraRoom: allCubes - baseCubes, allCubes,
      conquest: 0, transcendence: 0, fromExtra: 0,
    };
  });

  const planned = { conquest: 0, transcendence: 0 };
  for (const r of rows.filter((x) => x.main)) {
    r.transcendence = r.stage ? Math.min(WEEKLY_CUBES.transcendence, r.allCubes) : 0;
    r.conquest = r.allCubes - r.transcendence;
    r.fromExtra = r.extraRoom;
    planned.conquest += r.conquest;
    planned.transcendence += r.transcendence;
  }

  const alts = rows.filter((x) => !x.main);
  const ahead = { conquest: done.conquest + planned.conquest, transcendence: done.transcendence + planned.transcendence };
  const runs = alts.reduce((sum, r) => sum + r.baseCubes, 0);
  const tLow = (r) => (r.stage ? Math.max(0, r.baseCubes - (r.tier ? WEEKLY_CUBES.conquest : 0)) : 0);
  const tHigh = (r) => (r.stage ? Math.min(r.baseCubes, WEEKLY_CUBES.transcendence) : 0);
  const tMin = alts.reduce((sum, r) => sum + tLow(r), 0);
  const tMax = alts.reduce((sum, r) => sum + tHigh(r), 0);
  let bestT = tMin;
  let bestValue = -1;
  for (let t = tMin; t <= tMax; t += 1) {
    const value = kinaTotal("conquest", ahead.conquest, runs - t) + kinaTotal("transcendence", ahead.transcendence, t);
    if (value > bestValue) { bestValue = value; bestT = t; }
  }
  let left = bestT - tMin;
  for (const r of alts) r.transcendence = tLow(r);
  for (const r of [...alts].sort((a, b) => b.itemLevel - a.itemLevel)) {
    const more = Math.min(left, tHigh(r) - r.transcendence);
    r.transcendence += more;
    left -= more;
  }
  for (const r of alts) r.conquest = r.baseCubes - r.transcendence;
  planned.conquest += runs - bestT;
  planned.transcendence += bestT;

  const fullKina = (mode) => kinaPercent(mode, done[mode] + planned[mode]) === 100;
  for (const r of [...alts].sort((a, b) => b.itemLevel - a.itemLevel)) {
    while (r.fromExtra < r.extraRoom) {
      let mode = null;
      if (r.stage && r.transcendence < WEEKLY_CUBES.transcendence && fullKina("transcendence")) mode = "transcendence";
      else if (r.tier && r.conquest < WEEKLY_CUBES.conquest && fullKina("conquest")) mode = "conquest";
      if (!mode) break;
      r[mode] += 1;
      planned[mode] += 1;
      r.fromExtra += 1;
    }
  }

  for (const r of rows) {
    const spent = (r.conquest + r.transcendence) * CUBE_COST;
    r.cubes = r.conquest + r.transcendence;
    r.extraKept = r.extraEnergy - Math.max(0, spent - r.baseEnergy);
    r.baseLost = Math.max(0, r.baseEnergy - Math.min(spent, r.baseEnergy) - ODYLE_MAX);
  }

  const total = planned.conquest + planned.transcendence;
  const kina = kinaTotal("conquest", done.conquest, planned.conquest) + kinaTotal("transcendence", done.transcendence, planned.transcendence);
  return {
    reset, regen, done, planned, rows,
    after: { conquest: done.conquest + planned.conquest, transcendence: done.transcendence + planned.transcendence },
    averagePercent: total ? Math.round(kina / total) : 0,
  };
}
