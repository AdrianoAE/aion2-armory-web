// Theme: "system" follows the OS setting and keeps following it while the
// page is open; "dark" and "light" are fixed.

const media = window.matchMedia ? window.matchMedia("(prefers-color-scheme: light)") : null;
let chosen = "system";

export function resolvedTheme(name = chosen) {
  if (name === "dark" || name === "light") return name;
  return media && media.matches ? "light" : "dark";
}

export function applyTheme(name) {
  chosen = name === "dark" || name === "light" ? name : "system";
  const theme = resolvedTheme();
  const root = document.documentElement;
  if (root.dataset.theme === theme && root.dataset.themeChoice === chosen) return;
  root.dataset.theme = theme;
  root.dataset.themeChoice = chosen;
  root.style.colorScheme = theme;
  window.dispatchEvent(new CustomEvent("themechange", { detail: { theme, choice: chosen } }));
}

if (media) media.addEventListener("change", () => { if (chosen === "system") applyTheme("system"); });
