// Where the two audits' fixes meet: request time limits and request numbering (audit/reliability),
// plausible GPS matching (audit/nav-engine), and resuming a saved trip. Each fix passed its own tests;
// these check them together. Each test asserts the behavior we want; a failure is a confirmed defect.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness/world');

// As after the app was closed mid-trip: a destination saved a moment ago.
function savedTrip(end) {
  const e = H.toLL(end);
  return { 'flipmap.dest': JSON.stringify({ name: 'Destination', lat: e[0], lon: e[1], savedAt: 1700000000000 }) };
}

// Seconds after a route arrived in which the distance left didn't go down, though the car moved.
// (While a route loads, the distance is meant to hold still.)
function stalls() {
  let last = null;
  let n = 0;
  return {
    each(s) {
      if (s.mode !== 'on' || s.rerouting) return;
      if (last !== null && s.remaining >= last) n++;
      last = s.remaining;
    },
    get count() { return n; }
  };
}

test('a saved trip that takes 10 s to resume while you drive on at 30 m/s: guidance picks up with no extra reroute', async t => {
  const END = [0, 9000];
  const w = H.load(() => ({ delay: 10000 }), { storage: savedTrip(END) });
  t.after(() => w.close());
  const st = stalls();
  const fixes = H.drive([[0, 0], END], { speed: 30 });
  await H.feed(w, fixes.slice(0, 50), s => st.each(s));
  const s = w.nav.state();
  assert.strictEqual(w.calls.length, 1, 'route requests (1 = only the resume): ' + w.calls.length);
  assert.ok(st.count <= 1, 'seconds the distance left stood still while driving: ' + st.count);
  assert.ok(Math.abs(s.remaining - (9000 - 30 * 49)) < 100, 'distance left ' + Math.round(s.remaining) + ' m vs the car\'s ' + (9000 - 30 * 49));
});

test('a reroute that takes 10 s to answer while you drive the new way: guidance picks up with no second reroute', async t => {
  const L = [[0, 0], [0, 4000]];
  const w = H.load(req => (req.n === 1 ? { body: H.osrmRoute(L) } : { delay: 10000 }));
  t.after(() => w.close());
  await H.startTrip(w, L);
  await H.feed(w, H.drive([[0, 0], [0, 600]], { speed: 30 }).slice(0, 20)); // past the first 15 s
  const off = H.drive([[0, 600], [3000, 600]], { speed: 30 });
  for (let i = 0; w.calls.length < 2 && i < off.length; i++) await H.feed(w, [off[i]]);
  assert.strictEqual(w.calls.length, 2, 'a reroute was asked for');
  // The driver turns toward the destination right away: the way the new route goes.
  const onward = H.drive([w.calls[1].from, [0, 4000]], { speed: 30 });
  const st = stalls();
  await H.feed(w, onward.slice(1, 40), s => st.each(s));
  assert.strictEqual(w.calls.length, 2, 'route requests after the reroute answered: ' + (w.calls.length - 2) + ' more');
  assert.ok(st.count <= 1, 'seconds the distance left stood still while driving: ' + st.count);
});

test('a reroute request that times out, then a retry that answers in 8 s while you drive on: no extra reroute', async t => {
  const END = [0, 9000];
  const w = H.load(req => (req.n === 1 ? 'hang' : { delay: 8000 }), { storage: savedTrip(END) });
  t.after(() => w.close());
  await H.feed(w, H.drive([[0, 0], END], { speed: 30 }).slice(0, 60));
  const s = w.nav.state();
  assert.strictEqual(s.mode, 'on');
  assert.strictEqual(w.calls.length, 2, 'route requests (the hung one, then the retry): ' + w.calls.length);
  assert.ok(Math.abs(s.remaining - (9000 - 30 * 59)) < 100, 'distance left ' + Math.round(s.remaining) + ' m vs the car\'s ' + (9000 - 30 * 59));
});

