// Per-browser UI preferences: theme, widget layouts, alerts, timer options.
// They stay in this browser; the profile (game data) is what export/import
// carries.

const KEY = "aion2-armory-ui";
const listeners = new Set();

const DEFAULTS = {
  theme: "system",
  areas: {},
  alerts: {},
  timers: {},
  dashboard: {},
};

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

function mergeDefaults(target, defaults) {
  for (const [key, value] of Object.entries(defaults)) {
    if (target[key] === undefined) target[key] = clone(value);
    else if (isPlainObject(value) && isPlainObject(target[key])) mergeDefaults(target[key], value);
  }
  return target;
}

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    if (isPlainObject(parsed)) return mergeDefaults(parsed, DEFAULTS);
  } catch (e) { /* unreadable or blocked storage: defaults */ }
  return clone(DEFAULTS);
}

const state = read();

function notify() {
  for (const fn of [...listeners]) {
    try { fn(state); } catch (err) { console.error(err); }
  }
}

export function prefs() {
  return state;
}

// `path` is "a.b.c"; undefined deletes the key.
export function setPref(path, value) {
  const keys = String(path).split(".").filter(Boolean);
  if (!keys.length) return;
  let node = state;
  for (const key of keys.slice(0, -1)) {
    if (!isPlainObject(node[key])) node[key] = {};
    node = node[key];
  }
  const last = keys[keys.length - 1];
  if (value === undefined) delete node[last]; else node[last] = value;
  mergeDefaults(state, DEFAULTS);
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* storage blocked: keep it for this visit */ }
  notify();
}

export function onPrefs(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

window.addEventListener("storage", (e) => {
  if (e.key !== KEY) return;
  const fresh = read();
  for (const key of Object.keys(state)) delete state[key];
  Object.assign(state, fresh);
  notify();
});
