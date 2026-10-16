// Turn-by-turn: gets a driving route, tracks your progress along it, speaks the turns, reroutes.
(function (FM) {
  'use strict';

  var geo = FM.geo;
  // OSRM's public demo server: car routing, light personal use only.
  var ROUTER_URL = 'https://router.project-osrm.org/route/v1/driving/';
  var DEST_KEY = 'flipmap.dest';
  var VOICE_KEY = 'flipmap.voice';
  var RESUME_MS = 6 * 3600 * 1000; // reopen the app within 6 h and the route picks back up
  var OFF_ROUTE_M = 40; // plus GPS accuracy
  var OFF_ROUTE_FIXES = 3;
  var RETRY_GAP_MS = 15000;
  var ARRIVE_M = 30;

  var route = null; // see build()
  var pending = loadDest(); // destination waiting on a GPS fix or a network retry
  var lastFix = null;
  var busy = false;
  var lastRequest = 0;
  var offCount = 0;
  var voice = loadVoice();

  // --- Getting a route ---

  function go(dest) {
    pending = dest;
    route = null;
    lastRequest = 0;
    saveDest(dest);
    FM.map.setRoute(null);
    notify();
    if (lastFix) update(lastFix);
  }

  function request(from, dest, isReroute) {
    busy = true;
    lastRequest = Date.now();
    message(isReroute ? 'Rerouting…' : 'Finding route…');
    var url = ROUTER_URL + from.lon + ',' + from.lat + ';' + dest.lon + ',' + dest.lat +
      '?overview=false&steps=true&geometries=geojson';
    fetch(url)
      .then(function (res) {
        if (!res.ok) throw new Error('Router error ' + res.status);
        return res.json();
      })
      .then(function (data) {
        if (data.code !== 'Ok' || !data.routes || !data.routes.length) throw new Error('No route found');
        // The destination may have changed or been cancelled while we waited.
        if (dest !== (route ? route.dest : pending)) return;
        route = build(data.routes[0], dest);
        pending = null;
        offCount = 0;
        FM.map.setRoute(route.coords);
        message('');
        say((isReroute ? 'Route updated. ' : 'Starting route. ') + route.steps[0].text);
        track(from);
      })
      .catch(function (err) {
        message(navigator.onLine === false ? 'No data connection' : err.message || 'Route failed');
      })
      .then(function () {
        busy = false;
        notify();
      });
  }

  // OSRM gives a list of steps, each with its own piece of road geometry. Stitch the pieces into one
  // line and remember where along it (in meters) each maneuver happens.
  function build(r, dest) {
    var coords = [];
    var steps = r.legs[0].steps.map(function (s, i) {
      var startIdx = coords.length ? coords.length - 1 : 0;
      s.geometry.coordinates.forEach(function (c, j) {
        if (j > 0 || !coords.length) coords.push([c[1], c[0]]);
      });
      return {
        i: i,
        type: s.maneuver.type,
        startIdx: startIdx,
        text: instruction(s),
        icon: icon(s.maneuver),
        major: isMajor(s.maneuver)
      };
    });

    var cum = [0];
    for (var k = 1; k < coords.length; k++) {
      cum.push(cum[k - 1] + geo.distance(coords[k - 1][0], coords[k - 1][1], coords[k][0], coords[k][1]));
    }
    steps.forEach(function (s) { s.at = cum[s.startIdx]; });

    return {
      dest: dest,
      coords: coords,
      cum: cum,
      total: cum[cum.length - 1],
      duration: r.duration,
      steps: steps,
      said: {}, // step index -> 1 (early warning given) or 2 (turn-now given)
      lastIdx: 0,
      progress: 0,
      next: steps[steps.length - 1],
      toNext: cum[cum.length - 1]
    };
  }

  // --- Following the route ---

  function update(fix) {
    lastFix = fix;
    if (pending) {
      if (!busy && Date.now() - lastRequest > RETRY_GAP_MS) request(fix, pending, false);
    } else if (route) {
      track(fix);
    }
  }

  function track(fix) {
    var m = match(fix.lat, fix.lon);
    var tolerance = OFF_ROUTE_M + Math.min(fix.accuracy || 0, 50);
    route.lastIdx = m.idx;
    route.progress = m.progress;
    offCount = m.dist > tolerance ? offCount + 1 : 0;

    if (route.total - m.progress < ARRIVE_M && m.dist < tolerance) {
      say('You have arrived');
      message('Arrived: ' + route.dest.name);
      end();
      return;
    }

    if (offCount >= OFF_ROUTE_FIXES && !busy && Date.now() - lastRequest > RETRY_GAP_MS) {
      request(fix, route.dest, true);
    }

    route.next = nextStep(m.progress);
    route.toNext = route.next.at - m.progress;
    announce(route.next, route.toNext, fix.speed);
  }

  // Snap a position to the nearest point on the route line. Looks near the last match first so a
  // road that doubles back on itself doesn't make progress jump.
  function match(lat, lon) {
    var last = route.coords.length - 2;
    var best = scan(lat, lon, Math.max(0, route.lastIdx - 10), Math.min(last, route.lastIdx + 300));
    return best.dist > 100 ? scan(lat, lon, 0, last) : best;
  }

  function scan(lat, lon, from, to) {
    var c = route.coords;
    var cum = route.cum;
    var best = { dist: Infinity, idx: from, progress: cum[from] };
    for (var i = from; i <= to; i++) {
      var s = geo.toSegment(lat, lon, c[i], c[i + 1]);
      if (s.dist < best.dist) {
        best = { dist: s.dist, idx: i, progress: cum[i] + s.t * (cum[i + 1] - cum[i]) };
      }
    }
    return best;
  }

  function nextStep(progress) {
    for (var i = 1; i < route.steps.length; i++) {
      var s = route.steps[i];
      if (s.major && s.at > progress + 5) return s;
    }
    return route.steps[route.steps.length - 1];
  }

  // Two prompts per turn: an early warning, then "turn now". Both scale with speed.
  function announce(step, d, speed) {
    var v = Math.max(speed || 0, 8);
    var near = Math.max(40, v * 6);
    var far = Math.max(300, v * 25);
    var said = route.said[step.i] || 0;
    if (said < 2 && d <= near) {
      route.said[step.i] = 2;
      if (step.type !== 'arrive') say(step.text);
    } else if (said < 1 && d <= far && d > near * 1.5) {
      route.said[step.i] = 1;
      say(inDistance(d, step));
    }
  }

  function inDistance(d, step) {
    return 'In ' + geo.spokenDistance(d) + ', ' + step.text.charAt(0).toLowerCase() + step.text.slice(1);
  }

  function end() {
    route = null;
    pending = null;
    offCount = 0;
    clearDest();
    FM.map.setRoute(null);
    notify();
  }

  // --- Words and arrows for each maneuver ---

  function instruction(s) {
    var m = s.maneuver;
    var mod = m.modifier || '';
    var road = s.name || s.ref || '';
    var onto = road ? ' onto ' + road : '';
    var side = mod.indexOf('left') >= 0 ? 'left' : mod.indexOf('right') >= 0 ? 'right' : '';
    if (mod === 'uturn' && m.type !== 'depart' && m.type !== 'arrive') return 'Make a U-turn' + onto;
    switch (m.type) {
      case 'depart':
        return 'Head ' + geo.compass(m.bearing_after) + (road ? ' on ' + road : '');
      case 'arrive':
        return 'Arrive at destination' + (side ? ', on the ' + side : '');
      case 'roundabout':
      case 'rotary':
        return 'At the roundabout, take exit ' + (m.exit || 1) + onto;
      case 'exit roundabout':
      case 'exit rotary':
        return 'Exit the roundabout' + onto;
      case 'merge':
        return 'Merge' + (side ? ' ' + side : '') + onto;
      case 'on ramp':
        return 'Take the ramp' + (side ? ' on the ' + side : '') + onto;
      case 'off ramp':
        return 'Take the exit' + (side ? ' on the ' + side : '') + (s.destinations ? ' toward ' + s.destinations : onto);
      case 'fork':
        return 'Keep ' + (side || 'straight') + onto;
      case 'continue':
        if (side && mod.indexOf('slight') < 0) return 'Turn ' + side + ' to stay on ' + (road || 'the road');
        return 'Continue' + onto;
      case 'new name':
        return 'Continue' + onto;
    }
    if (!side) return 'Continue straight' + onto;
    return 'Turn ' + mod.replace('slight', 'slightly') + onto;
  }

  // Road name changes and "keep going straight" aren't worth a prompt.
  function isMajor(m) {
    var mod = m.modifier || '';
    if (m.type === 'depart' || m.type === 'new name' || m.type === 'notification') return false;
    if (m.type === 'continue') return /^(left|right|sharp|uturn)/.test(mod);
    if (m.type === 'turn') return mod !== 'straight';
    return true;
  }

  function icon(m) {
    var mod = m.modifier || '';
    if (m.type === 'arrive') return '◉';
    if (m.type === 'roundabout' || m.type === 'rotary') return '↻';
    if (mod === 'uturn') return '↶';
    if (mod.indexOf('slight') === 0) return mod.indexOf('left') > 0 ? '↖' : '↗';
    if (mod.indexOf('left') >= 0) return '←';
    if (mod.indexOf('right') >= 0) return '→';
    return '↑';
  }

  // --- Speech, vibration, storage ---

  function say(text) {
    if (navigator.vibrate) navigator.vibrate(150);
    if (!voice || !window.speechSynthesis || !window.SpeechSynthesisUtterance) return;
    try {
      window.speechSynthesis.speak(new window.SpeechSynthesisUtterance(text));
    } catch (e) {}
  }

  function message(text) {
    if (FM.nav.onmessage) FM.nav.onmessage(text);
  }

  function notify() {
    if (FM.nav.onchange) FM.nav.onchange();
  }

  function loadDest() {
    try {
      var d = JSON.parse(localStorage.getItem(DEST_KEY));
      if (d && Date.now() - d.savedAt < RESUME_MS) return d;
    } catch (e) {}
    return null;
  }

  function saveDest(dest) {
    try {
      localStorage.setItem(DEST_KEY, JSON.stringify({
        name: dest.name, lat: dest.lat, lon: dest.lon, savedAt: Date.now()
      }));
    } catch (e) {}
  }

  function clearDest() {
    try {
      localStorage.removeItem(DEST_KEY);
    } catch (e) {}
  }

  function loadVoice() {
    try {
      return localStorage.getItem(VOICE_KEY) !== 'off';
    } catch (e) {
      return true;
    }
  }

  FM.nav = {
    go: go,
    update: update,
    end: end,
    onchange: null,
    onmessage: null,

    active: function () {
      return !!(route || pending);
    },

    route: function () {
      return route;
    },

    state: function () {
      if (pending) return { mode: 'pending', dest: pending };
      if (!route) return { mode: 'off' };
      var remaining = Math.max(0, route.total - route.progress);
      return {
        mode: 'on',
        dest: route.dest,
        step: route.next,
        toNext: route.toNext,
        remaining: remaining,
        secs: route.total ? route.duration * remaining / route.total : 0
      };
    },

    repeat: function () {
      if (route) say(inDistance(route.toNext, route.next));
    },

    voice: function (on) {
      if (arguments.length) {
        voice = on;
        try {
          localStorage.setItem(VOICE_KEY, on ? 'on' : 'off');
        } catch (e) {}
      }
      return voice;
    }
  };
})(window.FM = window.FM || {});
