// A deterministic world for replaying drives through Flip Map's navigation engine (app/js/nav.js).
// Fake clock and timers, a scriptable mock routing server (answer, delay, hang, fail), seeded GPS
// noise, and recorders for speech and arrival. Nothing here touches the network.
'use strict';

const fs = require('fs');
const path = require('path');

// FLIPMAP_APP=<folder> tests another copy of the app (e.g. main's), for comparison.
const APP = path.join(process.env.FLIPMAP_APP ? path.resolve(process.env.FLIPMAP_APP) : path.join(__dirname, '..', '..', 'app'), 'js');
const LAT0 = 29.65; // Gainesville
const LON0 = -82.33;
const M_PER_DEG_LAT = 110574;
const M_PER_DEG_LON = 111320 * Math.cos(LAT0 * Math.PI / 180);

// --- Local metric frame: [x east, y north] in meters <-> [lat, lon] ---

function toLL(p) {
  return [LAT0 + p[1] / M_PER_DEG_LAT, LON0 + p[0] / M_PER_DEG_LON];
}

function toXY(lat, lon) {
  return [(lon - LON0) * M_PER_DEG_LON, (lat - LAT0) * M_PER_DEG_LAT];
}

function dist(a, b) {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

function bearing(a, b) {
  return (Math.atan2(b[0] - a[0], b[1] - a[1]) * 180 / Math.PI + 360) % 360;
}

function densify(a, b, step) {
  const n = Math.max(1, Math.ceil(dist(a, b) / step));
  const out = [];
  for (let i = 0; i <= n; i++) out.push([a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n]);
  return out;
}

function modifier(prev, at, next) {
  let d = bearing(at, next) - bearing(prev, at);
  d = ((d + 540) % 360) - 180;
  const side = d > 0 ? 'right' : 'left';
  const a = Math.abs(d);
  if (a < 20) return 'straight';
  if (a < 60) return 'slight ' + side;
  if (a < 135) return side;
  if (a < 170) return 'sharp ' + side;
  return 'uturn';
}

// An OSRM-shaped route along points (meters), turning at each interior point. Geometry is densified
// to a vertex every 10 m, like real OSRM output. lanes: { stepIndex: [[indications, valid], ...] }.
function osrmRoute(points, opts) {
  opts = opts || {};
  const speed = opts.speed || 13.4;
  const steps = [];
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const geom = densify(a, b, 10).map(p => { const ll = toLL(p); return [ll[1], ll[0]]; });
    total += dist(a, b);
    const lanes = opts.lanes && opts.lanes[i];
    steps.push({
      name: (opts.names && opts.names[i]) || 'Street ' + (i + 1),
      distance: dist(a, b),
      geometry: { coordinates: geom },
      maneuver: {
        type: i === 0 ? 'depart' : 'turn',
        modifier: i === 0 ? 'straight' : modifier(points[i - 1], a, b),
        bearing_after: Math.round(bearing(a, b)),
        location: geom[0]
      },
      intersections: [lanes ? { lanes: lanes.map(l => ({ indications: l[0].split(';'), valid: l[1] })) } : {}]
    });
  }
  const end = toLL(points[points.length - 1]);
  steps.push({
    name: 'Destination',
    distance: 0,
    geometry: { coordinates: [[end[1], end[0]], [end[1], end[0]]] },
    maneuver: { type: 'arrive', location: [end[1], end[0]] },
    intersections: [{}]
  });
  return { code: 'Ok', routes: [{ duration: total / speed, distance: total, legs: [{ steps }] }] };
}

// --- GPS fixes: drive a polyline at a steady speed, one fix per `every` seconds ---

function rng(seed) {
  let s = seed >>> 0 || 1;
  return function () {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

function drive(points, opts) {
  opts = opts || {};
  const speed = opts.speed || 13.4;
  const every = opts.every || 1;
  const noise = opts.noise || 0;
  const accuracy = opts.accuracy || 8;
  const rand = rng(opts.seed || 7);
  const fixes = [];
  const legs = [];
  let length = 0;
  for (let i = 0; i < points.length - 1; i++) {
    legs.push({ a: points[i], b: points[i + 1], at: length, len: dist(points[i], points[i + 1]) });
    length += dist(points[i], points[i + 1]);
  }
  for (let s = 0; s <= length + 1e-6; s += speed * every) {
    const leg = legs.find(l => s <= l.at + l.len + 1e-6) || legs[legs.length - 1];
    const f = leg.len ? (s - leg.at) / leg.len : 0;
    const p = [leg.a[0] + (leg.b[0] - leg.a[0]) * f, leg.a[1] + (leg.b[1] - leg.a[1]) * f];
    const n = noise ? [(rand() * 2 - 1) * noise, (rand() * 2 - 1) * noise] : [0, 0];
    fixes.push(fix([p[0] + n[0], p[1] + n[1]], { accuracy: accuracy, speed: speed, heading: bearing(leg.a, leg.b) }));
  }
  return fixes;
}

function fix(p, o) {
  o = o || {};
  const ll = toLL(p);
  return {
    lat: ll[0], lon: ll[1],
    accuracy: o.accuracy === undefined ? 8 : o.accuracy,
    speed: o.speed === undefined ? 13.4 : o.speed,
    heading: o.heading === undefined ? 0 : o.heading,
    xy: p
  };
}

// --- Fake clock and timers ---

async function flush() {
  for (let i = 0; i < 6; i++) await new Promise(r => setImmediate(r));
}

function makeClock(start) {
  let now = start;
  let seq = 0;
  const timers = [];
  return {
    now: () => now,
    setTimeout(fn, ms) {
      const id = ++seq;
      timers.push({ id: id, at: now + (ms || 0), fn: fn });
      return id;
    },
    clearTimeout(id) {
      const i = timers.findIndex(t => t.id === id);
      if (i >= 0) timers.splice(i, 1);
    },
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at);
        const t = timers[0];
        if (!t || t.at > end) break;
        timers.shift();
        now = t.at;
        t.fn();
        await flush();
      }
      now = end;
      await flush();
    }
  };
}

