// Navigation correctness: replayed drives through the real nav.js. Each test asserts the behavior we
// want; a failure is a confirmed defect. Run with: node --test tests/
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness/world');

// 800 m north, then right, 600 m east.
const L = [[0, 0], [0, 800], [600, 800]];
// Out 600 m north, right 100 m, back 600 m south: the two long legs run 100 m apart.
const U = [[0, 0], [0, 600], [100, 600], [100, 0]];

// A world whose router answers the first request with `route` and reroutes with straight lines.
function world(t, route, script) {
  const w = H.load(req => (req.n === 1 ? { body: H.osrmRoute(route) } : (script ? script(req) : {})));
  t.after(() => w.close());
  return w;
}

test('a clean drive: turns announced before they come, one arrival, no reroutes', async t => {
  const w = world(t, L);
  await H.startTrip(w, L);
  const fixes = H.drive(L, { noise: 5, seed: 3 });
  const cornerAt = w.clock.now() + 1000 * (Math.ceil(800 / 13.4) + 1);
  await H.feed(w, fixes);
  const turnNow = w.spoken.find(s => /^Turn right onto Street 2/.test(s.text));
  assert.ok(turnNow, 'a "turn now" prompt for the corner');
  assert.ok(turnNow.at < cornerAt, 'spoken before reaching the corner');
  assert.strictEqual(w.arrived.length, 1, 'arrives exactly once');
  assert.strictEqual(w.calls.length, 1, 'no reroutes');
});

test('one stray fix near the destination does not end the trip', async t => {
  const w = world(t, L);
  await H.startTrip(w, L);
  const fixes = H.drive(L);
  const stray = H.fix([598, 800]); // 2 m from the destination, while still 500 m+ from it
  await H.feed(w, fixes.slice(0, 20).concat([stray]));
  assert.strictEqual(w.arrived.length, 0, 'a single implausible jump must not count as arriving');
  assert.notStrictEqual(w.nav.state().mode, 'off', 'navigation is still running');
});

test('a GPS jump onto the parallel return leg does not skip ahead', async t => {
  const w = world(t, U);
  await H.startTrip(w, U);
  const out = H.drive([[0, 0], [0, 300]]);
  const jump = H.fix([92, 300]); // lands next to the return leg, 92 m from where we are
  const back = H.drive([[0, 313], [0, 340]]);
  let after = null;
  await H.feed(w, out.concat([jump], back), (s, f, i) => { if (i === out.length + back.length) after = s; });
  assert.strictEqual(after.step.type, 'turn', 'the next maneuver is still the turn at the top');
  assert.strictEqual(after.step.i, 1, 'still the first turn');
  assert.ok(after.toNext > 200 && after.toNext < 320, 'distance to it still fits our real position: ' + Math.round(after.toNext));
  assert.strictEqual(w.calls.length, 1, 'no reroute from one stray fix');
});

test('a 25-second GPS gap (tunnel) catches up without a reroute or a false arrival', async t => {
  const w = world(t, L);
  await H.startTrip(w, L);
  const all = H.drive(L);
  const before = all.slice(0, 15);
  const after = all.slice(40); // ~335 m later, after 25 s of silence
  await H.feed(w, before);
  await w.clock.advance(25000);
  let first = null;
  await H.feed(w, after, (s, f, i) => { if (i === 0) first = s; });
  assert.ok(first.mode === 'on' && first.step.i === 1, 'the corner is still next right after the gap');
  assert.strictEqual(w.calls.length, 1, 'no reroute');
  assert.strictEqual(w.arrived.length, 1, 'arrives once, at the end');
});

test('three turns within 150 m: every "turn now" is spoken in order, before its turn', async t => {
  const Z = [[0, 0], [0, 500], [70, 500], [70, 570], [140, 570], [140, 900]];
  const w = world(t, Z);
  await H.startTrip(w, Z);
  const t0 = w.clock.now();
  await H.feed(w, H.drive(Z));
  const corners = [500, 570, 640, 710]; // distance along the route of each turn
  const nowPrompts = w.spoken.filter(s => /^Turn (left|right) onto Street/.test(s.text));
  assert.strictEqual(nowPrompts.length, 4, 'one "turn now" per turn: ' + nowPrompts.map(s => s.text).join(' | '));
  nowPrompts.forEach((s, k) => {
    assert.ok(new RegExp('onto Street ' + (k + 2) + '$').test(s.text), 'in order: ' + s.text);
    const passedAt = t0 + 1000 * (Math.ceil(corners[k] / 13.4) + 1);
    assert.ok(s.at <= passedAt, 'spoken before passing turn ' + (k + 1));
  });
});

test('poor GPS (±100 m) does not cause reroutes or an early arrival', async t => {
  const w = world(t, L);
  await H.startTrip(w, L);
  const fixes = H.drive(L, { noise: 45, accuracy: 100, seed: 11 });
  let earlyArrival = false;
  await H.feed(w, fixes.slice(0, -8), () => { if (w.arrived.length) earlyArrival = true; });
  assert.strictEqual(earlyArrival, false, 'no arrival before the last stretch');
  assert.strictEqual(w.calls.length, 1, 'no reroutes from noise alone');
});

test('driving a parallel road 15 m away is noticed', { todo: 'needs a road graph to tell neighboring roads apart (research/offline-and-accuracy.md 1b)' }, async t => {
  const w = world(t, L);
  await H.startTrip(w, L);
  // A frontage road 15 m east of the route that never turns.
  await H.feed(w, H.drive([[15, 0], [15, 1400]]));
  assert.ok(w.calls.length > 1, 'should eventually reroute');
});
