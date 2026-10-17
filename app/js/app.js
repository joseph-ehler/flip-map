// Screens and keys. The app is always in one base state, sometimes with a sheet on top of it:
//   explore   the map and you             preview   routes to a chosen place, before Go
//   nav       driving, turn by turn       overview  the whole remaining route
//   arrived   the moment you get there    sheets    search, settings
// Each state decides what the soft keys say, what every key does, and which cards are on screen.
// Back always goes up one level.
(function (FM) {
  'use strict';

  var geo = FM.geo;
  var map = FM.map;
  var nav = FM.nav;
  var search = FM.search;
  var sim = FM.sim;
  var icons = FM.icons;

  var PAN_STEP = 56; // pixels per key press
  var STALE_MS = 15000; // no fix for this long = weak signal
  var RESUME_MS = 12000; // a panned map snaps back to you after this long while driving
  var ARRIVED_MS = 15000;
  var EXIT_MS = 2500;
  var FLASH_MS = 2400;
  var SCALE_MS = 1600;
  var SHEET_OUT_MS = 200;
  var ROUGH_M = 65; // worse than this, say the position is approximate
  var SLOW_FIX_MS = 20000;
  var PREFS_KEY = 'flipmap.prefs';
  var APPEARANCES = ['auto', 'light', 'dark'];
  var APPEARANCE_NAMES = { auto: 'Automatic', light: 'Light', dark: 'Dark' };

  function $(id) {
    return document.getElementById(id);
  }

  var root = document.documentElement;
  var body = document.body;

  var prefs = loadPrefs();
  var state = 'explore';
  var sheet = null;
  var fix = null;
  var gpsError = 0;
  var gpsStartedAt = Date.now();
  var watchId = null;
  var trip = emptyTrip(); // the preview: destination and route choices
  var shownRoute = null;
  var flash = null; // a short message in the status pill
  var exitArmedAt = 0;
  var settingsRows = [];
  var timers = {};

  function emptyTrip() {
    return { dest: null, plans: [], choice: 0, busy: false, error: '' };
  }

  // --- Small DOM helpers: only touch the page when something changed ---

  function setText(id, s) {
    var el = $(id);
    if (el.textContent !== s) el.textContent = s;
  }

  function setHTML(id, html) {
    var el = $(id);
    if (el.getAttribute('data-html') !== html) {
      el.innerHTML = html;
      el.setAttribute('data-html', html);
    }
  }

  function show(id, on) {
    var el = $(id);
    if (el.hidden === on) el.hidden = !on;
  }

  function topOf(el) {
    var y = 0;
    for (; el; el = el.offsetParent) y += el.offsetTop;
    return y;
  }

  function clock(secs, short) {
    var s = new Date(Date.now() + secs * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return short ? s.replace(/\s?[AP]M$/i, '') : s;
  }

  // --- States and sheets ---

  function setState(s) {
    if (s !== state && s !== 'preview' && s !== 'nav' && s !== 'overview') map.setCallouts([]);
    state = s;
    body.setAttribute('data-state', s);
    map.setDriving(s === 'nav' || s === 'overview');
    refresh();
  }

  function refresh() {
    renderNav();
    renderStatus();
    renderCompass();
    refreshKeys();
    layout();
  }

  function openSheet(name) {
    clearTimeout(timers.sheet);
    if (sheet) $(sheet).classList.remove('leaving');
    sheet = name;
    $(name).classList.remove('leaving');
    body.setAttribute('data-sheet', name);
    refreshKeys();
  }

  function closeSheet() {
    if (!sheet) return;
    var el = $(sheet);
    sheet = null;
    el.classList.add('leaving');
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    timers.sheet = setTimeout(function () {
      el.classList.remove('leaving');
      if (!sheet) body.removeAttribute('data-sheet');
    }, SHEET_OUT_MS);
    refreshKeys();
  }

  // The map frames itself in the space between the cards.
  function layout() {
    var h = $('map').offsetHeight;
    var top = 0;
    var bottom = $('softkeys').offsetHeight;
    ['banner'].forEach(function (id) {
      var el = $(id);
      if (el.offsetHeight) top = Math.max(top, topOf(el) + el.offsetHeight);
    });
    ['trip', 'preview', 'arrived', 'notice'].forEach(function (id) {
      var el = $(id);
      if (el.offsetHeight) bottom = Math.max(bottom, h - topOf(el));
    });
    map.setInsets(top, bottom);
  }

  // --- Soft keys: [left, center, right, center style] ---

  function stateKeys() {
    switch (state) {
      case 'explore':
        if (!fix && gpsError) return ['Search', 'Retry', 'More'];
        if (!fix || !map.following()) return ['Search', icons.icon('locateOutline'), 'More', 'sym'];
        if (isRotated()) return ['Search', icons.icon('compass'), 'More', 'sym'];
        return ['Search', icons.icon('locate'), 'More', 'sym on'];
      case 'preview':
        return trip.plans.length ? ['Back', 'Go', '', 'pill'] : ['Back', '', ''];
      case 'nav':
        if (!nav.route()) return ['', '', 'More'];
        return map.following() ? ['Overview', 'Repeat', 'More'] : ['Overview', 'Resume', 'More', 'pill'];
      case 'overview':
        return ['Resume', '', 'More'];
      case 'arrived':
        return ['', 'Done', ''];
    }
    return ['', '', ''];
  }

  function refreshKeys() {
    var k = sheet === 'search' ? search.softkeys()
      : sheet === 'settings' ? ['', 'Select', 'Done']
        : sheet === 'report' ? ['', '', 'Done']
          : stateKeys();
    setText('sk-left', k[0]);
    setText('sk-right', k[2]);
    setHTML('sk-center', k[1]);
    var cls = k[3] || '';
    if ($('sk-center').className !== cls) $('sk-center').className = cls;
  }

  // --- Turn card, trip bar, the next street on the map ---

  function renderNav() {
    var s = nav.state();
    var callout = null;
    if (s.mode === 'pending') {
      setHTML('glyph', s.error ? icons.maneuver('arrive') : icons.spinner);
      setText('b-dist', s.error || 'Finding Route');
      setText('b-road', s.dest.name);
      show('then', false);
      show('lanes', false);
      ['t-arrive', 't-time', 't-dist'].forEach(function (id) { setText(id, '–'); });
    } else if (s.mode === 'on') {
      var step = s.step;
      if (s.rerouting) {
        setHTML('glyph', icons.spinner);
        setText('b-dist', 'Rerouting');
      } else {
        setHTML('glyph', icons.maneuver(step.type, step.modifier));
        setText('b-dist', s.toNext < 20 ? 'Now' : geo.formatDistance(s.toNext));
      }
      setText('b-road', step.type === 'arrive' ? step.road : geo.shortRoad(step.road));
      show('then', !!s.then && !s.rerouting);
      if (state === 'nav' && !s.rerouting && step.street && step.type !== 'arrive') {
        callout = { lat: step.loc[0], lon: step.loc[1], text: geo.shortRoad(step.street) };
      }
      if (s.then) setHTML('then-glyph', icons.maneuver(s.then.type, s.then.modifier));
      if (s.lanes && !s.rerouting) {
        var fits = function (ind) { return FM.lanes.fits(ind, s.lanes.modifier); };
        setHTML('lanes-arrows', s.lanes.lanes.map(function (l) { return icons.lane(l.indications, l.valid, fits); }).join(''));
        setText('lanes-label', s.lanes.label);
      }
      show('lanes', !!s.lanes && !s.rerouting);

      var t = geo.durationParts(s.secs);
      var d = geo.distanceParts(s.remaining);
      setText('t-arrive', clock(s.secs, true));
      setText('t-time', t.value);
      setText('t-time-unit', t.unit);
      setText('t-dist', d.value);
      setText('t-dist-unit', d.unit);

      if (state === 'nav') {
        var v = fix && fix.speed > 0 ? fix.speed : 0;
        map.autoZoom(zoomFor(v, s.toNext));
        map.setLookAhead(lookAhead(v, s.toNext));
      }
    }
    if (state === 'nav' || state === 'overview') map.setCallouts(callout ? [callout] : []);
    layout();
  }

  // Where you sit while driving, as a share of the free space from the top: low (more road ahead)
  // as a turn comes up, a little higher and calmer on long straight stretches.
  function lookAhead(speed, toNext) {
    var fast = geo.clamp(speed / 30, 0, 1);
    if (toNext < 300) return 0.8;
    if (toNext > 1500) return 0.66 + 0.04 * fast;
    return 0.72 + 0.04 * fast;
  }

  // Closer in town, farther out on the highway, and close again as a turn comes up.
  function zoomFor(speed, toNext) {
    var z = speed > 24 ? 15 : speed > 13 ? 16 : 17;
    return toNext < 250 ? 17 : z;
  }

  function syncRoute() {
    var r = nav.route();
    if (r !== shownRoute) {
      shownRoute = r;
      if (state !== 'preview') map.setRoutes(r ? [r] : [], 0);
    } else if (r) {
      map.refreshRoute();
    }
  }

  // --- Preview: pick a route, then Go ---

  function openPreview(dest) {
    trip = emptyTrip();
    trip.dest = dest;
    setState('preview');
    renderPreview();
    planTrip();
  }

  function planTrip() {
    var t = trip;
    if (!fix || t.busy || t.plans.length) return;
    t.busy = true;
    t.error = '';
    renderPreview();
    nav.plan(t.dest).then(function (plans) {
      if (trip !== t) return;
      t.plans = plans;
      t.busy = false;
      renderPreview();
      refreshKeys();
      layout();
      map.setRoutes(plans, 0);
      map.setCallouts(routeTags());
      map.fit(plans.map(function (p) { return p.coords; }));
    }, function (err) {
      if (trip !== t) return;
      t.busy = false;
      t.error = err.message;
      renderPreview();
      refreshKeys();
    });
  }

  function renderPreview() {
    var t = trip;
    var r = t.plans[t.choice];
    setText('p-name', t.dest ? t.dest.name : '');
    if (r) {
      setText('p-time', geo.formatDuration(r.duration));
      setText('p-meta', geo.formatDistance(r.total) + ' · ' + clock(r.duration, true));
    } else if (t.error) {
      setText('p-time', 'No Route');
      setText('p-meta', t.error);
    } else {
      setHTML('p-time', icons.spinner);
      setText('p-meta', fix ? 'Finding routes' : 'Waiting for your location');
    }
    // With alternatives, which one is chosen ("‹ 1/2 ›"); the map shows each route's time.
    var n = t.plans.length;
    setText('p-alts', n > 1 ? '‹ ' + (t.choice + 1) + '/' + n + ' ›' : '');
    show('p-alts', n > 1);
    layout();
  }

  // A time tag on each route, where it runs farthest from the others; the chosen one in blue.
  function routeTags() {
    return trip.plans.map(function (p, i) {
      var at = tagSpot(p, trip.plans);
      var extra = Math.round((p.duration - trip.plans[0].duration) / 60);
      return {
        lat: at[0], lon: at[1], key: 'plan' + i, route: i, priority: i === trip.choice ? 102 : 101,
        kind: i === trip.choice ? 'route' : 'route-alt',
        text: i && extra > 0 ? geo.formatDuration(p.duration) + ' · +' + extra : geo.formatDuration(p.duration)
      };
    });
  }

  function tagSpot(p, plans) {
    var c = p.coords;
    var others = plans.filter(function (o) { return o !== p; });
    var best = c[Math.floor(c.length / 2)];
    var bestGap = -1;
    var step = Math.max(1, Math.floor(c.length / 40));
    for (var i = Math.floor(c.length * 0.15); i < c.length * 0.85; i += step) {
      var gap = Infinity;
      others.forEach(function (o) {
        var oc = o.coords;
        var stride = Math.max(1, Math.floor(oc.length / 200));
        for (var j = 0; j + stride < oc.length; j += stride) {
          gap = Math.min(gap, geo.toSegment(c[i][0], c[i][1], oc[j], oc[j + stride]).dist);
        }
      });
      if (others.length && gap > bestGap) {
        bestGap = gap;
        best = c[i];
      }
    }
    return best;
  }

  function cycleRoute(d) {
    var n = trip.plans.length;
    if (n < 2) return;
    trip.choice = (trip.choice + d + n) % n;
    map.select(trip.choice);
    map.setCallouts(routeTags());
    renderPreview();
  }

  function startRoute() {
    var r = trip.plans[trip.choice];
    if (!r) return;
    trip = emptyTrip();
    shownRoute = null;
    FM.report.start(r.dest);
    nav.start(r);
    setState('nav');
    // One move from the overview into driving: zoom in on you, facing the route's first stretch.
    var a = r.coords[0];
    var b = r.coords[Math.min(r.coords.length - 1, 6)];
    map.recenter({ zoom: zoomFor(fix && fix.speed > 0 ? fix.speed : 0, 9999), bearing: geo.bearing(a[0], a[1], b[0], b[1]) });
  }

  function backToSearch() {
    trip = emptyTrip();
    map.setRoutes([]);
    setState('explore');
    map.recenter();
    openSheet('search');
    search.open(true);
  }

  // --- Driving ---

  function showOverview() {
    var r = nav.route();
    if (!r) return;
    setState('overview');
    map.fit([r.coords.slice(r.snap ? r.snap.idx : 0)]);
  }

  function resume() {
    clearTimeout(timers.resume);
    setState('nav');
    map.recenter();
  }

  function endRoute() {
    closeSheet();
    FM.report.stop();
    nav.end();
    flashPill('Route Ended');
  }

  nav.onchange = function () {
    syncRoute();
    if (!nav.active() && (state === 'nav' || state === 'overview')) {
      setState('explore');
      map.recenter();
    }
    refresh();
  };

  nav.onmessage = function (text) {
    if (text) flashPill(text, 'warn');
  };

  nav.onarrive = function (dest) {
    FM.report.stop();
    setText('arrived-name', dest.name);
    setState('arrived');
    map.recenter();
    clearTimeout(timers.arrived);
    timers.arrived = setTimeout(function () {
      if (state === 'arrived') setState('explore');
    }, ARRIVED_MS);
  };

  // --- Status pill, compass, scale ---

  function flashPill(text, tone, ms) {
    flash = { text: text, tone: tone || 'info', until: Date.now() + (ms || FLASH_MS) };
    renderStatus();
    clearTimeout(timers.flash);
    timers.flash = setTimeout(renderStatus, (ms || FLASH_MS) + 50);
  }

  // Where location stands, honestly: each case says what's wrong and, where it can, what to do.
  function gpsState() {
    if (gpsError === 1) return 'denied';
    if (!fix) return gpsError ? 'unavailable' : 'searching';
    if (Date.now() - fix.time > STALE_MS) return 'lost';
    if (fix.accuracy > ROUGH_M) return 'rough';
    return 'good';
  }

  function renderStatus() {
    var g = gpsState();
    var p = null;
    if (flash && Date.now() < flash.until) p = flash;
    else if (g === 'searching') {
      p = { text: Date.now() - gpsStartedAt > SLOW_FIX_MS ? 'Still Looking — Try Outside' : 'Finding Your Location', tone: 'locating' };
    } else if (g === 'unavailable') p = { text: 'Location Unavailable', tone: 'warn' };
    else if (g === 'lost') p = { text: 'GPS Signal Lost', tone: 'warn' };
    else if (g === 'rough') p = { text: 'Approximate Location', tone: 'warn' };
    else if (navigator.onLine === false) p = { text: 'Offline', tone: 'muted' };
    var pill = $('pill');
    if (p) {
      setText('pill-text', p.text);
      if (pill.className !== p.tone) pill.className = p.tone;
    }
    show('pill', !!p);

    // Location switched off gets a card with the way back, not a passing pill.
    var denied = g === 'denied' && (state === 'explore' || state === 'preview');
    if (denied) {
      setText('notice-title', 'Location Is Off');
      setText('notice-body', 'Allow location for this page in the browser, then press OK.');
    }
    if ($('notice').hidden === denied) {
      show('notice', denied);
      layout();
    }
  }

  function isRotated() {
    var b = map.bearing();
    return b > 1 && b < 359;
  }

  function renderCompass() {
    show('compass', isRotated());
    $('compass-needle').style.transform = 'rotate(' + (-map.bearing()).toFixed(1) + 'deg)';
  }

  function showScale() {
    var s = geo.niceScale(map.metersPerPixel(), 72);
    $('scale-bar').style.width = Math.round(s.px) + 'px';
    setText('scale-text', s.label);
    show('scale', true);
    clearTimeout(timers.scale);
    timers.scale = setTimeout(function () { show('scale', false); }, SCALE_MS);
  }

  map.onzoom = showScale;

  // --- Settings sheet ---

  function openSettings() {
    openSheet('settings');
    var rows = [
      { icon: 'speaker', tint: 'green', label: 'Voice Guidance', on: function () { return nav.voice(); },
        act: function () { nav.voice(!nav.voice()); } },
      { icon: 'appearance', tint: 'blue', label: 'Appearance', value: function () { return APPEARANCE_NAMES[prefs.appearance]; },
        act: cycleAppearance },
      { icon: 'rotate', tint: 'orange', label: 'Rotate Map', on: function () { return prefs.rotate; },
        act: toggleRotate },
      { icon: 'motion', tint: 'blue', label: 'Reduce Motion', on: function () { return prefs.still; },
        act: toggleStill },
      null,
      { icon: 'gauge', tint: 'gray', label: 'Drive Report', link: true, act: openReport },
      { icon: 'check', tint: 'gray', label: 'Phone Check', link: true,
        act: function () { location.href = 'probe.html'; } }
    ];
    if (nav.active()) rows.push(null, { label: 'End Route', danger: true, act: endRoute });

    var holder = $('settings-body');
    var group = null;
    holder.innerHTML = '';
    settingsRows = [];
    rows.forEach(function (r) {
      if (!r) {
        group = null;
        return;
      }
      if (!group) {
        group = document.createElement('ul');
        group.className = 'group';
        holder.appendChild(group);
      }
      var li = document.createElement('li');
      li.tabIndex = 0;
      if (r.danger) {
        li.className = 'danger';
        li.textContent = r.label;
      } else {
        li.innerHTML = '<span class="icon-tile tint-' + r.tint + '">' + icons.icon(r.icon) + '</span>' +
          '<span class="row-label clip"></span><span class="accessory"></span>';
        li.querySelector('.row-label').textContent = r.label;
      }
      r.el = li;
      group.appendChild(li);
      settingsRows.push(r);
      syncRow(r);
    });
    settingsRows[0].el.focus();
  }

  function syncRow(r) {
    var acc = r.el.querySelector('.accessory');
    if (!acc) return;
    if (r.on) {
      if (!acc.firstChild) acc.innerHTML = '<span class="switch"><i></i></span>';
      acc.firstChild.classList.toggle('on', r.on());
    } else if (r.value) {
      acc.innerHTML = '<span class="value"></span>' + icons.icon('chevron');
      acc.firstChild.textContent = r.value();
    } else if (r.link) {
      acc.innerHTML = icons.icon('chevron');
    }
  }

  function settingsKey(k) {
    var i = settingsRows.map(function (r) { return r.el; }).indexOf(document.activeElement);
    switch (k) {
      case 'ArrowDown':
      case '8':
        if (settingsRows[i + 1]) settingsRows[i + 1].el.focus();
        return true;
      case 'ArrowUp':
      case '2':
        if (settingsRows[i - 1]) settingsRows[i - 1].el.focus();
        return true;
      case 'Enter':
      case '5':
        if (settingsRows[i]) {
          settingsRows[i].act();
          if (sheet === 'settings') syncRow(settingsRows[i]);
        }
        return true;
      case 'SoftRight':
      case 'SoftLeft':
      case 'Backspace':
      case 'Escape':
        closeSheet();
        return true;
    }
    return false;
  }

  function cycleAppearance() {
    prefs.appearance = APPEARANCES[(APPEARANCES.indexOf(prefs.appearance) + 1) % APPEARANCES.length];
    savePrefs();
    applyTheme();
  }

  // Jumps instead of glides: for phones that stutter, or people who prefer it.
  function toggleStill() {
    prefs.still = !prefs.still;
    savePrefs();
    applyMotion();
  }

  function applyMotion() {
    map.setStill(prefs.still);
    body.classList.toggle('still', prefs.still);
  }

  function toggleRotate() {
    prefs.rotate = !prefs.rotate;
    savePrefs();
    map.setRotate(prefs.rotate);
  applyMotion();
  }

  function loadPrefs() {
    var p = null;
    try {
      p = JSON.parse(localStorage.getItem(PREFS_KEY));
    } catch (e) {}
    p = p || {};
    return {
      appearance: APPEARANCES.indexOf(p.appearance) >= 0 ? p.appearance : 'auto',
      rotate: p.rotate !== false,
      still: p.still === true
    };
  }

  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch (e) {}
  }

  // Automatic appearance follows the sun where you are: dark map after dusk, for night driving.
  function applyTheme() {
    var theme = prefs.appearance;
    if (theme === 'auto') {
      var c = map.center();
      theme = geo.sunAltitude(new Date(), c.lat, c.lon) > -4 ? 'light' : 'dark';
    }
    map.setTheme(theme);
    if (root.getAttribute('data-theme') === theme) return;
    root.setAttribute('data-theme', theme);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#000000' : '#f2f2f7');
  }

  // --- Keys ---

  function mapKeys(k) {
    switch (k) {
      case 'ArrowUp': case '2': map.pan(0, -PAN_STEP); return true;
      case 'ArrowDown': case '8': map.pan(0, PAN_STEP); return true;
      case 'ArrowLeft': case '4': map.pan(-PAN_STEP, 0); return true;
      case 'ArrowRight': case '6': map.pan(PAN_STEP, 0); return true;
      case '1': case '-': map.zoomBy(-1); return true;
      case '3': case '=': case '+': map.zoomBy(1); return true;
    }
    return false;
  }

  function simDetour() {
    if (!sim.enabled) return false;
    sim.detour();
    flashPill('Simulating a wrong turn');
    return true;
  }

  var handlers = {
    explore: function (k) {
      switch (k) {
        case 'SoftLeft': case '7':
          openSheet('search');
          search.open(false);
          return true;
        case 'SoftRight': case '9':
          openSettings();
          return true;
        case 'Enter': case '5':
          if (!fix && gpsError) watchGps();
          else if (!map.following()) map.recenter();
          else if (isRotated()) map.resetNorth();
          return true;
        case '0':
          return simDetour();
      }
      return mapKeys(k);
    },

    preview: function (k) {
      switch (k) {
        case 'Enter': case '5':
          startRoute();
          return true;
        case 'SoftLeft': case 'Backspace': case 'Escape':
          backToSearch();
          return true;
        case 'ArrowLeft': case '4':
          cycleRoute(-1);
          return true;
        case 'ArrowRight': case '6':
          cycleRoute(1);
          return true;
        case '1': case '3': case '-': case '=': case '+':
          return mapKeys(k);
      }
      return false;
    },

    nav: function (k) {
      switch (k) {
        case 'SoftLeft': case '7':
          showOverview();
          return true;
        case 'SoftRight': case '9':
          openSettings();
          return true;
        case 'Enter': case '5':
          if (map.following()) nav.repeat();
          else resume();
          return true;
        case 'Backspace': case 'Escape':
          if (!map.following()) {
            resume();
            return true;
          }
          if (Date.now() - exitArmedAt < EXIT_MS) return false; // second press: let it close the app
          exitArmedAt = Date.now();
          flashPill('Press Back again to exit', 'info', EXIT_MS);
          return true;
        case '0':
          return simDetour();
      }
      return mapKeys(k);
    },

    overview: function (k) {
      switch (k) {
        case 'SoftLeft': case '7': case 'Enter': case '5': case 'Backspace': case 'Escape':
          resume();
          return true;
        case 'SoftRight': case '9':
          openSettings();
          return true;
      }
      return mapKeys(k);
    },

    arrived: function (k) {
      switch (k) {
        case 'Enter': case '5': case 'SoftLeft': case 'SoftRight': case 'Backspace': case 'Escape':
          setState('explore');
          return true;
      }
      return mapKeys(k);
    }
  };

  document.addEventListener('keydown', function (e) {
    var used = sheet === 'search' ? search.key(e)
      : sheet === 'settings' ? settingsKey(e.key)
        : sheet === 'report' ? reportKey(e.key)
          : handlers[state](e.key);
    if (used) e.preventDefault();
    FM.report.key();
    clearTimeout(timers.resume);
    if (state === 'nav' && !sheet && !map.following()) timers.resume = setTimeout(resume, RESUME_MS);
    renderCompass();
    refreshKeys();
  });
  document.addEventListener('focusin', refreshKeys); // e.g. search results arriving

  // --- Drive report sheet: read-only; up and down scroll ---

  function openReport() {
    closeSheet();
    openSheet('report');
    var body = $('report-body');
    FM.report.rows(function (data) {
      body.innerHTML = '';
      if (!data) {
        body.innerHTML = '<div class="empty"><b>No Trips Yet</b><span></span></div>';
        body.querySelector('span').textContent = 'Start a route; the report fills in as you drive.';
        return;
      }
      var head = document.createElement('h3');
      head.className = 'section-head clip';
      head.textContent = data.title;
      body.appendChild(head);
      data.groups.forEach(function (rows) {
        var ul = document.createElement('ul');
        ul.className = 'group report';
        rows.forEach(function (row) {
          var li = document.createElement('li');
          li.innerHTML = '<span class="row-label clip"></span><span class="value"></span>';
          li.firstChild.textContent = row[0];
          li.lastChild.textContent = row[1];
          ul.appendChild(li);
        });
        body.appendChild(ul);
      });
    });
  }

  function reportKey(k) {
    var body = $('report-body');
    switch (k) {
      case 'ArrowDown': case '8': body.scrollTop += 60; return true;
      case 'ArrowUp': case '2': body.scrollTop -= 60; return true;
      case 'SoftRight': case 'SoftLeft': case 'Backspace': case 'Escape': case 'Enter': case '5':
        closeSheet();
        return true;
    }
    return false;
  }

  // Simulator only: FM.debug.preview({ name, lat, lon }) opens a route preview to anywhere.
  if (sim.enabled) FM.debug = { preview: openPreview };

  search.onchoose = function (place) {
    closeSheet();
    openPreview(place);
  };
  search.onclose = closeSheet;

  // --- GPS ---

  function onFix(pos) {
    var c = pos.coords;
    var first = !fix;
    fix = {
      lat: c.latitude,
      lon: c.longitude,
      accuracy: c.accuracy,
      heading: c.heading,
      speed: c.speed,
      time: Date.now()
    };
    gpsError = 0;
    map.setStale(false);
    map.setFix(fix);
    FM.report.fix(fix);
    nav.update(fix);
    syncRoute();
    if (first) applyTheme();
    if (state === 'preview') planTrip();
    renderNav();
    renderStatus();
    renderCompass();
    if (state === 'explore') refreshKeys();
  }

  function onError(err) {
    gpsError = err.code;
    renderStatus();
    refreshKeys();
  }

  // Also the Retry action: asking again re-prompts for permission where the browser allows it.
  function watchGps() {
    if (!navigator.geolocation) {
      gpsError = 2;
      return;
    }
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    gpsError = 0;
    gpsStartedAt = Date.now();
    watchId = navigator.geolocation.watchPosition(onFix, onError, {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 30000
    });
    renderStatus();
    refreshKeys();
  }

  function startGps() {
    if (sim.enabled) sim.start(onFix);
    else watchGps();
    setInterval(function () {
      if (fix) map.setStale(Date.now() - fix.time > STALE_MS);
      renderStatus();
    }, 5000);
  }

  // Keep the screen on while the map is open. Each API is tried only if this Gecko has it.
  function keepScreenOn() {
    try {
      if (navigator.wakeLock) navigator.wakeLock.request('screen').catch(function () {});
      else if (navigator.b2g && navigator.b2g.requestWakeLock) navigator.b2g.requestWakeLock('screen');
      else if (navigator.requestWakeLock) navigator.requestWakeLock('screen');
    } catch (e) {}
  }

  // --- Start ---

  // Coming back (flip opened, app in front again): screen-on again, and if GPS went quiet while
  // hidden, start it afresh rather than trust a watch the browser may have dropped.
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) return;
    keepScreenOn();
    if (!sim.enabled && (!fix || Date.now() - fix.time > STALE_MS)) watchGps();
    renderStatus();
  });
  window.addEventListener('online', renderStatus);
  window.addEventListener('offline', renderStatus);
  window.addEventListener('resize', layout);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }

  applyTheme();
  setInterval(applyTheme, 60000);
  map.setRotate(prefs.rotate);
  setState(nav.active() ? 'nav' : 'explore');
  startGps();
  keepScreenOn();
})(window.FM = window.FM || {});
