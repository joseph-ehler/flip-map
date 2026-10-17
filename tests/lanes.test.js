// Lane guidance must never mislead. Run with: node --test tests/
'use strict';

const test = require('node:test');
const assert = require('node:assert');

global.window = {};
require('../app/js/lanes.js');
const { guide } = window.FM.lanes;

// An OSRM step: maneuver plus the lanes at its junction (intersections[0]), left to right.
function step(type, modifier, lanes, earlier) {
  const intersections = [{ lanes: lanes && lanes.map(([ind, valid]) => ({ indications: ind.split(';'), valid })) }];
  if (earlier) intersections.push({ lanes: earlier.map(([ind, valid]) => ({ indications: ind.split(';'), valid })) });
  return { maneuver: { type, modifier }, intersections };
}

test('a dedicated right-turn lane: use the right lane', () => {
  const g = guide(step('turn', 'right', [['left', false], ['straight', false], ['straight', false], ['right', true]]));
  assert.strictEqual(g.phrase, 'Use the right lane');
  assert.strictEqual(g.label, 'Right lane');
  assert.deepStrictEqual(g.lanes.map(l => l.valid), [false, false, false, true]);
});

test('double left-turn lanes', () => {
  const g = guide(step('turn', 'left', [['left', true], ['left', true], ['straight', false], ['straight;right', false]]));
  assert.strictEqual(g.phrase, 'Use the 2 left lanes');
  assert.strictEqual(g.label, '2 left lanes');
});

test('a shared straight-or-right lane counts for a right turn', () => {
  const g = guide(step('turn', 'right', [['left', false], ['straight', false], ['straight;right', true], ['right', true]]));
  assert.strictEqual(g.phrase, 'Use the 2 right lanes');
});

test('a shared lane recommended for the wrong direction is a conflict: say nothing', () => {
  // Seen in Gainesville: a left turn where OSRM also recommends a straight/right lane.
  assert.strictEqual(guide(step('turn', 'left', [['left', true], ['straight;right', true]])), null);
});

test('a recommended lane whose markings forbid the turn is a conflict: say nothing', () => {
  assert.strictEqual(guide(step('off ramp', 'slight right', [['straight', true], ['straight', false]])), null);
});

test('missing lane data: say nothing', () => {
  assert.strictEqual(guide(step('turn', 'left', null)), null);
  assert.strictEqual(guide({ maneuver: { type: 'turn', modifier: 'left' }, intersections: [] }), null);
  assert.strictEqual(guide({ maneuver: { type: 'turn', modifier: 'left' } }), null);
  assert.strictEqual(guide(null), null);
});

test('incomplete lane entries: say nothing', () => {
  const s = step('turn', 'left', [['left', true], ['straight', false]]);
  delete s.intersections[0].lanes[1].valid;
  assert.strictEqual(guide(s), null);
});

test('every lane works: nothing to say', () => {
  assert.strictEqual(guide(step('turn', 'right', [['straight;right', true], ['right', true]])), null);
});

test('no lane is recommended: say nothing', () => {
  assert.strictEqual(guide(step('turn', 'right', [['left', false], ['straight', false]])), null);
});

test('a single lane: nothing to choose', () => {
  assert.strictEqual(guide(step('turn', 'right', [['right', true]])), null);
});

test('lanes come from the maneuver junction, not an earlier intersection with a different count', () => {
  // Two lanes earlier on the road; a turn pocket opens to three at the junction itself.
  const s = step('turn', 'left', [['left', true], ['straight', false], ['straight', false]], [['straight', true], ['straight', true]]);
  const g = guide(s);
  assert.strictEqual(g.lanes.length, 3);
  assert.strictEqual(g.phrase, 'Use the left lane');
});

test('roundabouts, departures and arrivals get no lane advice', () => {
  for (const type of ['roundabout', 'rotary', 'depart', 'arrive']) {
    assert.strictEqual(guide(step(type, 'right', [['left', false], ['right', true]])), null, type);
  }
});

test('a recommended middle lane', () => {
  const g = guide(step('fork', 'slight left', [['left', false], ['slight left', true], ['right', false]]));
  assert.strictEqual(g.phrase, 'Use the center lane');
});

test('recommended lanes that are not side by side', () => {
  const g = guide(step('turn', 'right', [['right', true], ['straight', false], ['right', true]]));
  assert.strictEqual(g.phrase, 'Use the highlighted lanes');
});

test('unmarked lanes OSRM recommends are allowed', () => {
  const g = guide(step('turn', 'left', [['none', true], ['straight', false]]));
  assert.strictEqual(g.phrase, 'Use the left lane');
});

test('a U-turn can use a left-turn lane', () => {
  const g = guide(step('turn', 'uturn', [['left;uturn', true], ['straight', false]]));
  assert.strictEqual(g.phrase, 'Use the left lane');
});

test('going straight through: only lanes marked straight qualify', () => {
  assert.strictEqual(guide(step('continue', 'straight', [['left', true], ['straight', false]])), null);
  const g = guide(step('continue', 'straight', [['left', false], ['straight', true], ['straight;right', true]]));
  assert.strictEqual(g.phrase, 'Use the 2 right lanes');
});

// --- Real routes (tests/fixtures/gainesville-steps.json, saved from OSRM) ---

const real = require('./fixtures/gainesville-steps.json').steps;
const at = (name, type) => real.find(s => s.name === name && s.maneuver.type === type);

test('real: right onto SW 34th St from four lanes uses the right lane', () => {
  assert.strictEqual(guide(at('Southwest 34th Street', 'turn')).phrase, 'Use the right lane');
});

test('real: left onto NW 62nd St uses the left lane', () => {
  assert.strictEqual(guide(at('Northwest 62nd Street', 'turn')).phrase, 'Use the left lane');
});

test('real: left onto University Ave with an unmarked second lane uses the left lane', () => {
  assert.strictEqual(guide(at('West University Avenue', 'turn')).phrase, 'Use the left lane');
});

test('real: left onto NW 16th Blvd recommends a straight/right lane, so no advice', () => {
  assert.strictEqual(guide(at('Northwest 16th Boulevard', 'turn')), null);
});

test('real: continuing straight onto NW 34th St with left-marked lanes recommended, so no advice', () => {
  assert.strictEqual(guide(at('Northwest 34th Street', 'new name')), null);
});

test('real: every step without lane data gets no advice', () => {
  real.filter(s => !s.intersections[0].lanes).forEach(s => assert.strictEqual(guide(s), null, s.name));
});
