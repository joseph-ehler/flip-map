'use strict';

// Lets the app open with no data connection and keeps the map tiles you've already seen.
var SHELL = 'flipmap-shell-v2';
var TILES = 'flipmap-tiles-v1';
var MAX_TILES = 2000; // roughly 30-40 MB
var TRIM_EVERY = 50;
var NETWORK_TIMEOUT_MS = 4000;
var SHELL_FILES = [
  './',
  'index.html',
  'style.css',
  'manifest.webmanifest',
  'js/geo.js',
  'js/icons.js',
  'js/map.js',
  'js/nav.js',
  'js/search.js',
  'js/sim.js',
  'js/app.js',
  'fonts/inter-latin.woff2',
  'icons/map_56.png',
  'icons/map_112.png'
];

var puts = 0;

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(SHELL)
    .then(function (cache) { return cache.addAll(SHELL_FILES); })
    .then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys()
    .then(function (keys) {
      return Promise.all(keys
        .filter(function (k) { return k !== SHELL && k !== TILES; })
        .map(function (k) { return caches.delete(k); }));
    })
    .then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.hostname === 'tile.openstreetmap.org') e.respondWith(tile(req.url));
  else if (url.origin === self.location.origin) e.respondWith(shell(req));
  // Search and routing go straight to the network.
});

// Saved tile first; otherwise download it with CORS (so the cache holds the real bytes) and keep it.
function tile(url) {
  return caches.open(TILES).then(function (cache) {
    return cache.match(url).then(function (hit) {
      return hit || fetch(url, { mode: 'cors' }).then(function (res) {
        if (res.ok) {
          cache.put(url, res.clone()).then(function () {
            if (++puts % TRIM_EVERY === 0) trim(cache);
          });
        }
        return res;
      });
    });
  });
}

// Forget the oldest tiles once there are too many (the cache lists them oldest first).
function trim(cache) {
  cache.keys().then(function (keys) {
    keys.slice(0, Math.max(0, keys.length - MAX_TILES)).forEach(function (k) { cache.delete(k); });
  });
}

// App files: use the network so updates arrive, but fall back to the saved copy when offline or slow.
function shell(req) {
  return caches.open(SHELL).then(function (cache) {
    var saved = cache.match(req, { ignoreSearch: true });
    var network = fetch(req).then(function (res) {
      if (res.ok) cache.put(req, res.clone());
      return res;
    });
    return new Promise(function (resolve, reject) {
      network.then(resolve, function () {
        saved.then(function (hit) {
          if (hit) resolve(hit);
          else reject(new Error('Offline and not saved'));
        });
      });
      setTimeout(function () {
        saved.then(function (hit) { if (hit) resolve(hit); });
      }, NETWORK_TIMEOUT_MS);
    });
  });
}
