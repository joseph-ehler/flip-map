// One-screen report of what this phone's browser can do, for deciding what to build next.
// The blue summary line is short enough to read out or copy down.
(function () {
  'use strict';

  var results = document.getElementById('results');
  var summaryEl = document.getElementById('summary');
  var rows = {};
  var summary = {};
  var keysSeen = {};
  var keyLog = [];
  var tone = null;

  function row(id, label, value, good) {
    if (!rows[id]) {
      var dt = document.createElement('dt');
      dt.textContent = label;
      rows[id] = document.createElement('dd');
      results.appendChild(dt);
      results.appendChild(rows[id]);
    }
    rows[id].textContent = value;
    rows[id].className = good === true ? 'yes' : good === false ? 'no' : '';
  }

  function note(key, value) {
    summary[key] = value;
    summaryEl.textContent = Object.keys(summary).map(function (k) { return k + '=' + summary[k]; }).join(' ');
  }

  function yn(v) {
    return v ? 'yes' : 'no';
  }

  // --- Browser and screen ---

  var ua = navigator.userAgent;
  var gecko = (ua.match(/rv:([\d.]+)/) || ua.match(/Firefox\/([\d.]+)/) || [])[1] || '?';
  var standalone = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches;
  row('ua', 'Browser', ua);
  row('gecko', 'Gecko version', gecko);
  note('gecko', gecko);
  row('screen', 'Screen', window.innerWidth + '×' + window.innerHeight + ' at ' + window.devicePixelRatio + 'x');
  row('mode', 'Running as', (standalone ? 'app window' : 'browser tab') + ' · ' + location.origin);
  note('mode', standalone ? 'app' : 'tab');

  // --- Keys: which ones reach a web page? ---

  row('keys', 'Keys pressed (press every key once)', '—');
  document.addEventListener('keydown', function (e) {
    keyLog.unshift(e.key + ' (' + e.keyCode + ')');
    keyLog = keyLog.slice(0, 8);
    row('keys', 'Keys pressed (press every key once)', keyLog.join(', '));
    var short = {
      SoftLeft: 'SL', SoftRight: 'SR', Enter: 'OK', Backspace: 'Bk',
      ArrowUp: 'U', ArrowDown: 'D', ArrowLeft: 'L', ArrowRight: 'R', Call: 'Call'
    }[e.key];
    if (short) {
      keysSeen[short] = true;
      note('keys', Object.keys(keysSeen).join(''));
    }

    switch (e.key) {
      case 'ArrowDown': window.scrollBy(0, 60); break;
      case 'ArrowUp': window.scrollBy(0, -60); break;
      case '1': testGps(); break;
      case '2': testVoice(); break;
      case '3': testVibrate(); break;
      case '4': toggleTone(); break;
      case '5': testMap(); break;
      default: return;
    }
    e.preventDefault();
  });

  // --- Features the map app leans on ---

  var wake = [];
  if (navigator.wakeLock) wake.push('wakeLock');
  if (navigator.b2g && navigator.b2g.requestWakeLock) wake.push('b2g');
  if (navigator.requestWakeLock) wake.push('moz');
  row('wake', 'Keep screen on', wake.join(', ') || 'none', wake.length > 0);
  note('wake', wake.join('+') || 'no');

  row('sw', 'Offline support (service worker)', yn('serviceWorker' in navigator), 'serviceWorker' in navigator);
  note('sw', yn('serviceWorker' in navigator));
  row('vib', 'Vibrate', yn(!!navigator.vibrate), !!navigator.vibrate);

  var hasTts = !!(window.speechSynthesis && window.SpeechSynthesisUtterance);
  row('tts', 'Voice (speech synthesis)', hasTts ? 'present, checking voices…' : 'no', hasTts);
  note('tts', hasTts ? '?' : 'no');
  if (hasTts) {
    setTimeout(function () {
      var voices = window.speechSynthesis.getVoices();
      row('tts', 'Voice (speech synthesis)', voices.length + ' voices' +
        (voices.length ? ': ' + voices.slice(0, 3).map(function (v) { return v.name; }).join(', ') : ''), voices.length > 0);
      note('tts', voices.length);
    }, 1500);
  }

  // --- Apple Music: full songs on the web need Widevine DRM (outside Safari) ---

  var musicTypes = 'audio/mp4; codecs="mp4a.40.2"';
  var mse = !!(window.MediaSource && window.MediaSource.isTypeSupported(musicTypes));
  row('mse', 'Streaming AAC audio (MSE)', yn(mse), mse);
  note('mse', yn(mse));

  var drm = { widevine: 'com.widevine.alpha', playready: 'com.microsoft.playready', clearkey: 'org.w3.clearkey' };
  var drmDone = 0;
  var widevine = false;
  Object.keys(drm).forEach(function (name) {
    checkDrm(drm[name]).then(function (ok) {
      row('drm-' + name, 'DRM: ' + name, yn(ok), ok);
      note(name.slice(0, 2), yn(ok));
      if (name === 'widevine') widevine = ok;
      if (++drmDone === 3) {
        row('apple', 'Apple Music full songs in the browser',
          widevine && mse ? 'maybe — Widevine is here, worth trying MusicKit' : 'no — 30-second previews only',
          widevine && mse);
      }
    });
  });

  function checkDrm(system) {
    if (!navigator.requestMediaKeySystemAccess) return Promise.resolve(false);
    return navigator.requestMediaKeySystemAccess(system, [{
      initDataTypes: ['cenc'],
      audioCapabilities: [{ contentType: musicTypes }]
    }]).then(function () { return true; }, function () { return false; });
  }

  // --- Tests you trigger with a key ---

  function testGps() {
    if (!navigator.geolocation) {
      row('gps', 'GPS', 'not available', false);
      note('gps', 'none');
      return;
    }
    // First fix, then 15 s of updates: how often fixes arrive sets how smoothly the map can glide.
    var t0 = Date.now();
    var times = [];
    var first = '';
    row('gps', 'GPS', 'waiting for a fix… (works best outside)');
    var id = navigator.geolocation.watchPosition(function (p) {
      times.push(Date.now());
      lastFix = p.coords;
      if (times.length === 1) {
        var secs = Math.round((times[0] - t0) / 1000);
        first = '±' + Math.round(p.coords.accuracy) + ' m after ' + secs + ' s';
        note('gps', Math.round(p.coords.accuracy) + 'm/' + secs + 's');
        row('gps', 'GPS', first + ', timing updates…', true);
        setTimeout(function () {
          navigator.geolocation.clearWatch(id);
          var gaps = times.length > 1 ? (times[times.length - 1] - times[0]) / (times.length - 1) / 1000 : 0;
          row('gps', 'GPS', first + (gaps ? ', a fix every ' + gaps.toFixed(1) + ' s' : ', no further fixes in 15 s'), gaps > 0 && gaps <= 2);
          note('every', gaps ? gaps.toFixed(1) + 's' : 'none');
        }, 15000);
      }
    }, function (err) {
      navigator.geolocation.clearWatch(id);
      row('gps', 'GPS', 'error ' + err.code + ': ' + err.message, false);
      note('gps', 'err' + err.code);
    }, { enableHighAccuracy: true, timeout: 120000, maximumAge: 0 });
  }

  // --- Map speed: load and draw real map tiles here (around you, or downtown Gainesville), then turn
  // them for 2 s the way the app does while driving, counting frames. ---

  var lastFix = null;

  function testMap() {
    if (!window.FM || !FM.carto) {
      row('map', 'Map speed', 'map code did not load', false);
      return;
    }
    row('map', 'Map speed', 'loading map data…');
    waitFor(function () { return FM.carto.ready(); }, 10000).then(function (ready) {
      if (!ready) {
        row('map', 'Map speed', 'no map data (offline?)', false);
        note('draw', 'none');
        return;
      }
      var z = 16;
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var center = FM.geo.project(lastFix ? lastFix.latitude : 29.6516, lastFix ? lastFix.longitude : -82.3248, z);
      var tx0 = Math.floor(center.x / 256) - 1;
      var ty0 = Math.floor(center.y / 256) - 1;
      var box = document.createElement('div');
      box.style.cssText = 'position:fixed;left:0;top:0;right:0;bottom:0;overflow:hidden;z-index:9;background:#f3f1ec';
      var world = document.createElement('div');
      world.style.cssText = 'position:absolute;left:50%;top:50%;width:0;height:0';
      box.appendChild(world);
      document.body.appendChild(box);
      var tiles = [];
      for (var dy = 0; dy < 3; dy++) {
        for (var dx = 0; dx < 3; dx++) {
          var c = document.createElement('canvas');
          c.width = c.height = 256 * dpr;
          c.style.cssText = 'position:absolute;width:256px;height:256px;left:' + (dx * 256 - 384) + 'px;top:' + (dy * 256 - 384) + 'px';
          world.appendChild(c);
          tiles.push({ c: c, x: tx0 + dx, y: ty0 + dy });
        }
      }
      var drawAll = function () {
        return Promise.all(tiles.map(function (t) {
          return new Promise(function (res) { FM.carto.draw(t.c, z, t.x, t.y, res); });
        }));
      };
      var t0 = performance.now();
      drawAll().then(function () {
        var load = performance.now() - t0;
        var t1 = performance.now();
        return drawAll().then(function () {
          var draw = (performance.now() - t1) / tiles.length;
          return framePacing(world).then(function (f) {
            document.body.removeChild(box);
            var ms = draw < 10 ? draw.toFixed(1) : String(Math.round(draw));
            var loaded = load < 1000 ? Math.round(load) + ' ms' : (load / 1000).toFixed(1) + ' s';
            row('map', 'Map speed', ms + ' ms to draw a tile, ' + loaded + ' to load 9. While turning: ' +
              f.slow + '% of frames slow, worst ' + f.worst + ' ms', draw < 80 && f.slow < 5 && f.worst < 250);
            note('draw', ms + 'ms');
            note('slow', f.slow + '%');
            note('worst', f.worst + 'ms');
          });
        });
      });
    });
  }

  // Steadiness, not peak speed: the share of frames slower than 50 ms (a visible hitch) and the worst.
  function framePacing(el) {
    return new Promise(function (resolve) {
      var frames = 0;
      var slow = 0;
      var worst = 0;
      var start = performance.now();
      var prev = start;
      el.style.transition = 'transform 2s linear';
      requestAnimationFrame(function () { el.style.transform = 'rotate(90deg)'; });
      requestAnimationFrame(function tick(now) {
        var d = now - prev;
        prev = now;
        frames++;
        if (d > 50) slow++;
        worst = Math.max(worst, d);
        if (now - start < 2000) requestAnimationFrame(tick);
        else resolve({ slow: Math.round(slow / frames * 100), worst: Math.round(worst) });
      });
    });
  }

  function waitFor(test, ms) {
    return new Promise(function (resolve) {
      var start = Date.now();
      (function check() {
        if (test()) resolve(true);
        else if (Date.now() - start > ms) resolve(false);
        else setTimeout(check, 200);
      })();
    });
  }

  function testVoice() {
    if (!hasTts) {
      row('say', 'Voice test', 'no speech synthesis', false);
      return;
    }
    var u = new window.SpeechSynthesisUtterance('In 500 feet, turn right onto Main Street.');
    var answered = false;
    u.onend = function () {
      answered = true;
      row('say', 'Voice test', 'finished — did you hear it?', true);
    };
    u.onerror = function (e) {
      answered = true;
      row('say', 'Voice test', 'error: ' + e.error, false);
      note('say', 'err');
    };
    row('say', 'Voice test', 'speaking…');
    window.speechSynthesis.speak(u);
    setTimeout(function () {
      if (!answered) row('say', 'Voice test', 'no response from the speech engine', false);
    }, 8000);
  }

  function testVibrate() {
    var ok = !!(navigator.vibrate && navigator.vibrate([200, 100, 200]));
    row('vibtest', 'Vibrate test', ok ? 'sent — did it buzz?' : 'refused', ok);
  }

  // Half-second beeps on a loop. Close the phone while it plays to see if sound keeps going.
  function toggleTone() {
    if (tone) {
      tone.pause();
      tone = null;
      row('tone', 'Sound test', 'stopped');
      return;
    }
    tone = new Audio(beepUrl());
    tone.loop = true;
    tone.play().then(function () {
      row('tone', 'Sound test', 'beeping — close the phone: still beeping? Press 4 to stop', true);
    }, function (err) {
      row('tone', 'Sound test', 'could not play: ' + err.message, false);
      tone = null;
    });
  }

  function beepUrl() {
    var rate = 8000;
    var n = rate; // 1 second: 0.5 s of 440 Hz, 0.5 s of silence
    var buf = new ArrayBuffer(44 + n);
    var v = new DataView(buf);
    function text(at, s) {
      for (var i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i));
    }
    text(0, 'RIFF');
    v.setUint32(4, 36 + n, true);
    text(8, 'WAVE');
    text(12, 'fmt ');
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true); // PCM
    v.setUint16(22, 1, true); // mono
    v.setUint32(24, rate, true);
    v.setUint32(28, rate, true);
    v.setUint16(32, 1, true);
    v.setUint16(34, 8, true); // 8-bit
    text(36, 'data');
    v.setUint32(40, n, true);
    for (var i = 0; i < n; i++) {
      var on = i < rate / 2;
      v.setUint8(44 + i, 128 + (on ? Math.round(50 * Math.sin(2 * Math.PI * 440 * i / rate)) : 0));
    }
    return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  }

  testGps();
})();
