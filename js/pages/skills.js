// Skill Planner page: per-class skill builds, the Skill Description cards
// (level counters, Arcana wish, specializations in effect, star, hide), the
// description panel, the Priority List, and the skill points header. Port of
// the desktop's _build_skill_planner_tab and friends.

import { bp, onChange, save } from "../state.js";
import {
  DAMAGE_TYPE_COLORS, MONOLITH_MAX_LEVEL, SECTION_LABELS, SKILLPOINTS_BASE_AT_LEVEL_45, SKILL_LEVEL_BASE_CAP, SKILL_TYPES,
  SKILL_TYPE_COLORS, STIGMA_LEVEL_BASE_CAP, activeSpecCap, arcanaCeiling, arcanaClassPools, arcanaUsableLordTypes,
  cooldownReductionMs, currentSkillBuildName, data, describeSkill, emptyBuildState, ensureClassBuilds, escapeHtml, formatLevelHtml,
  formatSkillStats, layoutCopy, ready, setCurrentSkillBuild, skillContext, skillIconUrl, skillPointsRemaining, specIconHtml,
  specIconUrl, specLabel, specsHtml, specsInEffect, stigmaPointsSpent,
} from "../engine/skills.js";
import { iconImage, loadIcons, palette } from "./layout.js";

const TEXT = {
  title: "Skill Planner",
  pointsFree: "Skill Points Available:",
  monolith: "Monolith Level:",
  unlimited: "Unlimited",
  unlimitedTip: "Ignore the Skill Points budget. Skill Points still raise each skill to level 10 at most.",
  stigmaPoints: "Stigma Points:",
  calculator: "Arcana Calculator",
  addBuild: "Add new build", duplicateBuild: "Duplicate current build", renameBuild: "Rename current build", deleteBuild: "Delete current build",
  newBuildTitle: "New Build", nameColon: "Name:", duplicateDefault: (name) => `${name} (Copy)`,
  deleteConfirm: (name) => `Really delete "${name}"? This cannot be undone.`,
  tabDescription: "Skill Description", tabPriority: "Priority List",
  search: "Search…", active: "Active", passive: "Passive", stigma: "Stigma", onlyFavorites: "Only favorites",
  hidden: (count) => `Hidden (${count})`, hiddenTip: "Also show hidden skills, dimmed",
  chooseSkill: "Choose a skill", specializations: "Specializations", details: "Details",
  onPriorityList: "On the Priority List", hideTip: "Hide from the list", unhideTip: "Show in the list again",
  wishTip: "Arcana wish – counts toward the damage preview, but resets once the Arcana Calculator applies a combination to a build.",
  maxHint: (max) => `max +${max}`, noCard: "No available Arcana card can boost this skill for your class.",
  priorityHint: "Set a skill priority order for Active, Passive, and Stigma skills each – click a slot to assign a skill, and '+' to add another slot. Each skill can only appear once per list.",
  chooseSkillTitle: "Choose Skill", removePriority: "Remove from list", select: "Select",
};

const CARD_COLUMNS = 2;
const EXPORT_WIDTH = 1400;

const STAR_SVG = `<svg viewBox="0 0 18 18" width="18" height="18"><polygon fill="#fbbf24" points="9,0.5 11.4,6.1 17.5,6.5 12.9,10.5 14.3,16.5 9,13.3 3.7,16.5 5.1,10.5 0.5,6.5 6.6,6.1"/></svg>`;
function eyeSvg(slashed) {
  return `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
    <path d="M1.3 8 Q8 1.3 14.7 8 Q8 14.7 1.3 8 Z"/><circle cx="8" cy="8" r="1.9" fill="currentColor"/>${slashed ? `<path d="M2.9 2.9 L13.1 13.1"/>` : ""}</svg>`;
}
const MINUS_SVG = `<svg viewBox="0 0 14 14" width="14" height="14"><rect x="2" y="6" width="10" height="2" rx="1" fill="currentColor"/></svg>`;
const PLUS_SVG = `<svg viewBox="0 0 14 14" width="14" height="14"><rect x="2" y="6" width="10" height="2" rx="1" fill="currentColor"/><rect x="6" y="2" width="2" height="10" rx="1" fill="currentColor"/></svg>`;

// ── module state ────────────────────────────────────────────────────────────

let main = null;
let context = null;
let unsubscribe = null;
let suppress = false;
const view = { tab: "description", types: { active: true, passive: true, stigma: true }, query: "", favoritesOnly: false, showHidden: false, selectedId: null };
let arcana = { usable: [], pools: {} };
let cards = {};

function commit(fn) {
  fn();
  suppress = true;
  try { save(); } finally { suppress = false; }
}

function refreshContext() {
  const p = bp();
  const classLower = (p.character_class || "").toLowerCase();
  const buildName = currentSkillBuildName(p, classLower);
  context = skillContext(p, classLower, buildName);
  arcana.usable = arcanaUsableLordTypes(data.arcanaInfo);
  arcana.pools = arcanaClassPools(data.arcanaClassSkills, context.dataKey, arcana.usable);
}

const q = (selector) => main.querySelector(selector);

// ── skill points ────────────────────────────────────────────────────────────

function pointsExhausted() {
  const p = bp();
  return p.skill_points_unlimited === false && skillPointsRemaining(p.skill_levels, context.typeById, p.monolith_level || 0) <= 0;
}

