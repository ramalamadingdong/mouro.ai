// Town Trivia's service worker: notifications only. It opens (or brings back)
// the game when a trip notification is tapped. It has no fetch handler and
// caches nothing, so it can never serve a stale page (the reason the games
// otherwise have no service worker).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const game = windows.find((w) => new URL(w.url).pathname.startsWith("/games/road-trip/trivia/"));
    return game ? game.focus() : self.clients.openWindow("/games/road-trip/trivia/");
  })());
});
