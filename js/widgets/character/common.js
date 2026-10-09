// Shared plumbing of the Character widgets: which character a widget shows,
// the header extras (character chip, "Open …" button), the loading flow
// and the checklist progress of a character.

import { registerWidget } from "../../widgets.js";
import { bp, characters, currentCharacter, plannerCharacterNamed, selectCharacter } from "../../state.js";
import { buildOfPreset, linkedSkillBuild } from "../../builds.js";
import { escapeHtml, navigate } from "../../app.js";
import { ODYLE_MAX, isTaskDone, odyleEnergy } from "../../engine/planner.js";

export { escapeHtml, ODYLE_MAX };

export const className = (cls) => (cls ? cls[0].toUpperCase() + cls.slice(1) : "");

const KIND_LABELS = { daily: "Daily", weekly: "Weekly", portals: "Portals" };

export const CHARACTER_SETTING = {
  key: "character",
  label: "Character",
  type: "select",
  help: "Show a specific character instead of the one selected in the roster.",
  options: () => [["", "Selected character"], ...characters().map((e) => [e.key, `${e.name || "Unnamed"} · ${className(e.class)}`])],
  default: "",
};

export function loadPage(name) {
  return import(`../../pages/${name}.js`);
}

// { entry, cls, name, preset, build, skillBuild, isCurrent } for the widget,
// { missing: true } when its chosen character is gone, null without any.
export function targetOf(settings) {
  const current = currentCharacter();
  const key = settings && settings.character;
  const entry = key ? characters().find((e) => e.key === key) : current;
  if (!entry) return key ? { missing: true } : null;
  const p = bp();
  const isCurrent = !!current && current.key === entry.key;
  const preset = isCurrent ? p.current_build_name : entry.preset;
  return {
    entry,
    cls: entry.class,
    name: entry.name,
    preset,
    build: preset ? buildOfPreset(p, entry.class, preset) : null,
    skillBuild: preset ? linkedSkillBuild(p, entry.class, preset) : null,
    isCurrent,
  };
}

export function openFor(target, page) {
  if (target && !target.isCurrent) selectCharacter(target.cls, target.preset, target.name);
  navigate(page);
}

export function progressOf(name, now = new Date()) {
  const character = plannerCharacterNamed(name);
  if (!character) return null;
  const planner = bp().planner;
  const kinds = [];
  for (const kind of Object.keys(KIND_LABELS)) {
    const tasks = planner.tasks.character.filter((t) => t.kind === kind);
    if (!tasks.length) continue;
    const done = tasks.filter((t) => isTaskDone(planner, character.id, t, now)).length;
    kinds.push({ kind, label: KIND_LABELS[kind], done, total: tasks.length });
  }
  const odyle = planner.odyle[character.id];
  const energy = odyle ? odyleEnergy(Number(odyle.value), new Date(odyle.since), now) : null;
  return { odyle: energy, kinds };
}

export function kindChipsHtml(kinds) {
  return kinds.map((k) => {
    const complete = k.total > 0 && k.done >= k.total;
    return `<span class="tag ${complete ? "success" : k.kind}" title="${k.label} tasks done">${complete ? "✓ " : ""}${k.label} ${k.done}/${k.total}</span>`;
  }).join("");
}

export function odyleLevel(energy) {
  if (energy >= ODYLE_MAX) return "full";
  if (energy >= ODYLE_MAX * 0.9) return "high";
  return "";
}

function decorateHead(el, def, target, ctx) {
  const head = el.closest(".wa-card") ? el.closest(".wa-card").querySelector(".wa-head") : null;
  if (!head) return () => {};
  head.querySelectorAll(".cw-head-extra").forEach((n) => n.remove());
  const extra = document.createElement("span");
  extra.className = "cw-head-extra";
  if (target && target.entry && ctx.settings.character) {
    extra.innerHTML = `<span class="tag class-${target.cls}" title="${escapeHtml(className(target.cls))}">${escapeHtml(target.name || "Unnamed")}</span>`;
  }
  if (def.page && target && target.entry) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cw-open";
    button.textContent = `Open ${def.pageTitle}`;
    button.addEventListener("click", () => openFor(targetOf(ctx.settings), def.page));
    extra.appendChild(button);
  }
  head.insertBefore(extra, head.querySelector(".wa-tools"));
  return () => extra.remove();
}

const generations = new WeakMap();

// `fill(box, target, ctx, el)` builds the body off-screen (it may await its page
// module) and returns an optional cleanup; a stale fill is thrown away.
async function run(def, el, ctx) {
  const target = targetOf(ctx.settings);
  const generation = (generations.get(el) || 0) + 1;
  generations.set(el, generation);
  const cleanups = [decorateHead(el, def, target, ctx)];
  const cleanup = () => { for (const fn of cleanups.splice(0)) { try { fn(); } catch (err) { console.warn(err); } } };
  if (!target) {
    el.innerHTML = '<div class="muted small">No character yet.</div>';
    return cleanup;
  }
  if (target.missing) {
    el.innerHTML = '<div class="muted small">That character no longer exists. Pick another one in the widget settings.</div>';
    return cleanup;
  }
  el.innerHTML = '<div class="muted small cw-loading">Loading…</div>';
  const box = document.createElement("div");
  box.className = `cw-body cw-${def.id.split(".")[1]}`;
  try {
    const done = await def.fill(box, target, ctx, el);
    if (typeof done === "function") cleanups.push(done);
  } catch (err) {
    console.warn(`${def.id} unavailable:`, err);
    if (generations.get(el) === generation) el.innerHTML = `<div class="muted small">Not available: ${escapeHtml(err && err.message ? err.message : err)}</div>`;
    return cleanup;
  }
  if (generations.get(el) !== generation) { cleanup(); return null; }
  el.replaceChildren(box);
  if (box.afterAttach) box.afterAttach();
  return cleanup;
}

export function characterWidget(def) {
  const { settings = [], live = false } = def;
  return registerWidget({
    id: def.id,
    title: def.title,
    group: "Character",
    description: def.description,
    accent: def.accent,
    defaultSize: def.defaultSize,
    live,
    settings: [...settings, CHARACTER_SETTING],
    render(el, ctx) { return run(def, el, ctx); },
    compact: def.compact,
  });
}