function refreshSkillPoints() {
  const p = bp();
  const unlimited = p.skill_points_unlimited !== false;
  const value = q("#sp-value");
  if (unlimited) value.innerHTML = `<span class="lv-manual">∞</span>`;
  else {
    const remaining = skillPointsRemaining(p.skill_levels, context.typeById, p.monolith_level || 0);
    const base = Math.min(remaining, SKILLPOINTS_BASE_AT_LEVEL_45);
    value.innerHTML = `<span class="lv-manual">${base}</span> <span class="lv-bonus">(+${remaining - base})</span>`;
  }
  q("#monolith-level").disabled = unlimited;
  q("#sp-unlimited").classList.toggle("active", unlimited);
  const stigma = stigmaPointsSpent(p.skill_levels, context.typeById);
  q("#stigma-value").innerHTML = stigma <= 0 ? `<span class="lv-manual">0</span>` : `<span class="lv-danger">-${stigma}</span>`;
  const canSpend = !pointsExhausted();
  for (const card of Object.values(cards)) if (card.plusButton) card.plusButton.disabled = !canSpend;
  q("#arcana-calculator").disabled = !Object.values(p.skill_arcana_wish).some((v) => v > 0);
}

// ── cards ───────────────────────────────────────────────────────────────────

function filteredSkills() {
  const query = view.query.trim().toLowerCase();
  return context.skills.filter((s) => view.types[s.type]
    && (!query || (s.name || "").toLowerCase().includes(query))
    && (!view.favoritesOnly || context.priorityIds.has(s.id)));
}

function isShown(skillId) { return view.showHidden || !context.hidden.has(skillId); }

function wishRowHtml(skill) {
  if (skill.type !== "active" && skill.type !== "passive") return "";
  const ceiling = arcanaCeiling(skill.id, skill.type, arcana.usable, arcana.pools);
  if (ceiling <= 0) return `<div class="wish-row"><span class="arcana-hint no-card">${TEXT.noCard}</span></div>`;
  const wish = context.wishOf(skill.id);
  return `<div class="wish-row">
    <button class="wish-step wish-minus" title="${TEXT.wishTip}">${MINUS_SVG}</button>
    <span class="arcana-hint">${TEXT.maxHint(ceiling)}</span>
    <button class="wish-step wish-plus" title="${TEXT.wishTip}" ${wish >= ceiling ? "disabled" : ""}>${PLUS_SVG}</button></div>`;
}

function buildCard(skill) {
  const id = skill.id;
  const card = document.createElement("div");
  card.className = "skill-card";
  card.dataset.skill = id;
  const url = skillIconUrl(skill);
  card.innerHTML = `
    <div class="skill-card-left">
      <div class="skill-card-top">
        <div class="skill-row-icon">${url ? `<img src="${url}" alt="">` : ""}</div>
        <div class="skill-card-text"><div class="skill-card-name">${escapeHtml(skill.name || "")}</div>
          <div class="skill-card-type" style="color:${SKILL_TYPE_COLORS[skill.type] || "var(--muted)"}">${escapeHtml((skill.type || "").toUpperCase())}</div></div>
      </div>
      <div class="skill-card-specs"></div>
    </div>
    <div class="skill-card-right">
      <div class="marker-row"><span class="star" title="${TEXT.onPriorityList}">${STAR_SVG}</span><button class="hide-btn"></button></div>
      <div class="level-row"><button class="level-step minus">${MINUS_SVG}</button><span class="level-value"></span><button class="level-step plus">${PLUS_SVG}</button></div>
      ${wishRowHtml(skill)}
    </div>`;
  const entry = { skill, el: card, plusButton: skill.type !== "stigma" ? card.querySelector(".plus") : null };
  card.addEventListener("click", (e) => { if (!e.target.closest("button")) selectSkill(skill); });
  card.querySelector(".hide-btn").addEventListener("click", () => toggleHidden(id));
  card.querySelector(".minus").addEventListener("click", () => changeLevel(id, -1));
  card.querySelector(".plus").addEventListener("click", () => changeLevel(id, 1));
  const wishMinus = card.querySelector(".wish-minus"), wishPlus = card.querySelector(".wish-plus");
  if (wishMinus) wishMinus.addEventListener("click", () => changeWish(id, -1));
  if (wishPlus) wishPlus.addEventListener("click", () => changeWish(id, 1));
  refreshCard(entry);
  return entry;
}

function refreshCard(entry) {
  const { skill, el } = entry;
  const id = skill.id;
  el.querySelector(".level-value").innerHTML = formatLevelHtml(context.manual(id), context.bonusOf(id), context.wishOf(id));
  el.querySelector(".level-value").title = levelSourceTooltip(id);
  const specs = el.querySelector(".skill-card-specs");
  const html = specsHtml(skill, context.effective(id), context.chosen(id));
  specs.innerHTML = html;
  specs.hidden = !html;
  el.querySelector(".star").hidden = !context.priorityIds.has(id);
  const hidden = context.hidden.has(id);
  const hideBtn = el.querySelector(".hide-btn");
  hideBtn.innerHTML = eyeSvg(!hidden);
  hideBtn.title = hidden ? TEXT.unhideTip : TEXT.hideTip;
  el.classList.toggle("hidden-skill", hidden);
  el.classList.toggle("current", view.selectedId === id);
  const wishPlus = el.querySelector(".wish-plus");
  if (wishPlus) wishPlus.disabled = context.wishOf(id) >= arcanaCeiling(id, skill.type, arcana.usable, arcana.pools);
}

function levelSourceTooltip(id) {
  const lines = [];
  const { gear, arcana: arcanaBonus, daevanion } = context.bonus;
  if (gear[id]) lines.push(`Jewelry: +${gear[id]}`);
  if (arcanaBonus[id]) lines.push(`Arcana: +${arcanaBonus[id]}`);
  if (daevanion[id]) lines.push(`Daevanion Board: +${daevanion[id]}`);
  if (context.wishOf(id)) lines.push(`Arcana Wish: +${context.wishOf(id)}`);
  return lines.length ? `Level Source\n${lines.join("\n")}` : "";
}

