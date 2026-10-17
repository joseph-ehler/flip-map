// Every request the app makes to the outside world, answered from recorded responses so tests behave
// the same on any day. RECORD=1 fetches live answers instead and saves them. Faults can be switched on
// per service: answer late, never answer, fail, or act offline.
//
// Recorded: routing (OSRM), search (Nominatim), and the vector map (OpenFreeMap's TileJSON and tiles).
// A routing request from a position nobody recorded (a reroute) gets the recorded route to the same
// destination, joined from where you are: what OSRM would answer, give or take the first street.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = path.join(__dirname, '..', 'fixtures');
const RECORD = process.env.RECORD === '1';
const CORS = { 'access-control-allow-origin': '*' };

function kindOf(url) {
  if (url.startsWith('https://router.project-osrm.org/')) return 'route';
  if (url.startsWith('https://nominatim.openstreetmap.org/')) return 'search';
  if (/^https:\/\/tiles\.openfreemap\.org\/planet\/?$/.test(url)) return 'tilejson';
  if (/^https:\/\/tiles\.openfreemap\.org\/.+\.pbf$/.test(url)) return 'tile';
  if (url.startsWith('https://tile.openstreetmap.org/')) return 'raster';
  return 'other';
}

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'x';
}

function hash(s) {
  return crypto.createHash('sha1').update(s).digest('hex').slice(0, 10);
}

function meters(a, b) {
  const k = Math.PI / 180;
  const x = (b[1] - a[1]) * k * Math.cos((a[0] + b[0]) / 2 * k);
  const y = (b[0] - a[0]) * k;
  return Math.hypot(x, y) * 6371000;
}

function bearing(a, b) {
  const k = Math.PI / 180;
  const y = Math.sin((b[1] - a[1]) * k) * Math.cos(b[0] * k);
  const x = Math.cos(a[0] * k) * Math.sin(b[0] * k) - Math.sin(a[0] * k) * Math.cos(b[0] * k) * Math.cos((b[1] - a[1]) * k);
  return (Math.atan2(y, x) / k + 360) % 360;
}

// "…/driving/lon1,lat1;lon2,lat2?…alternatives=true" -> { from: [lat, lon], to: [lat, lon], alternatives }
function parseRoute(url) {
  const m = url.match(/driving\/(-?[\d.]+),(-?[\d.]+);(-?[\d.]+),(-?[\d.]+)/);
  return { from: [+m[2], +m[1]], to: [+m[4], +m[3]], alternatives: /alternatives=true/.test(url) };
}

function searchQuery(url) {
  return (new URL(url).searchParams.get('q') || '').trim().toLowerCase();
}

function readJSON(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJSON(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 1));
}

// The recorded route to `to`, re-joined at the point nearest `from`: a short first leg from where you
// are onto it, then the rest of its steps as recorded.
function joinRoute(body, from) {
  const route = body.routes[0];
  const steps = route.legs[0].steps;
  let best = { d: Infinity, s: 0, c: 0 };
  steps.forEach((st, s) => st.geometry.coordinates.forEach((c, i) => {
    const d = meters(from, [c[1], c[0]]);
    if (d < best.d) best = { d, s, c: i };
  }));
  const st = steps[best.s];
  const coords = st.geometry.coordinates;
  const at = coords[best.c];
  const rest = coords.slice(best.c);
  const restOfStep = Object.assign({}, st, {
    geometry: { coordinates: rest.length > 1 ? rest : [at, at] },
    distance: st.distance * (rest.length - 1) / Math.max(1, coords.length - 1),
    maneuver: Object.assign({}, st.maneuver, best.s === 0 || best.c > 0
      ? { type: 'turn', modifier: 'right', location: at }
      : {})
  });
  const lead = {
    name: 'Joining the route',
    distance: best.d,
    duration: best.d / 8,
    geometry: { coordinates: [[from[1], from[0]], at] },
    maneuver: { type: 'depart', modifier: 'straight', location: [from[1], from[0]], bearing_after: Math.round(bearing(from, [at[1], at[0]])) },
    intersections: [{}]
  };
  const kept = [lead, restOfStep].concat(steps.slice(best.s + 1));
  const distance = kept.reduce((sum, x) => sum + (x.distance || 0), 0);
  return {
    code: 'Ok',
    routes: [{ duration: route.duration * distance / route.distance, distance, legs: [{ steps: kept }] }],
    joined: true
  };
}

class Network {
  constructor() {
    this.faults = {}; // kind -> { mode, ms, status, times }
    this.log = []; // { kind, url, how }
    this.missing = [];
    this.hung = [];
    this.served = { route: [] }; // the routing answers given, latest last
    this.routes = this.loadRoutes();
  }

