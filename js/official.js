// Import and sync characters from aion2.plaync.com through a CORS relay:
// the search / pick / progress / summary dialog and the profile writes.

import { prefs } from "./ui.js";
import { addCharacter, bp, characters, currentCharacter, save, selectCharacter } from "./state.js";
import { daevanionSetsOf, equipSetsOf, linkedSkillBuild, buildOfPreset, renamePresetIn, selectPresetIn, skillBuildsOf, uniqueName } from "./builds.js";
import { data as skillsData, emptyBuildState, emptyLayout, ready as skillsReady, skillBonusFromBoards, skillBuild } from "./engine/skills.js";
import { data as equipmentData, detailCache, loadData, rememberItem, rememberSheet } from "./pages/equipment_data.js";
import * as O from "./engine/official.js";
import { escapeHtml, navigate } from "./app.js";

const GAP_MS = 150;
const RETRY_MS = [1500, 4000];
const RETRY_STATUS = new Set([408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const lower = (text) => String(text || "").trim().toLowerCase();
const clone = (value) => JSON.parse(JSON.stringify(value));
const entryKey = (cls, name) => `${lower(cls)}|${lower(name)}`;

class NotFound extends Error {}

export function relayPrefix() {
  const relay = String(((prefs().official || {}).relay) || "").trim();
  return relay || O.DEFAULT_RELAY;
}

export async function fetchViaRelay(url) {
  let failure = null;
  for (let attempt = 0; attempt <= RETRY_MS.length; attempt += 1) {
    if (attempt) await sleep(RETRY_MS[attempt - 1]);
    let response;
    try {
      response = await fetch(O.relayUrl(relayPrefix(), url), { cache: "no-store" });
    } catch (err) {
      failure = new Error("The relay refused the request: no answer, or the browser blocked it. Public relays are often busy; try again in a minute, or set your own relay in Settings → Official site.");
      continue;
    }
    const text = await response.text().catch(() => "");
    let json = null;
    try { json = JSON.parse(text); } catch (e) { /* not JSON: the relay's own error page */ }
    if (response.status === 404 || O.isNotFound(json)) throw new NotFound("Character not found.");
    if (response.ok && json) return json;
    failure = new Error(`The relay refused the request (HTTP ${response.status}${response.ok ? ", no JSON in the answer" : ""}).`);
    if (!response.ok && !RETRY_STATUS.has(response.status)) break;
  }
  throw failure;
}

export function officialLink(entry) {
  if (!entry) return null;
  return (bp().official_characters || {})[entry.key] || null;
}

export function syncTitle(entry) {
  const link = officialLink(entry);
  return link ? `Update this preset from aion2.plaync.com · last sync ${new Date(link.importedAt).toLocaleString()}`
    : "Find this character on aion2.plaync.com and import its equipment, skills and Daevanion boards";
}

// ── data the mapping needs ──────────────────────────────────────────────────

async function itemDetail(id) {
  if (detailCache.get(id)) return detailCache.get(id);
  try {
    const response = await fetch(`data/details/${id}.json`, { cache: "force-cache" });
    const detail = response.ok ? await response.json() : null;
    if (detail && !detailCache.has(id)) detailCache.set(id, detail);
    return detail;
  } catch (err) { return null; }
}

let boardIndex = null;
function loadBoardIndex() {
  if (!boardIndex) {
    boardIndex = fetch("data/daevanion_boards_s.json", { cache: "force-cache" }).then((r) => r.json()).then((raw) => {
      const start = new Map(), known = new Set();
      for (const n of raw.nodes || []) {
        known.add(String(n.id));
        if (n.g === "start") start.set(String(n.b), String(n.id));
      }
      return { start, known };
    });
    boardIndex.catch(() => { boardIndex = null; });
  }
  return boardIndex;
}

// ── fetch everything ────────────────────────────────────────────────────────

async function collect(who, info, progress, isCancelled) {
  const ask = async (label, url) => {
    if (isCancelled()) throw new Error("cancelled");
    progress.step(label);
    await sleep(GAP_MS);
    return fetchViaRelay(url);
  };
  await Promise.all([loadData(), skillsReady()]);
  const boards = await loadBoardIndex();
  if (!info) info = await ask("Fetching profile…", O.infoUrl(who));
  const equipment = await ask("Fetching equipment…", O.equipmentUrl(who));
  const mapped = O.mapEquipment(equipment, equipmentData.itemsById, {}, equipmentData.nameToItem);
  for (const miss of mapped.missing) {
    let item = null;
    try {
      const sheet = await ask(`Item sheet: ${miss.entry.name || miss.entry.id}`, O.gameconstItemUrl(miss.entry.id, who.region));
      item = O.itemFromDetail(sheet);
      if (item) { rememberSheet(item.id, sheet); rememberItem(item); }
    } catch (err) {
      if (isCancelled()) throw err;
    }
    O.placeMissing(mapped, miss, item);
  }
  const plan = O.boardPlan(info);
  progress.total(2 + mapped.rolls.length + plan.length);
  const substats = {}, unread = [];
  let failedInARow = 0;
  for (const [index, roll] of mapped.rolls.entries()) {
    if (failedInARow >= 2) { unread.push(roll.name); continue; }
    try {
      const rolled = await ask(`Item ${index + 1}/${mapped.rolls.length}: ${roll.name}`, O.itemUrl(who, roll));
      const detail = await itemDetail(mapped.equipped[roll.slotId].id);
      const matched = O.matchSubstats(rolled.subStats, detail && detail.subStats);
      if (matched.length) substats[roll.slotId] = matched;
      failedInARow = 0;
    } catch (err) {
      if (isCancelled()) throw err;
      unread.push(roll.name);
      failedInARow += 1;
    }
  }
  const boardIds = {}, boardNotes = [], boardFailures = [];
  for (const board of plan) {
    try {
      const detail = await ask(`${board.name} board…`, O.daevanionUrl(who, board.id));
      const ids = O.mapBoard(detail, boards.start.get(board.id)).filter((id) => boards.known.has(id));
      boardIds[board.id] = ids;
      boardNotes.push(`${board.name} ${Math.max(ids.length - 1, 0)} nodes`);
    } catch (err) {
      if (isCancelled()) throw err;
      boardFailures.push(board.name);
    }
  }
  return { info, mapped, substats, unread, skillList: ((equipment.skill || {}).skillList) || [], boardIds, boardNotes, boardFailures };
}

// ── profile writes ──────────────────────────────────────────────────────────

function sharedWithOthers(equips, presetName, field, value) {
  const me = equips[presetName];
  return Object.entries(equips).some(([name, e]) => name !== presetName && e && e[field] === value && lower(e.character_name) !== lower(me.character_name));
}

function ownSkillBuild(p, cls, presetName, fresh) {
  const equips = equipSetsOf(p, cls);
  const skills = skillBuildsOf(p, cls);
  const linked = linkedSkillBuild(p, cls, presetName);
  if (!fresh && !sharedWithOthers(equips, presetName, "linked_skill_build", linked)) return linked;
  const name = uniqueName(skills, presetName);
  skills[name] = fresh ? { ...emptyBuildState(), layout: emptyLayout(), levels: {}, specs: {} } : clone(skills[linked]);
  equips[presetName].linked_skill_build = name;
  return name;
}

function ownDaevanionSet(p, cls, presetName) {
  const equips = equipSetsOf(p, cls);
  const sets = daevanionSetsOf(p, cls);
  const linked = buildOfPreset(p, cls, presetName);
  if (!sharedWithOthers(equips, presetName, "linked_daevanion_build", linked)) return linked;
  const name = uniqueName(sets, equips[presetName].character_name || presetName);
  sets[name] = clone(sets[linked]);
  equips[presetName].linked_daevanion_build = name;
  return name;
}

function createCharacter(p, cls, name) {
  addCharacter(name, cls);
  const equips = equipSetsOf(p, cls);
  let presetName = Object.keys(equips).find((n) => lower(equips[n].character_name) === lower(name) && n === p.current_build_name)
    || Object.keys(equips).find((n) => lower(equips[n].character_name) === lower(name));
  if (presetName !== "Default" && !("Default" in equips) && renamePresetIn(p, cls, presetName, "Default")) presetName = "Default";
  return presetName;
}

function writeImport(p, target, who, result) {
  const cls = lower(target.cls);
  const isNew = target.mode === "new";
  const presetName = isNew ? createCharacter(p, cls, target.name) : target.preset;
  const equips = equipSetsOf(p, cls);
  const equip = equips[presetName];
  for (const part of ["equipped", "substats", "enchant", "philosopher_stone", "priority", "priority_progress"]) if (!equip[part] || typeof equip[part] !== "object") equip[part] = {};
  O.mergeEquipSet(equip, result.mapped, result.substats);
  const buildName = ownDaevanionSet(p, cls, presetName);
  const boardSet = daevanionSetsOf(p, cls)[buildName];
  const updatedBoards = O.mergeBoards(boardSet, result.boardIds);
  const skillName = ownSkillBuild(p, cls, presetName, isNew);
  const build = skillBuild(p, cls, skillName);
  const openInGame = Object.fromEntries(Object.entries(result.boardIds).map(([id, ids]) => [`s:${id}`, ids]));
  const skills = O.investedLevels(result.skillList, skillBonusFromBoards(cls, openInGame, skillsData.boards));
  if (isNew) for (const id of Object.keys(build.levels)) delete build.levels[id];
  O.mergeSkillLevels(build.levels, skills);
  const profile = result.info.profile || {};
  p.official_characters = p.official_characters || {};
  p.official_characters[entryKey(cls, target.name)] = {
    region: who.region, serverId: who.serverId, serverName: who.serverName || profile.serverName || "",
    characterId: who.characterId, level: Number(profile.characterLevel) || null, importedAt: new Date().toISOString(),
  };
  selectPresetIn(p, cls, presetName);
  save();
  return { presetName, buildName, skillName, skills, updatedBoards };
}

// ── dialog ──────────────────────────────────────────────────────────────────

function classIcon(cls) {
  return cls ? `<img class="class-icon" src="assets/class_icons/${escapeHtml(lower(cls))}.png" alt="">` : `<span class="class-icon official-no-icon"></span>`;
}

function openShell(title) {
  const dialog = document.createElement("dialog");
  dialog.className = "official-dialog";
  dialog.innerHTML = `<div class="official-head row"><h3 class="grow">${escapeHtml(title)}</h3>
      <button type="button" class="official-close" aria-label="Close" title="Close">&times;</button></div>
    <div class="official-body"></div>`;
  document.body.appendChild(dialog);
  const state = { closed: false };
  dialog.querySelector(".official-close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => { state.closed = true; dialog.remove(); });
  dialog.showModal();
  return { dialog, body: dialog.querySelector(".official-body"), state };
}

function serverOptions(region, selected) {
  const servers = O.regionOf(region).servers;
  return `<option value="">Any server</option>${servers.map((s) => `<option ${s === selected ? "selected" : ""}>${escapeHtml(s)}</option>`).join("")}`;
}

function existingFor(cls, name, characterId) {
  const list = characters();
  const linked = list.find((c) => c.class === lower(cls) && (officialLink(c) || {}).characterId === characterId);
  return linked || list.find((c) => c.class === lower(cls) && lower(c.name) === lower(name)) || null;
}

function freeName(cls, name) {
  const taken = new Set(characters().filter((c) => c.class === lower(cls)).map((c) => lower(c.name)));
  if (!taken.has(lower(name))) return name;
  for (let i = 2; ; i += 1) if (!taken.has(lower(`${name} ${i}`))) return `${name} ${i}`;
}

function presetSelect(entry, selected) {
  return entry.builds2.filter((b) => b.presets.length).map((b) => `<optgroup label="${escapeHtml(b.name)}">${b.presets
    .map((n) => `<option value="${escapeHtml(n)}" ${n === selected ? "selected" : ""}>${escapeHtml(n)}</option>`).join("")}</optgroup>`).join("");
}

function progressView(body) {
  body.innerHTML = `<div class="official-progress stack">
      <div class="official-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100"><span></span></div>
      <div class="official-status"></div>
      <ol class="official-log small muted"></ol>
    </div>`;
  const bar = body.querySelector(".official-bar span");
  const status = body.querySelector(".official-status");
  const log = body.querySelector(".official-log");
  let done = 0, total = 3;
  return {
    total(n) { total = n + 1; },
    step(label) {
      if (status.textContent) {
        const li = document.createElement("li");
        li.textContent = status.textContent.replace(/…$/, "");
        log.prepend(li);
        done += 1;
      }
      status.textContent = label;
      bar.style.width = `${Math.min(100, Math.round((done / total) * 100))}%`;
      bar.parentElement.setAttribute("aria-valuenow", String(Math.round((done / total) * 100)));
    },
  };
}

function errorView(body, message, retry) {
  body.innerHTML = `<div class="stack"><div class="official-error">${escapeHtml(message)}</div>
    <div class="row official-actions"><span class="grow"></span>${retry ? `<button type="button" class="retry">Back</button>` : ""}<button type="button" class="primary close">Close</button></div></div>`;
  if (retry) body.querySelector(".retry").addEventListener("click", retry);
  body.querySelector(".close").addEventListener("click", () => body.closest("dialog").close());
}

function summaryView(body, target, written, result) {
  const equippedCount = Object.keys(result.mapped.equipped).length;
  const substatSlots = Object.keys(result.substats).length;
  const levelCount = Object.keys(written.skills.levels).length;
  const boardCount = written.updatedBoards.length;
  const lines = [
    `<b>Equipment</b>: ${equippedCount} item${equippedCount === 1 ? "" : "s"} into preset "${escapeHtml(written.presetName)}"${substatSlots ? `, substats on ${substatSlots} slot${substatSlots === 1 ? "" : "s"}` : ""}.`,
    `<b>Skills</b>: ${levelCount} skill level${levelCount === 1 ? "" : "s"}, levels as reported by the site, minus the bonus levels of the boards opened in game.`,
    `<b>Daevanion</b>: ${boardCount} board${boardCount === 1 ? "" : "s"} updated in Build "${escapeHtml(written.buildName)}"${result.boardNotes.length ? ` (${escapeHtml(result.boardNotes.join(", "))})` : ""}; planned boards without open nodes were kept.`,
  ];
  if (result.mapped.skipped.length) lines.push(`<b>Skipped</b>: ${escapeHtml(result.mapped.skipped.join(", "))}.`);
  if (result.unread.length) lines.push(`<span class="warn">Substats not read for ${escapeHtml(result.unread.join(", "))}; those slots kept theirs.</span>`);
  if (result.boardFailures.length) lines.push(`<span class="warn">Could not read ${escapeHtml(result.boardFailures.join(", "))}; those boards were left as they were.</span>`);
  body.innerHTML = `<div class="official-summary stack">
      <div class="row official-who">${classIcon(target.cls)}<div class="grow"><div class="name">${escapeHtml(target.name)}</div>
        <div class="muted small">${escapeHtml(O.className(target.cls) || target.cls)} · Level ${escapeHtml(String((result.info.profile || {}).characterLevel || "?"))} · ${escapeHtml(target.serverName || "")}</div></div>
        <span class="tag success">${target.mode === "new" ? "Created" : "Updated"}</span></div>
      <ul>${lines.map((l) => `<li>${l}</li>`).join("")}</ul>
      <div class="muted small">Skill layout, specializations, Arcana, Genius Insight and Pantheon are not on the site and were left as they were.</div>
      <div class="row official-actions"><span class="grow"></span><button type="button" class="close">Close</button><button type="button" class="primary open">Open character</button></div>
    </div>`;
  body.querySelector(".close").addEventListener("click", () => body.closest("dialog").close());
  body.querySelector(".open").addEventListener("click", () => { body.closest("dialog").close(); navigate("character"); });
}

async function runImport(shell, who, target, info, onBack, progress = progressView(shell.body)) {
  let result;
  try {
    result = await collect(who, info, progress, () => shell.state.closed);
  } catch (err) {
    if (shell.state.closed) return;
    errorView(shell.body, err.message, onBack);
    return;
  }
  if (shell.state.closed) return;
  progress.step("Saving…");
  if (target.mode === "update" && !(target.preset in equipSetsOf(bp(), target.cls))) {
    errorView(shell.body, `The preset "${target.preset}" no longer exists; nothing was changed.`, onBack);
    return;
  }
  const written = writeImport(bp(), target, who, result);
  summaryView(shell.body, target, written, result);
}

// Asks where an import goes when the roster already has this character.
function targetView(shell, found, existing, info, onPick, onBack) {
  const cls = O.className(info.profile.className);
  const newName = freeName(cls, found.name);
  shell.body.innerHTML = `<form class="stack official-target">
      <div class="row official-who">${classIcon(cls)}<div class="grow"><div class="name">${escapeHtml(found.name)}</div>
        <div class="muted small">${escapeHtml(cls)} · Level ${escapeHtml(String(info.profile.characterLevel || found.level))} · ${escapeHtml(found.serverName)}</div></div></div>
      <div class="muted small">Your roster already has a ${escapeHtml(cls)} named ${escapeHtml(existing.name)}.</div>
      <label class="official-choice"><input type="radio" name="target" value="update" checked>
        <span class="grow">Update ${escapeHtml(existing.name)}<span class="muted small"> · preset</span></span>
        <select class="official-preset">${presetSelect(existing, existing.preset)}</select></label>
      <label class="official-choice"><input type="radio" name="target" value="new"><span class="grow">Create as new character "${escapeHtml(newName)}"</span></label>
      <div class="row official-actions"><button type="button" class="back">Back</button><span class="grow"></span><button type="submit" class="primary">Import</button></div>
    </form>`;
  const form = shell.body.querySelector("form");
  form.querySelector(".official-preset").addEventListener("focus", () => { form.querySelector('[value="update"]').checked = true; });
  form.querySelector(".back").addEventListener("click", onBack);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const update = form.querySelector('[value="update"]').checked;
    onPick(update
      ? { mode: "update", cls, name: existing.name, preset: form.querySelector(".official-preset").value, serverName: found.serverName }
      : { mode: "new", cls, name: newName, serverName: found.serverName });
  });
}

function whoOf(found, region) {
  return { region: found.region || region, serverId: found.serverId, serverName: found.serverName, characterId: found.characterId };
}

async function pickResult(shell, found, region, options, backToResults) {
  const who = whoOf(found, region);
  const progress = progressView(shell.body);
  let info;
  try {
    progress.step("Fetching profile…");
    info = await fetchViaRelay(O.infoUrl(who));
  } catch (err) {
    if (!shell.state.closed) errorView(shell.body, err.message, backToResults);
    return;
  }
  if (shell.state.closed) return;
  const cls = O.className((info.profile || {}).className);
  if (!cls) { errorView(shell.body, `The site reports an unknown class "${(info.profile || {}).className || "?"}".`, backToResults); return; }
  const name = info.profile.characterName || found.name;
  const preferred = options.entry && options.entry.class === lower(cls) ? options.entry : null;
  const existing = preferred || existingFor(cls, name, who.characterId);
  const start = (target, reuse) => runImport(shell, who, target, info, backToResults, reuse);
  if (!existing) { start({ mode: "new", cls, name, serverName: found.serverName }, progress); return; }
  targetView(shell, { ...found, name }, existing, info, start, backToResults);
  if (preferred && options.preset) {
    const select = shell.body.querySelector(".official-preset");
    if ([...select.options].some((o) => o.value === options.preset)) select.value = options.preset;
  }
}

function resultsView(shell, query, all, options, backToSearch) {
  const results = O.filterByServer(all, query.server);
  const elsewhere = query.server && !results.length && all.length;
  const rows = (list) => list.map((r, i) => `<button type="button" class="official-result${r.className ? ` class-${lower(r.className)}` : ""}" data-index="${i}">
      ${classIcon(r.className)}<span class="grow"><span class="name">${escapeHtml(r.name)}</span>
      <span class="muted small">${escapeHtml(r.className || "Unknown class")} · Level ${r.level}</span></span>
      <span class="tag info">${escapeHtml(r.serverName)}</span></button>`).join("");
  const shown = elsewhere ? all : results;
  const note = !all.length ? `No character starting with "${escapeHtml(query.keyword)}" in ${escapeHtml(O.regionOf(query.region).label)}.`
    : elsewhere ? `None on ${escapeHtml(query.server)}; ${all.length} on other servers:`
    : `${results.length} character${results.length === 1 ? "" : "s"}${query.server ? ` on ${escapeHtml(query.server)}` : ` in ${escapeHtml(O.regionOf(query.region).label)}`}. Pick one to import.`;
  shell.body.innerHTML = `<div class="stack">
      <div class="muted small">${note}</div>
      ${shown.length ? `<div class="official-results">${rows(shown)}</div>` : ""}
      <div class="row official-actions"><button type="button" class="back">Back</button><span class="grow"></span><button type="button" class="cancel">Cancel</button></div>
    </div>`;
  shell.body.querySelector(".back").addEventListener("click", backToSearch);
  shell.body.querySelector(".cancel").addEventListener("click", () => shell.dialog.close());
  const again = () => resultsView(shell, query, all, options, backToSearch);
  shell.body.querySelectorAll(".official-result").forEach((b) => b.addEventListener("click", () => pickResult(shell, shown[Number(b.dataset.index)], query.region, options, again)));
}

function searchView(shell, query, options) {
  shell.body.innerHTML = `<form class="stack official-search">
      <div class="official-fields">
        <label class="stack small muted">Region<select name="region">${O.REGIONS.map((r) => `<option value="${r.id}" ${r.id === query.region ? "selected" : ""}>${escapeHtml(r.label)}</option>`).join("")}</select></label>
        <label class="stack small muted">Server<select name="server">${serverOptions(query.region, query.server)}</select></label>
      </div>
      <label class="stack small muted">Character name<input name="keyword" type="text" maxlength="40" autocomplete="off" value="${escapeHtml(query.keyword)}" placeholder="Start of the name"></label>
      <div class="official-error" hidden></div>
      <div class="muted small">Searches the official character pages. Equipment, skill levels and Daevanion boards are imported; the request goes through the relay set in Settings.</div>
      <div class="row official-actions"><span class="grow"></span><button type="button" class="cancel">Cancel</button><button type="submit" class="primary">Search</button></div>
    </form>`;
  const form = shell.body.querySelector("form");
  const error = form.querySelector(".official-error");
  form.region.addEventListener("change", () => { form.server.innerHTML = serverOptions(form.region.value, ""); });
  form.querySelector(".cancel").addEventListener("click", () => shell.dialog.close());
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const next = { region: form.region.value, server: form.server.value, keyword: form.keyword.value.trim() };
    if (!next.keyword) { error.textContent = "Enter a character name."; error.hidden = false; form.keyword.focus(); return; }
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    button.textContent = "Searching…";
    error.hidden = true;
    try {
      const all = O.parseSearch(await fetchViaRelay(O.searchUrl({ keyword: next.keyword, region: next.region })));
      if (shell.state.closed) return;
      resultsView(shell, next, all, options, () => searchView(shell, next, options));
    } catch (err) {
      if (shell.state.closed) return;
      error.textContent = err.message;
      error.hidden = false;
      button.disabled = false;
      button.textContent = "Search";
    }
  });
  form.keyword.focus();
  form.keyword.select();
}

