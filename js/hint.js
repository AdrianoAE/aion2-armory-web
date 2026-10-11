// Explanations sit behind a small info icon: hovering or focusing it (a tap
// on touch screens) shows the text in the shared floating card.

import { hideHover, placeHover, showHover } from "./widgets/timers/hovercard.js";

const ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.4"/><rect x="7.3" y="7" width="1.4" height="4.6" rx="0.7" fill="currentColor"/><circle cx="8" cy="4.9" r="0.9" fill="currentColor"/></svg>';

const esc = (text) => String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// `text` is plain text; blank lines separate paragraphs.
export function hint(text) {
  const clean = String(text || "").replace(/[ \t]*\n[ \t]*/g, "\n").trim();
  if (!clean) return "";
  return `<span class="info-hint" tabindex="0" role="note" aria-label="${esc(clean)}" data-hint="${esc(clean)}">${ICON}</span>`;
}

function cardHtml(el) {
  return `<div class="hint-card">${el.dataset.hint.split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, " ")}</p>`).join("")}</div>`;
}

let installed = false;

export function installHints() {
  if (installed) return;
  installed = true;
  const who = {};
  let current = null;
  const target = (node) => (node && node.closest ? node.closest("[data-hint]") : null);
  document.addEventListener("pointerover", (e) => {
    const el = target(e.target);
    if (!el || el === current) return;
    current = el;
    showHover(cardHtml(el), e.clientX, e.clientY, who);
  });
  document.addEventListener("pointermove", (e) => { if (current) placeHover(e.clientX, e.clientY); });
  document.addEventListener("pointerout", (e) => {
    if (!current || target(e.relatedTarget) === current) return;
    current = null;
    hideHover(who);
  });
  document.addEventListener("focusin", (e) => {
    const el = target(e.target);
    if (!el) return;
    current = el;
    const r = el.getBoundingClientRect();
    showHover(cardHtml(el), r.right, r.bottom, who);
  });
  document.addEventListener("focusout", (e) => {
    if (current && target(e.target) === current) { current = null; hideHover(who); }
  });
}
