// Opening Flip Map with the stand-ins installed, pressing keys the way the Flip 4 sends them, and
// reading back what the app is doing. Used by the audit specs (keys, lifecycle, long drive).
'use strict';

const fs = require('fs');
const path = require('path');
const { Network } = require('./network');

const INIT = fs.readFileSync(path.join(__dirname, 'page-init.js'), 'utf8');
const TILEJSON = path.join(__dirname, '..', 'fixtures', 'tiles', 'tilejson.json');
const HOME = { lat: 29.6516, lon: -82.3248, accuracy: 8 }; // downtown Gainesville

// The phone's keys that Playwright can't press as real keys; they're dispatched as events instead.
const SYNTHETIC = ['SoftLeft', 'SoftRight', 'MicrophoneToggle'];

class App {
  constructor(page, context, net, errors, speedup) {
    this.page = page;
    this.context = context;
    this.net = net;
    this.errors = errors;
    this.speedup = speedup;
  }

  // One GPS fix: { lat, lon, accuracy, heading, speed }. Returns the ms the app spent on it.
  fix(f) {
    return this.page.evaluate(f => window.__gps.push(f), Object.assign({ accuracy: 8 }, f));
  }

  // Wait in page time: `ms` of the app's clock (shorter in real time when sped up).
  wait(ms) {
    return this.page.waitForTimeout(ms / this.speedup);
  }

  // A key press. opts.repeat: n extra key-repeat events, as when the key is held.
  async key(k, opts) {
    opts = opts || {};
    if (SYNTHETIC.indexOf(k) >= 0) {
      await this.page.evaluate(a => {
        const target = document.activeElement || document.body;
        for (let i = 0; i <= a.repeat; i++) {
          target.dispatchEvent(new KeyboardEvent('keydown', { key: a.k, repeat: i > 0, bubbles: true, cancelable: true }));
        }
        target.dispatchEvent(new KeyboardEvent('keyup', { key: a.k, bubbles: true, cancelable: true }));
      }, { k, repeat: opts.repeat || 0 });
    } else if (opts.repeat) {
      for (let i = 0; i <= opts.repeat; i++) await this.page.keyboard.down(k);
      await this.page.keyboard.up(k);
    } else {
      await this.page.keyboard.press(k);
    }
    if (opts.wait !== 0) await this.page.waitForTimeout(opts.wait || 150);
  }

  // What the app shows and is doing, in one read.
  look() {
    return this.page.evaluate(() => {
      const $ = id => document.getElementById(id);
      const s = FM.nav.state();
      const a = document.activeElement;
      return {
        state: document.body.getAttribute('data-state'),
        sheet: document.body.getAttribute('data-sheet') || '',
        keys: [$('sk-left').textContent, $('sk-center').textContent, $('sk-right').textContent],
        pill: $('pill').hidden ? '' : $('pill-text').textContent,
        banner: $('banner').offsetHeight ? $('b-dist').textContent + ' | ' + $('b-road').textContent : '',
        preview: $('preview').offsetHeight ? $('p-name').textContent + ' | ' + $('p-time').textContent + ' | ' + $('p-alts').textContent : '',
        nav: { mode: s.mode, dest: s.dest ? s.dest.name : '', remaining: s.remaining, rerouting: !!s.rerouting, error: s.error || '' },
        focus: a ? (a.id ? '#' + a.id : a.tagName.toLowerCase()) + (a.closest && a.closest('.sheet') ? ' in #' + a.closest('.sheet').id : '') : '',
        following: FM.map.following(),
        routeDrawn: ($('route-line').getAttribute('d') || '').length > 0,
        saved: localStorage.getItem('flipmap.dest'),
        spoken: window.__probe.spoken.map(x => x.text)
      };
    });
  }

  until(fn, what, timeout) {
    return this.page.waitForFunction(fn, null, { timeout: timeout || 15000, polling: 100 }).catch(() => {
      throw new Error('timed out waiting for ' + what);
    });
  }

  untilState(state, timeout) {
    return this.until(new Function('return document.body.getAttribute("data-state") === ' + JSON.stringify(state)), 'state ' + state, timeout);
  }

  // Search from the map and wait for the results (or the empty message).
  async search(q) {
    await this.key('SoftLeft');
    await this.page.keyboard.type(q);
    await this.key('Enter');
    await this.until(() => {
      const head = document.getElementById('s-head');
      const empty = document.getElementById('s-empty');
      const a = document.activeElement;
      return (!head.hidden && head.textContent === 'Results' && a && a.parentNode === document.getElementById('results')) ||
        (!empty.hidden && /No Results|Unavailable|Offline/.test(empty.textContent));
    }, 'search results');
  }

