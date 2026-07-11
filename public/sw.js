/**
 * Rubin Browser service worker (feature 127) — an OFFLINE APP SHELL only.
 *
 * The production build is a single inlined index.html (vite-plugin-singlefile),
 * so precaching the shell (index.html + manifest + icons) is enough to launch the
 * app offline. It then degrades to the OFFLINE synthetic cube with no network.
 *
 * CRITICAL: this SW NEVER caches or intercepts data requests — HiPS tiles, TAP/
 * SODA/DataLink/auth calls, Gaia/DSS imagery, or the dev `/rsp` proxy. It only
 * touches SAME-ORIGIN shell assets; every cross-origin request (and any other
 * same-origin request such as the proxy) is left entirely to the network, so a
 * stale/auth-bearing/huge response can never be served from cache.
 */

const CACHE = 'rubin-browser-shell-v1';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }
  // Never touch anything cross-origin (tiles, TAP/SODA/auth, Gaia/DSS).
  if (url.origin !== self.location.origin) return;

  // App navigation: network-first so a fresh deploy wins, falling back to the
  // cached shell only when offline.
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match('./index.html').then((r) => r || caches.match('./'))));
    return;
  }

  // Precached shell assets (manifest, icons): cache-first. Everything else
  // same-origin (e.g. the dev /rsp proxy) is deliberately left to the network.
  if (/\/(manifest\.webmanifest|icon-\d+\.png)$/.test(url.pathname)) {
    event.respondWith(caches.match(req).then((r) => r || fetch(req)));
  }
});