  loadRoutes() {
    const dir = path.join(DIR, 'routes');
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => readJSON(path.join(dir, f)));
  }

  // fault(kind, { mode: 'hang' | 'fail' | 'offline' | 'delay', ms, status, times }), or fault(kind) to clear.
  fault(kind, f) {
    if (f) this.faults[kind] = Object.assign({}, f);
    else delete this.faults[kind];
  }

  count(kind) {
    return this.log.filter(e => e.kind === kind).length;
  }

  takeFault(kind) {
    const f = this.faults[kind] || this.faults.all;
    if (!f) return null;
    if (f.times !== undefined && --f.times <= 0) {
      if (this.faults[kind] === f) delete this.faults[kind];
      else delete this.faults.all;
    }
    return f;
  }

  async attach(context) {
    await context.route(url => !/^http:\/\/localhost[:/]/.test(url.href), route => this.handle(route));
  }

  async handle(route) {
    const url = route.request().url();
    const kind = kindOf(url);
    const f = kind === 'other' ? null : this.takeFault(kind);
    if (f) {
      this.log.push({ kind, url, how: f.mode });
      if (f.mode === 'hang') {
        this.hung.push(route);
        return;
      }
      if (f.mode === 'offline') return route.abort('internetdisconnected').catch(() => {});
      if (f.mode === 'fail') return route.fulfill({ status: f.status || 503, headers: CORS, body: 'unavailable' }).catch(() => {});
      if (f.mode === 'delay') await new Promise(r => setTimeout(r, f.ms));
    } else {
      this.log.push({ kind, url, how: RECORD ? 'live' : 'replay' });
    }
    try {
      if (kind === 'other' || kind === 'raster') {
        this.missing.push(url);
        return await route.abort('blockedbyclient');
      }
      if (RECORD) return await this.record(route, kind, url);
      return await this.replay(route, kind, url);
    } catch (e) {
      // The page went away while this was being answered.
    }
  }

  async record(route, kind, url) {
    const res = await route.fetch();
    const body = await res.body();
    if (res.ok()) {
      if (kind === 'tilejson') {
        fs.mkdirSync(path.join(DIR, 'tiles'), { recursive: true });
        fs.writeFileSync(path.join(DIR, 'tiles', 'tilejson.json'), body);
      }
      if (kind === 'tile') {
        const m = url.match(/\/(\d+)\/(\d+)\/(\d+)\.pbf$/);
        const file = path.join(DIR, 'tiles', m[1], m[2], m[3] + '.pbf');
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, body);
      }
      if (kind === 'search') {
        writeJSON(path.join(DIR, 'search', slug(searchQuery(url)) + '.json'), { q: searchQuery(url), url, body: JSON.parse(body) });
      }
      if (kind === 'route') {
        const r = Object.assign(parseRoute(url), { url, body: JSON.parse(body) });
        writeJSON(path.join(DIR, 'routes', slug(r.to.join(' ')) + '-' + hash(url) + '.json'), r);
        this.routes.push(r);
        this.served.route.push(r);
      }
    }
    const headers = Object.assign({}, res.headers(), CORS);
    ['content-length', 'content-encoding', 'transfer-encoding'].forEach(h => delete headers[h]);
    await route.fulfill({ status: res.status(), headers, body });
  }

  async replay(route, kind, url) {
    if (kind === 'tilejson') {
      return route.fulfill({ status: 200, headers: Object.assign({ 'content-type': 'application/json' }, CORS), body: fs.readFileSync(path.join(DIR, 'tiles', 'tilejson.json')) });
    }
    if (kind === 'tile') {
      const m = url.match(/\/(\d+)\/(\d+)\/(\d+)\.pbf$/);
      const file = path.join(DIR, 'tiles', m[1], m[2], m[3] + '.pbf');
      let body = Buffer.alloc(0);
      if (fs.existsSync(file)) body = fs.readFileSync(file);
      else this.missing.push(url);
      return route.fulfill({ status: 200, headers: Object.assign({ 'content-type': 'application/x-protobuf' }, CORS), body });
    }
    if (kind === 'search') {
      const file = path.join(DIR, 'search', slug(searchQuery(url)) + '.json');
      let body = [];
      if (fs.existsSync(file)) body = readJSON(file).body;
      else this.missing.push(url);
      return route.fulfill({ status: 200, headers: Object.assign({ 'content-type': 'application/json' }, CORS), body: JSON.stringify(body) });
    }
    // Routing: the exact request if recorded; else the recorded route to the same place, from the
    // recorded start nearest you (within 300 m) or joined from where you are.
    const want = parseRoute(url);
    let hit = this.routes.find(r => r.url === url);
    let body = hit && hit.body;
    if (!hit) {
      const same = this.routes.filter(r => meters(r.to, want.to) < 30 && r.body.code === 'Ok')
        .sort((a, b) => meters(a.from, want.from) - meters(b.from, want.from));
      if (same.length && meters(same[0].from, want.from) < 300 && same[0].alternatives === want.alternatives) {
        hit = same[0];
        body = hit.body;
      } else if (same.length) {
        hit = same[0];
        body = joinRoute(hit.body, want.from);
      } else {
        this.missing.push(url);
        body = { code: 'NoRoute', message: 'not recorded' };
      }
    }
    this.served.route.push({ url, from: want.from, to: want.to, body });
    return route.fulfill({ status: 200, headers: Object.assign({ 'content-type': 'application/json' }, CORS), body: JSON.stringify(body) });
  }
}

module.exports = { Network, RECORD, meters, bearing, joinRoute };
