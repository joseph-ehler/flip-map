// Drive report: what the phone actually did during a trip, for judging it on real hardware.
// GPS rhythm, frame pacing (sampled briefly, so it costs little), key response, spoken prompts,
// reroutes, battery. Kept between launches so a passenger can read it back afterwards
// (More > Drive Report).
(function (FM) {
  'use strict';

  var KEY = 'flipmap.report';
  var SAMPLE_EVERY_MS = 30000; // how often to watch the frame rate
  var SAMPLE_MS = 3000; // for how long
  var SLOW_FRAME_MS = 50; // slower than this is a visible hitch
  var SAVE_EVERY = 10; // fixes between saves

  var r = load();
  var lastFixAt = 0;
  var timer = null;
  var sampling = false;

  function start(dest) {
    r = {
      dest: dest.name, started: Date.now(), ended: 0,
      fixes: 0, gapSum: 0, gapMax: 0, accSum: 0,
      frames: 0, slow: 0, worst: 0,
      keys: 0, keySum: 0, keyMax: 0,
      spoken: 0, voiceErrors: 0, reroutes: 0,
      battery0: null, battery1: null
    };
    lastFixAt = 0;
    readBattery(function (b) { r.battery0 = b; save(); });
    clearInterval(timer);
    timer = setInterval(sample, SAMPLE_EVERY_MS);
    setTimeout(sample, 5000);
    save();
  }

  function stop() {
    if (!r || r.ended) return;
    clearInterval(timer);
    r.ended = Date.now();
    readBattery(function (b) { r.battery1 = b; save(); });
    save();
  }

  function active() {
    return !!(r && !r.ended);
  }

  function fix(f) {
    if (!active()) return;
    var now = Date.now();
    if (lastFixAt) {
      var gap = now - lastFixAt;
      r.gapSum += gap;
      r.gapMax = Math.max(r.gapMax, gap);
    }
    lastFixAt = now;
    r.fixes++;
    r.accSum += f.accuracy || 0;
    if (r.fixes % SAVE_EVERY === 0) save();
  }

  // Time from a key press to the next painted frame (two animation frames later).
  function key() {
    if (!active() || !window.requestAnimationFrame) return;
    var t0 = performance.now();
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        var ms = performance.now() - t0;
        r.keys++;
        r.keySum += ms;
        r.keyMax = Math.max(r.keyMax, ms);
      });
    });
  }

  function sample() {
    if (!active() || sampling || document.hidden || !window.requestAnimationFrame) return;
    sampling = true;
    var start = performance.now();
    var prev = start;
    (function tick(now) {
      if (now) {
        var d = now - prev;
        prev = now;
        r.frames++;
        if (d > SLOW_FRAME_MS) r.slow++;
        r.worst = Math.max(r.worst, d);
      }
      if (performance.now() - start < SAMPLE_MS) requestAnimationFrame(tick);
      else sampling = false;
    })();
  }

  function spoke(ok) {
    if (!active()) return;
    if (ok) r.spoken++;
    else r.voiceErrors++;
  }

  function reroute() {
    if (active()) r.reroutes++;
  }

  // Battery as a percentage, where this browser still says (many no longer do).
  function readBattery(done) {
    try {
      var b = navigator.battery || navigator.mozBattery;
      if (b && typeof b.level === 'number') return done(Math.round(b.level * 100));
      if (navigator.getBattery) {
        return navigator.getBattery().then(function (x) { done(Math.round(x.level * 100)); }, function () { done(null); });
      }
    } catch (e) {}
    done(null);
  }

  // [label, value, good?] rows for the report sheet; good is true, false, or null (no judgment).
  function rows(cb) {
    if (!r) return cb(null);
    readBattery(function (now) {
      var end = r.ended || Date.now();
      var mins = (end - r.started) / 60000;
      var every = r.fixes > 1 ? r.gapSum / (r.fixes - 1) / 1000 : 0;
      var slowPct = r.frames ? r.slow / r.frames * 100 : 0;
      var keyAvg = r.keys ? r.keySum / r.keys : 0;
      var bEnd = r.ended ? r.battery1 : now;
      var used = r.battery0 !== null && bEnd !== null ? r.battery0 - bEnd : null;
      cb({
        title: r.dest + (r.ended ? '' : ' (driving)'),
        groups: [
          [
            ['Trip', Math.max(1, Math.round(mins)) + ' min', null],
            ['Reroutes', String(r.reroutes), null]
          ],
          [
            ['GPS fixes', r.fixes + (every ? ', one every ' + every.toFixed(1) + ' s' : ''), every ? every <= 2 : null],
            ['Longest gap', (r.gapMax / 1000).toFixed(1) + ' s', r.fixes > 1 ? r.gapMax <= 5000 : null],
            ['Accuracy', r.fixes ? '±' + Math.round(r.accSum / r.fixes) + ' m average' : '–', r.fixes ? r.accSum / r.fixes <= 25 : null]
          ],
          [
            ['Slow frames', r.frames ? slowPct.toFixed(1) + '% of ' + r.frames : 'not sampled yet', r.frames ? slowPct < 5 : null],
            ['Worst frame', r.frames ? Math.round(r.worst) + ' ms' : '–', r.frames ? r.worst < 250 : null],
            ['Key response', r.keys ? Math.round(keyAvg) + ' ms (slowest ' + Math.round(r.keyMax) + ')' : 'no keys pressed', r.keys ? keyAvg < 120 : null]
          ],
          [
            ['Spoken prompts', r.spoken + (r.voiceErrors ? ', ' + r.voiceErrors + ' failed' : ''), r.spoken + r.voiceErrors ? !r.voiceErrors : null],
            ['Battery used', used === null ? 'not reported by phone' : used + '% (' + (mins >= 5 ? Math.round(used / mins * 60) + '%/hour' : 'short trip') + ')', null]
          ]
        ]
      });
    });
  }

  function load() {
    try {
      return JSON.parse(localStorage.getItem(KEY));
    } catch (e) {
      return null;
    }
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(r));
    } catch (e) {}
  }

  FM.report = {
    start: start,
    stop: stop,
    fix: fix,
    key: key,
    spoke: spoke,
    reroute: reroute,
    rows: rows
  };
})(window.FM = window.FM || {});
