// Search: answers that arrive out of order must not replace newer results.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { JSDOM } = require('jsdom');
const H = require('./harness/world');

const APP = path.join(__dirname, '..', 'app', 'js');

function place(name) {
  return { name: name, display_name: name + ', Gainesville', lat: '29.65', lon: '-82.33', category: 'shop', type: 'supermarket', address: { city: 'Gainesville' } };
}

// Loads app/js/search.js into a small DOM with a fake clock and a search server whose answer time
// depends on the query: { publix: 3000, target: 500 } ms.
function searchWorld(t, delays) {
  const dom = new JSDOM('<input id="q"><span id="q-icon"></span><h3 id="s-head"></h3><ul id="results"></ul><div id="s-empty"></div>');
  dom.window.HTMLElement.prototype.scrollIntoView = function () {};
  const clock = H.makeClock(1700000000000);
  const saved = { window: global.window, document: global.document, fetch: global.fetch, now: Date.now, setTimeout: global.setTimeout, clearTimeout: global.clearTimeout, localStorage: global.localStorage, navigator: global.navigator };
  global.window = dom.window;
  global.document = dom.window.document;
  global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  Object.defineProperty(global, 'navigator', { value: { onLine: true }, configurable: true, writable: true });
  Date.now = clock.now;
  global.setTimeout = clock.setTimeout;
  global.clearTimeout = clock.clearTimeout;
  global.fetch = function (url, init) {
    const q = decodeURIComponent(url.match(/[?&]q=([^&]*)/)[1]);
    return new Promise((resolve, reject) => {
      if (init && init.signal) init.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e); });
      clock.setTimeout(() => resolve({ ok: true, json: () => Promise.resolve([place(q === 'publix' ? 'Publix' : 'Target')]) }), delays[q]);
    });
  };
  dom.window.FM = {};
  const fs = require('fs');
  const files = ['geo', 'net', 'icons', 'search'].map(n => path.join(APP, n + '.js')).filter(f => fs.existsSync(f));
  files.forEach(f => { delete require.cache[require.resolve(f)]; });
  files.slice(0, -1).forEach(f => require(f));
  dom.window.FM.map = { center: () => ({ lat: 29.65, lon: -82.33 }) };
  require(files[files.length - 1]);
  t.after(() => {
    Object.keys(saved).forEach(k => {
      if (k === 'now') Date.now = saved.now;
      else if (k === 'navigator') Object.defineProperty(global, 'navigator', { value: saved.navigator, configurable: true, writable: true });
      else global[k] = saved[k];
    });
  });
  const doc = dom.window.document;
  return {
    clock: clock,
    search: dom.window.FM.search,
    type(text) { doc.getElementById('q').value = text; },
    ok() { this.search.key({ key: 'Enter' }, 'Enter'); },
    titles() { return Array.from(doc.querySelectorAll('#results .row-title')).map(e => e.textContent); }
  };
}

test('a slow earlier search does not overwrite a newer one', async t => {
  const s = searchWorld(t, { publix: 3000, target: 500 });
  s.search.open(false);
  s.type('publix');
  s.ok();
  await s.clock.advance(1200); // past the one-search-per-second limit
  s.type('target');
  s.ok();
  await s.clock.advance(1000);
  assert.deepStrictEqual(s.titles(), ['Target'], 'the newer search shows first');
  await s.clock.advance(3000); // now the old one answers
  assert.deepStrictEqual(s.titles(), ['Target'], 'and stays');
});