function buildCards() {
  cards = {};
  const skills = filteredSkills();
  for (const type of SKILL_TYPES) {
    const grid = q(`.skill-section[data-type="${type}"] .skill-grid`);
    grid.innerHTML = "";
    for (const skill of skills.filter((s) => s.type === type)) {
      const entry = buildCard(skill);
      cards[skill.id] = entry;
      grid.appendChild(entry.el);
    }
  }
  relayoutCards();
  const selected = skills.find((s) => s.id === view.selectedId);
  if (selected && isShown(selected.id)) showDescription(selected); else clearDescription();
}

function relayoutCards() {
  refreshShowHiddenButton();
  for (const type of SKILL_TYPES) {
    const section = q(`.skill-section[data-type="${type}"]`);
    let shown = 0;
    for (const entry of Object.values(cards)) {
      if (entry.skill.type !== type) continue;
      const visible = isShown(entry.skill.id);
      entry.el.hidden = !visible;
      if (visible) shown++;
    }
    section.hidden = shown === 0;
  }
}

function refreshShowHiddenButton() {
  const count = context.skills.filter((s) => context.hidden.has(s.id)).length;
  const btn = q("#show-hidden");
  btn.textContent = TEXT.hidden(count);
  btn.hidden = count === 0;
  if (count === 0) view.showHidden = false;
  btn.classList.toggle("active", view.showHidden);
}

// ── card actions ────────────────────────────────────────────────────────────

function changeLevel(id, delta) {
  const p = bp();
  const isStigma = context.typeById[id] === "stigma";
  if (delta > 0 && !isStigma && pointsExhausted()) return;
  const cap = isStigma ? STIGMA_LEVEL_BASE_CAP : SKILL_LEVEL_BASE_CAP;
  commit(() => { p.skill_levels[id] = Math.max(0, Math.min(cap, (p.skill_levels[id] || 0) + delta)); });
  afterSkillChange(id);
}

function changeWish(id, delta) {
  const p = bp();
  const ceiling = arcanaCeiling(id, context.typeById[id], arcana.usable, arcana.pools);
  commit(() => { p.skill_arcana_wish[id] = Math.max(0, Math.min(ceiling, (p.skill_arcana_wish[id] || 0) + delta)); });
  afterSkillChange(id);
}

function afterSkillChange(id) {
  if (cards[id]) refreshCard(cards[id]);
  refreshSkillPoints();
  if (view.selectedId === id) refreshDescriptionPanel(context.byId[id]);
}

function toggleHidden(id) {
  const p = bp();
  commit(() => {
    const index = p.skill_hidden_ids.indexOf(id);
    if (index >= 0) p.skill_hidden_ids.splice(index, 1); else p.skill_hidden_ids.push(id);
    context.hidden = new Set(p.skill_hidden_ids);
  });
  if (cards[id]) refreshCard(cards[id]);
  relayoutCards();
  if (view.selectedId === id && !isShown(id)) clearDescription();
}

// ── description panel ───────────────────────────────────────────────────────

function selectSkill(skill) {
  const previous = view.selectedId;
  view.selectedId = skill.id;
  if (previous && cards[previous]) cards[previous].el.classList.remove("current");
  if (cards[skill.id]) cards[skill.id].el.classList.add("current");
  showDescription(skill);
}

function clearDescription() {
  view.selectedId = null;
  const panel = q("#skill-desc");
  panel.querySelector(".desc-icon").innerHTML = "";
  panel.querySelector(".desc-title").textContent = TEXT.chooseSkill;
  panel.querySelector(".desc-badges").innerHTML = "";
  panel.querySelector(".desc-text").innerHTML = "";
  panel.querySelector(".desc-specs-header").hidden = true;
  panel.querySelector(".desc-specs").hidden = true;
  panel.querySelector(".desc-stats").innerHTML = "—";
}

function badge(text, color) {
  return `<span class="type-badge" style="color:${color};border-color:${color}80;background:${color}29">${text}</span>`;
}

function showDescription(skill) {
  const panel = q("#skill-desc");
  const url = skillIconUrl(skill);
  panel.querySelector(".desc-icon").innerHTML = url ? `<img src="${url}" alt="">` : "";
  panel.querySelector(".desc-title").textContent = skill.name || "";
  let badges = "";
  if (skill.type) badges += badge(skill.type[0].toUpperCase() + skill.type.slice(1), SKILL_TYPE_COLORS[skill.type] || "#94a3b8");
  if (skill.damageType === "physic" || skill.damageType === "magic") badges += badge(skill.damageType === "physic" ? "Physical" : "Magic", DAMAGE_TYPE_COLORS[skill.damageType]);
  panel.querySelector(".desc-badges").innerHTML = badges;
  refreshDescriptionPanel(skill);
}

function refreshDescriptionPanel(skill) {
  const panel = q("#skill-desc");
  const level = context.effective(skill.id);
  panel.querySelector(".desc-text").innerHTML = describeSkill(skill, level);
  refreshDescriptionSpecs(skill);
  const chosen = context.chosen(skill.id);
  panel.querySelector(".desc-stats").innerHTML = formatSkillStats(skill, cooldownReductionMs(skill, level, chosen));
}