// --- The world: load nav.js fresh with stubbed browser globals ---

// script({ from: [x, y], to: [x, y], n }) -> { body, status, delay } | 'hang' | 'offline'.
// Default: answer in 300 ms with a straight route from `from` to `to`.
// opts.storage: localStorage contents the app finds when it loads (e.g. a saved trip).
function load(script, opts) {
  const clock = makeClock(1700000000000);
  const saved = {
    now: Date.now, setTimeout: global.setTimeout, clearTimeout: global.clearTimeout,
    fetch: global.fetch, window: global.window, navigator: global.navigator, localStorage: global.localStorage
  };
  const store = new Map(Object.entries((opts && opts.storage) || {}));
  const w = {
    clock: clock,
    calls: [],
    spoken: [],
    arrived: [],
    vibrations: 0,
    reroutes: 0,
    close() {
      Date.now = saved.now;
      global.setTimeout = saved.setTimeout;
      global.clearTimeout = saved.clearTimeout;
      global.fetch = saved.fetch;
      global.window = saved.window;
      global.localStorage = saved.localStorage;
      Object.defineProperty(global, 'navigator', { value: saved.navigator, configurable: true, writable: true });
    }
  };

  Date.now = clock.now;
  global.setTimeout = clock.setTimeout;
  global.clearTimeout = clock.clearTimeout;
  global.window = {
    speechSynthesis: { speak(u) { w.spoken.push({ at: clock.now(), text: u.text }); if (u.onend) u.onend(); } },
    SpeechSynthesisUtterance: function (text) { this.text = text; }
  };
  global.localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k)
  };
  Object.defineProperty(global, 'navigator', {
    value: { onLine: true, vibrate() { w.vibrations++; return true; } },
    configurable: true, writable: true
  });

  global.fetch = function (url, init) {
    const m = url.match(/driving\/(-?[\d.]+),(-?[\d.]+);(-?[\d.]+),(-?[\d.]+)/);
    const from = toXY(+m[2], +m[1]);
    const to = toXY(+m[4], +m[3]);
    w.calls.push({ at: clock.now(), from: from, to: to, url: url });
    const plan = (script || (() => ({})))({ from: from, to: to, n: w.calls.length, url: url }) || {};
    return new Promise((resolve, reject) => {
      const signal = init && init.signal;
      if (signal) {
        signal.addEventListener('abort', () => {
          const e = new Error('The operation was aborted');
          e.name = 'AbortError';
          reject(e);
        });
      }
      if (plan === 'hang') return;
      if (plan === 'offline') {
        clock.setTimeout(() => reject(new TypeError('NetworkError when attempting to fetch resource.')), 50);
        return;
      }
      const body = plan.body || osrmRoute([from, to]);
      const status = plan.status || 200;
      clock.setTimeout(() => resolve({
        ok: status < 400,
        status: status,
        json: () => Promise.resolve(body)
      }), plan.delay === undefined ? 300 : plan.delay);
    });
  };

  // net.js only exists once requests have time limits; load it when present so the same tests run
  // against older code too.
  const modules = ['geo', 'net', 'lanes', 'nav'].map(n => path.join(APP, n + '.js')).filter(f => fs.existsSync(f));
  modules.forEach(f => { delete require.cache[require.resolve(f)]; });
  global.window.FM = {};
  modules.forEach(f => require(f));
  const FM = global.window.FM;
  FM.report = { spoke() {}, reroute() { w.reroutes++; } };
  FM.nav.onarrive = dest => w.arrived.push({ at: clock.now(), dest: dest });
  w.FM = FM;
  w.nav = FM.nav;
  return w;
}

// Plan and start a trip from the first fix to `points`' last point, through the mock router.
async function startTrip(w, routePoints, firstFix) {
  w.nav.update(firstFix || fix(routePoints[0]));
  const end = toLL(routePoints[routePoints.length - 1]);
  const planned = w.nav.plan({ name: 'Destination', lat: end[0], lon: end[1] });
  await w.clock.advance(1000);
  const plans = await planned;
  w.nav.start(plans[0]);
  await flush();
  return plans[0];
}

// Feed fixes one per `dt` ms; `each(state, fix, i)` sees the navigation state after each one.
async function feed(w, fixes, each, dt) {
  for (let i = 0; i < fixes.length; i++) {
    await w.clock.advance(dt || 1000);
    w.nav.update(fixes[i]);
    await flush();
    if (each) each(w.nav.state(), fixes[i], i);
  }
}

module.exports = { load, startTrip, feed, drive, fix, osrmRoute, toLL, toXY, dist, flush, makeClock };
