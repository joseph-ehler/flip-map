// Keys and screens: duplicate and held OK, fast presses, Back while something loads, switching routes,
// Settings during a trip, and a long run of random keys. Firefox 123 at 240x320, recorded answers.
// Each test states the behavior we want; a failure is a finding.
'use strict';

const { test, expect } = require('@playwright/test');
const { open, beside } = require('./lib/harness');

const STADIUM = 'ben hill griffin stadium';
const AIRPORT = 'gainesville regional airport';
const MUSEUM = { name: 'Florida Museum of Natural History', address: 'Gainesville', lat: 29.6362, lon: -82.3704 };


test.afterEach(async ({}, info) => {
  if (info.status !== info.expectedStatus) console.log('  ' + info.title + ': see results/artifacts');
});

test('OK arriving twice for one press (MicrophoneToggle, then Enter) starts the route once', async ({ page, context }) => {
  const app = await open(page, context);
  await app.preview(STADIUM);
  await app.key('MicrophoneToggle', { wait: 0 });
  await app.key('Enter');
  const s = await app.look();
  expect(s.state).toBe('nav');
  expect(s.spoken.filter(t => /^Starting route/.test(t)), 'route starts').toHaveLength(1);
  expect(s.spoken.filter(t => /^In /.test(t)), 'the second event also repeated the instruction').toEqual([]);
  expect(app.errors).toEqual([]);
});

test('holding OK on the preview starts the route once and repeats nothing', async ({ page, context }) => {
  const app = await open(page, context);
  await app.preview(STADIUM);
  await app.key('Enter', { repeat: 8 }); // a held key: one press, then key-repeat events
  await app.wait(400);
  const s = await app.look();
  expect(s.state).toBe('nav');
  const repeats = s.spoken.filter(t => /^In /.test(t));
  expect(repeats, repeats.length + ' prompts queued by one held key').toEqual([]);
  expect(app.errors).toEqual([]);
});

test('holding OK while driving repeats the instruction once, not once per key-repeat', async ({ page, context }) => {
  const app = await open(page, context);
  await app.go(STADIUM);
  await app.wait(300);
  const before = (await app.look()).spoken.length;
  await app.key('Enter', { repeat: 8 });
  const s = await app.look();
  expect(s.spoken.length - before, 'prompts from one held OK').toBe(1);
});

