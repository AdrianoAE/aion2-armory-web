// Checklist resets. The game's schedule is CEST (UTC+2, a fixed offset):
// daily 09:00, weekly Wednesday 11:00, Abyss portals Mon/Thu/Sat 21:00,
// Odyle energy +15 every 3 hours from 09:00. Moments are JS Dates (UTC inside); the UI formats
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

export const SHOP_SPECIAL_TASK = "Buy Shop(H) → Special";
export const KIND_TITLES = { daily: "Daily", weekly: "Weekly", portals: "Abyss portals", available: "Info" };

const RENAMED_TASKS = { "buy shop odyle": SHOP_SPECIAL_TASK };

export function defaultPlannerTasks() {
  const tasks = (prefix, entries) => entries.map(([name, kind], i) => ({ id: `${prefix}${i + 1}`, name, kind }));
  return {
    server: tasks("s", [
      ["Duty", "daily"],
      [SHOP_SPECIAL_TASK, "weekly"],
      ["Craft Odyle (morph)", "weekly"],
      ["Daily dungeon", "weekly"],
      ["Command scrolls (Verteron and Abyss)", "weekly"],
      ["Shugo", "available"],
      ["Dimensional boss", "available"],
    ]),
    character: tasks("c", [
      ["Farm 1M Kinah", "daily"],
      ["Supply request", "daily"],
      [SHOP_SPECIAL_TASK, "weekly"],
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

export function durationText(ms) {
  const minutes = Math.max(0, Math.ceil(ms / 60000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days) return hours ? `${days} d ${hours} h` : `${days} d`;
  if (hours) return mins ? `${hours} h ${mins} min` : `${hours} h`;
  return `${mins} min`;
}

export function taskDoneAt(planner, scopeId, taskId) {
  const stamp = planner.done[`${scopeId}:${taskId}`];
  return stamp ? new Date(stamp) : null;
}

export function isTaskDone(planner, scopeId, task, now) {
  return isDone(task.kind, taskDoneAt(planner, scopeId, task.id), now);
}

// A character can opt out of any character task: planner.excluded[charId] = [taskId].
export function isExcluded(planner, scopeId, taskId) {
  const list = (planner.excluded || {})[scopeId];
  return Array.isArray(list) && list.includes(taskId);
}

export function setExcluded(planner, scopeId, taskId, excluded) {
  planner.excluded = planner.excluded || {};
  const list = new Set(planner.excluded[scopeId] || []);
  if (excluded) list.add(taskId); else list.delete(taskId);
  if (list.size) planner.excluded[scopeId] = [...list]; else delete planner.excluded[scopeId];
}

export function characterTasks(planner, scopeId, kind = null) {
  return (planner.tasks.character || []).filter((t) => (!kind || t.kind === kind) && !isExcluded(planner, scopeId, t.id));
}

export function taskProgress(planner, scopeId, tasks, now) {
  const tracked = tasks.filter((t) => RESETS[t.kind] && !isExcluded(planner, scopeId, t.id));
  return { done: tracked.filter((t) => isTaskDone(planner, scopeId, t, now)).length, total: tracked.length };
}

// Ids stay so ticks survive. The default merge matches by name, so it may
// already have added the new label as a second task: fold that copy back.
export function migratePlannerTasks(planner) {
  let changed = false;
  planner.defaults_seen = planner.defaults_seen || [];
  planner.done = planner.done || {};
  for (const [scope, tasks] of Object.entries(planner.tasks || {})) {
    for (const task of [...tasks]) {
      const label = RENAMED_TASKS[(task.name || "").trim().toLowerCase()];
      if (!label) continue;
      task.name = label;
      changed = true;
      for (const copy of tasks.filter((t) => t !== task && t.name === label && t.kind === task.kind)) {
        for (const key of Object.keys(planner.done)) {
          if (!key.endsWith(":" + copy.id)) continue;
          const own = key.slice(0, -copy.id.length) + task.id;
          if (!planner.done[own] || new Date(planner.done[own]) < new Date(planner.done[key])) planner.done[own] = planner.done[key];
          delete planner.done[key];
        }
        tasks.splice(tasks.indexOf(copy), 1);
      }
    }
    for (const label of new Set(Object.values(RENAMED_TASKS))) {
      const key = `${scope}:${label}`;
      if (tasks.some((t) => t.name === label) && !planner.defaults_seen.includes(key)) {
        planner.defaults_seen.push(key);
        changed = true;
      }
    }
  }
  return changed;
}
