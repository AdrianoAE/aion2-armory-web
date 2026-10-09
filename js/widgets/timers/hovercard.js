// One floating card for the timers widgets: event details on the timeline
// and the event list, Pantheon effects on Artwork icons.

let card = null;
let owner = null;

function element() {
  if (!card) {
    card = document.createElement("div");
    card.className = "tm-hover";
    card.setAttribute("role", "tooltip");
    card.hidden = true;
  }
  if (!card.isConnected) document.body.appendChild(card);
  return card;
}

export function showHover(html, x, y, who = null) {
  const el = element();
  if (el.dataset.html !== html) {
    el.innerHTML = html;
    el.dataset.html = html;
  }
  el.hidden = false;
  owner = who;
  placeHover(x, y);
}

export function placeHover(x, y) {
  if (!card || card.hidden) return;
  const w = card.offsetWidth, h = card.offsetHeight;
  let left = x + 16, top = y + 16;
  if (left + w > window.innerWidth - 8) left = Math.max(8, x - w - 16);
  if (top + h > window.innerHeight - 8) top = Math.max(8, y - h - 12);
  card.style.left = `${left}px`;
  card.style.top = `${top}px`;
}

export function hideHover(who = null) {
  if (!card || (who && owner !== who)) return;
  card.hidden = true;
  owner = null;
}

// Delegated hover over `selector` inside `root`; `build(target)` returns the
// card's HTML or "" for none. Returns the cleanup.
export function hoverable(root, selector, build) {
  const who = {};
  let current = null;
  const over = (e) => {
    const target = e.target.closest(selector);
    if (!target || !root.contains(target)) return;
    if (target !== current) {
      current = target;
      const html = build(target);
      if (!html) { hideHover(who); return; }
      showHover(html, e.clientX, e.clientY, who);
    }
  };
  const move = (e) => { if (current) placeHover(e.clientX, e.clientY); };
  const out = (e) => {
    if (!current) return;
    const to = e.relatedTarget && e.relatedTarget.closest ? e.relatedTarget.closest(selector) : null;
    if (to === current) return;
    current = null;
    hideHover(who);
  };
  root.addEventListener("pointerover", over);
  root.addEventListener("pointermove", move);
  root.addEventListener("pointerout", out);
  return () => {
    root.removeEventListener("pointerover", over);
    root.removeEventListener("pointermove", move);
    root.removeEventListener("pointerout", out);
    hideHover(who);
  };
}
