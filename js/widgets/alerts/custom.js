import { registerWidget } from "../../widgets.js";
import { onPrefs } from "../../ui.js";
import { REPEATS, customOccurrence } from "./core.js";
import { fromLocalInput, localInputValue, nextText } from "./settings.js";
import { alertSettings, newCustomEvent, saveAlertSettings } from "../../notify.js";

const esc = (text) => String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const REPEAT_LABEL = Object.fromEntries(REPEATS);

function sorted(events, now) {
  const key = (e) => { const at = customOccurrence(e, now); return at ? at.getTime() : Infinity; };
  return [...events].sort((a, b) => key(a) - key(b) || a.name.localeCompare(b.name));
}

function listHtml(settings, now) {
  if (!settings.customEvents.length) return `<div class="al-empty muted small">No custom events yet. Add one below; it alerts like any other timer.</div>`;
  return `<ul class="al-list">${sorted(settings.customEvents, now).map((e) => {
    const live = Boolean(customOccurrence(e, now));
    const lead = e.leadMinutes ?? settings.leadMinutes;
    return `<li class="al-row${live ? "" : " is-past"}" style="--al-accent: var(--accent-2)" data-id="${esc(e.id)}">
      <span class="al-dot" aria-hidden="true"></span>
      <div class="al-row-text"><b>${esc(e.name)}</b><span class="muted small">${esc(nextText(e, now))}</span></div>
      <span class="tag ${e.repeat === "none" ? "" : "accent"}">${REPEAT_LABEL[e.repeat]}</span>
      <span class="muted small" title="Alert this many minutes before">${lead} min</span>
      <button type="button" class="icon danger" data-delete="${esc(e.id)}" title="Delete" aria-label="Delete ${esc(e.name)}">×</button></li>`;
  }).join("")}</ul>`;
}

function formHtml() {
  const draft = newCustomEvent();
  return `<form class="al-quick" autocomplete="off">
    <input type="text" name="name" placeholder="New event" aria-label="Event name" required>
    <input type="datetime-local" name="at" value="${localInputValue(draft.at)}" aria-label="Date and time" required>
    <select name="repeat" aria-label="Repeat">${REPEATS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select>
    <button type="submit" class="primary">Add</button></form>`;
}

registerWidget({
  id: "alerts.custom",
  title: "Custom events",
  group: "Alerts",
  description: "Your own timed events with a quick add; they alert like the game timers.",
  accent: "accent-2",
  defaultSize: { cols: 2, rows: 2 },
  live: true,
  render(el) {
    const box = document.createElement("div");
    box.className = "al-widget";
    box.innerHTML = `<div class="al-custom-list"></div>${formHtml()}<div class="muted small"><a href="#settings">Edit lead times and repeats in Settings</a></div>`;
    el.appendChild(box);
    const listBox = box.querySelector(".al-custom-list");
    const draw = () => { listBox.innerHTML = listHtml(alertSettings(), new Date()); };
    listBox.addEventListener("click", (e) => {
      const button = e.target.closest("[data-delete]");
      if (!button) return;
      saveAlertSettings({ customEvents: alertSettings().customEvents.filter((ev) => ev.id !== button.dataset.delete) });
    });
    const form = box.querySelector("form");
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const at = fromLocalInput(form.elements.at.value);
      const name = form.elements.name.value.trim();
      if (!at || !name) { (name ? form.elements.at : form.elements.name).focus(); return; }
      saveAlertSettings({ customEvents: [...alertSettings().customEvents, newCustomEvent({ name, at, repeat: form.elements.repeat.value })] });
      form.elements.name.value = "";
    });
    draw();
    return onPrefs(() => { if (box.isConnected) draw(); });
  },
});
