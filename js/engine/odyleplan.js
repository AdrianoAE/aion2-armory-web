// Odyle plan: how many reward cubes each character can still open before the
// weekly reset, and whether each goes to Conquest or Transcendence so the
// server's Kina cut (Cumulative Play Reward Adjustment) costs the least.
// Numbers from aion2.wiki.fextralife.com and daevaguides.com, 2026-10; the
// Kina cut table from r/Aion2.

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

// characters: [{ id, name, role, itemLevel, base, extra, purchasesLeft }]
// runsDone: the server's { conquest, transcendence } counts this week.
export function planWeek({ characters, runsDone = {}, now = new Date() }) {
  const reset = nextReset("weekly", now);
  const regen = regenUntil(now, reset);
  const done = { conquest: Math.max(0, Number(runsDone.conquest) || 0), transcendence: Math.max(0, Number(runsDone.transcendence) || 0) };
  const rows = characters.filter((c) => c.role !== "off").map((c) => {
    const itemLevel = Number(c.itemLevel) || 0;
    const buyable = Math.max(0, c.purchasesLeft || 0) * ENERGY_PER_ITEM;
    const energy = Math.max(0, Math.min(ODYLE_MAX, c.base || 0)) + Math.max(0, c.extra || 0);
    const total = energy + regen + buyable;
    const tier = conquestTier(itemLevel);
    const stage = transcendenceStage(itemLevel);
    const cubes = Math.floor(total / CUBE_COST);
    const usable = Math.min(cubes, (tier ? WEEKLY_CUBES.conquest : 0) + (stage ? WEEKLY_CUBES.transcendence : 0));
    return {
      ...c, itemLevel, energy, regen, buyable, total, tier, stage, cubes, usable,
      tLow: stage ? Math.max(0, usable - (tier ? WEEKLY_CUBES.conquest : 0)) : 0,
      tHigh: stage ? Math.min(usable, WEEKLY_CUBES.transcendence) : 0,
      conquest: 0, transcendence: 0,
    };
  });

  const runs = rows.reduce((sum, r) => sum + r.usable, 0);
  const tMin = rows.reduce((sum, r) => sum + r.tLow, 0);
  const tMax = rows.reduce((sum, r) => sum + r.tHigh, 0);
  let bestT = tMin;
  let bestValue = -1;
  for (let t = tMin; t <= tMax; t += 1) {
    const value = kinaTotal("conquest", done.conquest, runs - t) + kinaTotal("transcendence", done.transcendence, t);
    if (value > bestValue) { bestValue = value; bestT = t; }
  }

  let left = bestT - tMin;
  for (const r of rows) r.transcendence = r.tLow;
  for (const r of [...rows].sort((a, b) => b.itemLevel - a.itemLevel)) {
    const more = Math.min(left, r.tHigh - r.transcendence);
    r.transcendence += more;
    left -= more;
  }
  for (const r of rows) {
    r.conquest = r.usable - r.transcendence;
    r.leftover = r.total - r.usable * CUBE_COST;
    r.skipPurchases = Math.min(Math.max(0, r.purchasesLeft || 0), Math.floor(r.leftover / ENERGY_PER_ITEM));
  }

  const planned = { conquest: runs - bestT, transcendence: bestT };
  return {
    reset, regen, done, planned, rows,
    after: { conquest: done.conquest + planned.conquest, transcendence: done.transcendence + planned.transcendence },
    averagePercent: runs ? Math.round(bestValue / runs) : 0,
  };
}
