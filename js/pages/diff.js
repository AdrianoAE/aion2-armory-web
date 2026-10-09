// Build diff (#diff/<class>/<presetA>/<presetB>): two presets side by side,
// section by section, and the Daevanion boards that differ drawn twice with
// B's added nodes outlined green and removed ones red.

import { bp } from "../state.js";
import { buildOfPreset, builds, currentPreset, diff } from "../builds.js";
import { escapeHtml as esc } from "../app.js";
import { data as skillData, ready as skillsReady } from "../engine/skills.js";
import { QUICK_GEAR_SLOT_LABELS, SLOT_LABELS } from "./equipment_data.js";
import { poolForLine } from "./genius.js";

let token = 0;
const cleanups = [];

const MOUSE_LABELS = { "@mouse_left": "Mouse left", "@mouse_right": "Mouse right", "@mouse_forward": "Mouse forward", "@mouse_back": "Mouse back" };

function parseHash() {
  const [, cls = "", a = "", b = ""] = location.hash.slice(1).split("/");
  const decode = (s) => { try { return decodeURIComponent(s); } catch (e) { return s; } };
  return { cls: decode(cls).toLowerCase(), a: decode(a), b: decode(b) };
}

function hashFor(cls, a, b) {
  return `#diff/${encodeURIComponent(cls)}/${encodeURIComponent(a)}/${encodeURIComponent(b)}`;
}

function resolvePair(cls, a, b) {
  const equips = (bp().equip_builds_data || {})[cls] || {};
  const valid = (name) => Object.prototype.hasOwnProperty.call(equips, name);
  const first = valid(a) ? a : currentPreset(cls) || Object.keys(equips)[0] || null;
  const who = first ? equips[first].character_name ?? undefined : undefined;
  const list = builds(cls, who);
  let second = valid(b) ? b : null;
  if (!second) {
    const mine = list.find((x) => x.presets.includes(first));
    const other = list.find((x) => x !== mine && x.presets.length);
    second = other ? other.presets[0] : (mine && mine.presets.find((n) => n !== first)) || first;
  }
  return { a: first, b: second, who, list };
}

function presetSelect(side, list, selected) {
  const groups = list.filter((b) => b.presets.length).map((b) => `<optgroup label="${esc(b.name)}">${b.presets
    .map((name) => `<option value="${esc(name)}" ${name === selected ? "selected" : ""}>${esc(name)}</option>`).join("")}</optgroup>`).join("");
  return `<select data-side="${side}" title="Preset ${side.toUpperCase()}">${groups}</select>`;
}

// ── value formatting ────────────────────────────────────────────────────────

const skillName = (id) => (skillData.byId[id] && skillData.byId[id].name) || String(id);

function specText(skillId, specIds) {
  const skill = skillData.byId[skillId];
  return specIds.map((id) => {
    const spec = skill && (skill.specializations || []).find((s) => String(s.id) === String(id));
    return spec ? (spec.specialized || "").trim() || `Lv ${spec.parentSkillLvl}` : id;
  });
}

function slotLabel(slot) {
  return QUICK_GEAR_SLOT_LABELS[slot] || SLOT_LABELS[slot] || slot;
}

function substatText(entry) {
  if (entry === null || entry === undefined) return "";
  if (typeof entry !== "object") return String(entry);
  return [entry.name || entry.stat || entry.id, entry.value].filter((v) => v !== undefined && v !== null && v !== "").join(" ");
}

const FORMAT = {
  equipment: (v) => `${esc(v.name)}${v.enchant ? ` <span class="warn">+${v.enchant}</span>` : ""}${v.substats.length ? `<div class="muted small">${v.substats.map((s) => esc(substatText(s))).join(", ")}</div>` : ""}`,
  skills: (v, row) => `Lv ${v.level}${v.specs.length ? `<div class="muted small">${specText(row.id, v.specs).map(esc).join(", ")}</div>` : ""}`,
  layout: (v, row) => (row.kind === "key" ? esc(MOUSE_LABELS[v] || v) : esc(skillName(v))),
  arcana: (v) => `${esc(v.theme || "No theme")}${v.slots.length ? `<div class="muted small">${v.slots.map((s) => `${esc(skillName(s.skill_id))}${s.level !== null && s.level !== undefined ? ` +${esc(s.level)}` : ""}`).join(", ")}</div>` : ""}`,
  genius: (v, row) => {
    const match = poolForLine(row.board, row.line).find((entry) => entry[0] === v.stat);
    const label = match ? match[1] : v.stat;
    return `${esc(label)} <span class="warn">${esc(v.value)}${match && match[4] ? "%" : ""}</span>`;
  },
};

