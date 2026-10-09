// Shows the alerts the relay Worker pushes while no Armory tab is open. It sits
// at the site root so its scope covers every page; it has no fetch handler and
// caches nothing.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { body: event.data ? event.data.text() : "" }; }
  event.waitUntil(self.registration.showNotification(data.title || "Aion 2 Armory", {
    body: data.body || "",
    tag: data.tag || undefined,
    icon: "assets/class_icons/gladiator.png",
    data: { url: data.url || "" },
  }));
});

function targetUrl(raw) {
  const scope = self.registration.scope;
  try {
    const url = new URL(raw || scope, scope);
    return url.href.startsWith(scope) ? url.href : scope;
  } catch (e) { return scope; }
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = targetUrl(event.notification.data && event.notification.data.url);
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const open = windows.find((client) => client.url.startsWith(self.registration.scope));
    if (!open) { await self.clients.openWindow(url); return; }
    await open.focus();
    open.postMessage({ type: "armory-open", url });
  })());
});