// options: { name, entry, preset } to prefill the name and to offer that
// roster character as the import target.
export function importCharacterDialog(options = {}) {
  const shell = openShell("Import from aion2.plaync.com");
  const link = options.entry ? officialLink(options.entry) : null;
  const query = {
    region: (link && link.region) || O.DEFAULT_REGION,
    server: (link && link.serverName) || O.DEFAULT_SERVER,
    keyword: options.name || (options.entry && options.entry.name) || "",
  };
  searchView(shell, query, options);
  return shell.dialog;
}

export function syncCharacter(entry, presetName) {
  const link = officialLink(entry);
  const preset = presetName || entry.preset;
  if (!link) return importCharacterDialog({ entry, preset });
  const shell = openShell(`Sync ${entry.name || "character"} from aion2.plaync.com`);
  const who = { region: link.region, serverId: link.serverId, serverName: link.serverName, characterId: link.characterId };
  const target = { mode: "update", cls: entry.class, name: entry.name, preset, serverName: link.serverName };
  (async () => {
    const progress = progressView(shell.body);
    let info;
    try {
      progress.step("Fetching profile…");
      info = await fetchViaRelay(O.infoUrl(who));
    } catch (err) {
      if (!shell.state.closed) errorView(shell.body, err instanceof NotFound ? "Character not found: it may have been renamed or deleted. Import it again to relink it." : err.message);
      return;
    }
    if (shell.state.closed) return;
    const cls = O.className((info.profile || {}).className);
    if (lower(cls) !== entry.class) { errorView(shell.body, `The linked character is a ${cls || "different class"} now; import it again to relink it.`); return; }
    runImport(shell, who, target, info, null, progress);
  })();
  return shell.dialog;
}