const LABEL = {
  equipment: (row) => esc(slotLabel(row.slot)),
  skills: (row) => esc(row.name),
  layout: (row) => esc(row.where),
  arcana: (row) => esc(row.cardType),
  genius: (row) => `${esc(row.board)} · Line ${row.line}`,
};

const SECTIONS = [
  { key: "equipment", title: "Equipment", head: "Slot" },
  { key: "skills", title: "Skills & specializations", head: "Skill" },
  { key: "layout", title: "Skill layout", head: "Where" },
  { key: "arcana", title: "Arcana", head: "Card" },
  { key: "genius", title: "Genius Insight", head: "Line" },
];

function rowKind(row) {
  if (row.a === null || row.a === undefined) return "added";
  if (row.b === null || row.b === undefined) return "removed";
  return "changed";
}

function cell(format, value, row) {
  return value === null || value === undefined ? '<span class="muted">—</span>' : format(value, row);
}

function sectionHtml(section, rows, a, b) {
  const count = rows.length;
  const body = count
    ? `<div class="diff-table-wrap"><table class="diff-table"><thead><tr><th>${section.head}</th><th>A · ${esc(a)}</th><th>B · ${esc(b)}</th></tr></thead><tbody>${rows.map((row) => {
      const kind = rowKind(row);
      return `<tr class="diff-${kind}"><td class="diff-label"><span class="diff-mark" title="${kind[0].toUpperCase() + kind.slice(1)}"></span>${LABEL[section.key](row)}</td>
        <td>${cell(FORMAT[section.key], row.a, row)}</td><td>${cell(FORMAT[section.key], row.b, row)}</td></tr>`;
    }).join("")}</tbody></table></div>`
    : '<div class="muted small diff-none">No differences</div>';
  return `<section class="card stack diff-section" data-section="${section.key}">
    <div class="row"><h3>${section.title}</h3><span class="grow"></span><span class="muted small">${count ? `${count} difference${count === 1 ? "" : "s"}` : ""}</span></div>
    ${body}</section>`;
}

// ── Daevanion ───────────────────────────────────────────────────────────────

async function fillDaevanion(section, cls, a, b, mine) {
  const body = section.querySelector(".diff-boards");
  let mod;
  try {
    mod = await import("./daevanion.js");
    await mod.prepare(cls);
  } catch (err) {
    console.error(err);
    body.innerHTML = `<div class="muted small">The Daevanion boards could not be loaded: ${esc(err.message)}</div>`;
    return;
  }
  if (mine !== token) return;
  const variant = mod.variantData();
  const result = diff(cls, a, b, { variant, skillName });
  const boards = result.daevanion.boards;
  const note = section.querySelector(".diff-count");
  note.textContent = boards.length ? `${boards.length} board${boards.length === 1 ? "" : "s"} differ` : "";
  if (!boards.length) { body.innerHTML = '<div class="muted small diff-none">No differences</div>'; return; }
  const p = bp();
  const sets = (p.daevanion_builds_data || {})[cls] || {};
  const setA = sets[buildOfPreset(p, cls, a)] || {}, setB = sets[buildOfPreset(p, cls, b)] || {};
  const activeOf = (set, boardId) => {
    const ids = set[`s:${boardId}`];
    if (ids) return new Set(ids.map(String));
    const grid = variant.nodes_by_board.get(boardId);
    const start = grid ? [...grid.values()].find((n) => n.g === "start") : null;
    return new Set(start ? [start.id] : []);
  };
  body.innerHTML = "";
  for (const item of boards) {
    const board = variant.boards.find((x) => String(x.id) === String(item.board));
    if (!board) continue;
    const card = document.createElement("div");
    card.className = "diff-board stack";
    const delta = item.spentB - item.spentA;
    card.innerHTML = `<div class="row diff-board-head"><b>${esc(board.name || `Board ${board.id}`)}</b>
      <span class="muted small">${item.spentA} → ${item.spentB} points${delta ? ` (${delta > 0 ? "+" : ""}${delta})` : ""}</span><span class="grow"></span>
      <span class="small diff-added-text">+${item.added.length} added</span><span class="small diff-removed-text">−${item.removed.length} removed</span></div>
      <div class="diff-board-pair"><figure><figcaption class="muted small">A · ${esc(a)}</figcaption></figure><figure><figcaption class="muted small">B · ${esc(b)}</figcaption></figure></div>`;
    const [figA, figB] = card.querySelectorAll("figure");
    const pairs = [
      [figA, activeOf(setA, board.id), {}],
      [figB, activeOf(setB, board.id), { added: new Set(item.added), removed: new Set(item.removed) }],
    ];
    for (const [figure, active, extra] of pairs) {
      const canvas = mod.renderBoard(null, variant, board, active, { side: 460, ...extra });
      canvas.classList.add("diff-canvas");
      canvas.style.width = "100%"; canvas.style.height = "auto";
      const move = (e) => {
        const rect = canvas.getBoundingClientRect();
        const scale = canvas._daevanion ? canvas._daevanion.side / rect.width : 1;
        const node = mod.hitTest(canvas, (e.clientX - rect.left) * scale, (e.clientY - rect.top) * scale);
        if (node && node.g !== "empty") mod.showTooltip(node, { board, activeSet: active, x: e.clientX, y: e.clientY });
        else mod.hideTooltip();
      };
      const leave = () => mod.hideTooltip();
      canvas.addEventListener("mousemove", move);
      canvas.addEventListener("mouseleave", leave);
      cleanups.push(() => mod.hideTooltip());
      figure.appendChild(canvas);
    }
    body.appendChild(card);
  }
}

