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
    var t0 = Date.now();
    row('gps', 'GPS', 'waiting for a fix… (works best outside)');
    navigator.geolocation.getCurrentPosition(function (p) {
      var secs = Math.round((Date.now() - t0) / 1000);
      var acc = Math.round(p.coords.accuracy);
      row('gps', 'GPS', '±' + acc + ' m after ' + secs + ' s', true);
      note('gps', acc + 'm/' + secs + 's');
    }, function (err) {
      row('gps', 'GPS', 'error ' + err.code + ': ' + err.message, false);
      note('gps', 'err' + err.code);
    }, { enableHighAccuracy: true, timeout: 120000, maximumAge: 0 });
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