// Preset picker for the character page's menu.
export function askSync(entry) {
  const link = officialLink(entry);
  const dialog = document.createElement("dialog");
  dialog.className = "builds-dialog official-ask";
  dialog.innerHTML = `<form method="dialog" class="stack">
      <h3>Sync from aion2.plaync.com</h3>
      <label class="stack small muted">Preset to update<select class="official-preset">${presetSelect(entry, entry.preset)}</select></label>
      <div class="muted small">${link ? escapeHtml(`Linked to ${entry.name} on ${link.serverName}; last sync ${new Date(link.importedAt).toLocaleString()}.`)
        : "Not linked yet: search the character first."} Equipment and skill levels are replaced with the site's; boards with open nodes are updated, planned boards are kept.</div>
      <div class="row builds-dialog-actions"><span class="grow"></span><button type="button" class="cancel">Cancel</button><button type="submit" class="primary">${link ? "Sync" : "Search…"}</button></div>
    </form>`;
  document.body.appendChild(dialog);
  let preset = null;
  dialog.querySelector("form").addEventListener("submit", (e) => { e.preventDefault(); preset = dialog.querySelector(".official-preset").value; dialog.close(); });
  dialog.querySelector(".cancel").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => { dialog.remove(); if (preset) syncCharacter(entry, preset); });
  dialog.showModal();
}

