// The map: tiles, routes and your position. Everything sits on one "world" layer that a CSS transform
// moves, turns and scales, so travel between GPS fixes, zooms and turns glides instead of jumping.
// Knows nothing about keys, screens or navigation.
(function (FM) {
  'use strict';

  var geo = FM.geo;
  // OpenStreetMap's standard tiles. style.css tones them down for light and dark appearance.
  var TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  var TILE = 256;
  var MIN_ZOOM = 3;
  var MAX_ZOOM = 19;
  var FIRST_FIX_ZOOM = 16;
  var VIEW_KEY = 'flipmap.view';
  var REANCHOR_PX = 50000; // keeps pixel numbers small after a long drive
  var MAX_TILES = 64;
  var RETRY_MS = 8000;
  var PREV_MS = 1500;
  var ZOOM_MS = 320;
  var PAN_MS = 240;
  var EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';
  var DRIVE_FOCUS = 0.72; // while driving you sit low on screen, so more of the road ahead shows
  var FIT_PAD = 22;
  var RAD = Math.PI / 180;

  var still = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  function $(id) {
    return document.getElementById(id);
  }

  var mapEl = $('map');
  var worldEls = [$('world'), $('world-over')]; // tiles (color-filtered) and routes, moved together
  var tilesEl = $('tiles');
  var prevEl = $('tiles-prev');
  var altsEdgeEl = $('route-alts-edge');
  var altsEl = $('route-alts');
  var edgeEl = $('route-edge');
  var lineEl = $('route-line');
  var destEl = $('route-dest');
  var puckEl = $('puck');
  var headingEl = $('puck-heading');
  var haloEl = $('halo');

  var saved = loadView();
  var cam = {
    lat: saved ? saved.lat : 39.83, // middle of the US until we know better
    lon: saved ? saved.lon : -98.58,
    zoom: saved ? saved.zoom : 4,
    scale: 1, // not 1 only while a zoom animates
    bearing: 0, // compass direction at the top of the screen
    rot: 0 // the same, but continuous, so turning past north doesn't spin the long way round
  };
  var anchor = { lat: cam.lat, lon: cam.lon }; // world pixels are measured from here
  var anchorPx = null;
  var driving = false;
  var rotate = true;
  var follow = true;
  var fitted = false;
  var manualZoom = false;
  var insets = { top: 0, bottom: 0 };
  var fix = null;
  var heading = null;
  var headingRot = 0;
  var lastFixAt = 0;
  var gpsMs = 1000;
  var tiles = {};
  var zoomTimer = null;
  var zoomTarget = null;
  var prevTimer = null;
  var routes = [];
  var selected = 0;

  // --- Coordinates ---

  function anchorAt() {
    if (!anchorPx) {
      var p = geo.project(anchor.lat, anchor.lon, cam.zoom);
      anchorPx = { x: Math.round(p.x), y: Math.round(p.y) }; // whole pixels keep tile seams invisible
    }
    return anchorPx;
  }

  function toWorld(lat, lon) {
    var p = geo.project(lat, lon, cam.zoom);
    var a = anchorAt();
    return { x: p.x - a.x, y: p.y - a.y };
  }

  function focusPoint() {
    var w = mapEl.clientWidth;
    var h = mapEl.clientHeight;
    var top = insets.top;
    var bottom = h - insets.bottom;
    return { x: w / 2, y: top + (bottom - top) * (driving && !fitted ? DRIVE_FOCUS : 0.5) };
  }

  function toScreen(p, f, c) {
    var a = -cam.rot * RAD;
    var dx = (p.x - f.x) * cam.scale;
    var dy = (p.y - f.y) * cam.scale;
    return {
      x: c.x + dx * Math.cos(a) - dy * Math.sin(a),
      y: c.y + dx * Math.sin(a) + dy * Math.cos(a)
    };
  }

  function turnTo(from, to) {
    return from + ((((to - from) % 360) + 540) % 360) - 180;
  }

  function setBearing(b) {
    cam.rot = turnTo(cam.rot, b);
    cam.bearing = ((b % 360) + 360) % 360;
  }

  // --- Placing the camera ---

  function transition(how) {
    if (still || how === 'none') return 'none';
    if (how === 'gps') return 'transform ' + gpsMs + 'ms linear';
    return 'transform ' + (how === 'zoom' ? ZOOM_MS : PAN_MS) + 'ms ' + EASE;
  }

  function place(how) {
    var f = toWorld(cam.lat, cam.lon);
    if (Math.abs(f.x) > REANCHOR_PX || Math.abs(f.y) > REANCHOR_PX) {
      reanchor();
      f = toWorld(cam.lat, cam.lon);
      how = 'none';
    }
    var c = focusPoint();
    var t = transition(how);
    var transform = 'translate(' + px(c.x) + ',' + px(c.y) + ') rotate(' + deg(-cam.rot) +
      ') scale(' + cam.scale + ') translate(' + px(-f.x) + ',' + px(-f.y) + ')';
    worldEls.forEach(function (el) {
      el.style.transition = t;
      el.style.transform = transform;
    });
    placePuck(f, c, t);
    loadTiles(f, c);
  }

  function px(v) {
    return v.toFixed(2) + 'px';
  }

  function deg(v) {
    return v.toFixed(2) + 'deg';
  }

  function placePuck(f, c, t) {
    if (!fix) return;
    var s = toScreen(toWorld(fix.lat, fix.lon), f, c);
    puckEl.hidden = false;
    puckEl.style.transition = t;
    puckEl.style.transform = 'translate(' + px(s.x) + ',' + px(s.y) + ')';
    headingEl.style.transition = t;
    headingEl.style.transform = 'rotate(' + deg(headingRot - cam.rot) + ')';
    puckEl.classList.toggle('has-heading', heading !== null);

    var r = fix.accuracy / geo.metersPerPixel(fix.lat, cam.zoom) * cam.scale;
    haloEl.hidden = r < 12;
    haloEl.style.transition = t;
    haloEl.style.width = haloEl.style.height = px(r * 2);
    haloEl.style.transform = 'translate(' + px(s.x - r) + ',' + px(s.y - r) + ')';
  }

  function reanchor() {
    anchor = { lat: cam.lat, lon: cam.lon };
    anchorPx = null;
    tilesEl.innerHTML = '';
    prevEl.innerHTML = '';
    tiles = {};
    drawRoutes();
  }

  // --- Tiles ---

  // Load every tile under the (possibly rotated) screen, plus half a tile of slack for motion.
  function loadTiles(f, c) {
    var w = mapEl.clientWidth;
    var h = mapEl.clientHeight;
    var a = cam.rot * RAD;
    var cos = Math.cos(a);
    var sin = Math.sin(a);
    var minX = Infinity;
    var minY = Infinity;
    var maxX = -Infinity;
    var maxY = -Infinity;
    [[0, 0], [w, 0], [0, h], [w, h]].forEach(function (pt) {
      var dx = (pt[0] - c.x) / cam.scale;
      var dy = (pt[1] - c.y) / cam.scale;
      var x = f.x + dx * cos - dy * sin;
      var y = f.y + dx * sin + dy * cos;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    });

    var ap = anchorAt();
    var n = Math.pow(2, cam.zoom);
    var slack = TILE / 2;
    var x0 = Math.floor((minX - slack + ap.x) / TILE);
    var x1 = Math.floor((maxX + slack + ap.x) / TILE);
    var y0 = Math.max(0, Math.floor((minY - slack + ap.y) / TILE));
    var y1 = Math.min(n - 1, Math.floor((maxY + slack + ap.y) / TILE));
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > MAX_TILES) return; // mid zoom-out; the settled zoom loads

    var now = Date.now();
    for (var ty = y0; ty <= y1; ty++) {
      for (var tx = x0; tx <= x1; tx++) {
        var key = tx + '/' + ty;
        var img = tiles[key];
        if (img && img.failedAt && now - img.failedAt > RETRY_MS) {
          drop(key);
          img = null;
        }
        if (!img) tiles[key] = makeTile(tx, ty, n, ap);
      }
    }
    // Forget tiles a full tile beyond what's needed.
    for (var k in tiles) {
      var parts = k.split('/');
      var kx = +parts[0];
      var ky = +parts[1];
      if (kx < x0 - 1 || kx > x1 + 1 || ky < y0 - 1 || ky > y1 + 1) drop(k);
    }
  }

  function makeTile(tx, ty, n, ap) {
    var img = document.createElement('img');
    img.className = 'tile';
    img.alt = '';
    img.onload = function () {
      img.classList.add('ready');
      if (!tilesEl.querySelector('.tile:not(.ready)')) clearPrev();
    };
    img.onerror = function () {
      img.failedAt = Date.now();
    };
    img.style.left = (tx * TILE - ap.x) + 'px';
    img.style.top = (ty * TILE - ap.y) + 'px';
    img.src = TILE_URL
      .replace('{z}', cam.zoom)
      .replace('{x}', ((tx % n) + n) % n)
      .replace('{y}', ty);
    tilesEl.appendChild(img);
    return img;
  }

  function drop(key) {
    var img = tiles[key];
    if (img && img.parentNode) img.parentNode.removeChild(img);
    delete tiles[key];
  }

  function clearPrev() {
    clearTimeout(prevTimer);
    prevEl.innerHTML = '';
  }

  // --- Zoom: scale the world smoothly, then swap in sharp tiles for the new level ---

  function zoomTo(z, announce) {
    z = geo.clamp(Math.round(z), MIN_ZOOM, MAX_ZOOM);
    if (zoomTimer) settleZoom();
    if (z === cam.zoom) {
      place('zoom');
      return;
    }
    if (still) {
      setZoom(z, announce);
      return;
    }
    cam.scale = Math.pow(2, z - cam.zoom);
    zoomTarget = { z: z, announce: announce };
    place('zoom');
    zoomTimer = setTimeout(settleZoom, ZOOM_MS);
  }

  function settleZoom() {
    clearTimeout(zoomTimer);
    zoomTimer = null;
    if (!zoomTarget) return;
    var t = zoomTarget;
    zoomTarget = null;
    setZoom(t.z, t.announce);
  }

  function setZoom(z, announce) {
    // Keep the current tiles on screen, scaled to the new level, until sharper ones arrive.
    clearPrev();
    while (tilesEl.firstChild) prevEl.appendChild(tilesEl.firstChild);
    prevEl.style.transform = 'scale(' + Math.pow(2, z - cam.zoom) + ')';
    prevTimer = setTimeout(clearPrev, PREV_MS);
    tiles = {};
    cam.zoom = z;
    cam.scale = 1;
    anchorPx = null;
    place('none');
    drawRoutes();
    saveView();
    if (announce && FM.map.onzoom) FM.map.onzoom();
  }

  // --- Routes (SVG in world pixels, so they ride along with the tiles) ---

  function drawRoutes() {
    var alts = '';
    for (var i = 0; i < routes.length; i++) {
      if (i !== selected) alts += pathData(routes[i], false);
    }
    altsEdgeEl.setAttribute('d', alts);
    altsEl.setAttribute('d', alts);

    var r = routes[selected];
    var d = r ? pathData(r, true) : '';
    edgeEl.setAttribute('d', d);
    lineEl.setAttribute('d', d);
    if (r) {
      var end = r.coords[r.coords.length - 1];
      var p = toWorld(end[0], end[1]);
      destEl.setAttribute('cx', p.x.toFixed(1));
      destEl.setAttribute('cy', p.y.toFixed(1));
    }
    destEl.style.display = r ? '' : 'none';
  }

  // The active route is drawn only from where you are onward.
  function pathData(r, trim) {
    var ap = anchorAt();
    var key = cam.zoom + ':' + ap.x + ':' + ap.y;
    if (!r.px || r.px.key !== key) {
      r.px = {
        key: key,
        pts: r.coords.map(function (c) {
          var p = toWorld(c[0], c[1]);
          return p.x.toFixed(1) + ' ' + p.y.toFixed(1);
        })
      };
    }
    var pts = r.px.pts;
    var from = 0;
    var d = '';
    if (trim && r.snap) {
      var s = toWorld(r.snap.lat, r.snap.lon);
      d = 'M' + s.x.toFixed(1) + ' ' + s.y.toFixed(1);
      from = r.snap.idx + 1;
    }
    for (var i = from; i < pts.length; i++) d += (d ? 'L' : 'M') + pts[i];
    return d;
  }

  // --- Saved view ---

  function loadView() {
    try {
      var v = JSON.parse(localStorage.getItem(VIEW_KEY));
      if (v && isFinite(v.lat) && isFinite(v.lon) && isFinite(v.zoom)) return v;
    } catch (e) {}
    return null;
  }

  function saveView() {
    try {
      localStorage.setItem(VIEW_KEY, JSON.stringify({ lat: cam.lat, lon: cam.lon, zoom: cam.zoom }));
    } catch (e) {}
  }

  // --- Public ---

  FM.map = {
    onzoom: null,

    render: function () {
      place('none');
      drawRoutes();
    },

    // Space covered by cards at the top and bottom; the map centers in what's left.
    setInsets: function (top, bottom) {
      if (top === insets.top && bottom === insets.bottom) return;
      insets = { top: top, bottom: bottom };
      place('pan');
    },

    setFix: function (f) {
      var now = Date.now();
      gpsMs = lastFixAt ? Math.round(geo.clamp(now - lastFixAt, 250, 1500)) : 1000;
      lastFixAt = now;
      var first = !fix;
      fix = f;
      if (f.speed > 1 && typeof f.heading === 'number' && isFinite(f.heading)) {
        heading = f.heading;
        headingRot = turnTo(headingRot, f.heading);
        if (follow && rotate && f.speed > 2.5) setBearing(f.heading);
      }
      if (follow) {
        cam.lat = f.lat;
        cam.lon = f.lon;
      }
      if (zoomTimer) return; // the zoom in progress picks this up when it settles
      if (first && cam.zoom < FIRST_FIX_ZOOM) setZoom(FIRST_FIX_ZOOM, false);
      else place('gps');
    },

    setStale: function (stale) {
      puckEl.classList.toggle('stale', stale);
    },

    setDriving: function (on) {
      if (on === driving) return;
      driving = on;
      mapEl.classList.toggle('driving', on);
      place('pan');
    },

    setRotate: function (on) {
      rotate = on;
      if (!on) setBearing(0);
      else if (follow && heading !== null && fix && fix.speed > 2.5) setBearing(heading);
      place('pan');
    },

    pan: function (dx, dy) {
      var a = cam.rot * RAD;
      var wx = (dx * Math.cos(a) - dy * Math.sin(a)) / cam.scale;
      var wy = (dx * Math.sin(a) + dy * Math.cos(a)) / cam.scale;
      var f = toWorld(cam.lat, cam.lon);
      var ap = anchorAt();
      var ll = geo.unproject(f.x + wx + ap.x, f.y + wy + ap.y, cam.zoom);
      cam.lat = geo.clamp(ll.lat, -85, 85);
      cam.lon = ll.lon;
      follow = false;
      place('pan');
      saveView();
    },

    zoomBy: function (d) {
      manualZoom = true;
      zoomTo(cam.zoom + d, true);
    },

    // Driving picks its own zoom from speed, unless you've zoomed by hand since the last recenter.
    autoZoom: function (z) {
      if (follow && !manualZoom && !fitted && !zoomTimer && z !== cam.zoom) zoomTo(z, false);
    },

    zoom: function () {
      return cam.zoom;
    },

    recenter: function () {
      follow = true;
      fitted = false;
      manualZoom = false;
      if (fix) {
        cam.lat = fix.lat;
        cam.lon = fix.lon;
        if (rotate && heading !== null && fix.speed > 2.5) setBearing(heading);
      }
      place('pan');
    },

    resetNorth: function () {
      setBearing(0);
      place('pan');
    },

    following: function () {
      return follow;
    },

    bearing: function () {
      return cam.bearing;
    },

    // Frame one or more lines of [lat, lon] in the space between the cards, north up.
    fit: function (lines) {
      var minX = Infinity;
      var minY = Infinity;
      var maxX = -Infinity;
      var maxY = -Infinity;
      lines.forEach(function (coords) {
        coords.forEach(function (c) {
          var p = geo.project(c[0], c[1], 0);
          minX = Math.min(minX, p.x);
          maxX = Math.max(maxX, p.x);
          minY = Math.min(minY, p.y);
          maxY = Math.max(maxY, p.y);
        });
      });
      if (!isFinite(minX)) return;
      var w = mapEl.clientWidth - FIT_PAD * 2;
      var h = mapEl.clientHeight - insets.top - insets.bottom - FIT_PAD * 2;
      var z = Math.log(Math.min(w / Math.max(maxX - minX, 1e-9), h / Math.max(maxY - minY, 1e-9))) / Math.LN2;
      var ll = geo.unproject((minX + maxX) / 2, (minY + maxY) / 2, 0);
      follow = false;
      fitted = true;
      cam.lat = ll.lat;
      cam.lon = ll.lon;
      setBearing(0);
      zoomTo(Math.min(Math.floor(z), 18), false);
    },

    setRoutes: function (list, sel) {
      routes = list || [];
      selected = sel || 0;
      drawRoutes();
    },

    select: function (i) {
      selected = i;
      drawRoutes();
    },

    refreshRoute: drawRoutes,

    // "Near me": your position if known, otherwise the middle of the map.
    center: function () {
      return fix ? { lat: fix.lat, lon: fix.lon } : { lat: cam.lat, lon: cam.lon };
    },

    metersPerPixel: function () {
      return geo.metersPerPixel(cam.lat, cam.zoom);
    }
  };

  window.addEventListener('resize', FM.map.render);
  drawRoutes();
  place('none');
})(window.FM = window.FM || {});