function refreshDescriptionSpecs(skill) {
  const panel = q("#skill-desc");
  const specs = skill.specializations || [];
  const level = context.effective(skill.id);
  const list = panel.querySelector(".desc-specs");
  if (specs.length) {
    const lines = [];
    if (skill.type === "active") {
      const chosen = context.chosen(skill.id);
      for (const spec of specs) {
        const lvl = spec.parentSkillLvl;
        const specId = String(spec.id ?? "");
        const label = escapeHtml(specLabel(spec));
        const available = Number.isInteger(lvl) && level >= lvl;
        if (!available || !specId) { lines.push(specIconHtml(spec, 22) + label); continue; }
        const picked = chosen.has(specId);
        lines.push(`${specIconHtml(spec, 22)}<a href="#" class="spec-link ${picked ? "chosen" : "available"}" data-spec="${specId}">${label}</a>`);
      }
    } else {
      for (const spec of specs) {
        const lvl = spec.parentSkillLvl;
        const label = escapeHtml(specLabel(spec));
        lines.push(Number.isInteger(lvl) && level >= lvl ? `<span class="warn">${label}</span>` : label);
      }
    }
    list.innerHTML = lines.join("<br>");
    for (const link of list.querySelectorAll(".spec-link")) link.addEventListener("click", (e) => { e.preventDefault(); toggleSpec(link.dataset.spec); });
  }
  panel.querySelector(".desc-specs-header").hidden = !specs.length;
  list.hidden = !specs.length;
}

function toggleSpec(specId) {
  const id = view.selectedId;
  const skill = id && context.byId[id];
  if (!skill) return;
  const p = bp();
  const cap = activeSpecCap(context.effective(id));
  const chosen = context.chosen(id);
  if (chosen.has(specId)) chosen.delete(specId);
  else if (chosen.size < cap) chosen.add(specId);
  else return;
  commit(() => {
    if (chosen.size) p.skill_active_specs[id] = [...chosen].sort(); else delete p.skill_active_specs[id];
  });
  refreshDescriptionSpecs(skill);
  if (cards[id]) refreshCard(cards[id]);
  const level = context.effective(id);
  q("#skill-desc .desc-stats").innerHTML = formatSkillStats(skill, cooldownReductionMs(skill, level, context.chosen(id)));
}

// ── builds ──────────────────────────────────────────────────────────────────

function buildsRowHtml() {
  const p = bp();
  const builds = ensureClassBuilds(p, context.classLower);
  const options = Object.keys(builds).map((name) => `<option ${name === context.buildName ? "selected" : ""}>${escapeHtml(name)}</option>`).join("");
  return `<select id="build-select">${options}</select>
    <button id="build-add" class="icon-btn" title="${TEXT.addBuild}">${PLUS_SVG}</button>
    <button id="build-duplicate" class="icon-btn" title="${TEXT.duplicateBuild}"><svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="5" y="5" width="9" height="9" rx="1.5"/><path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5"/></svg></button>
    <button id="build-rename" class="icon-btn" title="${TEXT.renameBuild}"><svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M11.5 2.5l2 2L5 13H3v-2z"/></svg></button>
    <button id="build-delete" class="icon-btn" title="${TEXT.deleteBuild}" ${Object.keys(builds).length > 1 ? "" : "disabled"}><svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 4h10M6 4V2.5h4V4M4.5 4l.7 9h5.6l.7-9"/></svg></button>`;
}

function wireBuilds() {
  const p = bp();
  const builds = ensureClassBuilds(p, context.classLower);
  q("#build-select").addEventListener("change", (e) => {
    commit(() => setCurrentSkillBuild(p, context.classLower, e.target.value));
    draw();
  });
  q("#build-add").addEventListener("click", () => {
    const name = (window.prompt(`${TEXT.newBuildTitle} – ${TEXT.nameColon}`, "") || "").trim();
    if (!name || name in builds) return;
    commit(() => { builds[name] = emptyBuildState(); setCurrentSkillBuild(p, context.classLower, name); });
    draw();
  });
  q("#build-duplicate").addEventListener("click", () => {
    const source = builds[context.buildName];
    const name = (window.prompt(`${TEXT.duplicateBuild} – ${TEXT.nameColon}`, TEXT.duplicateDefault(context.buildName)) || "").trim();
    if (!name || name in builds) return;
    commit(() => {
      builds[name] = {
        priority: Object.fromEntries(Object.entries(source.priority).map(([k, v]) => [k, [...v]])),
        arcana_cards: JSON.parse(JSON.stringify(source.arcana_cards || {})),
        layout: layoutCopy(source.layout),
      };
      setCurrentSkillBuild(p, context.classLower, name);
    });
    draw();
  });
  q("#build-rename").addEventListener("click", () => {
    const old = context.buildName;
    const name = (window.prompt(`${TEXT.renameBuild} – ${TEXT.nameColon}`, old) || "").trim();
    if (!name || name === old || name in builds) return;
    commit(() => {
      builds[name] = builds[old];
      delete builds[old];
      for (const equip of Object.values((p.equip_builds_data || {})[context.classLower] || {})) if (equip.linked_skill_build === old) equip.linked_skill_build = name;
      if (p.current_skill_build_name === old) p.current_skill_build_name = name;
    });
    draw();
  });
  q("#build-delete").addEventListener("click", () => {
    if (Object.keys(builds).length <= 1 || !window.confirm(TEXT.deleteConfirm(context.buildName))) return;
    commit(() => {
      delete builds[context.buildName];
      setCurrentSkillBuild(p, context.classLower, Object.keys(builds)[0]);
    });
    draw();
  });
}

// ── priority list ───────────────────────────────────────────────────────────

function shortName(name, max = 12) { return name.length <= max ? name : name.slice(0, max - 1).trimEnd() + "…"; }

