import { registerWidget } from "../../widgets.js";
import { ODYLE_MAX, SHOP_SPECIAL_TASK, durationText, odyleEnergy } from "../../engine/planner.js";
import { SOURCE_STYLE, relativeText } from "./core.js";
import { BELL_ICON, alertSettings, onAlerts, refreshSources, saveAlertSettings, snoozeAlert, sourcesLoaded, unsnoozeAlert, upcomingAlerts } from "../../notify.js";

const esc = (text) => String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clock = (date) => date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

export function whenText(alert, now) {
  if (alert.source === "odyle") return alert.capAt && alert.capAt > now ? `full ${relativeText(alert.capAt, now)}` : "full";
  if (alert.source === "weekly") return `resets in ${durationText(alert.at - now)}`;
  return relativeText(alert.at, now);
}

function detailText(alert, now) {
  const label = (SOURCE_STYLE[alert.source] || {}).label || "";
  switch (alert.source) {
    case "odyle": return `${odyleEnergy(alert.value, alert.since, now)}/${ODYLE_MAX} energy`;
    case "weekly": return `${SHOP_SPECIAL_TASK}: ${alert.pending.join(", ")}`;
    case "boss": return `${label} · ${clock(alert.at)}${alert.zone ? ` · ${alert.zone}` : ""}${alert.estimated ? " (est.)" : ""}`;
    case "custom": return `${label} · ${clock(alert.at)}${alert.repeat && alert.repeat !== "none" ? ` · ${alert.repeat}` : ""}`;
    default: return `${label} · ${clock(alert.at)}`;
  }
}

function stateHtml(alert) {
  if (alert.status === "snoozed") return `<span class="tag secondary" title="Snoozed">until ${clock(alert.snoozedUntil)}</span><button type="button" class="link" data-unsnooze="${esc(alert.key)}">Undo</button>`;
  const tag = alert.status === "fired" ? `<span class="tag success">alerted</span>` : "";
  return `${tag}<button type="button" class="link" data-snooze="${esc(alert.key)}" title="Remind me again in 15 minutes">Snooze 15 min</button>`;
}

export function headHtml(count, enabled) {
  return `<div class="al-head"><span class="al-bell${enabled ? "" : " off"}">${BELL_ICON}</span><b>Next 24 hours</b><span class="grow"></span>
    <span class="muted small">${enabled ? `${count} alert${count === 1 ? "" : "s"}` : "off"}</span><a class="small" href="#settings">Settings</a></div>`;
}

function emptyText(settings) {
  const on = [settings.timers && "event timers", settings.trackedBosses && "tracked bosses", settings.customEvents.length && "custom events", settings.odyle.enabled && "Odyle", settings.weekly.enabled && "the weekly shop"].filter(Boolean);
  return `Nothing due in the next 24 hours.${on.length ? ` Watching ${on.join(", ")}.` : " Every source is off."}`;
}

function fill(box, now) {
  const settings = alertSettings();
  if (!settings.enabled) {
    box.innerHTML = `${headHtml(0, false)}<div class="al-empty muted small">Alerts are off.</div><div><button type="button" class="primary" data-turn-on>Turn alerts on</button></div>`;
    return [];
  }
  const list = upcomingAlerts(now);
  box.innerHTML = `${headHtml(list.length, true)}${list.length ? `<ul class="al-list">${list.map((a) => `<li class="al-row is-${a.status}" style="--al-accent: var(${a.accent})">
      <span class="al-dot" aria-hidden="true"></span>
      <div class="al-row-text"><a href="#${a.route}" class="al-row-title">${esc(a.title)}</a><span class="muted small">${esc(detailText(a, now))}</span></div>
      <span class="al-when">${esc(whenText(a, now))}</span>
      <span class="al-row-actions">${stateHtml(a)}</span></li>`).join("")}</ul>`
    : `<div class="al-empty muted small">${emptyText(settings)}</div>`}`;
  return list;
}

registerWidget({
  id: "alerts.upcoming",
  title: "Upcoming alerts",
  group: "Alerts",
  description: "The alerts of the next 24 hours with countdowns; snooze one for 15 minutes.",
  accent: "accent-2",
  defaultSize: { cols: 2, rows: 2 },
  live: true,
  render(el) {
    const box = document.createElement("div");
    box.className = "al-widget";
    el.appendChild(box);
    let list = [];
    const draw = () => { list = fill(box, new Date()); };
    box.addEventListener("click", (e) => {
      const button = e.target.closest("button");
      if (!button) return;
      const find = (key) => list.find((a) => a.key === key);
      if (button.dataset.snooze && find(button.dataset.snooze)) snoozeAlert(find(button.dataset.snooze));
      else if (button.dataset.unsnooze && find(button.dataset.unsnooze)) unsnoozeAlert(find(button.dataset.unsnooze));
      else if (button.hasAttribute("data-turn-on")) { saveAlertSettings({ enabled: true }); refreshSources(new Date(), true); draw(); }
    });
    draw();
    if (!sourcesLoaded()) refreshSources(new Date());
    return onAlerts(() => { if (box.isConnected) draw(); });
  },
  compact(el) {
    const box = document.createElement("span");
    box.className = "al-compact";
    el.appendChild(box);
    const draw = () => {
      const now = new Date();
      const settings = alertSettings();
      const next = settings.enabled ? upcomingAlerts(now).find((a) => a.status === "pending" || a.status === "due") : null;
      box.innerHTML = `<span class="al-bell${settings.enabled ? "" : " off"}">${BELL_ICON}</span>${!settings.enabled ? `<span class="muted">Alerts off</span>`
        : next ? `<span class="muted">next:</span> <b>${esc(next.title)}</b> <span>${esc(whenText(next, now))}</span>` : `<span class="muted">No alerts in the next 24 h</span>`}`;
    };
    draw();
    if (!sourcesLoaded()) refreshSources(new Date());
    return onAlerts(() => { if (box.isConnected) draw(); });
  },
});