test('a stray fix by the destination right after a slow resume: no false arrival', async t => {
  const END = [0, 3000];
  const w = H.load(() => ({ delay: 6000 }), { storage: savedTrip(END) });
  t.after(() => w.close());
  const fixes = H.drive([[0, 0], END]);
  await H.feed(w, fixes.slice(0, 7));
  assert.strictEqual(w.nav.state().mode, 'on', 'resumed');
  await H.feed(w, [H.fix([2, 2998])]); // one stray fix, 2 m from the destination
  await H.feed(w, fixes.slice(8, 12));
  assert.strictEqual(w.arrived.length, 0, 'arrived early');
  assert.strictEqual(w.nav.state().mode, 'on');
});

test('arriving while a reroute is still loading: one arrival, and the late answer starts nothing', async t => {
  const L = [[0, 0], [0, 700]];
  const w = H.load(req => (req.n === 1 ? { body: H.osrmRoute(L) } : { delay: 11000 })); // answers after you arrive
  t.after(() => w.close());
  await H.startTrip(w, L);
  await H.feed(w, H.drive([[0, 0], [0, 540]]).slice(0, 40));
  await H.feed(w, [H.fix([90, 550]), H.fix([95, 560]), H.fix([95, 570]), H.fix([95, 580])]);
  assert.strictEqual(w.calls.length, 2, 'a reroute was asked for');
  await H.feed(w, H.drive([[0, 600], [0, 700]]));
  await H.feed(w, Array.from({ length: 10 }, () => H.fix([0, 700], { speed: 0 }))); // parked at the end
  assert.strictEqual(w.arrived.length, 1, 'arrivals');
  assert.strictEqual(w.nav.active(), false, 'a trip is active after the late answer');
  assert.strictEqual(w.nav.state().mode, 'off');
});

test('starting a new trip while a saved trip resumes: the new trip is followed, without "Rerouting"', async t => {
  const w = H.load(req => (req.n === 1 ? { delay: 8000 } : {}), { storage: savedTrip([0, 3000]) });
  t.after(() => w.close());
  w.nav.update(H.fix([0, 0]));
  await H.flush();
  assert.strictEqual(w.nav.state().mode, 'pending', 'resuming the saved trip');
  const other = H.toLL([2000, 0]);
  const planned = w.nav.plan({ name: 'Elsewhere', lat: other[0], lon: other[1] });
  await w.clock.advance(1000);
  w.nav.start((await planned)[0]);
  await H.flush();
  const states = [];
  await H.feed(w, H.drive([[0, 0], [2000, 0]]).slice(1, 15), s => states.push(s));
  assert.ok(states.every(s => s.mode === 'on' && s.dest.name === 'Elsewhere'), 'the saved trip took over again');
  assert.deepStrictEqual(states.filter(s => s.rerouting).length, 0, 'seconds the new trip showed "Rerouting"');
  assert.ok(!w.spoken.some(x => /Resuming/.test(x.text)), 'said "Resuming route" for the old trip');
});

test('a reroute answered just before you reach the destination: arrival is still announced', async t => {
  const L = [[0, 0], [0, 700]];
  const w = H.load(req => (req.n === 1 ? { body: H.osrmRoute(L) } : { delay: 8000 }));
  t.after(() => w.close());
  await H.startTrip(w, L);
  await H.feed(w, H.drive([[0, 0], [0, 540]]).slice(0, 40));
  await H.feed(w, [H.fix([90, 550]), H.fix([95, 560]), H.fix([95, 570]), H.fix([95, 580])]);
  assert.strictEqual(w.calls.length, 2, 'a reroute was asked for');
  await H.feed(w, H.drive([[0, 600], [0, 700]]));
  await H.feed(w, Array.from({ length: 3 }, () => H.fix([0, 700], { speed: 0 }))); // parked at the end
  assert.strictEqual(w.arrived.length, 1, 'arrivals within 3 s of parking at the destination');
});
