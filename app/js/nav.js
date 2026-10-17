// Turn-by-turn: plans routes, follows your progress along one, speaks the turns, reroutes.
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
  var ROUTE_MS = 12000; // a route request with no answer by then is abandoned and retried
  var MIN_REACH_MPS = 15; // assume at least this speed when judging how far we could have gone
  var MAX_GAP_S = 120;
  var THEN_M = 300; // a second turn this soon after the next one gets a "Then" hint

  var route = null; // see build()
  var pending = loadDest(); // a saved trip waiting for a GPS fix or a network retry
  var lastFix = null;
  var busy = false;
  var asked = 0; // number of the latest route request; a newer request or trip makes older ones moot
  var lastRequest = 0;
  var lastError = '';
  var offCount = 0;
  var voice = loadVoice();

  // --- Getting routes ---

  function fetchRoutes(from, dest, alternatives) {
    var url = ROUTER_URL + from.lon + ',' + from.lat + ';' + dest.lon + ',' + dest.lat +
      '?overview=false&steps=true&geometries=geojson' + (alternatives ? '&alternatives=true' : '');
    return FM.net.getJSON(url, ROUTE_MS, 'Routing is not answering')
      .catch(function (err) {
        throw err.status ? new Error('Routing is unavailable') : err;
      })
      .then(function (data) {
        if (data.code !== 'Ok' || !data.routes || !data.routes.length) throw new Error('No route found');
        return data.routes.map(function (r) { return build(r, dest); });
      });
  }

  function explain(err) {
    return navigator.onLine === false || err instanceof TypeError ? 'No connection' : err.message;
  }

  // Choices to preview before starting, fastest first.
  function plan(dest) {
    if (!lastFix) return Promise.reject(new Error('Waiting for your location'));
    return fetchRoutes(lastFix, dest, true).then(function (list) {
      return list.sort(function (a, b) { return a.duration - b.duration; });
    }, function (err) {
      throw new Error(explain(err));
    });
  }

  function start(r) {
    forget();
    route = r;
    pending = null;
    offCount = 0;
    lastError = '';
    lastRequest = Date.now();
    saveDest(r.dest);
    say('Starting route. ' + r.steps[0].text, false);
    if (lastFix) track(lastFix);
    notify();
  }

  // Resuming a saved trip, or rerouting: no preview, just the best route from here.
  function request(from, dest, isReroute) {
    var ask = ++asked;
    var at = Date.now(); // when we were at `from`
    busy = true;
    lastRequest = at;
    notify();
    fetchRoutes(from, dest, false)
      .then(function (list) {
        // The trip may have been ended or changed while we waited.
        if (ask !== asked || dest !== (route ? route.dest : pending)) return;
        route = list[0];
        pending = null;
        offCount = 0;
        lastError = '';
        // Match where we asked from, as of then, and then where we are now, saying nothing yet: an
        // answer that took a while may describe road we've already driven, turns and all.
        track(from, at, true);
        if (route && lastFix && lastFix !== from) track(lastFix, 0, true);
        if (route) introduce(route, isReroute, (lastFix || from).speed);
      })
      .catch(function (err) {
        if (ask !== asked) return;
        lastError = explain(err);
        message(lastError);
      })
      .then(function () {
        if (ask !== asked) return;
        busy = false;
        notify();
      });
  }

  // A request still out belongs to the trip it was made for: starting or ending a trip lets it go, so
  // its answer, error or spinner can't reach the next one.
  function forget() {
    asked++;
    busy = false;
  }

  // OSRM gives a list of steps, each with its own piece of road. Stitch the pieces into one line and
  // remember where along it (in meters) each maneuver happens.
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
        modifier: s.maneuver.modifier || '',
        startIdx: startIdx,
        text: instruction(s), // spoken
        road: label(s, dest), // shown under the distance
        street: roadName(s), // the real name, if the road has one
        lanes: FM.lanes.guide(s),
        major: isMajor(s.maneuver)
      };
    });

    var cum = [0];
    for (var k = 1; k < coords.length; k++) {
      cum.push(cum[k - 1] + geo.distance(coords[k - 1][0], coords[k - 1][1], coords[k][0], coords[k][1]));
    }
    steps.forEach(function (s) {
      s.at = cum[s.startIdx];
      s.loc = coords[s.startIdx];
    });

    return {
      dest: dest,
      coords: coords,
      cum: cum,
      total: cum[cum.length - 1],
      duration: r.duration,
      steps: steps,
      said: {}, // step index -> 1 (early warning given) or 2 (turn-now given)
      lastIdx: 0,
      trackedAt: 0, // when the last fix matched the route; 0 until the first one
      progress: 0,
      snap: null, // where you are on the line
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

  // A new route from here (a reroute, or a saved trip picked back up): say what's next from where we
  // are now. Just setting off, which way to head; otherwise the next turn, unless it's due right away,
  // which announce() says as "turn now".
  function introduce(r, isReroute, speed) {
    var lead = isReroute ? '' : 'Resuming route. ';
    if (!isReroute && r.progress < ARRIVE_M) {
      say(lead + r.steps[0].text, false);
    } else if (!r.said[r.next.i] && r.toNext > nearM(speed)) {
      r.said[r.next.i] = 1;
      say(lead + inDistance(r.toNext, r.next), false);
    } else if (lead) {
      say(lead.trim(), false);
    }
    announce(r.next, r.toNext, speed);
  }

  // `at`: when the fix was taken, if not just now. A route that took a while to arrive is matched
  // against where we asked from, as of then, so the next fix may plausibly be that much farther on.
  // `quiet`: follow the route without announcing anything (introduce() speaks once we're placed).
  function track(fix, at, quiet) {
    var now = at || Date.now();
    var m = match(fix, now);
    var c = route.coords;
    var tolerance = OFF_ROUTE_M + Math.min(fix.accuracy || 0, 50);

    // Not near any part of the route we could have reached since the last fix: count it as off the
    // route and leave progress alone, so one stray fix can't skip turns or end the trip. If it keeps
    // happening, the usual reroute takes over.
    if (m.dist > tolerance) {
      offCount++;
      if (offCount >= OFF_ROUTE_FIXES && !busy && now - lastRequest > RETRY_GAP_MS) {
        FM.report.reroute();
        request(fix, route.dest, true);
      }
      return;
    }

    offCount = 0;
    route.trackedAt = now;
    route.lastIdx = m.idx;
    route.progress = m.progress;
    route.snap = {
      idx: m.idx,
      lat: c[m.idx][0] + m.t * (c[m.idx + 1][0] - c[m.idx][0]),
      lon: c[m.idx][1] + m.t * (c[m.idx + 1][1] - c[m.idx][1])
    };

    if (route.total - m.progress < ARRIVE_M) {
      var dest = route.dest;
      say('You have arrived', true);
      if (FM.nav.onarrive) FM.nav.onarrive(dest);
      end();
      return;
    }

    route.next = nextStep(m.progress);
    route.toNext = route.next.at - m.progress;
    if (!quiet) announce(route.next, route.toNext, fix.speed);
  }

  // Snap a position to the nearest point on the stretch of route we could plausibly have reached:
  // a little behind where we were, up to the farthest we could have driven since (at least 15 m/s,
  // with slack for GPS error). A jump onto a far part of the route, such as the other side of a road
  // that doubles back, or the destination, isn't on that stretch, so it doesn't match.
  function match(fix, now) {
    var last = route.coords.length - 2;
    if (!route.trackedAt) return scan(fix.lat, fix.lon, 0, last);
    var gap = Math.min((now - route.trackedAt) / 1000, MAX_GAP_S);
    var slack = 60 + Math.min(fix.accuracy || 0, 100);
    var reach = Math.max(fix.speed || 0, MIN_REACH_MPS) * gap * 1.5 + slack;
    var from = indexAt(route.progress - slack);
    var to = Math.min(last, indexAt(route.progress + reach) + 1);
    return scan(fix.lat, fix.lon, from, to);
  }

  // The last route vertex at or before `d` meters along the route.
  function indexAt(d) {
    var cum = route.cum;
    var lo = 0;
    var hi = cum.length - 1;
    if (d <= 0) return 0;
    while (lo < hi) {
      var mid = (lo + hi + 1) >> 1;
      if (cum[mid] <= d) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  function scan(lat, lon, from, to) {
    var c = route.coords;
    var cum = route.cum;
    var best = { dist: Infinity, idx: from, t: 0, progress: cum[from] };
    for (var i = from; i <= to; i++) {
      var s = geo.toSegment(lat, lon, c[i], c[i + 1]);
      if (s.dist < best.dist) {
        best = { dist: s.dist, idx: i, t: s.t, progress: cum[i] + s.t * (cum[i + 1] - cum[i]) };
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

  function thenStep() {
    var n = route.next;
    for (var i = n.i + 1; i < route.steps.length; i++) {
      var s = route.steps[i];
      if (!s.major) continue;
      // Only worth a hint if it's soon and the arrow says something ("Then ↑" doesn't).
      var turns = s.type === 'arrive' || (s.modifier && s.modifier !== 'straight');
      return s.at - n.at < THEN_M && turns ? s : null;
    }
    return null;
  }

  // Two prompts per turn: an early warning, then "turn now" (with a buzz). Both scale with speed.
  function announce(step, d, speed) {
    var v = Math.max(speed || 0, 8);
    var near = nearM(speed);
    var far = Math.max(300, v * 25);
    var said = route.said[step.i] || 0;
    if (said < 2 && d <= near) {
      route.said[step.i] = 2;
      if (step.type !== 'arrive') say(step.text, true);
    } else if (said < 1 && d <= far && d > near * 1.5) {
      route.said[step.i] = 1;
      say(inDistance(d, step), false);
    }
  }

  // How close "turn now" is said: 6 seconds out, and never under 40 m.
  function nearM(speed) {
    return Math.max(40, Math.max(speed || 0, 8) * 6);
  }

  function inDistance(d, step) {
    return 'In ' + geo.spokenDistance(d) + ', ' + step.text.charAt(0).toLowerCase() + step.text.slice(1) +
      (step.lanes ? '. ' + step.lanes.phrase : '');
  }

  function end() {
    forget();
    route = null;
    pending = null;
    offCount = 0;
    lastError = '';
    clearDest();
    notify();
  }

  // --- Words for each maneuver ---

  function roadName(s) {
    if (s.name) return s.name;
    return s.ref ? s.ref.split(';')[0].replace(/^(I|US) (\d)/, '$1-$2') : '';
  }

  function instruction(s) {
    var m = s.maneuver;
    var mod = m.modifier || '';
    var road = roadName(s);
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
        return 'At the roundabout, take the ' + ordinal(m.exit || 1) + ' exit' + onto;
      case 'exit roundabout':
      case 'exit rotary':
        return 'Exit the roundabout' + onto;
      case 'merge':
        return 'Merge' + (side ? ' ' + side : '') + onto;
      case 'on ramp':
        return 'Take the ramp' + (side ? ' on the ' + side : '') + onto;
      case 'off ramp':
        return 'Take the exit' + (side ? ' on the ' + side : '') +
          (s.destinations ? ' toward ' + s.destinations : onto);
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

  // The line under the distance: the road you turn onto, since the arrow already says which way.
  function label(s, dest) {
    var m = s.maneuver;
    var road = roadName(s);
    if (m.type === 'arrive') return dest.name;
    if (m.type === 'off ramp') {
      var exit = s.exits ? 'Exit ' + s.exits.split(';')[0] : '';
      return [exit, s.destinations || road].filter(Boolean).join(' · ') || 'Take the exit';
    }
    if ((m.type === 'roundabout' || m.type === 'rotary') && !road) return ordinal(m.exit || 1) + ' exit';
    return road || instruction({ maneuver: m });
  }

  function ordinal(k) {
    return k + (k % 10 === 1 && k !== 11 ? 'st' : k % 10 === 2 && k !== 12 ? 'nd' : k % 10 === 3 && k !== 13 ? 'rd' : 'th');
  }

  // Lanes show up early enough to change lanes calmly: half a kilometer, or 25 seconds at speed.
  function laneWindow() {
    var v = lastFix && lastFix.speed > 0 ? lastFix.speed : 0;
    return Math.max(500, v * 25);
  }

  // Road name changes and "keep going straight" aren't worth a prompt.
  function isMajor(m) {
    var mod = m.modifier || '';
    if (m.type === 'depart' || m.type === 'new name' || m.type === 'notification') return false;
    if (m.type === 'continue') return /^(left|right|sharp|uturn)/.test(mod);
    if (m.type === 'turn') return mod !== 'straight';
    return true;
  }

  // --- Speech, storage ---

  function say(text, buzz) {
    if (buzz && navigator.vibrate) navigator.vibrate(120);
    if (!voice || !window.speechSynthesis || !window.SpeechSynthesisUtterance) return;
    try {
      var u = new window.SpeechSynthesisUtterance(text);
      u.onend = function () { FM.report.spoke(true); };
      u.onerror = function () { FM.report.spoke(false); };
      window.speechSynthesis.speak(u);
    } catch (e) {
      FM.report.spoke(false);
    }
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
    plan: plan,
    start: start,
    update: update,
    end: end,
    onchange: null,
    onmessage: null,
    onarrive: null,

    active: function () {
      return !!(route || pending);
    },

    route: function () {
      return route;
    },

    state: function () {
      if (pending) return { mode: 'pending', dest: pending, error: busy ? '' : lastError };
      if (!route) return { mode: 'off' };
      var remaining = Math.max(0, route.total - route.progress);
      return {
        mode: 'on',
        dest: route.dest,
        step: route.next,
        toNext: route.toNext,
        // Only for the very next maneuver, only close to it, and never while off the route.
        lanes: route.next.lanes && route.toNext <= laneWindow() && !offCount && !busy ? route.next.lanes : null,
        then: thenStep(),
        remaining: remaining,
        secs: route.total ? route.duration * remaining / route.total : 0,
        rerouting: busy
      };
    },

    repeat: function () {
      if (route) say(inDistance(route.toNext, route.next), false);
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
