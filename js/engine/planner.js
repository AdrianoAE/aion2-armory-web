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
export const CRAFT_ODYLE_TASK = "Craft Odyle (morph)";
export const ODYLE_PURCHASE_TASKS = [SHOP_SPECIAL_TASK, CRAFT_ODYLE_TASK];
export const KIND_TITLES = { daily: "Daily", weekly: "Weekly", portals: "Abyss portals", available: "Info" };

const RENAMED_TASKS = { "buy shop odyle": SHOP_SPECIAL_TASK };
// Info rows that became a counter (Nightmare entries) or were dropped.
const REMOVED_TASKS = new Set(["nightmare", "expedition / transcendence"]);
// The main character buys and crafts the server's share, so these left the server card.
const REMOVED_SERVER_TASKS = new Set(ODYLE_PURCHASE_TASKS.map((name) => name.toLowerCase()));

export function defaultPlannerTasks() {
  const tasks = (prefix, entries) => entries.map(([name, kind], i) => ({ id: `${prefix}${i + 1}`, name, kind }));
  return {
    server: tasks("s", [
      ["Duty", "daily"],
      [SHOP_SPECIAL_TASK, "weekly"],
      [CRAFT_ODYLE_TASK, "weekly"],
      ["Daily dungeon", "weekly"],
      ["Command scrolls (Verteron and Abyss)", "weekly"],
      ["Shugo", "available"],
      ["Dimensional boss", "available"],
    ]).filter((t) => !REMOVED_SERVER_TASKS.has(t.name.toLowerCase())),
    character: tasks("c", [
      ["Farm 1M Kinah", "daily"],
      ["Supply request", "daily"],
      [SHOP_SPECIAL_TASK, "weekly"],
      [CRAFT_ODYLE_TASK, "weekly"],
      ["Ascension trial", "weekly"],
      ["Battlefield", "weekly"],
      ["Abyss silver medals", "weekly"],
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
      if (task.kind === "available" && REMOVED_TASKS.has((task.name || "").trim().toLowerCase())) {
        tasks.splice(tasks.indexOf(task), 1);
        for (const key of Object.keys(planner.done)) if (key.endsWith(":" + task.id)) delete planner.done[key];
        changed = true;
        continue;
      }
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
    if (scope === "server") {
      for (const task of tasks.filter((t) => REMOVED_SERVER_TASKS.has((t.name || "").trim().toLowerCase()))) {
        tasks.splice(tasks.indexOf(task), 1);
        for (const key of Object.keys(planner.done)) if (key.endsWith(":" + task.id)) delete planner.done[key];
        changed = true;
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

// "full" / "full in 3 h 12 min" / "" for a planner.odyle entry {value, since}.
export function odyleCapText(entry, now = new Date()) {
  if (!entry) return "";
  const value = Number(entry.value) || 0;
  const since = new Date(entry.since);
  if (Number.isNaN(since.getTime())) return "";
  if (odyleEnergy(value, since, now) >= ODYLE_MAX) return "full";
  const ticks = Math.ceil((ODYLE_MAX - value) / ODYLE_PER_TICK);
  const at = new Date(nextOdyleTick(since).getTime() + (ticks - 1) * ODYLE_TICK_HOURS * HOUR);
  return `full in ${durationText(at - now)} · ${capMoment(at, now)}`;
}

// Nightmare (solo boss) entries: +2 at every daily reset, held up to 14.
export const NIGHTMARE_MAX = 14;
export const NIGHTMARE_PER_DAY = 2;

function dailyResetsSince(since, now) {
  const resets = [];
  let at = new Date(since);
  if (Number.isNaN(at.getTime())) return resets;
  for (let guard = 0; guard < 400; guard += 1) {
    const next = nextReset("daily", at);
    if (!next || next > now) break;
    resets.push(next);
    at = next;
  }
  return resets;
}

export function nightmareEntries(value, since, now = new Date()) {
  const base = Math.max(0, Number(value) || 0);
  return Math.min(NIGHTMARE_MAX, base + NIGHTMARE_PER_DAY * dailyResetsSince(since, now).length);
}

// "full" / "full in 1 d 4 h" / "" for a planner.nightmare entry {value, since}.
export function nightmareCapText(entry, now = new Date()) {
  if (!entry) return "";
  const current = nightmareEntries(entry.value, entry.since, now);
  if (current >= NIGHTMARE_MAX) return "full";
  const resetsNeeded = Math.ceil((NIGHTMARE_MAX - current) / NIGHTMARE_PER_DAY);
  let at = now;
  for (let i = 0; i < resetsNeeded; i += 1) { at = nextReset("daily", at); if (!at) return ""; }
  return `full in ${durationText(at - now)} · ${capMoment(at, now)}`;
}

// "Mon 09:00", with the date when it is more than six days away.
export function capMoment(at, now = new Date()) {
  const far = at - now > 6 * 24 * 3600 * 1000;
  return at.toLocaleString([], far ? { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" } : { weekday: "short", hour: "2-digit", minute: "2-digit" });
}