test('Back while a search is loading: the late answer changes nothing', async ({ page, context }) => {
  const app = await open(page, context);
  app.net.fault('search', { mode: 'delay', ms: 2500, times: 1 });
  await app.key('SoftLeft');
  await page.keyboard.type(STADIUM);
  await app.key('Enter');
  await app.key('SoftLeft'); // Cancel
  await app.wait(3500);
  const s = await app.look();
  expect(s.state).toBe('explore');
  expect(s.sheet).toBe('');
  expect(s.keys[0]).toBe('Search');
  expect(s.focus, 'focus went into the closed search sheet').not.toMatch(/in #search/);
  await app.preview(STADIUM); // and search still works
  expect((await app.look()).preview).toMatch(/Ben Hill Griffin Stadium \| \d+ min/);
  expect(app.errors).toEqual([]);
});

test('choosing a recent place while a search is loading: the late answer leaves the preview alone', async ({ page, context }) => {
  const app = await open(page, context, { storage: { 'flipmap.recent': JSON.stringify([MUSEUM]) } });
  app.net.fault('search', { mode: 'delay', ms: 2500, times: 1 });
  await app.key('SoftLeft');
  await page.keyboard.type(STADIUM);
  await app.key('Enter');
  await app.key('ArrowDown'); // the recent, still listed while the search loads
  await app.key('Enter');
  await app.untilState('preview');
  await app.wait(3500);
  const s = await app.look();
  expect(s.state).toBe('preview');
  expect(s.sheet).toBe('');
  expect(s.preview).toMatch(/^Florida Museum of Natural History/);
  expect(s.keys[0]).toBe('Back');
  expect(app.errors).toEqual([]);
});

test('typing in the search field while the last search loads: its answer doesn\'t take the keys', async ({ page, context }) => {
  const app = await open(page, context);
  app.net.fault('search', { mode: 'delay', ms: 1500, times: 1 });
  await app.key('SoftLeft');
  await page.keyboard.type('ben hill');
  await app.key('Enter');
  await app.wait(1000);
  await page.keyboard.type(' griff', { delay: 120 }); // still typing when the answer lands
  await app.wait(800);
  const s = await page.evaluate(() => ({ value: document.getElementById('q').value, focus: document.activeElement.id }));
  expect(s.value, 'letters typed after the answer arrived were lost').toBe('ben hill griff');
});

test('Back from the preview while its routes load: the late routes are ignored', async ({ page, context }) => {
  const app = await open(page, context);
  app.net.fault('route', { mode: 'delay', ms: 2500, times: 1 });
  await app.search(STADIUM);
  await app.key('Enter');
  await app.untilState('preview');
  await app.key('SoftLeft'); // Back, to the search results
  await app.wait(3500);
  let s = await app.look();
  expect(s.state).toBe('explore');
  expect(s.sheet).toBe('search');
  expect(s.routeDrawn, 'a route appeared on the map after Back').toBe(false);
  await app.key('SoftLeft'); // Cancel
  await app.wait(400);
  s = await app.look();
  expect(s.sheet).toBe('');
  expect(s.routeDrawn).toBe(false);
  expect(app.errors).toEqual([]);
});

test('switching routes before and after they load, then Go: the chosen route is the one driven', async ({ page, context }) => {
  const app = await open(page, context, { storage: { 'flipmap.recent': JSON.stringify([MUSEUM]) } }); // two routes there
  app.net.fault('route', { mode: 'delay', ms: 1500, times: 1 });
  await app.key('SoftLeft');
  await app.key('ArrowDown');
  await app.key('Enter');
  await app.untilState('preview');
  for (let i = 0; i < 3; i++) await app.key('ArrowRight', { wait: 20 }); // before the routes arrive: nothing to switch
  await app.until(() => /\d/.test(document.getElementById('p-time').textContent), 'routes');
  const served = app.net.served.route[app.net.served.route.length - 1].body.routes.slice().sort((a, b) => a.duration - b.duration);
  expect(served.length, 'this destination needs alternatives for the test').toBeGreaterThan(1);
  for (let i = 0; i < 5; i++) await app.key('ArrowRight', { wait: 0 });
  await app.wait(300);
  const want = 5 % served.length;
  const s = await app.look();
  expect(s.preview).toContain('‹ ' + (want + 1) + '/' + served.length + ' ›');
  await app.key('MicrophoneToggle');
  await app.untilState('nav');
  // Which of the served routes is the one being driven: the one its points lie on.
  const driven = await page.evaluate(() => FM.nav.route().coords.filter((c, i) => i % 10 === 0));
  const off = served.map(r => {
    const line = [].concat.apply([], r.legs[0].steps.map(st => st.geometry.coordinates));
    return driven.reduce((sum, c) => sum + Math.min.apply(null, line.map(p => Math.hypot((p[1] - c[0]) * 111320, (p[0] - c[1]) * 96800))), 0) / driven.length;
  });
  expect(off.indexOf(Math.min.apply(null, off)), 'driven route (average meters off each choice: ' + off.map(Math.round) + ')').toBe(want);
  expect(app.errors).toEqual([]);
});

test('Settings during a trip: voice off silences prompts, Done goes back to the trip, which carries on', async ({ page, context }) => {
  const app = await open(page, context, { speedup: 4 });
  const coords = await app.go(STADIUM);
  await app.driveAlong(coords.slice(0, 8));
  await app.key('SoftRight');
  expect((await app.look()).sheet).toBe('settings');
  await app.key('Enter'); // Voice Guidance off
  await app.key('SoftRight'); // Done
  await app.wait(1200);
  const mid = await app.look();
  expect(mid.state).toBe('nav');
  expect(mid.sheet).toBe('');
  expect(mid.following).toBe(true);
  expect(mid.keys).toEqual(['Overview', 'Repeat', 'More']);
  const said = mid.spoken.length;
  await app.driveAlong(coords.slice(8, 60));
  const s = await app.look();
  expect(s.nav.mode).toBe('on');
  expect(s.nav.remaining).toBeLessThan(mid.nav.remaining);
  expect(s.spoken.slice(said), 'spoken with voice off').toEqual([]);
  expect(app.errors).toEqual([]);
});

test('arriving while Settings is open: End Route, still listed, does nothing', async ({ page, context }) => {
  const app = await open(page, context, { speedup: 4 });
  const coords = await app.go(STADIUM);
  await app.key('SoftRight'); // Settings, while driving: End Route is the last row
  await app.driveAlong(coords.filter((c, i) => i % 3 === 0).concat([coords[coords.length - 1]]), { until: () => !FM.nav.active() });
  await app.wait(500);
  expect((await app.look()).nav.mode).toBe('off');
  for (let i = 0; i < 6; i++) await app.key('ArrowDown', { wait: 30 });
  expect(await page.evaluate(() => document.activeElement.textContent)).toBe('End Route');
  await app.key('Enter');
  const s = await app.look();
  expect(s.pill, 'a "Route Ended" message for a trip that had already ended').not.toBe('Route Ended');
});

test('ending a trip while its reroute loads, then starting another: the new trip isn\'t held up by the old request', async ({ page, context }) => {
  const app = await open(page, context, { speedup: 4 });
  const coords = await app.go(STADIUM);
  await app.driveAlong(coords.slice(0, 18)); // past the 15 s before a reroute is allowed
  app.net.fault('route', { mode: 'hang', times: 1 });
  for (let i = 0; i < 5; i++) {
    await app.fix(beside(coords, 18, 150 + i * 10));
    await app.wait(1000);
  }
  expect((await app.look()).nav.rerouting, 'a reroute should be loading').toBe(true);
  await app.key('SoftRight');
  for (let i = 0; i < 6; i++) await app.key('ArrowDown', { wait: 30 });
  await app.key('Enter'); // End Route
  await app.wait(500);
  expect((await app.look()).nav.mode).toBe('off');

  const coordsB = await app.go(AIRPORT);
  const pills = [];
  for (let i = 0; i < 16; i++) {
    await app.fix({ lat: coordsB[i][0], lon: coordsB[i][1], speed: 10 });
    await app.wait(1000);
    const s = await app.look();
    pills.push(s.pill);
    expect(s.nav.rerouting, 'the new trip shows "Rerouting" (second ' + i + ')').toBe(false);
  }
  expect(pills.filter(p => /answering|unavailable|connection/i.test(p)), 'the old request\'s error shown on the new trip').toEqual([]);
});

// A long run of random keys from the phone's keypad, from a trip in progress. After every few keys:
// one known screen, its sheet (if any) showing, and soft keys that belong to it. No script errors.
test('300 random key presses leave the app on one consistent screen', async ({ page, context }) => {
  test.skip(process.env.RECORD === '1', 'random searches aren\'t worth recording');
  test.setTimeout(240000);
  const app = await open(page, context, { speedup: 2 });
  const coords = await app.go(STADIUM);
  let seed = 12345;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const KEYS = ['SoftLeft', 'SoftRight', 'MicrophoneToggle', 'Enter', 'Backspace', 'Escape', 'ArrowUp', 'ArrowDown',
    'ArrowLeft', 'ArrowRight', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
  const SOFT = {
    explore: k => k[0] === 'Search' && k[2] === 'More',
    preview: k => k[0] === 'Back' && k[2] === '',
    nav: k => (k[0] === 'Overview' || k[0] === '') && k[2] === 'More',
    overview: k => k[0] === 'Resume' && k[2] === 'More',
    arrived: k => k[0] === '' && k[1] === 'Done',
    search: k => k[0] === 'Cancel',
    settings: k => k[1] === 'Select' && k[2] === 'Done',
    report: k => k[2] === 'Done'
  };
  const problems = [];
  let left = 0;
  let step = 0;
  for (let i = 0; i < 300; i++) {
    const k = KEYS[Math.floor(rand() * KEYS.length)];
    await app.key(k, { wait: 20 + Math.floor(rand() * 60) });
    if (i % 4 === 0) {
      step = Math.min(step + 1, coords.length - 1);
      await app.fix({ lat: coords[step][0], lon: coords[step][1], speed: 10 });
    }
    if (!page.url().includes('index.html')) { // Settings > Phone Check leaves the app
      left++;
      await page.goBack();
      await page.waitForFunction(() => window.FM && FM.nav && window.__gps);
      continue;
    }
    if (i % 5 === 4) {
      await app.wait(450); // sheets take 200 ms to leave
      const s = await app.look();
      const shown = await page.evaluate(() => Array.from(document.querySelectorAll('.sheet')).filter(el => getComputedStyle(el).display !== 'none').map(el => el.id));
      const where = 'after key ' + (i + 1) + ' (' + k + '): ';
      if (!SOFT[s.state]) problems.push(where + 'unknown state ' + s.state);
      if (s.sheet ? shown.join() !== s.sheet : shown.length) problems.push(where + 'sheet ' + s.sheet + ' but showing [' + shown + ']');
      const keysOk = SOFT[s.sheet || s.state];
      if (keysOk && !keysOk(s.keys)) problems.push(where + (s.sheet || s.state) + ' with soft keys ' + JSON.stringify(s.keys));
    }
  }
  console.log('  key run: left the app ' + left + ' times via Phone Check; ' + app.net.count('search') + ' searches; ' + app.net.count('route') + ' route requests');
  expect(problems).toEqual([]);
  expect(app.errors).toEqual([]);
});
