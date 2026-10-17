// Runs in the page before any app script (Playwright's addInitScript). Stands in for what the tests
// control on the phone: GPS, speech and vibration, plus an optional faster clock so a long drive can
// replay quickly. Also counts what a leak would grow: timers, listeners, requests in flight, frames.
// Nothing here changes the app's code; it replaces browser features the app calls.
(function (cfg) {
  'use strict';

  var speedup = cfg.speedup || 1;
  var realNow = Date.now.bind(Date);
  var raw = {
    setTimeout: window.setTimeout.bind(window),
    clearTimeout: window.clearTimeout.bind(window),
    setInterval: window.setInterval.bind(window),
    clearInterval: window.clearInterval.bind(window),
    fetch: window.fetch.bind(window),
    raf: window.requestAnimationFrame.bind(window)
  };

  // --- Clock: page time runs `speedup` times faster (Date.now and timers). Frame timing stays real. ---

  var t0 = realNow();
  if (speedup !== 1) Date.now = function () { return Math.round(t0 + (realNow() - t0) * speedup); };

  var live = { timeouts: new Set(), intervals: new Set() };
  window.setTimeout = function (fn, ms) {
    var args = Array.prototype.slice.call(arguments, 2);
    var id = raw.setTimeout(function () {
      live.timeouts.delete(id);
      fn.apply(window, args);
    }, (ms || 0) / speedup);
    live.timeouts.add(id);
    return id;
  };
  window.setInterval = function (fn, ms) {
    var args = Array.prototype.slice.call(arguments, 2);
    var id = raw.setInterval(function () { fn.apply(window, args); }, (ms || 0) / speedup);
    live.intervals.add(id);
    return id;
  };
  window.clearTimeout = window.clearInterval = function (id) {
    live.timeouts.delete(id);
    live.intervals.delete(id);
    raw.clearTimeout(id);
  };

  // --- Listeners and requests in flight (trends, not exact counts) ---

  var listeners = 0;
  var add = EventTarget.prototype.addEventListener;
  var remove = EventTarget.prototype.removeEventListener;
  EventTarget.prototype.addEventListener = function () {
    listeners++;
    return add.apply(this, arguments);
  };
  EventTarget.prototype.removeEventListener = function () {
    listeners--;
    return remove.apply(this, arguments);
  };

  var inflight = 0;
  window.fetch = function () {
    inflight++;
    var p = raw.fetch.apply(window, arguments);
    var done = function () { inflight--; };
    p.then(done, done);
    return p;
  };

  // --- Speech: recorded, and "spoken" one at a time at about the pace of a real voice ---

  var spoken = [];
  var queue = [];
  var talking = false;
  var queueMax = 0;
  function pump() {
    if (talking || !queue.length) return;
    talking = true;
    var u = queue.shift();
    raw.setTimeout(function () {
      talking = false;
      if (u.onend) u.onend({});
      pump();
    }, (500 + 55 * String(u.text).length) / speedup);
  }
  if (window.speechSynthesis) {
    window.speechSynthesis.speak = function (u) {
      spoken.push({ text: u.text, at: Date.now() });
      queue.push(u);
      queueMax = Math.max(queueMax, queue.length + (talking ? 1 : 0));
      pump();
    };
    window.speechSynthesis.cancel = function () { queue = []; };
  }
  var vibrations = 0;
  navigator.vibrate = function () {
    vibrations++;
    return true;
  };

  // --- GPS: the test pushes fixes; every watcher gets each one, as on the phone ---

  var watchers = {};
  var nextWatch = 1;
  var last = null;
  var gets = [];
  var fixCost = { n: 0, sum: 0, max: 0 };
  function position(c) {
    return {
      coords: {
        latitude: c.lat, longitude: c.lon, accuracy: c.accuracy === undefined ? 8 : c.accuracy,
        altitude: null, altitudeAccuracy: null,
        heading: c.heading === undefined ? null : c.heading,
        speed: c.speed === undefined ? null : c.speed
      },
      timestamp: Date.now()
    };
  }
  var geolocation = {
    watchPosition: function (ok, err) {
      var id = nextWatch++;
      watchers[id] = { ok: ok, err: err };
      if (last) raw.setTimeout(function () { if (watchers[id]) ok(last); }, 0);
      return id;
    },
    clearWatch: function (id) {
      delete watchers[id];
    },
    getCurrentPosition: function (ok, err) {
      if (last) raw.setTimeout(function () { ok(last); }, 0);
      else gets.push({ ok: ok, err: err });
    }
  };
  Object.defineProperty(Navigator.prototype, 'geolocation', { get: function () { return geolocation; }, configurable: true });

  window.__gps = {
    push: function (c) {
      last = position(c);
      var t = performance.now();
      Object.keys(watchers).forEach(function (id) {
        try {
          watchers[id].ok(last);
        } catch (e) {
          raw.setTimeout(function () { throw e; }, 0);
        }
      });
      var ms = performance.now() - t;
      fixCost.n++;
      fixCost.sum += ms;
      fixCost.max = Math.max(fixCost.max, ms);
      gets.splice(0).forEach(function (g) { g.ok(last); });
      return ms;
    },
    error: function (code) {
      Object.keys(watchers).forEach(function (id) {
        if (watchers[id].err) watchers[id].err({ code: code, message: 'test error ' + code });
      });
    },
    watchers: function () {
      return Object.keys(watchers).length;
    }
  };

  // --- Frames: intervals between painted frames, while recording ---

  var frames = { on: false, n: 0, slow: 0, worst: 0, prev: 0 };
  function tick(now) {
    if (!frames.on) return;
    if (frames.prev) {
      var d = now - frames.prev;
      frames.n++;
      if (d > 50) frames.slow++;
      frames.worst = Math.max(frames.worst, d);
    }
    frames.prev = now;
    raw.raf(tick);
  }

  // Time from a key press to the second frame after it: when the result is on screen.
  function keyToFrame(fire) {
    return new Promise(function (resolve) {
      var t = performance.now();
      fire();
      var sync = performance.now() - t;
      raw.raf(function () {
        raw.raf(function () { resolve({ sync: sync, painted: performance.now() - t }); });
      });
    });
  }

  window.__probe = {
    spoken: spoken,
    speedup: speedup,
    keyToFrame: keyToFrame,
    recordFrames: function (on) {
      frames.on = on;
      frames.prev = 0;
      if (on) raw.raf(tick);
    },
    // Counters since the last take(), and current sizes.
    take: function () {
      var out = {
        fixes: fixCost.n,
        fixMsAvg: fixCost.n ? fixCost.sum / fixCost.n : 0,
        fixMsMax: fixCost.max,
        frames: frames.n,
        slowFrames: frames.slow,
        worstFrame: frames.worst
      };
      fixCost = { n: 0, sum: 0, max: 0 };
      frames.n = frames.slow = frames.worst = 0;
      return out;
    },
    sizes: function () {
      var storage = 0;
      try {
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          storage += k.length + (localStorage.getItem(k) || '').length;
        }
      } catch (e) {}
      // Sheet contents are rebuilt each time a sheet opens, so they're counted apart from the rest.
      var inSheets = document.querySelectorAll('.sheet *').length;
      return {
        nodes: document.getElementsByTagName('*').length - inSheets,
        sheetNodes: inSheets,
        tiles: document.querySelectorAll('#tiles > *').length,
        prevTiles: document.querySelectorAll('#tiles-prev > *').length,
        labels: document.querySelectorAll('#labels > *').length,
        routePathChars: (document.getElementById('route-line').getAttribute('d') || '').length,
        timeouts: live.timeouts.size,
        intervals: live.intervals.size,
        listeners: listeners,
        inflight: inflight,
        storageChars: storage,
        spoken: spoken.length,
        speechQueueMax: queueMax,
        vibrations: vibrations,
        watchers: Object.keys(watchers).length
      };
    }
  };
})(__CONFIG__);