function renderPriorityRows() {
  const priority = context.build.priority;
  for (const type of SKILL_TYPES) {
    const row = q(`.priority-row[data-type="${type}"]`);
    row.innerHTML = "";
    const ids = priority[type];
    ids.forEach((skillId, index) => {
      if (index > 0) row.insertAdjacentHTML("beforeend", `<span class="priority-arrow">&gt;</span>`);
      const skill = skillId ? context.byId[skillId] : null;
      const slot = document.createElement("div");
      slot.className = "priority-slot";
      const url = skill ? skillIconUrl(skill) : null;
      const fullName = skill ? skill.name || "" : TEXT.chooseSkillTitle;
      slot.innerHTML = `<button class="skill-tile" title="${escapeHtml(fullName)}">${url ? `<img src="${url}" alt="">` : ""}
        ${skill ? `<span class="slot-remove" title="${TEXT.removePriority}">×</span>` : ""}</button>
        <div class="skill-tile-name" title="${escapeHtml(fullName)}">${escapeHtml(skill ? shortName(fullName, 11) : fullName)}</div>`;
      slot.querySelector(".skill-tile").addEventListener("click", (e) => {
        if (e.target.classList.contains("slot-remove")) { removePrioritySlot(type, index); return; }
        openSkillPicker(type, index);
      });
      row.appendChild(slot);
    });
    row.insertAdjacentHTML("beforeend", `<span class="priority-arrow">&gt;</span><button class="priority-add" ${ids[ids.length - 1] === null ? "disabled" : ""}>＋</button>`);
    row.querySelector(".priority-add").addEventListener("click", () => {
      commit(() => ids.push(null));
      renderPriorityRows();
    });
  }
}

function afterPriorityChange() {
  context.priorityIds = new Set();
  for (const ids of Object.values(context.build.priority)) for (const id of ids) if (id !== null) context.priorityIds.add(id);
  renderPriorityRows();
  if (view.favoritesOnly) buildCards(); else for (const entry of Object.values(cards)) entry.el.querySelector(".star").hidden = !context.priorityIds.has(entry.skill.id);
}

function removePrioritySlot(type, index) {
  const ids = context.build.priority[type];
  commit(() => {
    if (index >= 0 && index < ids.length) ids.splice(index, 1);
    if (!ids.length) ids.push(null);
  });
  afterPriorityChange();
}

function openSkillPicker(type, index) {
  const ids = context.build.priority[type];
  const used = new Set(ids.filter((sid, i) => sid !== null && i !== index));
  const skills = context.skills.filter((s) => s.type === type && !used.has(s.id));
  const dialog = document.createElement("dialog");
  dialog.className = "skill-picker";
  dialog.innerHTML = `<div class="stack"><h2>${TEXT.chooseSkillTitle}</h2><input type="text" placeholder="${TEXT.search}">
    <div class="list"></div><div class="row"><button class="choose grow">${TEXT.select}</button><button class="cancel">Cancel</button></div></div>`;
  const list = dialog.querySelector(".list");
  let selected = null;
  const fill = () => {
    const query = dialog.querySelector("input").value.trim().toLowerCase();
    list.innerHTML = "";
    for (const skill of skills) {
      if (query && !(skill.name || "").toLowerCase().includes(query)) continue;
      const row = document.createElement("div");
      row.className = "picker-row" + (selected === skill ? " current" : "");
      const url = skillIconUrl(skill);
      row.innerHTML = `${url ? `<img src="${url}" alt="">` : ""}<span>${escapeHtml(skill.name || "")}</span>`;
      row.addEventListener("click", () => { selected = skill; for (const r of list.children) r.classList.remove("current"); row.classList.add("current"); });
      row.addEventListener("dblclick", () => { selected = skill; accept(); });
      list.appendChild(row);
    }
  };
  const accept = () => {
    if (!selected) return;
    commit(() => { ids[index] = selected.id; });
    dialog.close();
    afterPriorityChange();
  };
  dialog.querySelector("input").addEventListener("input", fill);
  dialog.querySelector(".choose").addEventListener("click", accept);
  dialog.querySelector(".cancel").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => dialog.remove());
  fill();
  document.body.appendChild(dialog);
  dialog.showModal();
}

// ── page ────────────────────────────────────────────────────────────────────

