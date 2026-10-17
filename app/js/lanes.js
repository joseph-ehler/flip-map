// Lane guidance from OpenStreetMap's turn lanes, as OSRM passes them along with each maneuver.
// A lane recommendation can make someone change lanes, so this stays silent unless the data clearly
// agrees with the turn: right junction, complete lanes, every recommended lane allows the turn, and
// some lanes don't (or there's nothing to say). Tested on its own in tests/lanes.test.js.
(function (FM) {
  'use strict';

  // Does a lane marked `ind` allow a maneuver with this OSRM modifier?
  function fits(ind, mod) {
    if (ind === 'none') return true; // unmarked lane: OSRM judged it usable
    if (mod === 'uturn') return ind === 'uturn' || ind.indexOf('left') >= 0;
    if (mod.indexOf('left') >= 0) return ind.indexOf('left') >= 0;
    if (mod.indexOf('right') >= 0) return ind.indexOf('right') >= 0;
    return ind === 'straight';
  }

  // step: an OSRM route step. Uses only the lanes at the maneuver's own junction (the step's first
  // intersection), never lanes from earlier intersections, where the lane count may differ.
  function guide(step) {
    var m = step && step.maneuver;
    var junction = step && step.intersections && step.intersections[0];
    var lanes = junction && junction.lanes;
    if (!m || !lanes || lanes.length < 2) return null;
    if (m.type === 'roundabout' || m.type === 'rotary' || m.type === 'arrive' || m.type === 'depart') return null;

    var mod = m.modifier || 'straight';
    var clean = [];
    var valid = [];
    for (var i = 0; i < lanes.length; i++) {
      var l = lanes[i];
      if (!l || typeof l.valid !== 'boolean') return null; // incomplete data
      var ind = l.indications && l.indications.length ? l.indications : ['none'];
      if (l.valid) {
        // OSRM recommends a lane whose markings don't allow this turn: the data disagrees with itself.
        if (!ind.some(function (x) { return fits(x, mod); })) return null;
        valid.push(i);
      }
      clean.push({ indications: ind, valid: l.valid });
    }
    if (!valid.length || valid.length === lanes.length) return null; // no lane works, or any lane does

    var words = describe(valid, lanes.length);
    return { lanes: clean, modifier: mod, phrase: words.spoken, label: words.short };
  }

  // Lanes by position, never "you're in the wrong lane": phone GPS can't tell which lane you're in.
  function describe(valid, n) {
    var k = valid.length;
    var first = valid[0];
    var last = valid[k - 1];
    if (last - first + 1 !== k) return { spoken: 'Use the highlighted lanes', short: 'Highlighted lanes' };
    var side = first === 0 ? 'left' : last === n - 1 ? 'right' : 'center';
    if (k === 1) return { spoken: 'Use the ' + side + ' lane', short: cap(side) + ' lane' };
    return { spoken: 'Use the ' + k + ' ' + side + ' lanes', short: k + ' ' + side + ' lanes' };
  }

  function cap(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  FM.lanes = { guide: guide, fits: fits };
})(window.FM = window.FM || {});
