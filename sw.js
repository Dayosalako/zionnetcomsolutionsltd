/*!
 * Zion Netcom — service worker
 * ------------------------------------------------------------------
 * Makes the site installable as an app and gives it a graceful offline mode.
 *
 * RULES (deliberately conservative — this site handles payments and live data):
 *  • Your own pages + code   → always fetched fresh from the network when online.
 *                              The saved copy is only used when the network fails.
 *  • Images                  → shown instantly from the saved copy, refreshed in the background.
 *  • Font-Awesome / Google Fonts / script CDNs → same as images, so the app looks right offline.
 *  • EVERYTHING ELSE (Supabase, Paystack, Formspree, EmailJS, IP lookup, any POST)
 *                            → goes straight to the network. Never cached, never intercepted.
 *
 * To force every device to drop its saved copies after a big change, bump VERSION.
 */
var VERSION = 'v1';
var CACHE = 'zn-' + VERSION;
var CDN_HOSTS = ['cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net'];
var IMAGE_RE = /\.(png|jpe?g|webp|gif|svg|ico|woff2?)$/i;
var NAV_TIMEOUT_MS = 5000;

var PRECACHE = [
  '/offline.html',
  '/manifest.webmanifest', '/admin.webmanifest',
  '/icons/icon-192.png', '/icons/admin-icon-192.png',
  '/favicon.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      // one missing file must never block installation
      return Promise.all(PRECACHE.map(function (u) { return c.add(u).catch(function () {}); }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k.indexOf('zn-') === 0 && k !== CACHE; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;                       // never touch form posts, payments, tracking
  if (req.headers.has('range')) return;                   // let the browser handle media seeking
  var url = new URL(req.url);

  if (url.origin === self.location.origin) {
    if (req.mode === 'navigate') { e.respondWith(navigate(e, req, url)); return; }
    if (IMAGE_RE.test(url.pathname)) { e.respondWith(swr(e, req)); return; }
    e.respondWith(networkFirst(req));
    return;
  }
  if (CDN_HOSTS.indexOf(url.hostname) > -1) { e.respondWith(swr(e, req)); return; }
  // any other origin (Supabase, Paystack, Formspree, ...): not handled → straight to the network
});

function putSafe(cache, req, res) {
  try { return cache.put(req, res).catch(function () {}); } catch (err) { return Promise.resolve(); }
}

// ---- pages: network first, saved copy if the network is down or very slow ----
async function navigate(e, req, url) {
  var cache = await caches.open(CACHE);
  // 'no-cache' = always ask the server whether the page changed (cheap 304 if not), so a fresh upload shows up at once
  var network = fetch(req, { cache: 'no-cache' }).then(function (res) {
    if (res.ok && !res.redirected && res.type === 'basic') putSafe(cache, req, res.clone());
    return res;
  });
  var SLOW = {};
  var timer = new Promise(function (r) { setTimeout(function () { r(SLOW); }, NAV_TIMEOUT_MS); });

  var first = null;
  try { first = await Promise.race([network, timer]); } catch (err) { first = null; }   // rejected = offline
  if (first && first !== SLOW) return first;

  var cached = await matchNav(cache, req, url);
  if (first === SLOW) {                                   // network is just slow
    if (cached) { e.waitUntil(network.catch(function () {})); return cached; }   // show saved copy, refresh quietly
    try { return await network; } catch (err) { /* fall through to offline page */ }
  }
  return cached || (await cache.match('/offline.html')) || Response.error();
}

// the installed app always opens "/index.html?utm_source=app" — match it even if only "/index.html" was saved
async function matchNav(cache, req, url) {
  var hit = await cache.match(req);
  if (hit) return hit;
  var p = url.pathname;
  if (p === '/' || p === '/index.html' || p === '/admin.html') return cache.match(req, { ignoreSearch: true });
  return undefined;
}

// ---- scripts, styles, manifests: always try for the newest version first ----
async function networkFirst(req) {
  try {
    var res = await fetch(req, { cache: 'no-cache' });
    if (res.ok && res.type === 'basic') { var c = await caches.open(CACHE); putSafe(c, req, res.clone()); }
    return res;
  } catch (err) {
    var hit = await caches.match(req);
    if (hit) return hit;
    throw err;
  }
}

// ---- images, fonts, CDN files: instant from saved copy, refreshed in the background ----
async function swr(e, req) {
  var cache = await caches.open(CACHE);
  var cached = await cache.match(req);
  var fetching = fetch(req).then(function (res) {
    if (res && (res.ok || res.type === 'opaque')) putSafe(cache, req, res.clone());
    return res;
  }).catch(function () { return null; });
  if (cached) { e.waitUntil(fetching); return cached; }
  return (await fetching) || Response.error();
}