  // Search, pick the first result, and wait for the routes to load in the preview.
  async preview(q) {
    await this.search(q);
    await this.key('Enter');
    await this.untilState('preview');
    await this.until(() => /\d/.test(document.getElementById('p-time').textContent) || document.getElementById('p-time').textContent === 'No Route', 'routes');
  }

  // Preview and Go: the route is under way.
  async go(q) {
    await this.preview(q);
    await this.key('MicrophoneToggle');
    await this.untilState('nav');
    return this.page.evaluate(() => FM.nav.route().coords);
  }

  // Drive along [lat, lon] points, one fix per `everyMs` of page time.
  async driveAlong(coords, opts) {
    opts = opts || {};
    const every = opts.everyMs || 1000;
    for (let i = 0; i < coords.length; i++) {
      const c = coords[i];
      const n = coords[Math.min(i + 1, coords.length - 1)];
      const p = coords[Math.max(i - 1, 0)];
      const heading = (Math.atan2((n[1] - p[1]) * Math.cos(c[0] * Math.PI / 180), n[0] - p[0]) * 180 / Math.PI + 360) % 360;
      await this.fix({ lat: c[0], lon: c[1], speed: opts.speed || 12, heading });
      await this.wait(every);
      if (opts.until && await this.page.evaluate(opts.until)) return i;
    }
    return coords.length - 1;
  }

  async report() {
    return this.page.evaluate(() => JSON.parse(localStorage.getItem('flipmap.report')));
  }

  // Stop the GPS from moving the test on: no more fixes until fix() is called again.
  async reload() {
    await this.page.reload();
    await this.page.waitForFunction(() => window.FM && FM.nav && window.__gps);
  }
}

// Each browser logs an outside request that fails (offline, blocked) as an error: Chromium as "Failed to
// load resource", Firefox as a cross-origin request that "did not succeed". That's the browser reporting
// what the test did to the network, not a script error. Other cross-origin errors still count.
function networkNoise(m) {
  const t = m.text();
  const outside = !/^http:\/\/localhost[:/]/.test((m.location() || {}).url || '');
  return (/^Failed to load resource/.test(t) && outside) || /Reason: CORS request did not succeed/.test(t);
}

// Opens Flip Map at 240x320 with recorded network answers, fake GPS, speech and vibration.
// opts: { speedup, prefs, storage: { key: value }, faults: { kind: fault }, url,
//         at: first fix ({lat, lon}) or null for none }
async function open(page, context, opts) {
  opts = opts || {};
  const speedup = opts.speedup || 1;
  const net = new Network();
  Object.keys(opts.faults || {}).forEach(k => net.fault(k, opts.faults[k])); // from the first request
  await net.attach(context);
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => {
    if (m.type() === 'error' && !networkNoise(m)) errors.push('console: ' + m.text());
  });
  await page.addInitScript(INIT.replace('__CONFIG__', JSON.stringify({ speedup })));

  // A returning user: preferences set, the map last left on Gainesville, its data address known.
  // Seeded once per test, so reloads see what the app saved.
  const seed = {
    'flipmap.prefs': JSON.stringify(Object.assign({ appearance: 'light', rotate: true }, opts.prefs || {})),
    'flipmap.view': JSON.stringify({ lat: HOME.lat, lon: HOME.lon, zoom: 16 }) // where the map was left
  };
  if (fs.existsSync(TILEJSON)) seed['flipmap.vector'] = JSON.parse(fs.readFileSync(TILEJSON, 'utf8')).tiles[0];
  Object.assign(seed, opts.storage || {});
  await page.addInitScript(s => {
    try {
      if (!sessionStorage.getItem('fm.seeded')) {
        sessionStorage.setItem('fm.seeded', '1');
        localStorage.clear();
        Object.keys(s).forEach(k => localStorage.setItem(k, s[k]));
      }
    } catch (e) {}
  }, seed);

  await page.goto(opts.url || '/index.html');
  await page.waitForFunction(() => window.FM && FM.nav && window.__gps);
  const app = new App(page, context, net, errors, speedup);
  if (opts.at !== null) await app.fix(opts.at || HOME);
  return app;
}

// A fix `m` meters to the right of route point i, square to the road there: off the route, not along it.
function beside(coords, i, m) {
  const a = coords[Math.max(0, i - 2)];
  const b = coords[Math.min(coords.length - 1, i + 2)];
  const k = Math.cos(coords[i][0] * Math.PI / 180);
  const e = (b[1] - a[1]) * k;
  const n = b[0] - a[0];
  const len = Math.hypot(e, n) || 1;
  return { lat: coords[i][0] - (e / len) * m / 111320, lon: coords[i][1] + (n / len) * m / (111320 * k), speed: 10 };
}

module.exports = { open, beside, HOME, App };
