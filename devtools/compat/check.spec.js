// The current Flip Map build in Firefox 123 (Gecko 123, KaiOS 4.0's engine version) at 240x320.
// Uses the real app, real geolocation updates, and the live map, search and routing services.
// Speech is recorded instead of played. Screenshots land in results/ for review.
'use strict';

const { test, expect } = require('@playwright/test');

const SHOTS = 'results/';

// Before any app script: record speech instead of playing it, count vibrations, pick an appearance.
function setup(appearance) {
  return function () {
    window.__spoken = [];
    window.speechSynthesis.speak = function (u) {
      window.__spoken.push(u.text);
      if (u.onend) setTimeout(u.onend, 0);
    };
    navigator.vibrate = function () { return true; };
    try {
      if (!sessionStorage.getItem('flipmap.compat')) {
        sessionStorage.setItem('flipmap.compat', '1');
        localStorage.clear();
        localStorage.setItem('flipmap.prefs', JSON.stringify({ appearance: '__APPEARANCE__', rotate: true }));
      }
    } catch (e) {}
  }.toString().replace('__APPEARANCE__', appearance);
}

async function open(page, url, appearance) {
  await page.addInitScript('(' + setup(appearance || 'light') + ')()');
  await page.goto(url);
}

// Key presses as the phone sends them. KaiOS-only keys aren't in Playwright's key list, so they're
// dispatched directly; the app only reads e.key.
async function key(page, k) {
  if (['SoftLeft', 'SoftRight', 'MicrophoneToggle'].indexOf(k) >= 0) {
    await page.evaluate(name => {
      (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
    }, k);
  } else {
    await page.keyboard.press(k);
  }
  await page.waitForTimeout(250);
}

function watchErrors(page) {
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  return errors;
}

test('explore: map draws, labels show, GPS dot appears, nothing overflows (day)', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, '/index.html', 'light');
  await expect.poll(() => page.locator('#tiles canvas.ready').count(), { timeout: 30000 }).toBeGreaterThan(3);
  await expect(page.locator('#puck .dot')).toBeVisible({ timeout: 15000 }); // #puck itself is a zero-size anchor
  await expect.poll(() => page.locator('#labels .label.on').count(), { timeout: 15000 }).toBeGreaterThan(0);
  await page.waitForTimeout(800); // let the labels finish fading in before the screenshot
  const facts = await page.evaluate(() => ({
    overflowX: document.documentElement.scrollWidth - innerWidth,
    font: document.fonts.check('600 14px Inter'),
    theme: document.documentElement.getAttribute('data-theme'),
    pill: document.getElementById('pill').hidden ? '' : document.getElementById('pill-text').textContent,
    keys: ['sk-left', 'sk-right'].map(id => document.getElementById(id).textContent)
  }));
  await page.screenshot({ path: SHOTS + '1-explore-day.png' });
  expect(facts.overflowX, 'no sideways scrolling').toBeLessThanOrEqual(0);
  expect(facts.font, 'Inter loaded').toBe(true);
  expect(facts.theme).toBe('light');
  expect(facts.keys).toEqual(['Search', 'More']);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('search, preview, Go with OK as MicrophoneToggle, then driving on real location updates', async ({ page, context }) => {
  const errors = watchErrors(page);
  await open(page, '/index.html', 'light');
  await expect.poll(() => page.locator('#tiles canvas.ready').count(), { timeout: 30000 }).toBeGreaterThan(3);

  await key(page, '7');
  await expect(page.locator('#search')).toBeVisible();
  await page.keyboard.type('ben hill griffin stadium');
  await key(page, 'Enter');
  await expect(page.locator('#results li').first()).toBeVisible({ timeout: 20000 });
  await page.screenshot({ path: SHOTS + '2-search.png' });

  await key(page, 'Enter'); // the first result is focused
  await expect(page.locator('body')).toHaveAttribute('data-state', 'preview');
  await expect(page.locator('#p-time')).toContainText('min', { timeout: 20000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: SHOTS + '3-preview.png' });

  await key(page, 'MicrophoneToggle'); // the Flip 4's center key
  await expect(page.locator('body')).toHaveAttribute('data-state', 'nav');
  await expect(page.locator('#banner')).toBeVisible();

  // Drive the first few hundred meters of the route by moving the browser's GPS position: this goes
  // through watchPosition, as on the phone. Playwright's positions carry no course or speed, so the
  // map keeps the bearing it started with and the arrow points north; a moving phone supplies both.
  const coords = await page.evaluate(() => FM.nav.route().coords);
  const before = await page.evaluate(() => FM.nav.state().remaining);
  for (let i = 1; i <= 12; i++) {
    const c = coords[Math.min(i * 2, coords.length - 1)];
    await context.setGeolocation({ latitude: c[0], longitude: c[1], accuracy: 8 });
    await page.waitForTimeout(1000);
  }
  const after = await page.evaluate(() => ({
    left: FM.nav.state().remaining,
    mode: FM.nav.state().mode,
    dist: document.getElementById('b-dist').textContent,
    road: document.getElementById('b-road').textContent,
    trip: document.getElementById('t-time').textContent + ' ' + document.getElementById('t-time-unit').textContent,
    spoken: window.__spoken
  }));
  await page.screenshot({ path: SHOTS + '4-driving.png' });
  expect(after.mode).toBe('on');
  expect(after.left, 'progress along the route from location updates').toBeLessThan(before);
  expect(after.spoken.join(' | '), 'voice prompts were issued').toMatch(/Starting route/);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('settings sheet, switches, and the Drive Report open and close by keys', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, '/index.html', 'light');
  await expect.poll(() => page.locator('#tiles canvas.ready').count(), { timeout: 30000 }).toBeGreaterThan(3);
  await key(page, '9');
  await expect(page.locator('#settings')).toBeVisible();
  const first = page.locator('#settings-body li').first();
  const was = await first.locator('.switch').getAttribute('class');
  await key(page, 'Enter');
  expect(await first.locator('.switch').getAttribute('class')).not.toBe(was);
  await page.screenshot({ path: SHOTS + '5-settings.png' });
  for (let i = 0; i < 4; i++) await key(page, 'ArrowDown'); // to Drive Report
  await key(page, 'Enter');
  await expect(page.locator('#report')).toBeVisible();
  await page.screenshot({ path: SHOTS + '6-drive-report.png' });
  await key(page, 'Escape');
  await page.waitForTimeout(400);
  await expect(page.locator('body')).not.toHaveAttribute('data-sheet', /.+/);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('night appearance draws the dark map', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, '/index.html', 'dark');
  await expect.poll(() => page.locator('#tiles canvas.ready').count(), { timeout: 30000 }).toBeGreaterThan(3);
  await page.waitForTimeout(800);
  const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  await page.screenshot({ path: SHOTS + '7-explore-night.png' });
  expect(theme).toBe('dark');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('phone check: map speed and the flip test run in Gecko 123', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, '/probe.html', 'light');
  await expect(page.locator('#summary')).toContainText('gecko=123');
  await key(page, '5');
  await expect(page.locator('dd', { hasText: 'ms to draw a tile' })).toBeVisible({ timeout: 45000 });
  await key(page, '6');
  await key(page, '6');
  await expect(page.locator('dd', { hasText: 'wake locks released' })).toBeVisible();
  const rows = await page.evaluate(() => Array.from(document.querySelectorAll('dt')).map(dt => dt.textContent + ': ' + dt.nextElementSibling.textContent));
  const summary = await page.locator('#summary').textContent();
  await page.screenshot({ path: SHOTS + '8-phone-check.png', fullPage: true });
  console.log('\n  phone check in Firefox 123:\n  ' + summary + '\n  ' + rows.filter(r => /Map speed|Flip test|Keep screen|Voice/.test(r)).join('\n  '));
  expect(errors, errors.join('\n')).toEqual([]);
});
