// Network failures: a routing server that hangs, errors, is offline, or answers too late.
// Each test asserts the behavior we want; a failure is a confirmed defect.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness/world');

const L = [[0, 0], [0, 800], [600, 800]];
// Leave the route eastward 200 m in, and keep going east (well off the route).
const DETOUR = [[0, 200], [400, 200]];

function world(t, rest) {
  const w = H.load(req => (req.n === 1 ? { body: H.osrmRoute(L) } : rest(req)));
  t.after(() => w.close());
  return w;
}

async function driveOff(w, seconds) {
  await H.feed(w, H.drive([[0, 0], [0, 200]]).slice(0, 15));
  await H.feed(w, H.drive(DETOUR).slice(0, seconds));
}

test('a reroute request that never answers is given up and retried', async t => {
  const w = world(t, () => 'hang');
  await H.startTrip(w, L);
  let stuck = 0;
  await H.feed(w, H.drive([[0, 0], [0, 200]]).slice(0, 15));
  await H.feed(w, H.drive(DETOUR).slice(0, 29), s => { stuck = s.rerouting ? stuck + 1 : 0; });
  assert.ok(w.calls.length >= 3, 'tries again after giving up (requests: ' + w.calls.length + ')');
  assert.ok(stuck < 20, '"Rerouting" is not shown for ever (' + stuck + ' s in a row)');
});

test('a route plan that never answers fails within 20 seconds instead of spinning for ever', async t => {
  const w = H.load(() => 'hang');
  t.after(() => w.close());
  w.nav.update(H.fix([0, 0]));
  const end = H.toLL([600, 800]);
  let settled = null;
  w.nav.plan({ name: 'Destination', lat: end[0], lon: end[1] }).then(() => { settled = 'ok'; }, e => { settled = e.message; });
  await w.clock.advance(20000);
  assert.ok(settled, 'the preview gets an answer or an error');
});

test('a saved trip whose first request hangs keeps retrying', async t => {
  // As after the app was closed mid-trip: the destination is saved, and the app reloads.
  const end = H.toLL([600, 800]);
  const saved = { name: 'Destination', lat: end[0], lon: end[1], savedAt: 1700000000000 };
  const w = H.load(() => 'hang', { storage: { 'flipmap.dest': JSON.stringify(saved) } });
  t.after(() => w.close());
  assert.strictEqual(w.nav.state().mode, 'pending', 'starts out resuming the saved trip');
  await H.feed(w, H.drive([[0, 0], [0, 600]]).slice(0, 45));
  assert.ok(w.calls.length >= 2, 'asked again after the first request hung (requests: ' + w.calls.length + ')');
});

test('a reroute that answers after the trip was ended does not restart navigation', async t => {
  const w = world(t, () => ({ delay: 8000 }));
  await H.startTrip(w, L);
  await driveOff(w, 10); // off the route long enough to ask for a reroute (3 fixes beyond 48 m)
  assert.strictEqual(w.calls.length, 2, 'a reroute was requested');
  w.nav.end();
  await w.clock.advance(10000);
  assert.strictEqual(w.nav.state().mode, 'off', 'still ended');
  assert.strictEqual(w.nav.route(), null);
});

test('a server error on reroute is retried, and the new route is used', async t => {
  const w = world(t, req => (req.n === 2 ? { status: 500 } : {}));
  await H.startTrip(w, L);
  const messages = [];
  w.nav.onmessage = m => messages.push(m);
  await driveOff(w, 30);
  assert.ok(messages.indexOf('Routing is unavailable') >= 0, 'says so: ' + messages.join(' | '));
  assert.ok(w.calls.length >= 3, 'retried (requests: ' + w.calls.length + ')');
  assert.strictEqual(w.nav.state().rerouting, false, 'not stuck rerouting');
  assert.ok(w.nav.route().steps[0].text.indexOf('Head') === 0, 'navigating the new route');
});

test('going offline on reroute says "No connection" and retries', async t => {
  const w = world(t, req => (req.n === 2 ? 'offline' : {}));
  await H.startTrip(w, L);
  const messages = [];
  w.nav.onmessage = m => messages.push(m);
  await driveOff(w, 30);
  assert.ok(messages.indexOf('No connection') >= 0, 'says so: ' + messages.join(' | '));
  assert.ok(w.calls.length >= 3, 'retried (requests: ' + w.calls.length + ')');
});
