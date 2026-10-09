// Aion 2 Armory relay: a Cloudflare Worker (free tier) that lets the Armory
// read aion2.plaync.com's character pages, which send no CORS headers.
// Deploy it (see "Official import" in docs/ARCHITECTURE.md), then set
// https://<name>.<account>.workers.dev/?url= as the relay in Settings.
//
// Only the character API and the character search are forwarded; anything
// else gets 403, so the worker cannot be used as an open proxy.

const ALLOWED = [
  "https://aion2.plaync.com/api/character/",
  "https://aion2.plaync.com/api/gameconst/item",
  "https://aion2.plaync.com/en-us/api/gameconst/item",
  "https://api-search.plaync.com/aion2global/search/",
];

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Referer": "https://aion2.plaync.com/en-us/characters/index",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Max-Age": "86400",
};

function reply(body, status, extra = {}) {
  return new Response(body, { status, headers: { ...CORS, "Content-Type": "application/json; charset=utf-8", ...extra } });
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (request.method !== "GET") return reply(JSON.stringify({ error: "Only GET is relayed." }), 405);

    const target = new URL(request.url).searchParams.get("url");
    if (!target) return reply(JSON.stringify({ error: "Add ?url=<encoded aion2.plaync.com API URL>." }), 400);
    let url;
    try { url = new URL(target); } catch (e) { return reply(JSON.stringify({ error: "The url parameter is not a URL." }), 400); }
    if (!ALLOWED.some((prefix) => url.href.startsWith(prefix))) return reply(JSON.stringify({ error: "Only the Aion 2 character API is relayed." }), 403);

    let upstream;
    try {
      upstream = await fetch(url.href, { headers: BROWSER_HEADERS, cf: { cacheTtl: 0 } });
    } catch (err) {
      return reply(JSON.stringify({ error: `aion2.plaync.com did not answer: ${err.message}` }), 502);
    }
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        ...CORS,
        "Content-Type": upstream.headers.get("Content-Type") || "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  },
};
