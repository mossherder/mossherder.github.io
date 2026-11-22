// Service worker: network-first for app files so a Home Screen launch picks up
// the latest deploy, with the cached copy as a fallback when slow or offline.
// Change CACHE on every deploy — editing this file is what tells the browser
// a new version exists.
const CACHE = 'gd-v1';
const SHELL = ['./', 'index.html', 'data-cleaned-names.js', 'favicon.png', 'apple-touch-icon.png'];
const TIMEOUT = 2500;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE)
    .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Audio and show metadata come from archive.org; leave cross-origin requests alone
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(networkFirst(e.request));
});

async function networkFirst(req) {
  const c = await caches.open(CACHE);
  const net = fetch(req, { cache: 'no-cache' }).then((r) => { if (r.ok) c.put(req, r.clone()); return r; });
  const timeout = new Promise((res) => setTimeout(res, TIMEOUT));
  const first = await Promise.race([net.catch(() => null), timeout]);
  if (first) return first;
  const hit = await c.match(req, { ignoreSearch: true });
  return hit || net;
}