// Syncs every roster character in one go: linked ones through their link,
// the others by a name search on the default region and server, linked when
// exactly one result has the same class. The current preset of each
// character is the one updated.
export function syncAllCharacters() {
  const shell = openShell("Sync all characters from aion2.plaync.com");
  const before = currentCharacter();
  const list = characters().filter((e) => e.name);
  const lines = [];
  const render = (current) => {
    if (shell.state.closed) return;
    shell.body.innerHTML = `<div class="stack official-syncall">
      ${current ? `<div class="official-status">${escapeHtml(current)}</div>` : ""}
      <ul class="official-syncall-list">${lines.map((l) => `<li class="${l.ok ? "ok" : "skip"}">${escapeHtml(l.text)}</li>`).join("")}</ul>
      ${current ? "" : `<div class="row"><span class="grow"></span><button type="button" class="primary official-done">Close</button></div>`}
    </div>`;
    const done = shell.body.querySelector(".official-done");
    if (done) done.addEventListener("click", () => shell.dialog.close());
  };
  (async () => {
    if (!list.length) { lines.push({ ok: false, text: "No characters in the roster." }); render(null); return; }
    const first = list.map(officialLink).find(Boolean);
    const region = (first && first.region) || O.DEFAULT_REGION;
    const server = (first && first.serverName) || O.DEFAULT_SERVER;
    for (const entry of list) {
      if (shell.state.closed) return;
      const label = `${entry.name} (${O.className(entry.class)})`;
      render(`${label}: looking up…`);
      try {
        let who = null;
        const link = officialLink(entry);
        if (link) who = { region: link.region, serverId: link.serverId, serverName: link.serverName, characterId: link.characterId };
        else {
          await sleep(GAP_MS);
          const found = O.parseSearch(await fetchViaRelay(O.searchUrl({ keyword: entry.name, region })));
          const sameName = found.filter((f) => lower(f.name) === lower(entry.name) && lower(O.classOfPcId(f.pcId)) === entry.class);
          const onServer = O.filterByServer(sameName, server);
          const pick = onServer.length === 1 ? onServer[0] : sameName.length === 1 ? sameName[0] : null;
          if (!pick) {
            lines.push({ ok: false, text: `${label}: ${sameName.length ? `${sameName.length} matches, pick one with Import` : "not found on the site"}` });
            continue;
          }
          who = whoOf(pick, region);
        }
        await sleep(GAP_MS);
        const info = await fetchViaRelay(O.infoUrl(who));
        const cls = O.className((info.profile || {}).className);
        if (lower(cls) !== entry.class) { lines.push({ ok: false, text: `${label}: the site says ${cls || "another class"}, skipped` }); continue; }
        const preset = entry.preset || (entry.builds2[0] && entry.builds2[0].presets[0]);
        const progress = { total() {}, step: (text) => render(`${label}: ${text}`) };
        const result = await collect(who, info, progress, () => shell.state.closed);
        if (shell.state.closed) return;
        const written = writeImport(bp(), { mode: "update", cls: entry.class, name: entry.name, preset, serverName: who.serverName }, who, result);
        lines.push({ ok: true, text: `${label}: preset "${written.presetName}" updated, ${Object.keys(result.mapped.equipped || {}).length} items, ${Object.keys(written.skills).length} skill levels, ${written.updatedBoards.length} boards` });
      } catch (err) {
        if (shell.state.closed) return;
        lines.push({ ok: false, text: `${label}: ${err instanceof NotFound ? "not found on the site" : err.message}` });
      }
    }
    if (before) selectCharacter(before.class, before.preset || before.current, before.name);
    render(null);
  })();
  return shell.dialog;
}
