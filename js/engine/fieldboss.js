// Field boss respawn state, ported from armory_engine/fieldboss.py. The
// feed is aion2timers.com's community kill feed per server, mirrored by
// the feeds workflow (see .github/workflows/feeds.yml) because the site
// itself cannot read it cross-origin.

export const DEFAULT_SERVER = "eu-vaizel";
export const SOON_MS = 3600 * 1000;
export const SERVERS = [
  ["Europe", [
    ["eu-siel", "Siel"], ["eu-israphel", "Israphel"], ["eu-nezekan", "Nezekan"], ["eu-zikel", "Zikel"],
    ["eu-vaizel", "Vaizel"], ["eu-triniel", "Triniel"], ["eu-kaisinel", "Kaisinel"], ["eu-lumiel", "Lumiel"],
    ["eu-yustiel", "Yustiel"], ["eu-marchutan", "Marchutan"], ["eu-ariel", "Ariel"], ["eu-azphel", "Azphel"],
    ["eu-fregion", "Fregion"], ["eu-ereshkigal", "Ereshkigal"], ["eu-beritra", "Beritra"],
  ]],
  ["NA East", [["nae-siel", "Siel"], ["nae-israphel", "Israphel"], ["nae-nezekan", "Nezekan"], ["nae-zikel", "Zikel"], ["nae-triniel", "Triniel"]]],
  ["NA West", [["naw-siel", "Siel"], ["naw-israphel", "Israphel"], ["naw-nezekan", "Nezekan"], ["naw-zikel", "Zikel"]]],
  ["South America", [["sa-siel", "Siel"], ["sa-israphel", "Israphel"], ["sa-nezekan", "Nezekan"], ["sa-zikel", "Zikel"]]],
];

export function serverLabel(serverId) {
  for (const [region, servers] of SERVERS) {
    for (const [id, label] of servers) if (id === serverId) return `${region} · ${label}`;
  }
  return serverId;
}

export function dropsYellowArtwork(boss) {
  return String((boss.artwork || {}).grade || "").toLowerCase() === "unique";
}

const stamp = (value) => (value ? new Date(Number(value) * 1000) : null);

export function bossStatuses(bosses, feed, now) {
  const kills = (feed && feed.kills) || {};
  const statuses = bosses.map((boss) => {
    const entry = kills[boss.id];
    if (!entry) return { boss, known: false, up: false, estimated: false, since: null, nextSpawn: null };
    let up = entry.st === "up";
    let nextSpawn = stamp(entry.ns);
    if (!up && !nextSpawn && stamp(entry.t)) nextSpawn = new Date(stamp(entry.t).getTime() + (boss.cycle_minutes || 0) * 60000);
    if (!up && nextSpawn && nextSpawn <= now) up = true; // overdue: no newer kill known
    return { boss, known: true, up, estimated: Boolean(entry.est), since: up ? stamp(entry.us) : stamp(entry.t), nextSpawn };
  });
  const order = (s) => (!s.known ? [2, s.boss.name] : s.up ? [0, s.boss.name] : [1, s.nextSpawn || now]);
  return statuses.sort((a, b) => {
    const [ka, va] = order(a); const [kb, vb] = order(b);
    return ka - kb || (va < vb ? -1 : va > vb ? 1 : 0);
  });
}

export function timeLeft(status, now) {
  if (status.up || !status.nextSpawn) return null;
  return Math.max(0, status.nextSpawn - now);
}

export function isSoon(status, now, horizon = SOON_MS) {
  if (!status.known) return false;
  if (status.up) return true;
  const left = timeLeft(status, now);
  return left !== null && left <= horizon;
}
