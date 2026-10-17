// A long drive, Gainesville to the Jacksonville Zoo (77 miles, about 100 minutes), replayed through the real app
// on recorded answers. GPS drifts and wanders, drops out twice, and sends three stray fixes; you take a
// wrong turn; the connection goes away for a while, map tiles turn slow, and the routing server fails
// once. Every 5 minutes of the drive it measures what a leak or a slowdown would grow: page size,
// labels, timers, listeners, the time each GPS fix costs, frame pacing, key response, and memory.
//
// LONG_SPEEDUP=n replays n times faster (page clock and timers sped up; frames stay real). Default 1:
// real time, about 105 minutes. In Chromium (project long-drive-chromium) it also reads the JS heap.
'use strict';

const fs = require('fs');
const { execSync } = require('child_process');
const { test, expect } = require('@playwright/test');
const { open } = require('./lib/harness');
const { track } = require('./lib/drive');
const { RECORD } = require('./lib/network');

const DEST = 'jacksonville zoo and gardens';
const SPEEDUP = +(process.env.LONG_SPEEDUP || (RECORD ? 16 : 1));
const BUCKET_S = 300;
const LABEL = process.env.RUN_LABEL ? '-' + process.env.RUN_LABEL : ''; // names this run's result files

// Resident memory of every process of this browser build, in MB (Firefox has no in-page memory API).
function browserMB(browserName) {
  try {
    const marker = browserName === 'firefox' ? 'ms-playwright/firefox-1440/' : 'ms-playwright/chromium-1105/'; // 1.42.1's builds
    const out = execSync('ps -axo rss=,command=', { encoding: 'utf8', maxBuffer: 1 << 24 });
    return Math.round(out.split('\n').filter(l => l.includes(marker)).reduce((sum, l) => sum + parseInt(l, 10), 0) / 1024);
  } catch (e) {
    return null;
  }
}

