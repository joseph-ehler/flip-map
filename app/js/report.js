// Drive report: what the phone actually did during a trip, for judging it on real hardware.
// GPS rhythm and accuracy spread, what kept working with the screen off (flip closed), frame pacing
// (sampled briefly, so it costs little), key response, voice prompts, reroutes, battery. It reports
// and doesn't judge: we don't yet know what "good" is on this phone. Kept between launches so a
// passenger can read it back afterwards (More > Drive Report).
(function (FM) {
  'use strict';

  var KEY = 'flipmap.report';
  var SAMPLE_EVERY_MS = 30000; // how often to watch the frame rate
  var SAMPLE_MS = 3000; // for how long
  var SLOW_FRAME_MS = 50; // slower than this is a visible hitch
  var SAVE_EVERY = 10; // fixes between saves
  var POOR_FIX_M = 20; // a fix this vague can't reliably tell neighboring roads apart

  var r = load();
  var lastFixAt = 0;
  var timer = null;
  var sampling = false;

  function start(dest) {
    r = {
      dest: dest.name, started: Date.now(), ended: 0,
      fixes: 0, gapSum: 0, gapMax: 0, accSum: 0, accMax: 0, accPoor: 0,
      hiddenMs: 0, hiddenSince: document.hidden ? Date.now() : 0, hiddenFixes: 0, hiddenSpoken: 0,
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
    if (r.hiddenSince) r.hiddenMs += r.ended - r.hiddenSince;
    r.hiddenSince = 0;
    readBattery(function (b) { r.battery1 = b; save(); });
    save();
  }

  function active() {
    return !!(r && !r.ended);
  }

  // The app opened with no trip to resume (it ended while closed, or is too old to pick up): the trip
  // stopped when its last fix arrived.
  function abandon() {
    if (!active()) return;
    clearInterval(timer);
    r.ended = r.lastFixAt || r.started;
    if (r.hiddenSince) r.hiddenMs += Math.max(0, r.ended - r.hiddenSince);
    r.hiddenSince = 0;
    save();
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
    r.lastFixAt = now;
    r.fixes++;
    r.accSum += f.accuracy || 0;
    r.accMax = Math.max(r.accMax || 0, f.accuracy || 0);
    if (f.accuracy > POOR_FIX_M) r.accPoor++;
    if (document.hidden) r.hiddenFixes++;
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

  // ok: the speech engine says it finished. Whether anyone heard it is for the passenger to say.
  function spoke(ok) {
    if (!active()) return;
    if (ok) r.spoken++;
    else r.voiceErrors++;
    if (ok && document.hidden) r.hiddenSpoken++;
  }

  // Screen off (flip closed, or another app in front): does GPS keep arriving, does the voice go on?
  document.addEventListener('visibilitychange', function () {
    if (!active()) return;
    if (document.hidden) {
      r.hiddenSince = Date.now();
    } else if (r.hiddenSince) {
      r.hiddenMs += Date.now() - r.hiddenSince;
      r.hiddenSince = 0;
    }
    save();
  });

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

  // { title, groups: [[[label, value], ...], ...] } for the report sheet.
  function rows(cb) {
    if (!r) return cb(null);
    readBattery(function (now) {
      var end = r.ended || Date.now();
      var mins = (end - r.started) / 60000;
      var every = r.fixes > 1 ? r.gapSum / (r.fixes - 1) / 1000 : 0;
      var keyAvg = r.keys ? r.keySum / r.keys : 0;
      var bEnd = r.ended ? r.battery1 : now;
      var used = r.battery0 !== null && bEnd !== null ? r.battery0 - bEnd : null;
      var hiddenMs = (r.hiddenMs || 0) + (r.hiddenSince ? end - r.hiddenSince : 0);
      var pct = function (n, of) { return of ? Math.round(n / of * 100) + '%' : '–'; };

      var screenOff = hiddenMs < 1000
        ? [['Screen off', 'never during this trip']]
        : [
          ['Screen off', fmtMins(hiddenMs / 60000)],
          ['GPS fixes while off', String(r.hiddenFixes || 0)],
          ['Prompts finished while off', String(r.hiddenSpoken || 0)]
        ];

      cb({
        title: r.dest + (r.ended ? '' : ' (driving)'),
        groups: [
          [
            ['Trip', fmtMins(mins)],
            ['Reroutes', String(r.reroutes)]
          ],
          [
            ['GPS fixes', r.fixes + (every ? ', one every ' + every.toFixed(1) + ' s' : '')],
            ['Longest gap', (r.gapMax / 1000).toFixed(1) + ' s'],
            ['Accuracy', r.fixes ? '±' + Math.round(r.accSum / r.fixes) + ' m avg, worst ±' + Math.round(r.accMax || 0) + ' m' : '–'],
            ['Fixes vaguer than ' + POOR_FIX_M + ' m', pct(r.accPoor || 0, r.fixes)]
          ],
          screenOff,
          [
            ['Slow frames (over 50 ms)', r.frames ? (r.slow / r.frames * 100).toFixed(1) + '% of ' + r.frames : 'not sampled yet'],
            ['Worst frame', r.frames ? Math.round(r.worst) + ' ms' : '–'],
            ['Key response', r.keys ? Math.round(keyAvg) + ' ms avg, slowest ' + Math.round(r.keyMax) : 'no keys pressed']
          ],
          [
            ['Prompts the phone played', String(r.spoken)],
            ['Prompts that failed', String(r.voiceErrors)],
            ['Heard them all?', 'ask your passenger']
          ],
          [
            ['Battery used', used === null ? 'not reported by phone' : used + '%' + (mins >= 5 ? ' (' + Math.round(used / mins * 60) + '% per hour)' : '')]
          ]
        ]
      });
    });
  }

  function fmtMins(m) {
    return m < 1 ? Math.max(1, Math.round(m * 60)) + ' s' : Math.round(m) + ' min';
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

  // Reopened mid-trip (a reload, or back from the phone check): keep sampling frames.
  if (active()) timer = setInterval(sample, SAMPLE_EVERY_MS);

  FM.report = {
    start: start,
    stop: stop,
    abandon: abandon,
    fix: fix,
    key: key,
    spoke: spoke,
    reroute: reroute,
    rows: rows
  };
})(window.FM = window.FM || {});
