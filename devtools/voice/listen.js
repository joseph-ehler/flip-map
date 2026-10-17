// The blind listening test. Clips come from /manifest.json (serve.js builds it from samples/). Every
// phrase is played once in every voice, all shuffled together, with the voices unnamed until the end.
// For each clip: time from the clip's start to "Got it", which maneuver it was, and two 1-5 ratings.
// Sessions are kept in this browser (localStorage) and can be downloaded as JSON.
(function () {
  'use strict';

  var QUICK = ['02-early-right', '05-now-left', '07-exit-now', '08-fork-lanes', '09-merge', '10-roundabout', '13-lane', '18-arrive-soon'];
  var STORE = 'flipmap.voicetest.sessions';
  var MISS_MS = 4000; // after a clip ends, how long "Got it" waits before it counts as not understood
  var LEAD_S = 0.06;
  var THROUGH = { headphones: 'Headphones', laptop: 'Laptop speakers', phone: 'Phone speaker', car: 'Car' };

  var $ = function (id) { return document.getElementById(id); };
  var data = null;
  var ctx = null;
  var buffers = {};
  var out = null;
  var noise = null;
  var current = null;
  var session = null;
  var trial = null;

  // --- Small helpers ---

  function show(id) {
    ['start', 'trial', 'results', 'browse'].forEach(function (s) { $(s).hidden = s !== id; });
    window.scrollTo(0, 0);
  }

  function pick(el, onChange) {
    el.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b || !el.contains(b)) return;
      Array.prototype.forEach.call(el.children, function (c) { c.classList.toggle('on', c === b); });
      if (onChange) onChange(b.getAttribute('data-v'));
    });
  }

  function picked(id) {
    var on = $(id).querySelector('.on');
    return on ? on.getAttribute('data-v') : null;
  }

  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  // No phrase twice in a row, where it can be helped.
  function spread(pairs) {
    for (var i = 1; i < pairs.length; i++) {
      if (pairs[i].phraseId !== pairs[i - 1].phraseId) continue;
      for (var j = i + 1; j < pairs.length; j++) {
        if (pairs[j].phraseId !== pairs[i - 1].phraseId) {
          var t = pairs[i]; pairs[i] = pairs[j]; pairs[j] = t;
          break;
        }
      }
    }
    return pairs;
  }

  function phrase(id) {
    return data.phrases.filter(function (p) { return p.id === id; })[0];
  }

  function voice(id) {
    return data.voices.filter(function (v) { return v.id === id; })[0];
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function download(name, obj) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 1)], { type: 'application/json' }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function loadSessions() {
    try {
      return JSON.parse(localStorage.getItem(STORE)) || [];
    } catch (e) {
      return [];
    }
  }

  function saveSessions(list) {
    try {
      localStorage.setItem(STORE, JSON.stringify(list));
    } catch (e) {}
  }

  // --- Sound: speech through an optional small-speaker filter, with optional road noise ---

  function audio() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function route(sim) {
    out = ctx.destination;
    if (sim.speaker) {
      // A tiny phone speaker: nothing below ~400 Hz or above ~3.6 kHz, a midrange bump, squeezed.
      var hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 400; hp.Q.value = 0.7;
      var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3600; lp.Q.value = 0.7;
      var mid = ctx.createBiquadFilter(); mid.type = 'peaking'; mid.frequency.value = 1800; mid.Q.value = 1; mid.gain.value = 4;
      var squeeze = ctx.createDynamicsCompressor(); squeeze.threshold.value = -24; squeeze.ratio.value = 4;
      hp.connect(lp); lp.connect(mid); mid.connect(squeeze); squeeze.connect(ctx.destination);
      out = hp;
    }
    if (sim.noise) noise = roadNoise();
  }

  // Low rumble about 9 dB under the speech (clips are at -16 LUFS).
  function roadNoise() {
    var n = ctx.sampleRate * 4;
    var buf = ctx.createBuffer(1, n, ctx.sampleRate);
    var d = buf.getChannelData(0);
    var last = 0;
    var sum = 0;
    for (var i = 0; i < n; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last;
      sum += last * last;
    }
    var scale = 0.04 / Math.sqrt(sum / n);
    for (i = 0; i < n; i++) d[i] *= scale;
    var src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700;
    src.connect(lp);
    lp.connect(ctx.destination);
    src.start();
    return src;
  }

  function quiet() {
    if (current) {
      try { current.stop(); } catch (e) {}
      current = null;
    }
  }

  function endSound() {
    quiet();
    if (noise) {
      try { noise.stop(); } catch (e) {}
      noise = null;
    }
  }

  function load(url) {
    if (buffers[url]) return Promise.resolve(buffers[url]);
    return fetch(url).then(function (r) { return r.arrayBuffer(); }).then(function (b) {
      return new Promise(function (resolve, reject) { ctx.decodeAudioData(b, resolve, reject); });
    }).then(function (buf) {
      buffers[url] = buf;
      return buf;
    });
  }

  // Starts a clip; returns when it will be heard (performance.now() time) and calls onEnded after.
  function play(url, onEnded) {
    quiet();
    var src = ctx.createBufferSource();
    src.buffer = buffers[url];
    src.connect(out || ctx.destination);
    src.start(ctx.currentTime + LEAD_S);
    current = src;
    src.onended = function () {
      if (current === src) current = null;
      if (onEnded) onEnded();
    };
    return performance.now() + (LEAD_S + (ctx.outputLatency || ctx.baseLatency || 0)) * 1000;
  }

  // --- Start screen ---

  function describeVoices() {
    var by = {};
    data.voices.forEach(function (v) { by[v.provider] = (by[v.provider] || 0) + 1; });
    var parts = Object.keys(by).map(function (p) { return p + (by[p] > 1 ? ' ×' + by[p] : ''); });
    var missing = ['openai', 'elevenlabs', 'google'].filter(function (p) { return !by[p]; });
    $('voices-note').textContent = data.voices.length + ' voice' + (data.voices.length === 1 ? '' : 's') + ' ready: ' + parts.join(', ') + '.' +
      (missing.length ? ' Not rendered yet: ' + missing.join(', ') + ' (add keys to keys.local, then run node generate.js).' : '');
    $('begin').disabled = data.voices.length < 2;
  }

  function stats(trials) {
    var rows = {};
    trials.forEach(function (t) {
      var r = rows[t.voiceId] || (rows[t.voiceId] = { voiceId: t.voiceId, n: 0, right: 0, times: [], clear: 0, natural: 0 });
      r.n++;
      if (t.correct) {
        r.right++;
        if (t.msToGotIt !== null) r.times.push(t.msToGotIt);
      }
      r.clear += t.clarity;
      r.natural += t.natural;
    });
    return Object.keys(rows).map(function (k) {
      var r = rows[k];
      var s = r.times.slice().sort(function (a, b) { return a - b; });
      return {
        voiceId: r.voiceId, n: r.n,
        understood: r.right / r.n,
        median: s.length ? s[Math.floor(s.length / 2)] : null,
        clear: r.clear / r.n,
        natural: r.natural / r.n
      };
    }).sort(function (a, b) {
      return b.understood - a.understood || b.clear - a.clear || (a.median || 1e9) - (b.median || 1e9);
    });
  }

  function table(target, rows, info, extraHead, extraCell) {
    var t = $(target);
    t.innerHTML = '';
    var head = el('thead');
    var hr = el('tr');
    ['Voice', 'Understood', 'Time', 'Clear', 'Natural'].concat(extraHead || []).forEach(function (h, i) {
      hr.appendChild(el('th', i ? 'num' : '', h));
    });
    head.appendChild(hr);
    t.appendChild(head);
    var body = el('tbody');
    rows.forEach(function (r, i) {
      var v = info(r.voiceId);
      var tr = el('tr', i === 0 && rows.length > 1 ? 'best' : '');
      var name = el('td');
      name.appendChild(document.createTextNode(v ? v.label : r.voiceId));
      if (v) name.appendChild(el('small', '', [v.model, v.voice].filter(Boolean).join(' · ')));
      tr.appendChild(name);
      tr.appendChild(el('td', 'num', Math.round(r.understood * 100) + '%'));
      tr.appendChild(el('td', 'num', r.median === null ? '–' : (r.median / 1000).toFixed(2) + ' s'));
      tr.appendChild(el('td', 'num', r.clear.toFixed(1)));
      tr.appendChild(el('td', 'num', r.natural.toFixed(1)));
      if (extraCell) extraCell(tr, r, v);
      body.appendChild(tr);
    });
    t.appendChild(body);
  }

  function renderHistory() {
    var list = loadSessions();
    $('history').hidden = !list.length;
    if (!list.length) return;
    var all = [];
    var known = {};
    var conds = {};
    list.forEach(function (s) {
      all = all.concat(s.trials);
      s.voices.forEach(function (v) { known[v.id] = v; });
      var c = THROUGH[s.through] + (s.simulate.speaker ? ' + speaker filter' : '') + (s.simulate.noise ? ' + road noise' : '');
      conds[c] = (conds[c] || 0) + 1;
    });
    $('history-sum').textContent = list.length + ' session' + (list.length === 1 ? '' : 's') + ', ' + all.length + ' clips: ' +
      Object.keys(conds).map(function (c) { return c + (conds[c] > 1 ? ' ×' + conds[c] : ''); }).join('; ') + '.';
    table('history-table', stats(all), function (id) { return known[id]; }, ['Clips'], function (tr, r) {
      tr.appendChild(el('td', 'num', String(r.n)));
    });
  }

  // --- A session ---

  function begin() {
    audio();
    var ids = picked('length') === 'quick'
      ? QUICK.filter(function (id) { return phrase(id); })
      : data.phrases.map(function (p) { return p.id; });
    var voices = data.voices.filter(function (v) { return ids.every(function (id) { return v.files[id]; }); });
    var order = [];
    ids.forEach(function (pid) { voices.forEach(function (v) { order.push({ phraseId: pid, voiceId: v.id }); }); });
    spread(shuffle(order));
    session = {
      id: Date.now().toString(36),
      startedAt: new Date().toISOString(),
      listener: $('listener').value.trim(),
      through: picked('through'),
      simulate: { speaker: $('sim-speaker').checked, noise: $('sim-noise').checked },
      length: picked('length'),
      voices: voices.map(function (v) { return { id: v.id, label: v.label, provider: v.provider, model: v.model, voice: v.voice, opusKB: v.opusKB }; }),
      order: order,
      trials: []
    };
    $('begin').disabled = true;
    var done = 0;
    var urls = order.map(function (p) { return voice(p.voiceId).files[p.phraseId]; });
    $('voices-note').textContent = 'Loading clips…';
    Promise.all(urls.map(function (u) {
      return load(u).then(function () { $('voices-note').textContent = 'Loading clips… ' + (++done) + ' of ' + urls.length; });
    })).then(function () {
      describeVoices();
      route(session.simulate);
      show('trial');
      next(0);
    }, function (e) {
      $('voices-note').textContent = 'Couldn\'t load the clips: ' + e.message;
      $('begin').disabled = false;
    });
  }

  function next(i) {
    var pair = session.order[i];
    var p = phrase(pair.phraseId);
    var url = voice(pair.voiceId).files[pair.phraseId];
    trial = {
      index: i, phraseId: pair.phraseId, voiceId: pair.voiceId,
      exposure: session.trials.filter(function (t) { return t.phraseId === pair.phraseId; }).length,
      msToGotIt: null, missed: false, choice: null, correct: null, clarity: null, natural: null, replays: 0,
      url: url, startPerf: 0, timer: null, listening: false
    };
    $('t-count').textContent = 'Clip ' + (i + 1) + ' of ' + session.order.length;
    $('t-bar').style.width = (i / session.order.length * 100) + '%';
    $('gotit').disabled = true;
    $('gotit').classList.remove('playing');
    $('t-status').textContent = 'Listen…';
    $('answer').hidden = true;
    $('next').disabled = true;

    var choices = $('choices');
    choices.innerHTML = '';
    shuffle([p.answer].concat(p.decoys)).forEach(function (c, k) {
      var b = el('button');
      b.appendChild(el('span', 'k', String(k + 1)));
      b.appendChild(document.createTextNode(c));
      b.setAttribute('data-v', c);
      choices.appendChild(b);
    });
    ['clarity', 'natural'].forEach(function (id) {
      var s = $(id);
      s.innerHTML = '';
      for (var n = 1; n <= 5; n++) {
        var b = el('button', '', String(n));
        b.setAttribute('data-v', n);
        s.appendChild(b);
      }
    });

    var t = trial;
    setTimeout(function () {
      if (trial !== t) return;
      t.startPerf = play(url, function () {
        if (trial !== t || t.msToGotIt !== null || t.missed) return;
        $('gotit').classList.remove('playing');
        t.timer = setTimeout(function () {
          if (trial !== t || t.msToGotIt !== null) return;
          t.missed = true;
          $('gotit').disabled = true;
          $('t-status').textContent = 'No “Got it” in time. Answer anyway.';
          $('answer').hidden = false;
        }, MISS_MS);
      });
      t.listening = true;
      $('gotit').disabled = false;
      $('gotit').classList.add('playing');
      $('t-status').textContent = 'Press Got it as soon as you know what to do';
    }, 450);
  }

  function gotIt() {
    var t = trial;
    if (!t || !t.listening || t.msToGotIt !== null || t.missed) return;
    t.msToGotIt = Math.max(0, Math.round(performance.now() - t.startPerf));
    clearTimeout(t.timer);
    $('gotit').disabled = true;
    $('gotit').classList.remove('playing');
    $('t-status').textContent = (t.msToGotIt / 1000).toFixed(2) + ' s';
    $('answer').hidden = false;
  }

  function ready() {
    $('next').disabled = !(trial.choice && trial.clarity && trial.natural);
  }

  function advance() {
    if ($('next').disabled) return;
    var t = trial;
    clearTimeout(t.timer);
    session.trials.push({
      index: t.index, phraseId: t.phraseId, voiceId: t.voiceId, exposure: t.exposure,
      msToGotIt: t.msToGotIt, missed: t.missed, choice: t.choice, correct: t.correct,
      clarity: t.clarity, natural: t.natural, replays: t.replays
    });
    if (t.index + 1 < session.order.length) next(t.index + 1);
    else finish();
  }

  function finish() {
    endSound();
    if (trial) clearTimeout(trial.timer);
    trial = null;
    out = null;
    session.endedAt = new Date().toISOString();
    if (session.trials.length) {
      var list = loadSessions();
      list.push(session);
      saveSessions(list);
    }
    var s = session;
    $('r-title').textContent = s.trials.length ? 'This session' : 'Nothing answered';
    $('r-cond').textContent = [s.listener, THROUGH[s.through], s.simulate.speaker ? 'phone-speaker filter' : '', s.simulate.noise ? 'road noise' : '',
      s.trials.length + ' of ' + s.order.length + ' clips'].filter(Boolean).join(' · ');
    var info = function (id) { return s.voices.filter(function (v) { return v.id === id; })[0]; };
    table('r-table', stats(s.trials), info, ['Pack'], function (tr, r, v) {
      tr.appendChild(el('td', 'num', v && v.opusKB ? v.opusKB + ' KB' : '–'));
    });
    show('results');
  }

  // --- Browse: every clip, named ---

  function browse() {
    audio();
    out = ctx.destination;
    var t = $('browse-table');
    t.innerHTML = '';
    var head = el('thead');
    var hr = el('tr');
    hr.appendChild(el('th', '', 'Phrase'));
    data.voices.forEach(function (v) {
      var th = el('th', '', v.label);
      th.title = v.license || '';
      hr.appendChild(th);
    });
    head.appendChild(hr);
    t.appendChild(head);
    var body = el('tbody');
    data.phrases.forEach(function (p) {
      var tr = el('tr');
      var td = el('td', 'text', p.text);
      td.appendChild(el('small', '', p.kind));
      tr.appendChild(td);
      data.voices.forEach(function (v) {
        var cell = el('td');
        if (v.files[p.id]) {
          var b = el('button', 'play', '▶');
          b.title = 'Sent: ' + (v.sent[p.id] || p.text);
          b.setAttribute('aria-label', 'Play ' + v.label + ': ' + p.text);
          b.addEventListener('click', function () {
            var url = v.files[p.id];
            Array.prototype.forEach.call(t.querySelectorAll('.play.on'), function (x) { x.classList.remove('on'); });
            b.classList.add('on');
            load(url).then(function () { play(url, function () { b.classList.remove('on'); }); });
          });
          cell.appendChild(b);
        } else {
          cell.textContent = '–';
        }
        tr.appendChild(cell);
      });
      body.appendChild(tr);
    });
    var foot = el('tr');
    foot.appendChild(el('td', 'text', 'Voice pack, Opus 24 kb/s'));
    data.voices.forEach(function (v) { foot.appendChild(el('td', 'num', v.opusKB + ' KB')); });
    body.appendChild(foot);
    t.appendChild(body);
    show('browse');
  }

  // --- Wiring ---

  pick($('through'));
  pick($('length'));
  pick($('choices'), function (v) {
    var p = phrase(trial.phraseId);
    trial.choice = v;
    trial.correct = v === p.answer;
    ready();
  });
  pick($('clarity'), function (v) { trial.clarity = +v; ready(); });
  pick($('natural'), function (v) { trial.natural = +v; ready(); });

  $('begin').addEventListener('click', begin);
  $('gotit').addEventListener('click', gotIt);
  $('next').addEventListener('click', advance);
  $('replay').addEventListener('click', function () {
    if (!trial || (trial.msToGotIt === null && !trial.missed)) return;
    trial.replays++;
    play(trial.url);
  });
  $('t-quit').addEventListener('click', finish);
  $('r-again').addEventListener('click', function () {
    renderHistory();
    describeVoices();
    show('start');
  });
  $('r-download').addEventListener('click', function () { download('voice-test-' + session.id + '.json', session); });
  $('browse-open').addEventListener('click', browse);
  $('browse-close').addEventListener('click', function () {
    quiet();
    show('start');
  });
  $('history-download').addEventListener('click', function () { download('voice-test-all.json', loadSessions()); });
  $('history-clear').addEventListener('click', function () {
    if (!window.confirm('Delete every saved session in this browser?')) return;
    saveSessions([]);
    renderHistory();
  });

  document.addEventListener('keydown', function (e) {
    if ($('trial').hidden || !trial) return;
    if (e.key === ' ') {
      e.preventDefault();
      gotIt();
    } else if (/^[1-4]$/.test(e.key) && !$('answer').hidden) {
      var b = $('choices').children[+e.key - 1];
      if (b) b.click();
    } else if (e.key === 'Enter' && !$('answer').hidden) {
      e.preventDefault();
      advance();
    }
  });

  fetch('manifest.json').then(function (r) { return r.json(); }).then(function (m) {
    data = m;
    describeVoices();
    renderHistory();
  }, function () {
    $('voices-note').textContent = 'Couldn\'t read the clips. Is serve.js running?';
  });
})();
