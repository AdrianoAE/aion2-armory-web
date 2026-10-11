// Odyle plan: how many reward cubes each character can still open before the
// weekly reset, and whether each goes to an Expedition (Conquest) or to
// Transcendence so the server's Kina cut (Cumulative Play Reward Adjustment)
// costs the least. Entry item levels, cube cost and weekly cube limits from
// aion2.wiki.fextralife.com and daevaguides.com, 2026-10; the Kina cut table
// from the game's own Cumulative Play Reward Adjustment window.

import { ODYLE_MAX, ODYLE_PER_TICK, lastReset, nextOdyleTick, nextReset } from "./planner.js";

// Every character has the subscription: a run opens the cube with the second
// reward too, so it always takes 80 Odyle.
export const RUN_COST = 80;
export const ENERGY_PER_ITEM = 40;
export const PURCHASE_LIMITS = { main: 20, alt: 4 };
export const ROLES = ["main", "priority", "alt", "off"];
export const ROLE_TITLES = { main: "Main", priority: "Priority", alt: "Alt", off: "Not played" };

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

// Alts run while a run still pays at least this share of its Kina.
export const ALT_MIN_SHARE = 80;

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

// Characters go in order: the main, then the priority characters in the
// order given, each doing every run its base and additional energy pay for
// up to the weekly limits. The other alts then use their energy while runs
// still pay at least ALT_MIN_SHARE of the Kina, and always at least what
// keeps their base energy from overflowing the cap by the reset. The main is
// counted Transcendence first; everyone else gets the split that pays the
// most Kina after the runs already counted, Transcendence first on a tie,
// since only item level 1600+ can use it and Conquest is left for the rest.
// characters: [{ id, name, role, itemLevel, base, extra, purchasesLeft }], in priority order.
// runsDone: the server's { conquest, transcendence } counts this week.
export function planWeek({ characters, runsDone = {}, now = new Date() }) {
  const reset = nextReset("weekly", now);
  const regen = regenUntil(now, reset);
  const done = { conquest: Math.max(0, Number(runsDone.conquest) || 0), transcendence: Math.max(0, Number(runsDone.transcendence) || 0) };
  const rank = { main: 0, priority: 1, alt: 2 };
  const rows = characters.filter((c) => c.role in rank).map((c, index) => {
    const itemLevel = Number(c.itemLevel) || 0;
    const base = Math.max(0, Math.min(ODYLE_MAX, c.base || 0));
    const extra = Math.max(0, c.extra || 0);
    const buyable = Math.max(0, c.purchasesLeft || 0) * ENERGY_PER_ITEM;
    const baseEnergy = base + regen;
    const extraEnergy = extra + buyable;
    const tier = conquestTier(itemLevel);
    const stage = transcendenceStage(itemLevel);
    const capacity = (tier ? WEEKLY_CUBES.conquest : 0) + (stage ? WEEKLY_CUBES.transcendence : 0);
    const baseCubes = Math.min(capacity, Math.floor(baseEnergy / RUN_COST));
    const overflowRuns = Math.min(capacity, Math.ceil(Math.max(0, baseEnergy - ODYLE_MAX) / RUN_COST));
    const energyRuns = Math.min(capacity, Math.floor((baseEnergy + extraEnergy) / RUN_COST));
    return {
      ...c, index, itemLevel, base, extra, regen, buyable, baseEnergy, extraEnergy, total: baseEnergy + extraEnergy, tier, stage,
      main: c.role === "main", fullUse: c.role !== "alt", baseCubes, overflowRuns, energyRuns, cubes: energyRuns, conquest: 0, transcendence: 0,
    };
  }).sort((a, b) => rank[a.role] - rank[b.role] || a.index - b.index);

  const counted = { ...done };
  const slotsAtLeast = (mode, share) => {
    let n = 0;
    while (n < 1000 && kinaPercent(mode, counted[mode] + n) >= share) n += 1;
    return n;
  };
  for (const r of rows) {
    if (!r.fullUse) {
      const okT = r.stage ? Math.min(WEEKLY_CUBES.transcendence, slotsAtLeast("transcendence", ALT_MIN_SHARE)) : 0;
      const okC = r.tier ? Math.min(WEEKLY_CUBES.conquest, slotsAtLeast("conquest", ALT_MIN_SHARE)) : 0;
      r.cubes = Math.max(r.overflowRuns, Math.min(r.energyRuns, okT + okC));
    }
    r.fromExtra = Math.max(0, r.cubes - r.baseCubes);
    const tLow = r.stage ? Math.max(0, r.cubes - (r.tier ? WEEKLY_CUBES.conquest : 0)) : 0;
    const tHigh = r.stage ? Math.min(r.cubes, WEEKLY_CUBES.transcendence) : 0;
    let t = tHigh;
    if (!r.main) {
      let best = -1;
      for (let option = tLow; option <= tHigh; option += 1) {
        const value = kinaTotal("conquest", counted.conquest, r.cubes - option) + kinaTotal("transcendence", counted.transcendence, option);
        if (value >= best) { best = value; t = option; }
      }
    }
    r.transcendence = t;
    r.conquest = r.cubes - t;
    r.kina = kinaTotal("conquest", counted.conquest, r.conquest) + kinaTotal("transcendence", counted.transcendence, r.transcendence);
    r.shares = {};
    for (const mode of ["conquest", "transcendence"]) {
      for (let i = 0; i < r[mode]; i += 1) {
        const share = kinaPercent(mode, counted[mode] + i);
        r.shares[share] = (r.shares[share] || 0) + 1;
      }
    }
    counted.conquest += r.conquest;
    counted.transcendence += r.transcendence;
    const spent = r.cubes * RUN_COST;
    r.extraKept = r.extraEnergy - Math.max(0, spent - r.baseEnergy);
    r.baseLost = Math.max(0, r.baseEnergy - Math.min(spent, r.baseEnergy) - ODYLE_MAX);
    r.baseAtReset = Math.min(ODYLE_MAX, Math.max(0, r.baseEnergy - spent));
  }

  const planned = { conquest: counted.conquest - done.conquest, transcendence: counted.transcendence - done.transcendence };
  const total = planned.conquest + planned.transcendence;
  const kina = rows.reduce((sum, r) => sum + r.kina, 0);
  return { reset, regen, done, planned, rows, after: counted, averagePercent: total ? Math.round(kina / total) : 0 };
}
