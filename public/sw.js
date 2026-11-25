// Minimal Service Worker for PWA installability (network-first passthrough)
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {
  // Network passthrough; offline shell caching will be added in Phase 4
});