function draw() {
  refreshContext();
  const p = bp();
  const scrollTop = q(".skill-cards") ? q(".skill-cards").scrollTop : 0;
  main.innerHTML = `<div class="skills-page">
    <div class="row skills-header">
      <h2>${TEXT.title}</h2><span class="grow"></span>
      <span class="section-label">${TEXT.pointsFree}</span><span id="sp-value" class="mono"></span>
      <span class="section-label gap-left">${TEXT.monolith}</span><input id="monolith-level" type="number" min="0" max="${MONOLITH_MAX_LEVEL}" value="${p.monolith_level || 0}" style="width:60px">
      <button id="sp-unlimited" title="${TEXT.unlimitedTip}">${TEXT.unlimited}</button>
      <span class="section-label gap-left">${TEXT.stigmaPoints}</span><span id="stigma-value" class="mono"></span>
      <button id="arcana-calculator" class="gap-left" disabled>${TEXT.calculator}</button>
    </div>
    <div class="row builds-row">${buildsRowHtml()}</div>
    <div class="tabs"><button data-tab="description" class="${view.tab === "description" ? "active" : ""}">${TEXT.tabDescription}</button><button data-tab="priority" class="${view.tab === "priority" ? "active" : ""}">${TEXT.tabPriority}</button></div>
    <div class="skills-description" ${view.tab === "description" ? "" : "hidden"}>
      <div class="skills-left">
        <div class="row controls">
          <input id="skill-search" type="text" class="grow" placeholder="${TEXT.search}" value="${escapeHtml(view.query)}">
          ${SKILL_TYPES.map((t) => `<button class="type-filter ${view.types[t] ? "active" : ""}" data-type="${t}">${TEXT[t]}</button>`).join("")}
          <button id="favorites-only" class="${view.favoritesOnly ? "active" : ""}">${TEXT.onlyFavorites}</button>
          <button id="show-hidden" title="${TEXT.hiddenTip}" hidden></button>
        </div>
        <div class="skill-cards">
          ${SKILL_TYPES.map((t) => `<div class="skill-section" data-type="${t}"><div class="skill-section-header">${SECTION_LABELS[t]}</div><div class="skill-grid"></div></div>`).join("")}
        </div>
      </div>
      <div id="skill-desc" class="skills-right">
        <div class="desc-icon skill-tile-icon"></div>
        <div class="desc-title">${TEXT.chooseSkill}</div>
        <div class="desc-badges"></div>
        <div class="desc-text"></div>
        <div class="desc-specs-header section-label" hidden>${TEXT.specializations}</div>
        <div class="desc-specs" hidden></div>
        <div class="section-label">${TEXT.details}</div>
        <div class="desc-stats">—</div>
      </div>
    </div>
    <div class="skills-priority" ${view.tab === "priority" ? "" : "hidden"}>
      <div class="muted hint">${TEXT.priorityHint}</div>
      ${SKILL_TYPES.map((t) => `<div class="skill-section-header">${SECTION_LABELS[t]}</div><div class="priority-row" data-type="${t}"></div>`).join("")}
    </div>
  </div>`;

  q("#monolith-level").addEventListener("change", (e) => {
    commit(() => { p.monolith_level = Math.max(0, Math.min(MONOLITH_MAX_LEVEL, Number(e.target.value) || 0)); });
    e.target.value = p.monolith_level;
    refreshSkillPoints();
  });
  q("#sp-unlimited").addEventListener("click", () => { commit(() => { p.skill_points_unlimited = p.skill_points_unlimited === false; }); refreshSkillPoints(); });
  for (const tab of main.querySelectorAll(".tabs button")) tab.addEventListener("click", () => {
    view.tab = tab.dataset.tab;
    for (const t of main.querySelectorAll(".tabs button")) t.classList.toggle("active", t === tab);
    q(".skills-description").hidden = view.tab !== "description";
    q(".skills-priority").hidden = view.tab !== "priority";
  });
  q("#skill-search").addEventListener("input", (e) => { view.query = e.target.value; buildCards(); });
  for (const btn of main.querySelectorAll(".type-filter")) btn.addEventListener("click", () => {
    view.types[btn.dataset.type] = !view.types[btn.dataset.type];
    btn.classList.toggle("active", view.types[btn.dataset.type]);
    buildCards();
  });
  q("#favorites-only").addEventListener("click", (e) => { view.favoritesOnly = !view.favoritesOnly; e.target.classList.toggle("active", view.favoritesOnly); buildCards(); });
  q("#show-hidden").addEventListener("click", () => {
    view.showHidden = !view.showHidden;
    relayoutCards();
    if (view.selectedId && !isShown(view.selectedId)) clearDescription();
  });
  wireBuilds();
  buildCards();
  refreshSkillPoints();
  renderPriorityRows();
  q(".skill-cards").scrollTop = scrollTop;
}

export function mount(el) {
  main = el;
  main.innerHTML = `<div class="muted">Loading…</div>`;
  unsubscribe = onChange(() => { if (!suppress && main) draw(); });
  ready().then(() => { if (main) draw(); });
}

export function unmount() {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  main = null;
  cards = {};
}

// Resolves once the skill data is loaded; the synchronous helpers below need it.
export { ready };

// ── Characters page: cards and export image ─────────────────────────────────

// Name + level + specializations per skill, grouped Active/Passive/Stigma,
// as the Characters page shows them. Empty until `ready()` has resolved.
export function skillCardsHtml(classKey, buildName, { columns = 3 } = {}) {
  if (!data.skills) return "";
  const p = bp();
  const classLower = (classKey || p.character_class || "").trim().toLowerCase();
  const ctx = skillContext(p, classLower, buildName || currentSkillBuildName(p, classLower));
  const onBar = new Set(Object.values(ctx.build.layout.slots));
  let html = "";
  for (const type of SKILL_TYPES) {
    const skills = ctx.skills.filter((s) => s.type === type && !ctx.hidden.has(s.id));
    if (!skills.length) continue;
    html += `<div class="summary-skills-section"><div class="section-label">${SECTION_LABELS[type]}</div>
      <div class="summary-skills-grid" style="grid-template-columns: repeat(${columns}, minmax(0, 1fr))">`;
    for (const skill of skills) {
      const placed = onBar.has(skill.id);
      const draggable = (skill.type === "active" || skill.type === "stigma") && !placed;
      const url = skillIconUrl(skill);
      const specs = specsHtml(skill, ctx.effective(skill.id), ctx.chosen(skill.id), 14);
      html += `<div class="skill-card summary-skill-card${placed ? " placed" : ""}" data-skill-drag="${skill.id}" draggable="${draggable}">
        <div class="summary-skill-icon">${url ? `<img src="${url}" alt="">` : ""}</div>
        <div class="summary-skill-text"><div class="row nowrap"><span class="summary-skill-name" style="color:${SKILL_TYPE_COLORS[skill.type]}">${escapeHtml(skill.name || "")}</span>
          <span class="grow"></span><span class="section-label">Lv. ${ctx.effective(skill.id)}</span></div>
          ${specs ? `<div class="skill-card-specs">${specs}</div>` : ""}</div></div>`;
    }
    html += `</div></div>`;
  }
  return html;
}