test('a long drive with GPS and network trouble: arrives once, and nothing grows or slows', async ({ page, context, browserName }) => {
  const app = await open(page, context, { speedup: SPEEDUP });
  const cdp = browserName === 'chromium' ? await context.newCDPSession(page) : null;
  async function heap() {
    if (!cdp) return {};
    await cdp.send('HeapProfiler.collectGarbage');
    const h = await cdp.send('Runtime.getHeapUsage');
    const d = await cdp.send('Memory.getDOMCounters');
    return { heapMB: +(h.usedSize / 1048576).toFixed(1), domNodes: d.nodes, jsListeners: d.jsEventListeners };
  }

  await app.go(DEST);
  const served = app.net.served.route[app.net.served.route.length - 1].body.routes.slice().sort((a, b) => a.duration - b.duration)[0];
  const T = Math.round(served.duration);
  const plan = {
    seed: 2026,
    outliers: [Math.round(T * 0.15), Math.round(T * 0.45), Math.round(T * 0.75)],
    gaps: [[Math.round(T * 0.3), 30], [Math.round(T * 0.6), 45]],
    detour: [Math.round(T * 0.22), 50],
    canyonLastM: 2500
  };
  const drive = track(served, plan);
  const offlineAt = Math.round(T * 0.35);
  const slowTilesAt = Math.round(T * 0.5);
  console.log('  route: ' + (served.distance / 1609.34).toFixed(1) + ' mi, ' + Math.round(served.duration / 60) + ' min by OSRM; ' +
    'replay: ' + drive.fixes.length + ' s of driving at ' + SPEEDUP + 'x');

  const rows = [];
  const keyTimes = [];
  const begin = Date.now();
  await page.evaluate(() => window.__probe.recordFrames(true));
  await page.evaluate(() => window.__probe.take());
  rows.push(Object.assign({ min: 0 }, await page.evaluate(() => window.__probe.sizes()), { browserMB: browserMB(browserName) }, await heap()));

  async function pressAndTime(k) {
    const r = await page.evaluate(k => window.__probe.keyToFrame(() => {
      (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    }), k);
    keyTimes.push(Object.assign({ key: k }, r));
  }

  for (let t = 0; t < drive.fixes.length; t++) {
    const f = drive.fixes[t];
    if (f) await app.fix(f);

    // Network trouble.
    if (t === plan.detour[0] + 3) app.net.fault('route', { mode: 'fail', status: 503, times: 1 }); // first reroute fails
    if (t === offlineAt) {
      await context.setOffline(true);
      app.net.fault('all', { mode: 'offline' });
    }
    if (t === offlineAt + 150) {
      await context.setOffline(false);
      app.net.fault('all');
    }
    if (t === slowTilesAt) app.net.fault('tile', { mode: 'delay', ms: 4000 / SPEEDUP }); // 4 s of drive time
    if (t === slowTilesAt + 300) app.net.fault('tile');

    // Keys, as a driver would press them: Repeat, Overview and back, Settings and back.
    if (t % BUCKET_S === 150) await pressAndTime('Enter');
    if (t % 600 === 450) {
      await pressAndTime('SoftLeft');
      await app.wait(2000);
      await pressAndTime('SoftLeft');
    }
    if (t === Math.round(T * 0.4)) {
      await pressAndTime('SoftRight');
      await app.wait(3000);
      await pressAndTime('SoftRight');
    }

    if (t > 0 && t % BUCKET_S === 0) {
      const take = await page.evaluate(() => window.__probe.take());
      const sizes = await page.evaluate(() => window.__probe.sizes());
      const look = await app.look();
      rows.push(Object.assign({ min: t / 60 }, take, sizes, { mode: look.nav.mode, left: Math.round(look.nav.remaining || 0), browserMB: browserMB(browserName) }, await heap()));
    }

    // Keep pace: second t of the drive is due at t / SPEEDUP seconds of real time.
    const due = begin + (t + 1) * 1000 / SPEEDUP;
    const lag = due - Date.now();
    if (lag > 0) await page.waitForTimeout(lag);
  }

  // Parked at the end until the app calls it.
  const end = drive.fixes.filter(Boolean).pop();
  for (let i = 0; i < 10 && (await app.look()).nav.mode !== 'off'; i++) {
    await app.fix(Object.assign({}, end, { speed: 0, heading: null }));
    await app.wait(1000);
  }
  const take = await page.evaluate(() => window.__probe.take());
  const last = await app.look();
  rows.push(Object.assign({ min: +(drive.fixes.length / 60).toFixed(1) }, take, await page.evaluate(() => window.__probe.sizes()), { mode: last.nav.mode, browserMB: browserMB(browserName) }, await heap()));
  const report = await app.report();
  await page.screenshot({ path: 'results/long-drive-' + browserName + LABEL + '-end.png' });

  const out = {
    browser: browserName, speedup: SPEEDUP, wallMinutes: +((Date.now() - begin) / 60000).toFixed(1),
    route: { miles: +(served.distance / 1609.34).toFixed(1), osrmMinutes: Math.round(served.duration / 60) },
    events: drive.events.filter(e => e.what !== 'stop').concat([{ t: offlineAt, what: 'offline', secs: 150 }, { t: slowTilesAt, what: 'slow tiles (4 s)', secs: 300 }]),
    stops: drive.events.filter(e => e.what === 'stop').length,
    arrivedSpoken: last.spoken.filter(x => /You have arrived/.test(x)).length,
    prompts: last.spoken.length,
    reroutes: report && report.reroutes,
    state: last.state,
    keyTimes, rows,
    missingFixtures: app.net.missing.length,
    errors: app.errors
  };
  fs.writeFileSync('results/long-drive-' + browserName + LABEL + '.json', JSON.stringify(out, null, 1));
  console.log('  ' + browserName + ': ' + out.wallMinutes + ' min wall; arrived ' + out.arrivedSpoken + 'x; reroutes ' + out.reroutes +
    '; prompts ' + out.prompts + '; missing fixtures ' + out.missingFixtures);
  console.log('  min  fixMs(avg/max)  frames slow worst  nodes labels tiles timeouts intervals listeners  MB' + (cdp ? '  heap' : ''));
  rows.forEach(r => console.log('  ' + [String(r.min).padStart(4), ((r.fixMsAvg || 0).toFixed(2) + '/' + (r.fixMsMax || 0).toFixed(1)).padStart(14),
    String(r.frames || 0).padStart(6), String(r.slowFrames || 0).padStart(4), String(Math.round(r.worstFrame || 0)).padStart(5),
    String(r.nodes).padStart(6), String(r.labels).padStart(6), String(r.tiles).padStart(5), String(r.timeouts).padStart(8),
    String(r.intervals).padStart(9), String(r.listeners).padStart(9), String(r.browserMB).padStart(5)].join(' ') + (cdp ? '  ' + r.heapMB : '')));

  if (RECORD) return; // recording only collects the answers
  expect(out.errors).toEqual([]);
  expect(out.arrivedSpoken, 'arrival announced').toBe(1);
  expect(last.state === 'arrived' || last.state === 'explore').toBe(true);
  expect(out.reroutes, 'reroutes (one wrong turn; stray fixes and gaps shouldn\'t cause any)').toBeLessThanOrEqual(3);
  // Structural growth from the first full bucket (5 min) to the last: a leak shows here.
  const first = rows[1];
  const final = rows[rows.length - 1];
  expect(final.nodes, 'page elements outside the sheets, 5 min vs end').toBeLessThan(first.nodes * 1.25 + 20);
  expect(final.sheetNodes, 'sheet contents').toBeLessThan(200);
  expect(final.listeners - first.listeners, 'event listeners added and never removed').toBeLessThan(25);
  expect(final.intervals, 'repeating timers').toBeLessThanOrEqual(first.intervals + 1);
  expect(final.timeouts, 'pending timers').toBeLessThan(60);
});
