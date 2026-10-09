// The Alerts card on the Settings page; every change saves at once.

import { onPrefs } from "../../ui.js";
import { NO_PUSH_RELAY, disablePush, enablePush, onPushStatus, pushStatus, relayOrigin, sendTestPush } from "../../push.js";
import { ODYLE_MAX, SHOP_SPECIAL_TASK } from "../../engine/planner.js";
import { REPEATS, customOccurrence, odyleTarget, relativeText } from "./core.js";
import { SOUNDS, alertSettings, eventList, newCustomEvent, notificationState, playSound, requestNotifications, saveAlertSettings, trackedBossCount } from "../../notify.js";

const esc = (text) => String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function pushState(st) {
  if (!st.supported) return ["warn", "Not supported in this browser", ""];
  if (st.relayPush === "missing") return ["warn", "Needs the Armory relay Worker", NO_PUSH_RELAY];
  if (st.permission === "denied") return ["danger", "Blocked by the browser: allow notifications for this site in its settings", ""];
  if (!st.enabled) return st.relayPush === "ok" ? ["info", "Off", ""] : ["warn", "The relay is not answering", ""];
  if (!st.subscribed) return ["danger", "Subscription lost", "The browser dropped the push subscription; turn push notifications off and on again."];
  const sync = st.lastSync || {};
  const note = st.relayChanged ? "The relay URL changed since push was turned on; turn it off and on to move to the new relay." : "";
  if (sync.error) return ["danger", "Upload failed", sync.error];
  if (!sync.at) return ["info", "On · waiting for the alert sources", note];
  const time = new Date(sync.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return ["success", `On · ${sync.count} alert${sync.count === 1 ? "" : "s"} uploaded at ${time}`, note];
}

const PERMISSION = {
  granted: ["success", "Allowed"],
  denied: ["danger", "Blocked by the browser: allow notifications for this site in its settings"],
  default: ["info", "The browser asks when you turn this on"],
  unsupported: ["warn", "Not supported in this browser"],
};

export function localInputValue(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(value) {
  const d = new Date(value);
  return value && !Number.isNaN(d.getTime()) ? d.toISOString() : null;
}

export function nextText(event, now = new Date()) {
  const at = customOccurrence(event, now);
  if (!at) return event.at ? "Passed" : "Set a date and time";
  return `${at.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })} ${at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })} · ${relativeText(at, now)}`;
}

function getPath(source, path) {
  return path.split(".").reduce((node, key) => (node == null ? undefined : node[key]), source);
}

function eventRow(event, lead) {
  return `<div class="al-event" data-id="${esc(event.id)}">
    <input type="text" class="al-ev-name" data-ev="name" value="${esc(event.name)}" aria-label="Event name" placeholder="Event name">
    <input type="datetime-local" data-ev="at" value="${esc(localInputValue(event.at))}" aria-label="Date and time">
    <select data-ev="repeat" aria-label="Repeat">${REPEATS.map(([value, label]) => `<option value="${value}" ${value === event.repeat ? "selected" : ""}>${label}</option>`).join("")}</select>
    <label class="al-ev-lead"><input type="number" data-ev="leadMinutes" min="0" max="1440" value="${event.leadMinutes ?? ""}" placeholder="${lead}" aria-label="Minutes before"><span class="muted small">min before</span></label>
    <span class="muted small al-ev-next">${esc(nextText(event))}</span>
    <button type="button" class="icon danger" data-ev-delete title="Delete this event" aria-label="Delete ${esc(event.name)}">×</button>
  </div>`;
}

export function renderAlertSettings(el) {
  let s = alertSettings();
  let lastWritten = JSON.stringify(s.customEvents);
  el.innerHTML = `<div class="al-form stack">
    <label class="al-master row"><input type="checkbox" data-k="enabled" ${s.enabled ? "checked" : ""}>
      <span><b>Alerts on</b><br><span class="muted small">A sound and a notice in the corner while this page is open in a tab.</span></span></label>
    <div class="al-fields stack${s.enabled ? "" : " off"}">
      <div class="al-field"><span class="al-label">Sound</span><div class="row">
        <select data-k="sound">${[...Object.entries(SOUNDS).map(([key, def]) => [key, def.label]), ["custom", "Custom URL"]].map(([key, label]) => `<option value="${key}" ${key === s.sound ? "selected" : ""}>${label}</option>`).join("")}</select>
        <input type="url" class="al-url" data-k="customSoundUrl" value="${esc(s.customSoundUrl)}" placeholder="https://…/sound.mp3" aria-label="Sound URL" ${s.sound === "custom" ? "" : "hidden"}>
        <button type="button" data-test>Test</button></div></div>
      <div class="al-field"><span class="al-label">Lead time</span><div class="row">
        <input type="number" data-k="leadMinutes" min="0" max="1440" value="${s.leadMinutes}" aria-label="Lead time in minutes">
        <span class="muted small">minutes before an event or a boss spawn</span></div></div>
      <div class="al-field"><span class="al-label">Browser notifications</span><div class="stack al-tight">
        <div class="row"><label class="row"><input type="checkbox" data-k="browser" ${s.browser ? "checked" : ""}> System notifications</label><span class="tag" data-permission></span></div>
        <label class="row small muted"><input type="checkbox" data-k="browserAlways" ${s.browserAlways ? "checked" : ""}> Also while this tab is in front (otherwise only when it is hidden)</label></div></div>
      <h3>While the site is closed</h3>
      <div class="al-push stack al-tight">
        <div class="row"><label class="al-switch row"><input type="checkbox" role="switch" data-push-toggle>
          <span>Push notifications (works with the browser running, even with the Armory closed)</span></label><span class="tag" data-push-state></span></div>
        <div class="small muted al-push-note" data-push-note hidden></div>
        <div class="row"><button type="button" data-push-test disabled>Send test</button><span class="small muted al-push-msg" data-push-msg></span></div>
        <div class="muted small">Alert times are uploaded to your relay Worker; it sends the notification at the right minute.</div>
      </div>
      <h3>Sources</h3>
      <div class="al-sources">
        <div class="al-source" style="--al-accent: var(--warn)"><label class="row"><input type="checkbox" data-k="timers" ${s.timers ? "checked" : ""}><b>Event timers</b></label>
          <div class="muted small">The next start of each event on the Timers page. <button type="button" class="link" data-events-toggle>Choose events</button></div>
          <div class="al-event-picks" hidden></div></div>
        <div class="al-source" style="--al-accent: var(--elyos)"><label class="row"><input type="checkbox" data-k="trackedBosses" ${s.trackedBosses ? "checked" : ""}><b>Tracked bosses</b></label>
          <div class="muted small" data-tracked></div></div>
        <div class="al-source" style="--al-accent: var(--info)"><label class="row"><input type="checkbox" data-k="odyle.enabled" ${s.odyle.enabled ? "checked" : ""}><b>Odyle energy</b></label>
          <div class="small muted al-inline">When a character reaches <input type="number" data-k="odyle.percent" min="1" max="100" value="${s.odyle.percent}" aria-label="Odyle percent">% of ${ODYLE_MAX} (<span data-odyle-target>${odyleTarget(s.odyle.percent)}</span>)</div></div>
        <div class="al-source" style="--al-accent: var(--weekly)"><label class="row"><input type="checkbox" data-k="weekly.enabled" ${s.weekly.enabled ? "checked" : ""}><b>Weekly shop</b></label>
          <div class="small muted al-inline"><input type="number" data-k="weekly.hoursBefore" min="0" max="168" value="${s.weekly.hoursBefore}" aria-label="Hours before the weekly reset"> h before the Wednesday reset while ${esc(SHOP_SPECIAL_TASK)} is unchecked</div></div>
      </div>
      <h3>Custom events</h3>
      <div class="al-events stack al-tight"></div>
      <div class="row"><button type="button" data-add-event>Add event</button><span class="muted small">Leave "min before" empty to use the lead time above.</span></div>
    </div>
  </div>`;

  const fields = el.querySelector(".al-fields");
  const eventsBox = el.querySelector(".al-events");
  const picks = el.querySelector(".al-event-picks");

  const save = (patch) => {
    saveAlertSettings(patch);
    s = alertSettings();
    lastWritten = JSON.stringify(s.customEvents);
  };

  const drawPermission = () => {
    const [tone, text] = PERMISSION[notificationState()] || PERMISSION.unsupported;
    const tag = el.querySelector("[data-permission]");
    tag.className = `tag ${tone}`;
    tag.textContent = text;
  };

  const drawTracked = () => {
    const count = trackedBossCount();
    el.querySelector("[data-tracked]").innerHTML = `${count ? `${count} boss${count === 1 ? "" : "es"} tracked` : "No bosses tracked yet"}; alerts at their next spawn. <a href="#timers">Timers</a>`;
  };

  const drawEvents = () => {
    eventsBox.innerHTML = s.customEvents.length
      ? s.customEvents.map((event) => eventRow(event, s.leadMinutes)).join("")
      : `<div class="muted small">No custom events yet: a guild meeting, a siege with friends, anything with a time.</div>`;
  };

  const drawPicks = async () => {
    const events = await eventList();
    if (!events.length) { picks.innerHTML = `<div class="muted small">The event schedule could not be loaded.</div>`; return; }
    const chosen = new Set(s.timerEvents);
    picks.innerHTML = `<div class="muted small">None ticked means every event.</div><div class="al-pick-grid">${events.map((e) => `<label class="row small"><input type="checkbox" data-pick="${esc(e.id)}" ${chosen.has(e.id) ? "checked" : ""}>${esc(e.name)}</label>`).join("")}</div>`;
  };

  const readField = (input) => {
    if (input.type === "checkbox") return input.checked;
    if (input.type === "number") return input.value === "" ? null : Number(input.value);
    return input.value;
  };

  const onField = (input, final) => {
    const path = input.dataset.k;
    let value = readField(input);
    if (input.type === "number") {
      if (value === null || !Number.isFinite(value)) { if (final) input.value = getPath(s, path); return; }
      value = Math.min(Number(input.max), Math.max(Number(input.min), value));
      if (final) input.value = value;
    }
    const [head, sub] = path.split(".");
    save({ [head]: sub ? { ...s[head], [sub]: value } : value });
    if (path === "enabled") fields.classList.toggle("off", !s.enabled);
    if (path === "sound") el.querySelector(".al-url").hidden = s.sound !== "custom";
    if (path === "odyle.percent") el.querySelector("[data-odyle-target]").textContent = odyleTarget(s.odyle.percent);
    if (path === "leadMinutes") eventsBox.querySelectorAll('[data-ev="leadMinutes"]').forEach((i) => { i.placeholder = s.leadMinutes; });
    if (path === "browser" && value) requestNotifications().then(drawPermission);
  };

  const onEventField = (input, final) => {
    const row = input.closest("[data-id]");
    const events = s.customEvents.map((e) => ({ ...e }));
    const event = events.find((e) => e.id === row.dataset.id);
    if (!event) return;
    const field = input.dataset.ev;
    if (field === "name") event.name = input.value;
    else if (field === "at") { const at = fromLocalInput(input.value); if (!at) return; event.at = at; }
    else if (field === "repeat") event.repeat = input.value;
    else if (field === "leadMinutes") {
      if (input.value === "") event.leadMinutes = null;
      else if (Number.isFinite(Number(input.value))) event.leadMinutes = Math.min(1440, Math.max(0, Math.round(Number(input.value))));
      else return;
      if (final) input.value = event.leadMinutes ?? "";
    }
    save({ customEvents: events });
    const saved = s.customEvents.find((e) => e.id === event.id);
    if (saved) row.querySelector(".al-ev-next").textContent = nextText(saved);
    if (final && field === "name" && !input.value.trim()) input.value = saved ? saved.name : "";
  };

  const handle = (e, final) => {
    const input = e.target;
    if (input.dataset.k) onField(input, final);
    else if (input.dataset.ev) onEventField(input, final);
    else if (input.dataset.pick !== undefined && final) {
      save({ timerEvents: [...picks.querySelectorAll("[data-pick]:checked")].map((i) => i.dataset.pick) });
    }
  };
  el.addEventListener("input", (e) => { if (e.target.type !== "checkbox" && e.target.tagName !== "SELECT") handle(e, false); });
  el.addEventListener("change", (e) => handle(e, true));
  el.addEventListener("click", (e) => {
    const button = e.target.closest("button");
    if (!button) return;
    if (button.hasAttribute("data-test")) playSound(s.sound);
    else if (button.hasAttribute("data-add-event")) {
      save({ customEvents: [...s.customEvents, newCustomEvent()] });
      drawEvents();
      const rows = eventsBox.querySelectorAll(".al-ev-name");
      if (rows.length) { rows[rows.length - 1].focus(); rows[rows.length - 1].select(); }
    } else if (button.hasAttribute("data-ev-delete")) {
      const id = button.closest("[data-id]").dataset.id;
      save({ customEvents: s.customEvents.filter((ev) => ev.id !== id) });
      drawEvents();
    } else if (button.hasAttribute("data-events-toggle")) {
      picks.hidden = !picks.hidden;
      button.textContent = picks.hidden ? "Choose events" : "Hide events";
      if (!picks.hidden) drawPicks();
    }
  });

  const stop = onPrefs(() => {
    if (!el.isConnected) { stop(); return; }
    const fresh = alertSettings();
    if (JSON.stringify(fresh.customEvents) === lastWritten) return;
    s = fresh;
    lastWritten = JSON.stringify(s.customEvents);
    if (!eventsBox.contains(document.activeElement)) drawEvents();
  });
  const clock = setInterval(() => {
    if (!el.isConnected) { clearInterval(clock); return; }
    eventsBox.querySelectorAll("[data-id]").forEach((row) => {
      const event = s.customEvents.find((e) => e.id === row.dataset.id);
      if (event) row.querySelector(".al-ev-next").textContent = nextText(event);
    });
  }, 30000);

  const pushBox = el.querySelector(".al-push");
  const pushToggle = pushBox.querySelector("[data-push-toggle]");
  const pushTest = pushBox.querySelector("[data-push-test]");
  const pushMsg = pushBox.querySelector("[data-push-msg]");
  let pushBusy = false;
  const say = (text, bad = false) => { pushMsg.textContent = text; pushMsg.classList.toggle("bad", bad); };
  const drawPush = async () => {
    const st = await pushStatus();
    if (!el.isConnected) return;
    const [tone, text, note] = pushState(st);
    const tag = pushBox.querySelector("[data-push-state]");
    tag.className = `tag ${tone}`;
    tag.textContent = text;
    const noteEl = pushBox.querySelector("[data-push-note]");
    noteEl.textContent = note;
    noteEl.hidden = !note;
    pushToggle.checked = st.enabled;
    pushToggle.disabled = pushBusy || (!st.enabled && (!st.supported || st.relayPush !== "ok" || st.permission === "denied"));
    pushTest.disabled = pushBusy || !st.enabled || !st.subscribed;
  };
  pushToggle.addEventListener("change", async () => {
    pushBusy = true;
    const on = pushToggle.checked;
    say(on ? "Turning on…" : "Turning off…");
    try {
      if (on) await enablePush(); else await disablePush();
      say(on ? "Push notifications are on." : "");
    } catch (err) {
      say(err.message, true);
    } finally {
      pushBusy = false;
      drawPush();
    }
  });
  pushTest.addEventListener("click", async () => {
    pushTest.disabled = true;
    say("Sending…");
    try {
      await sendTestPush();
      say("Sent: it should appear within a few seconds.");
    } catch (err) {
      say(err.message, true);
    } finally { drawPush(); }
  });
  const stopPush = onPushStatus(() => { if (!el.isConnected) stopPush(); else drawPush(); });
  let relaySeen = relayOrigin();
  const stopRelay = onPrefs(() => {
    if (!el.isConnected) { stopRelay(); return; }
    if (relayOrigin() !== relaySeen) { relaySeen = relayOrigin(); drawPush(); }
  });

  drawPermission();
  drawTracked();
  drawEvents();
  drawPush();
}