// ── export image of the skill cards (the desktop's skills.png) ──────────────

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrapText(ctx, text, maxWidth) {
  const words = text.split(" ");
  const lines = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width > maxWidth && line) { lines.push(line); line = word; } else line = candidate;
  }
  if (line) lines.push(line);
  return lines;
}

function drawCircleButton(ctx, cx, cy, r, color, plus, colors) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = colors.overlay;
  ctx.strokeStyle = colors.border;
  ctx.lineWidth = 1;
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.5, r / 6);
  ctx.lineCap = "round";
  const a = r * 0.45;
  ctx.beginPath();
  ctx.moveTo(cx - a, cy); ctx.lineTo(cx + a, cy);
  if (plus) { ctx.moveTo(cx, cy - a); ctx.lineTo(cx, cy + a); }
  ctx.stroke();
  ctx.restore();
}

function drawEye(ctx, x, y, size, color, slashed) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = size * 0.1;
  ctx.lineCap = "round";
  const cy = y + size / 2;
  ctx.beginPath();
  ctx.moveTo(x + size * 0.08, cy);
  ctx.quadraticCurveTo(x + size * 0.5, y + size * 0.08, x + size * 0.92, cy);
  ctx.quadraticCurveTo(x + size * 0.5, y + size * 0.92, x + size * 0.08, cy);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x + size / 2, cy, size * 0.12, 0, Math.PI * 2);
  ctx.fill();
  if (slashed) { ctx.beginPath(); ctx.moveTo(x + size * 0.18, y + size * 0.18); ctx.lineTo(x + size * 0.82, y + size * 0.82); ctx.stroke(); }
  ctx.restore();
}

