// Lifecycle: reloading mid-trip and after it ends, requests cut off or never answered, losing and
// regaining the connection, leaving the app and coming back. Firefox 123 at 240x320, recorded answers.
// Each test states the behavior we want; a failure is a finding.
'use strict';

const { test, expect } = require('@playwright/test');
const { open, beside } = require('./lib/harness');

const STADIUM = 'ben hill griffin stadium';


test('reload mid-trip: the trip resumes to the same place, from where you are', async ({ page, context }) => {
  const app = await open(page, context, { speedup: 4 });
  const coords = await app.go(STADIUM);
  await app.driveAlong(coords.slice(0, 30));
  const before = await app.look();
  await app.reload();
  let s = await app.look();
  expect(s.state).toBe('nav');
  expect(s.nav.mode, 'waiting for a fix to resume').toBe('pending');
  expect(s.banner).toContain('Ben Hill Griffin Stadium');
  await app.driveAlong(coords.slice(30, 34));
  await app.until(() => FM.nav.state().mode === 'on', 'the resumed route');
  s = await app.look();
  expect(s.nav.dest).toBe(before.nav.dest);
  expect(s.spoken.filter(t => /^Resuming route/.test(t))).toHaveLength(1);
  expect(Math.abs(s.nav.remaining - before.nav.remaining), 'remaining distance after resuming vs before').toBeLessThan(150);
  expect(app.errors).toEqual([]);
});

test('reload after arriving: no trip restarts', async ({ page, context }) => {
  const app = await open(page, context, { speedup: 4 });
  const coords = await app.go(STADIUM);
  await app.driveAlong(coords.filter((c, i) => i % 3 === 0).concat([coords[coords.length - 1]]), { until: () => !FM.nav.active() });
  expect((await app.look()).state).toBe('arrived');
  await app.reload();
  await app.fix({ lat: coords[coords.length - 1][0], lon: coords[coords.length - 1][1] });
  await app.wait(2000);
  const s = await app.look();
  expect(s.state).toBe('explore');
  expect(s.nav.mode).toBe('off');
  expect(s.saved).toBe(null);
  expect(s.spoken.filter(t => /Resuming/.test(t))).toEqual([]);
  expect(app.net.count('route'), 'route requests after the reload').toBe(1);
});

test('reload after End Route: no trip restarts', async ({ page, context }) => {
  const app = await open(page, context, { speedup: 4 });
  const coords = await app.go(STADIUM);
  await app.driveAlong(coords.slice(0, 10));
  await app.key('SoftRight');
  for (let i = 0; i < 6; i++) await app.key('ArrowDown', { wait: 30 });
  await app.key('Enter');
  await app.reload();
  await app.driveAlong(coords.slice(10, 14));
  const s = await app.look();
  expect(s.state).toBe('explore');
  expect(s.nav.mode).toBe('off');
  expect(s.saved).toBe(null);
});

test('reload while previewing: back on the map, nothing saved', async ({ page, context }) => {
  const app = await open(page, context);
  await app.preview(STADIUM);
  await app.reload();
  await app.fix({ lat: 29.6516, lon: -82.3248 });
  await app.wait(1000);
  const s = await app.look();
  expect(s.state).toBe('explore');
  expect(s.nav.mode).toBe('off');
  expect(s.routeDrawn).toBe(false);
});

test('offline mid-trip: off the route it says No connection, and reroutes once back online', async ({ page, context }) => {
  const app = await open(page, context, { speedup: 4 });
  const coords = await app.go(STADIUM);
  await app.driveAlong(coords.slice(0, 18));
  await context.setOffline(true);
  app.net.fault('all', { mode: 'offline' });
  const pills = [];
  for (let i = 0; i < 8; i++) {
    await app.fix(beside(coords, 18, 150 + i * 5));
    await app.wait(1000);
    pills.push((await app.look()).pill);
  }
  expect(pills.some(p => /No connection|Offline/.test(p)), 'pills: ' + pills.join(' / ')).toBe(true);
  expect((await app.look()).nav.rerouting).toBe(false);
  await context.setOffline(false);
  app.net.fault('all');
  for (let i = 0; i < 25; i++) { // the reroute retries 15 s after the last try
    await app.fix(beside(coords, 18, 190));
    await app.wait(1000);
    if ((await app.look()).nav.remaining && app.net.served.route.length > 1) break;
  }
  await app.wait(1500);
  const s = await app.look();
  if (process.env.DEBUG) console.log(app.net.log.filter(e => e.kind === 'route').map(e => e.how).join(' '), JSON.stringify(s.nav), s.pill);
  expect(app.net.served.route.length, 'a reroute after the connection came back').toBeGreaterThan(1);
  expect(s.nav.mode).toBe('on');
  expect(s.nav.rerouting).toBe(false);
  expect(s.banner).not.toMatch(/Rerouting/);
});