// ── page ────────────────────────────────────────────────────────────────────

export async function mount(main) {
  const mine = ++token;
  const parsed = parseHash();
  const cls = parsed.cls || String(bp().character_class || "").toLowerCase();
  const { a, b, who, list } = resolvePair(cls, parsed.a, parsed.b);
  if (!a) {
    main.innerHTML = '<div class="card stack"><h2>Nothing to compare</h2><div class="muted">This character has no presets yet.</div></div>';
    return;
  }
  const className = cls ? cls[0].toUpperCase() + cls.slice(1) : "";
  const p = bp();
  const buildA = buildOfPreset(p, cls, a), buildB = buildOfPreset(p, cls, b);
  main.innerHTML = `<div class="diff-page stack">
    <div class="card diff-header">
      <div class="row diff-who"><img class="class-icon" src="assets/class_icons/${esc(cls)}.png" alt=""><b>${esc(who || "Unnamed")}</b><span class="muted">${esc(className)}</span></div>
      <div class="row diff-pickers">
        <label class="diff-side"><span class="diff-side-tag">A</span>${presetSelect("a", list, a)}<span class="muted small">Build: ${esc(buildA)}</span></label>
        <button type="button" class="diff-swap" title="Swap A and B">⇄</button>
        <label class="diff-side"><span class="diff-side-tag">B</span>${presetSelect("b", list, b)}<span class="muted small">Build: ${esc(buildB)}</span></label>
      </div>
      <div class="row diff-legend small"><span class="diff-key diff-added">Only in B</span><span class="diff-key diff-removed">Only in A</span><span class="diff-key diff-changed">Changed</span></div>
    </div>
    <div class="diff-sections stack"><span class="muted small">Loading…</span></div>
  </div>`;
  const go = (na, nb) => { location.hash = hashFor(cls, na, nb); };
  main.querySelectorAll("select[data-side]").forEach((select) => select.addEventListener("change", () => {
    go(main.querySelector('select[data-side="a"]').value, main.querySelector('select[data-side="b"]').value);
  }));
  main.querySelector(".diff-swap").addEventListener("click", () => go(b, a));

  try { await skillsReady(); } catch (err) { console.error(err); }
  if (mine !== token) return;
  const result = diff(cls, a, b, { skillName });
  const sections = main.querySelector(".diff-sections");
  sections.innerHTML = SECTIONS.map((section) => sectionHtml(section, result[section.key], a, b)).join("")
    + `<section class="card stack diff-section" data-section="daevanion">
      <div class="row"><h3>Daevanion boards</h3><span class="muted small">${buildA === buildB ? `Both presets use the build "${esc(buildA)}"` : `${esc(buildA)} → ${esc(buildB)}`}</span><span class="grow"></span><span class="muted small diff-count"></span></div>
      <div class="diff-boards stack">${buildA === buildB ? '<div class="muted small diff-none">No differences</div>' : '<span class="muted small">Loading…</span>'}</div></section>`;
  if (buildA !== buildB) await fillDaevanion(sections.querySelector('[data-section="daevanion"]'), cls, a, b, mine);
}

export function unmount() {
  token += 1;
  for (const fn of cleanups.splice(0)) { try { fn(); } catch (e) { /* tooltip already gone */ } }
}
