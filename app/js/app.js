// Wires everything together: GPS, the status bar, the turn banner, soft keys, menus, keypad.
(function (FM) {
  'use strict';

  var geo = FM.geo;
  var map = FM.map;
  var nav = FM.nav;
  var search = FM.search;
  var sim = FM.sim;

  var PAN_STEP = 48; // pixels per key press
  var STALE_MS = 15000; // no fix for this long = signal lost
  var MPS_TO_MPH = 2.23694;

  var gpsEl = document.getElementById('gps');
  var speedEl = document.getElementById('speed');
  var navEl = document.getElementById('nav');
  var navIcon = document.getElementById('nav-icon');
  var navDist = document.getElementById('nav-dist');
  var navText = document.getElementById('nav-text');
  var navTrip = document.getElementById('nav-trip');
  var toastEl = document.getElementById('toast');
  var menuEl = document.getElementById('menu');
  var menuList = document.getElementById('menu-items');
  var skLeft = document.getElementById('sk-left');
  var skCenter = document.getElementById('sk-center');
  var skRight = document.getElementById('sk-right');

  var fix = null;
  var toastTimer = null;
  var menuActions = [];

  // --- Screen pieces ---

  function setStatus(text, level) {
    gpsEl.textContent = text;
    gpsEl.className = level;
  }

  function toast(text) {
    clearTimeout(toastTimer);
    toastEl.hidden = !text;
    if (!text) return;
    toastEl.textContent = text;
    toastTimer = setTimeout(function () { toastEl.hidden = true; }, 4000);
  }

  function renderNav() {
    var s = nav.state();
    var wasHidden = navEl.hidden;
    navEl.hidden = s.mode === 'off';
    if (s.mode === 'pending') {
      navIcon.textContent = '…';
      navDist.textContent = 'Finding route';
      navText.textContent = s.dest.name;
      navTrip.textContent = fix ? '' : 'Waiting for GPS';
    } else if (s.mode === 'on') {
      navIcon.textContent = s.step.icon;
      navDist.textContent = geo.formatDistance(s.toNext);
      navText.textContent = s.step.text;
      navTrip.textContent = arrival(s.secs) + ' · ' + geo.formatDuration(s.secs) + ' · ' + geo.formatDistance(s.remaining);
    }
    if (wasHidden !== navEl.hidden) map.render(); // the map just got taller or shorter
  }

  function arrival(secs) {
    return new Date(Date.now() + secs * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  function refreshKeys() {
    var k;
    if (search.isOpen()) k = search.softkeys();
    else if (!menuEl.hidden) k = ['', 'Select', 'Close'];
    else if (!map.following()) k = ['Search', 'Follow', 'Options'];
    else k = ['Search', nav.route() ? 'Repeat' : 'Following', 'Options'];
    skLeft.textContent = k[0];
    skCenter.textContent = k[1];
    skRight.textContent = k[2];
    skCenter.classList.toggle('on', k[1] === 'Following');
  }

  // --- Options menu ---

  function openMenu() {
    var items = [
      ['Zoom in  (3)', function () { map.zoomBy(1); }],
      ['Zoom out  (1)', function () { map.zoomBy(-1); }],
      ['Voice: ' + (nav.voice() ? 'on' : 'off'), function () {
        nav.voice(!nav.voice());
        toast('Voice ' + (nav.voice() ? 'on' : 'off'));
      }]
    ];
    if (nav.active()) items.push(['End route', function () { nav.end(); toast('Route ended'); }]);
    items.push(['Phone check', function () { location.href = 'probe.html'; }]);

    menuList.innerHTML = '';
    menuActions = items.map(function (item) {
      var li = document.createElement('li');
      li.tabIndex = 0;
      li.textContent = item[0];
      menuList.appendChild(li);
      return item[1];
    });
    menuEl.hidden = false;
    menuList.children[0].focus();
  }

  function closeMenu() {
    menuEl.hidden = true;
    if (document.activeElement) document.activeElement.blur();
  }

  function menuKey(e) {
    var items = Array.prototype.slice.call(menuList.children);
    var i = items.indexOf(document.activeElement);
    switch (e.key) {
      case 'ArrowDown':
        items[Math.min(i + 1, items.length - 1)].focus();
        return true;
      case 'ArrowUp':
        items[Math.max(i - 1, 0)].focus();
        return true;
      case 'Enter':
        closeMenu();
        if (i >= 0) menuActions[i]();
        return true;
      case 'SoftRight':
      case 'Backspace':
      case 'Escape':
        closeMenu();
        return true;
    }
    return false;
  }

  // --- Keypad ---
  // D-pad or 2/4/6/8 pans, Enter or 5 snaps back to you (or repeats the next turn), 1/3 zoom,
  // soft keys or 7/9 open Search/Options. The digits are there because the regular KaiOS browser
  // may keep the D-pad and soft keys for itself.

  function mapKey(e) {
    switch (e.key) {
      case 'ArrowUp': case '2': map.pan(0, -PAN_STEP); break;
      case 'ArrowDown': case '8': map.pan(0, PAN_STEP); break;
      case 'ArrowLeft': case '4': map.pan(-PAN_STEP, 0); break;
      case 'ArrowRight': case '6': map.pan(PAN_STEP, 0); break;
      case 'Enter': case '5':
        if (map.following() && nav.route()) nav.repeat();
        else map.recenter();
        break;
      case '1': case '-': map.zoomBy(-1); break;
      case '3': case '=': case '+': map.zoomBy(1); break;
      case 'SoftLeft': case '7': search.open(); break;
      case 'SoftRight': case '9': openMenu(); break;
      case '0':
        if (!sim.enabled) return false;
        sim.detour();
        toast('Sim: leaving the route');
        break;
      default:
        return false;
    }
    return true;
  }

  document.addEventListener('keydown', function (e) {
    var used = search.isOpen() ? search.key(e) : !menuEl.hidden ? menuKey(e) : mapKey(e);
    if (used) e.preventDefault();
    refreshKeys();
  });
  document.addEventListener('focusin', refreshKeys); // e.g. search results arriving

  // --- GPS ---

  function onFix(pos) {
    var c = pos.coords;
    fix = {
      lat: c.latitude,
      lon: c.longitude,
      accuracy: c.accuracy,
      heading: c.heading,
      speed: c.speed,
      time: Date.now()
    };
    setStatus('GPS ±' + Math.round(c.accuracy) + ' m', c.accuracy <= 25 ? 'ok' : 'warn');
    speedEl.textContent = typeof c.speed === 'number' && !isNaN(c.speed)
      ? Math.round(c.speed * MPS_TO_MPH) + ' mph'
      : '';
    map.setFix(fix);
    nav.update(fix);
    renderNav();
  }

  function onError(err) {
    if (err.code === 1) setStatus('GPS: permission denied', 'bad');
    else if (err.code === 2) setStatus('GPS: no signal', 'warn');
    else setStatus('GPS: searching…', 'warn');
  }

  function startGps() {
    if (sim.enabled) {
      sim.start(onFix);
    } else if (navigator.geolocation) {
      navigator.geolocation.watchPosition(onFix, onError, {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 30000
      });
    } else {
      setStatus('GPS: not supported', 'bad');
    }

    setInterval(function () {
      if (fix && Date.now() - fix.time > STALE_MS) {
        setStatus('GPS: signal lost', 'bad');
        speedEl.textContent = '';
      }
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

  nav.onchange = function () {
    renderNav();
    refreshKeys();
  };
  nav.onmessage = toast;

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) map.save();
    else keepScreenOn();
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }

  map.render();
  renderNav();
  refreshKeys();
  if (nav.active()) toast('Resuming route to ' + nav.state().dest.name);
  startGps();
  keepScreenOn();
})(window.FM = window.FM || {});