test('a map tile request that never answers: that part of the map is retried and drawn', async ({ page, context }) => {
  const view = JSON.stringify({ lat: 29.6516, lon: -82.3248, zoom: 16 });
  // The first two tile downloads stall for good.
  const app = await open(page, context, { at: null, storage: { 'flipmap.view': view }, faults: { tile: { mode: 'hang', times: 2 } } });
  expect(app.net.hung.length, 'stalled downloads').toBe(2);
  let ok = false;
  let blank = 0;
  for (let i = 0; i < 45 && !ok; i++) { // standing still, a fix a second
    await app.fix({ lat: 29.6516, lon: -82.3248 });
    await app.wait(1000);
    const t = await page.evaluate(() => ({ n: document.querySelectorAll('#tiles > canvas').length, blank: document.querySelectorAll('#tiles > canvas:not(.ready)').length }));
    blank = t.blank;
    ok = t.n > 3 && !t.blank;
  }
  await page.screenshot({ path: 'results/lifecycle-tile-hang.png' });
  expect(ok, blank + ' map tiles still blank 45 s later').toBe(true);
});

test('a reroute answer that arrives after the trip ended doesn\'t restart it', async ({ page, context }) => {
  const app = await open(page, context, { speedup: 4 });
  const coords = await app.go(STADIUM);
  await app.driveAlong(coords.slice(0, 18));
  app.net.fault('route', { mode: 'delay', ms: 2000, times: 1 });
  for (let i = 0; i < 4; i++) {
    await app.fix(beside(coords, 18, 150));
    await app.wait(1000);
  }
  await app.key('SoftRight');
  for (let i = 0; i < 6; i++) await app.key('ArrowDown', { wait: 30 });
  await app.key('Enter'); // End Route while the reroute is out
  await page.waitForTimeout(2500);
  await app.fix(beside(coords, 18, 150));
  await app.wait(1000);
  const s = await app.look();
  expect(s.state).toBe('explore');
  expect(s.nav.mode).toBe('off');
  expect(s.saved).toBe(null);
});

test('Phone Check in the middle of a trip, then back: the trip carries on', async ({ page, context }) => {
  const app = await open(page, context, { speedup: 4 });
  const coords = await app.go(STADIUM);
  await app.driveAlong(coords.slice(0, 10));
  await app.key('SoftRight');
  for (let i = 0; i < 5; i++) await app.key('ArrowDown', { wait: 30 });
  await app.key('Enter'); // Phone Check
  await page.waitForURL(/probe\.html/);
  await page.goBack();
  await page.waitForFunction(() => window.FM && FM.nav && window.__gps);
  await app.driveAlong(coords.slice(10, 16));
  await app.until(() => FM.nav.state().mode === 'on', 'the trip, after coming back');
  const s = await app.look();
  expect(s.state).toBe('nav');
  expect(s.nav.dest).toBe('Ben Hill Griffin Stadium');
});

test('after a reload mid-trip, the Drive Report keeps measuring frames as well as fixes', async ({ page, context }) => {
  const app = await open(page, context, { speedup: 4 });
  const coords = await app.go(STADIUM);
  await app.driveAlong(coords.slice(0, 40)); // the report samples frames every 30 s
  expect((await app.report()).frames, 'frames sampled before the reload').toBeGreaterThan(0);
  await app.reload();
  const before = await app.report(); // as saved when the page unloaded
  await app.driveAlong(coords.slice(40, 110));
  const after = await app.report();
  console.log('  report frames after the reload, then 70 s later: ' + before.frames + ' / ' + after.frames + '; fixes ' + before.fixes + ' / ' + after.fixes);
  expect(after.fixes).toBeGreaterThan(before.fixes);
  expect(after.frames, 'frames sampled after the reload').toBeGreaterThan(before.frames);
});

test('a trip too old to resume (over 6 h) doesn\'t leave the Drive Report saying "driving"', async ({ page, context }) => {
  const hours = 3600 * 1000;
  const startedAt = Date.now() - 7 * hours;
  const report = {
    dest: 'Ben Hill Griffin Stadium', started: startedAt, ended: 0, fixes: 300, gapSum: 299000, gapMax: 1500,
    accSum: 2400, accMax: 12, accPoor: 0, hiddenMs: 0, hiddenSince: 0, hiddenFixes: 0, hiddenSpoken: 0,
    frames: 500, slow: 2, worst: 70, keys: 3, keySum: 90, keyMax: 40, spoken: 6, voiceErrors: 0, reroutes: 0,
    battery0: null, battery1: null
  };
  const app = await open(page, context, {
    storage: {
      'flipmap.dest': JSON.stringify({ name: 'Ben Hill Griffin Stadium', lat: 29.6499, lon: -82.3486, savedAt: startedAt }),
      'flipmap.report': JSON.stringify(report)
    }
  });
  await app.wait(1000);
  expect((await app.look()).nav.mode).toBe('off');
  await app.key('SoftRight');
  for (let i = 0; i < 4; i++) await app.key('ArrowDown', { wait: 30 });
  await app.key('Enter'); // Drive Report
  const title = await page.locator('#report-body h3').textContent();
  expect(title, 'the report of a trip that can no longer resume').not.toMatch(/driving/);
});
