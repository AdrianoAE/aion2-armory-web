// Planner resets, ported from ItemDatabase/armory_engine/planner.py.
// The game's schedule is CEST (UTC+2, a fixed offset): daily 09:00, weekly
// Wednesday 11:00, Abyss portals Mon/Thu/Sat 21:00, Odyle energy +15 every
// 3 hours from 09:00. Moments are JS Dates (UTC inside); the UI formats
// them in the browser's zone.

export const PLANNER_KINDS = ["daily", "weekly", "portals", "available"];
export const CEST_OFFSET_MS = 2 * 3600 * 1000;
export const ODYLE_PER_TICK = 15;
export const ODYLE_MAX = 840;
const ODYLE_TICK_HOURS = 3;
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

// Reset moments per kind as [weekday (0=Mon) or null for every day, hour].
const RESETS = {
  daily: [[null, 9]],
  weekly: [[2, 11]],
  portals: [[0, 21], [3, 21], [5, 21]],
};

// A "schedule time" is a Date whose UTC fields hold the CEST wall clock.
export function scheduleTime(utc) {
  return new Date(utc.getTime() + CEST_OFFSET_MS);
}

export function fromScheduleTime(local) {
  return new Date(local.getTime() - CEST_OFFSET_MS);
}

function weekdayMon0(local) {
  return (local.getUTCDay() + 6) % 7;
}

function resetMomentsAround(kind, local) {
  const midnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const moments = [];
  for (let offset = -7; offset <= 7; offset++) {
    const day = new Date(midnight + offset * DAY);
    for (const [weekday, hour] of RESETS[kind]) {
      if (weekday === null || weekdayMon0(day) === weekday) {
        moments.push(new Date(day.getTime() + hour * HOUR));
      }
    }
  }
  return moments.sort((a, b) => a - b);
}

export function lastReset(kind, now) {
  if (!RESETS[kind]) return null;
  const local = scheduleTime(now);
  const past = resetMomentsAround(kind, local).filter((m) => m <= local);
  return fromScheduleTime(past[past.length - 1]);
}

export function nextReset(kind, now) {
  if (!RESETS[kind]) return null;
  const local = scheduleTime(now);
  return fromScheduleTime(resetMomentsAround(kind, local).find((m) => m > local));
}

export function isDone(kind, doneAt, now) {
  if (!doneAt) return false;
  const reset = lastReset(kind, now);
  return reset === null || doneAt >= reset;
}

function nextOdyleTickLocal(local) {
  const floored = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), local.getUTCHours()));
  let tick = new Date(floored.getTime() + ((-local.getUTCHours() % ODYLE_TICK_HOURS) + ODYLE_TICK_HOURS) % ODYLE_TICK_HOURS * HOUR);
  if (tick <= local) tick = new Date(tick.getTime() + ODYLE_TICK_HOURS * HOUR);
  return tick;
}

export function odyleEnergy(value, since, now) {
  const first = nextOdyleTickLocal(scheduleTime(since));
  const nowLocal = scheduleTime(now);
  if (first > nowLocal) return Math.min(value, ODYLE_MAX);
  const ticks = Math.floor((nowLocal - first) / (ODYLE_TICK_HOURS * HOUR)) + 1;
  return Math.min(ODYLE_MAX, value + ODYLE_PER_TICK * ticks);
}

export function nextOdyleTick(now) {
  return fromScheduleTime(nextOdyleTickLocal(scheduleTime(now)));
}

export function defaultPlannerTasks() {
  const tasks = (prefix, entries) => entries.map(([name, kind], i) => ({ id: `${prefix}${i + 1}`, name, kind }));
  return {
    server: tasks("s", [
      ["Duty", "daily"],
      ["Buy shop Odyle", "weekly"],
      ["Craft Odyle (morph)", "weekly"],
      ["Daily dungeon", "weekly"],
      ["Command scrolls (Verteron and Abyss)", "weekly"],
      ["Shugo", "available"],
      ["Dimensional boss", "available"],
    ]),
    character: tasks("c", [
      ["Farm 1M Kinah", "daily"],
      ["Supply request", "daily"],
      ["Buy shop Odyle", "weekly"],
      ["Craft Odyle (morph)", "weekly"],
      ["Ascension trial", "weekly"],
      ["Battlefield", "weekly"],
      ["Nightmare", "available"],
      ["Expedition / Transcendence", "available"],
      ["Abyss portals", "portals"],
    ]),
  };
}

export function countdown(ms) {
  const minutes = Math.max(0, Math.floor(ms / 60000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  return days ? `${days}d ${hours}h` : `${hours}h ${String(mins).padStart(2, "0")}m`;
}
