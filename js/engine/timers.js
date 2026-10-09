// Event timers from shugo.gg's feed, ported from armory_engine/timers.py.
// Schedules are hourly / daily / weekly / once in the region's zone (or a
// zone of their own, e.g. the Global resets in Seoul time). The browser's
// Intl does the zone maths; occurrences are Dates.

export const DEFAULT_REGION = "global-eu";
const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

const formatters = new Map();
function partsIn(zone, date) {
  if (!formatters.has(zone)) {
    formatters.set(zone, new Intl.DateTimeFormat("en-US", {
      timeZone: zone, hourCycle: "h23",
      year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric",
    }));
  }
  const out = {};
  for (const { type, value } of formatters.get(zone).formatToParts(date)) {
    if (type !== "literal") out[type] = Number(value);
  }
  return out;
}

// The zone's wall clock of `date`, as a Date whose UTC fields hold it.
export function toZone(date, zone) {
  const p = partsIn(zone, date);
  return new Date(Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second));
}

export function zoneOffsetMs(zone, date) {
  return toZone(date, zone).getTime() - Math.floor(date.getTime() / 1000) * 1000;
}

// A wall-clock moment in `zone` (UTC fields hold the wall clock) -> real Date.
export function fromZone(local, zone) {
  const guess = new Date(local.getTime() - zoneOffsetMs(zone, local));
  return new Date(local.getTime() - zoneOffsetMs(zone, guess));
}

export function zoneLabel(zone) {
  return zone.split("/").pop().replace(/_/g, " ");
}

export function eventSchedule(event, regionId) {
  return (event.schedules || {})[regionId] || null;
}

function scheduleZone(schedule, region) {
  return schedule.timeZone || region.timeZone || "UTC";
}

export function occurrences(event, region, windowStart, windowEnd, now = null) {
  const schedule = eventSchedule(event, region.id);
  if (!schedule) return [];
  const duration = (event.durationMinutes || 0) * 60000;
  const portal = event.portalMinutes ? event.portalMinutes * 60000 : 0;
  const labels = schedule.timeLabels || [];
  const make = (start, label = "") => ({
    start, end: new Date(start.getTime() + duration),
    portalEnd: portal ? new Date(start.getTime() + portal) : null, label,
  });
  const found = [];
  if (schedule.type === "once") {
    if (schedule.hideAfter && now && now >= new Date(schedule.hideAfter)) return [];
    found.push(make(new Date(schedule.at)));
  } else {
    const zone = scheduleZone(schedule, region);
    const first = toZone(windowStart, zone);
    const last = toZone(windowEnd, zone);
    let day = Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), first.getUTCDate()) - DAY;
    const lastDay = Date.UTC(last.getUTCFullYear(), last.getUTCMonth(), last.getUTCDate());
    for (; day <= lastDay; day += DAY) {
      let clocks;
      if (schedule.type === "hourly") {
        clocks = Array.from({ length: 24 }, (_, h) => [h, schedule.minute || 0]);
      } else if (schedule.type === "weekly" && !(schedule.days || []).includes(WEEKDAYS[(new Date(day).getUTCDay() + 6) % 7])) {
        clocks = [];
      } else {
        clocks = (schedule.times || []).map((t) => t.split(":").map(Number));
      }
      clocks.forEach(([hour, minute], i) => {
        found.push(make(fromZone(new Date(day + hour * HOUR + minute * 60000), zone), labels[i] || ""));
      });
    }
  }
  found.sort((a, b) => a.start - b.start);
  return found.filter((o) => o.start <= windowEnd && Math.max(o.end, o.start) >= windowStart);
}

export function isRunning(occurrence, now) {
  return occurrence.start <= now && now < occurrence.end;
}

export function nextOccurrence(event, region, now) {
  const found = occurrences(event, region, new Date(now.getTime() - 2 * HOUR), new Date(now.getTime() + 8 * DAY), now);
  return found.find((o) => o.end > now || (o.end.getTime() === o.start.getTime() && o.start >= now)) || null;
}

export function upcomingOccurrences(event, region, now, count = 3) {
  const found = occurrences(event, region, new Date(now.getTime() - 2 * HOUR), new Date(now.getTime() + 8 * DAY), now);
  return found.filter((o) => o.end > now || (o.end.getTime() === o.start.getTime() && o.start >= now)).slice(0, count);
}

// Events the region schedules that still have a time ahead (a one-off
// launch drops out once it has passed).
export function regionEvents(events, region, now) {
  return events.filter((e) => eventSchedule(e, region.id) && nextOccurrence(e, region, now));
}

export function scheduleSummary(schedule, region) {
  if (!schedule) return "";
  if (schedule.type === "hourly") return `Every hour at :${String(schedule.minute || 0).padStart(2, "0")}`;
  if (schedule.type === "once") return `Once · ${new Date(schedule.at).toISOString().slice(0, 16).replace("T", " ")} UTC`;
  const label = zoneLabel(scheduleZone(schedule, region));
  const times = (schedule.times || []).join(", ");
  if (schedule.type === "weekly") {
    const days = (schedule.days || []).map((d) => d[0].toUpperCase() + d.slice(1)).join(", ");
    return `${days} · ${times} ${label}`;
  }
  return `Daily · ${times} ${label}`;
}

export function hms(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const clock = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return days ? `${days}d ${clock}` : clock;
}

export function localClock(date) {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

export function dayWord(date, now) {
  const a = new Date(date); a.setHours(0, 0, 0, 0);
  const b = new Date(now); b.setHours(0, 0, 0, 0);
  const delta = Math.round((a - b) / DAY);
  if (delta === 0) return "Today";
  if (delta === 1) return "Tomorrow";
  return date.toLocaleDateString([], { weekday: "short" });
}

export function spanText(occurrence, now) {
  const start = localClock(occurrence.start);
  if (occurrence.end.getTime() === occurrence.start.getTime()) return `${start} · ${dayWord(occurrence.start, now)}`;
  return `${start}-${localClock(occurrence.end)} · ${dayWord(occurrence.start, now)}`;
}