function drawStar(ctx, cx, cy, size, color) {
  const outer = size / 2, inner = outer * 0.42;
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const angle = Math.PI / 2 + i * Math.PI / 5;
    const r = i % 2 === 0 ? outer : inner;
    const px = cx + Math.cos(angle) * r, py = cy - Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// The skill cards of a class as one image, 1400 px wide, two columns per
// section like the desktop export. Returned at once; `canvas.ready` resolves
// once data and icons are drawn.
export function renderSkillCards(classKey, buildName, { showHidden = false, scale = 1 } = {}) {
  const canvas = document.createElement("canvas");
  canvas.ready = ready().then(async () => {
    const p = bp();
    const classLower = (classKey || p.character_class || "").trim().toLowerCase();
    const ctx2 = skillContext(p, classLower, buildName || currentSkillBuildName(p, classLower));
    const usable = arcanaUsableLordTypes(data.arcanaInfo);
    const pools = arcanaClassPools(data.arcanaClassSkills, ctx2.dataKey, usable);
    const sections = SKILL_TYPES.map((type) => [type, ctx2.skills.filter((s) => s.type === type && (showHidden || !ctx2.hidden.has(s.id)))]).filter(([, list]) => list.length);
    const urls = [];
    for (const [, list] of sections) for (const skill of list) {
      urls.push(skillIconUrl(skill));
      for (const spec of specsInEffect(skill, ctx2.effective(skill.id), ctx2.chosen(skill.id)).applied) urls.push(specIconUrl(spec));
    }
    await loadIcons(urls);
    const colors = { ...palette(), overlay: getComputedStyle(document.documentElement).getPropertyValue("--overlay").trim() || "#1c2740", secondary: "#a78bfa", warn: "#fbbf24" };
    const width = EXPORT_WIDTH, margin = 12, sectionGap = 12, gridGap = 10, rightW = 150, padX = 10, padY = 8;
    const cardW = (width - 2 * margin - gridGap * (CARD_COLUMNS - 1)) / CARD_COLUMNS;
    const specW = cardW - 2 * padX - rightW - 10;
    const measure = document.createElement("canvas").getContext("2d");
    measure.font = `600 12px ${colors.font}`;
    const cardModel = (skill) => {
      const level = ctx2.effective(skill.id);
      const { applied, unlocked, state } = specsInEffect(skill, level, ctx2.chosen(skill.id));
      const lines = [];
      if (applied.length) for (const spec of applied) {
        const wrapped = wrapText(measure, specLabel(spec), specW - 24);
        wrapped.forEach((text, i) => lines.push({ text, icon: i === 0 ? iconImage(specIconUrl(spec)) : null, color: state === "chosen" ? "#0d9488" : colors.warn }));
      } else if (skill.type === "active" && unlocked.length) lines.push({ text: "No specialization chosen", color: colors.muted, italic: true });
      const hasWish = skill.type === "active" || skill.type === "passive";
      const ceiling = hasWish ? arcanaCeiling(skill.id, skill.type, usable, pools) : 0;
      const leftH = padY + 40 + (lines.length ? 6 + lines.length * 20 : 0) + padY;
      const rightH = padY + 22 + 6 + 26 + (hasWish ? 6 + (ceiling > 0 ? 20 : 24) : 0) + padY;
      return { skill, lines, level, hasWish, ceiling, height: Math.max(96, leftH, rightH) };
    };
    const rows = [];
    let y = margin;
    for (const [type, list] of sections) {
      rows.push({ header: SECTION_LABELS[type], y });
      y += 28;
      const models = list.map(cardModel);
      for (let i = 0; i < models.length; i += CARD_COLUMNS) {
        const chunk = models.slice(i, i + CARD_COLUMNS);
        const h = Math.max(...chunk.map((m) => m.height));
        chunk.forEach((m, col) => rows.push({ card: m, x: margin + col * (cardW + gridGap), y, h }));
        y += h + gridGap;
      }
      y += sectionGap - gridGap;
    }
    const height = Math.max(40, y + margin - sectionGap);
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, width, height);
    ctx.textBaseline = "middle";
    for (const row of rows) {
      if (row.header) {
        ctx.font = `bold 15px ${colors.font}`;
        if ("letterSpacing" in ctx) ctx.letterSpacing = "1px";
        ctx.fillStyle = colors.fg;
        ctx.textAlign = "left";
        ctx.fillText(row.header, margin + 2, row.y + 14);
        if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
        continue;
      }
      const { card, x, h } = row;
      const { skill } = card;
      const hidden = ctx2.hidden.has(skill.id);
      ctx.save();
      if (hidden) ctx.globalAlpha = 0.45;
      roundRectPath(ctx, x + 0.5, row.y + 0.5, cardW - 1, h - 1, 10);
      ctx.fillStyle = "rgba(28, 39, 64, 0.6)";
      ctx.strokeStyle = colors.border;
      ctx.lineWidth = 1;
      ctx.fill();
      ctx.stroke();
      // icon box
      const ix = x + padX, iy = row.y + padY;
      roundRectPath(ctx, ix, iy, 40, 40, 8);
      ctx.fillStyle = "rgba(22, 32, 54, 0.75)";
      ctx.fill();
      ctx.strokeStyle = "rgba(34, 211, 238, 0.5)";
      ctx.lineWidth = 2;
      ctx.stroke();
      const icon = iconImage(skillIconUrl(skill));
      if (icon && icon.complete && icon.naturalWidth) {
        ctx.save(); roundRectPath(ctx, ix + 2, iy + 2, 36, 36, 6); ctx.clip(); ctx.drawImage(icon, ix + 2, iy + 2, 36, 36); ctx.restore();
      }
      ctx.textAlign = "left";
      ctx.font = `bold 14px ${colors.font}`;
      ctx.fillStyle = colors.fg;
      ctx.fillText(skill.name || "", ix + 50, iy + 11);
      ctx.font = `bold 10px ${colors.font}`;
      if ("letterSpacing" in ctx) ctx.letterSpacing = "1px";
      ctx.fillStyle = SKILL_TYPE_COLORS[skill.type] || colors.muted;
      ctx.fillText((skill.type || "").toUpperCase(), ix + 50, iy + 29);
      if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
      let ly = iy + 40 + 6 + 10;
      for (const line of card.lines) {
        let tx = ix;
        if (line.icon && line.icon.complete && line.icon.naturalWidth) { ctx.drawImage(line.icon, tx, ly - 9, 18, 18); }
        if (line.icon) tx += 24;
        ctx.font = `${line.italic ? "italic " : ""}600 12px ${colors.font}`;
        ctx.fillStyle = line.color;
        ctx.fillText(line.text, tx, ly);
        ly += 20;
      }
      // right column
      const rx = x + cardW - padX - rightW;
      const ry = row.y + padY;
      if (ctx2.priorityIds.has(skill.id)) drawStar(ctx, rx + rightW - 22 - 4 - 9, ry + 11, 18, colors.warn);
      drawEye(ctx, rx + rightW - 19, ry + 3, 16, colors.muted, !hidden);
      const levelY = ry + 22 + 6 + 13;
      const manual = ctx2.manual(skill.id), bonus = ctx2.bonusOf(skill.id), wish = ctx2.wishOf(skill.id);
      const parts = [[String(manual), colors.fg]];
      if (bonus > 0) parts.push([` (+${bonus})`, colors.accent]);
      if (wish > 0) parts.push([` (+${wish})`, colors.secondary]);
      ctx.font = `bold 13px Consolas, "DejaVu Sans Mono", monospace`;
      const textW = parts.reduce((w, [t]) => w + ctx.measureText(t).width, 0);
      const groupW = 26 + 6 + Math.max(28, textW) + 6 + 26;
      const gx = rx + (rightW - groupW) / 2;
      drawCircleButton(ctx, gx + 13, levelY, 13, colors.fg, false, colors);
      let tx = gx + 26 + 6 + (Math.max(28, textW) - textW) / 2;
      for (const [t, color] of parts) { ctx.fillStyle = color; ctx.fillText(t, tx, levelY); tx += ctx.measureText(t).width; }
      drawCircleButton(ctx, gx + groupW - 13, levelY, 13, colors.fg, true, colors);
      if (card.hasWish) {
        const wy = levelY + 13 + 6 + 10;
        ctx.font = `10px ${colors.font}`;
        if (card.ceiling > 0) {
          const hint = `max +${card.ceiling}`;
          const hw = ctx.measureText(hint).width;
          const total = 20 + 4 + hw + 4 + 20;
          const wx = rx + (rightW - total) / 2;
          drawCircleButton(ctx, wx + 10, wy, 10, colors.secondary, false, colors);
          ctx.fillStyle = "rgba(148, 163, 184, 0.65)";
          ctx.textAlign = "left";
          ctx.fillText(hint, wx + 24, wy);
          drawCircleButton(ctx, wx + total - 10, wy, 10, colors.secondary, true, colors);
        } else {
          ctx.fillStyle = "rgba(148, 163, 184, 0.65)";
          ctx.textAlign = "center";
          const lines = wrapText(ctx, "No available Arcana card can boost this skill for your class.", rightW);
          lines.forEach((text, i) => ctx.fillText(text, rx + rightW / 2, wy - 5 + i * 12));
        }
      }
      ctx.restore();
    }
    return canvas;
  });
  return canvas;
}
