// A second-by-second GPS track for driving a routing answer (OSRM), for replaying long drives: each
// stretch at its own pace, slowing for turns, some stops at lights, receiver error that drifts the way
// real GPS does, and scripted trouble (stray fixes, gaps with no signal, a wrong turn). Seeded, so the
// same options always give the same drive.
'use strict';

const { meters, bearing } = require('./network');

function rng(seed) {
  let s = seed >>> 0 || 1;
  return function () {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// Speed to slow to for a maneuver, in m/s (null: no need to slow).
function slowFor(m) {
  const mod = m.modifier || '';
  switch (m.type) {
    case 'turn': case 'end of road': return /straight/.test(mod) ? null : /slight/.test(mod) ? 13 : 7;
    case 'roundabout': case 'rotary': case 'exit roundabout': case 'exit rotary': return 6;
    case 'on ramp': case 'off ramp': return 16;
    case 'fork': return 18;
    case 'continue': return /left|right/.test(mod) && !/slight/.test(mod) ? 8 : null;
    default: return null;
  }
}

// opts: { seed, outliers: [second], gaps: [[second, length]], detour: [second, length],
//         canyonLastM: meters of poor GPS before the end, stopChance }
function track(route, opts) {
  opts = opts || {};
  const rand = rng(opts.seed || 11);
  const gauss = () => Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * rand());

  // The line, each stretch's pace, and where to slow down.
  const pts = [];
  const pace = [];
  const turns = [];
  route.legs[0].steps.forEach(st => {
    const v = clamp(st.duration > 0 ? st.distance / st.duration : 10, 5, 34);
    const slow = slowFor(st.maneuver);
    st.geometry.coordinates.forEach((c, j) => {
      if (j === 0 && pts.length) {
        if (slow !== null) turns.push({ at: pts.length - 1, slow, stop: st.maneuver.type === 'turn' && v < 18 });
        return;
      }
      pts.push([c[1], c[0]]);
      pace.push(v);
    });
  });
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + meters(pts[i - 1], pts[i]));
  const total = cum[cum.length - 1];
  turns.forEach(t => { t.cum = cum[t.at]; });

  function at(s) {
    let lo = 0;
    let hi = cum.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (cum[mid] <= s) lo = mid;
      else hi = mid - 1;
    }
    const i = Math.min(lo, pts.length - 2);
    const f = cum[i + 1] > cum[i] ? clamp((s - cum[i]) / (cum[i + 1] - cum[i]), 0, 1) : 0;
    return {
      p: [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f],
      heading: bearing(pts[i], pts[i + 1]),
      pace: pace[i]
    };
  }

  function offset(p, east, north) {
    return [p[0] + north / 111320, p[1] + east / (111320 * Math.cos(p[0] * Math.PI / 180))];
  }

  const outliers = new Set(opts.outliers || []);
  const gaps = opts.gaps || [];
  const detour = opts.detour || null;
  const canyonFrom = total - (opts.canyonLastM || 0);
  const fixes = [];
  const events = [];
  let s = 0;
  let v = 0;
  let stopLeft = 0;
  let nextTurn = 0;
  let dx = 0;
  let dy = 0;
  let detourAt = null;

  for (let t = 0; s < total || t < 3; t++) {
    // Move.
    if (detour && t === detour[0]) detourAt = { s, at: at(s) };
    const inDetour = detour && t >= detour[0] && t < detour[0] + detour[1];
    if (!inDetour) {
      while (nextTurn < turns.length && turns[nextTurn].cum < s - 1) nextTurn++;
      let target = at(s).pace;
      for (let k = nextTurn; k < turns.length && turns[k].cum - s < 400; k++) {
        const d = Math.max(0, turns[k].cum - s);
        target = Math.min(target, Math.sqrt(turns[k].slow * turns[k].slow + 2 * 2.0 * d));
      }
      const tn = turns[nextTurn];
      const atLight = tn && tn.stop && !tn.rolled && tn.cum - s <= Math.max(v, 3);
      if (atLight) tn.rolled = true;
      if (stopLeft > 0) {
        stopLeft--;
        v = 0;
      } else if (atLight && rand() < (opts.stopChance === undefined ? 0.35 : opts.stopChance)) {
        stopLeft = 8 + Math.floor(rand() * 32);
        v = 0;
        s = Math.max(s, tn.cum - 3); // at the stop line
        events.push({ t, what: 'stop', secs: stopLeft });
      } else {
        v = v < target ? Math.min(target, v + 2.0) : Math.max(target, v - 2.5);
        s = Math.min(total, s + v);
      }
    }

    // Where the receiver says we are.
    const canyon = s >= canyonFrom;
    const sd = canyon ? 12 : 3.5;
    const phi = 0.95;
    dx = phi * dx + Math.sqrt(1 - phi * phi) * sd * gauss();
    dy = phi * dy + Math.sqrt(1 - phi * phi) * sd * gauss();
    const w = canyon ? 5 : 1.5;
    let here = at(s);
    let p = here.p;
    let heading = here.heading;
    let speed = v;
    if (inDetour) {
      const k = t - detour[0];
      const half = detour[1] / 2;
      const out = 11 * (k < half ? k : detour[1] - k);
      heading = (detourAt.at.heading + (k < half ? 90 : 270)) % 360;
      p = offset(detourAt.at.p, out * Math.sin((detourAt.at.heading + 90) * Math.PI / 180), out * Math.cos((detourAt.at.heading + 90) * Math.PI / 180));
      speed = 11;
    }
    const fix = {
      lat: 0, lon: 0,
      accuracy: Math.round(canyon ? 18 + rand() * 22 : 4 + sd + Math.abs(gauss()) * 2),
      speed: speed < 0.5 ? 0 : Math.max(0, speed + gauss() * 0.3),
      heading: speed < 0.5 ? null : (heading + gauss() * 3 + 360) % 360
    };
    let q = offset(p, dx + w * gauss(), dy + w * gauss());
    if (outliers.has(t)) {
      q = offset(p, 180 * Math.sin((heading + 90) * Math.PI / 180), 180 * Math.cos((heading + 90) * Math.PI / 180));
      fix.accuracy = 15;
      events.push({ t, what: 'stray fix' });
    }
    fix.lat = q[0];
    fix.lon = q[1];
    const gap = gaps.find(g => t >= g[0] && t < g[0] + g[1]);
    if (gap && t === gap[0]) events.push({ t, what: 'no signal', secs: gap[1] });
    if (inDetour && t === detour[0]) events.push({ t, what: 'wrong turn', secs: detour[1] });
    fixes.push(gap ? null : fix);
  }
  return { fixes, total, events };
}

module.exports = { track };
