// Draws the slippy map: tiles, route line, your position. Knows nothing about keys or GPS.
(function (FM) {
  'use strict';

  var geo = FM.geo;
  // OpenStreetMap's public tiles: fine for one person's light use, attribution required.
  var TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  var TILE = 256;
  var MIN_ZOOM = 3;
  var MAX_ZOOM = 19;
  var FIRST_FIX_ZOOM = 16;
  var VIEW_KEY = 'flipmap.view';

  var mapEl = document.getElementById('map');
  var tilesEl = document.getElementById('tiles');
  var canvas = document.getElementById('route');
  var ctx = canvas.getContext('2d');
  var meEl = document.getElementById('me');
  var arrowEl = document.getElementById('arrow');
  var accuracyEl = document.getElementById('accuracy');
  var crosshairEl = document.getElementById('crosshair');
  var zoomEl = document.getElementById('zoom');

  var view = loadView() || { lat: 39.83, lon: -98.58, zoom: 4 }; // middle of the US
  var follow = true;
  var fix = null;
  var tiles = {}; // "z/x/y" -> <img>
  var route = null; // [[lat, lon], ...]
  var routePx = null; // route projected to pixels at routePx.zoom

  function render() {
    var w = mapEl.clientWidth;
    var h = mapEl.clientHeight;
    var center = geo.project(view.lat, view.lon, view.zoom);
    var left = center.x - w / 2;
    var top = center.y - h / 2;

    drawTiles(left, top, w, h);
    drawRoute(left, top, w, h);
    drawMe(left, top);
    crosshairEl.hidden = follow;
    zoomEl.textContent = 'z' + view.zoom;
  }

  function drawTiles(left, top, w, h) {
    var n = Math.pow(2, view.zoom);
    var wanted = {};
    var y0 = Math.max(0, Math.floor(top / TILE));
    var y1 = Math.min(n - 1, Math.floor((top + h) / TILE));
    var x0 = Math.floor(left / TILE);
    var x1 = Math.floor((left + w) / TILE);
    for (var ty = y0; ty <= y1; ty++) {
      for (var tx = x0; tx <= x1; tx++) {
        var key = view.zoom + '/' + tx + '/' + ty;
        var img = tiles[key];
        if (!img) {
          img = document.createElement('img');
          img.alt = '';
          img.src = TILE_URL
            .replace('{z}', view.zoom)
            .replace('{x}', ((tx % n) + n) % n)
            .replace('{y}', ty);
          tilesEl.appendChild(img);
          tiles[key] = img;
        }
        img.style.left = Math.round(tx * TILE - left) + 'px';
        img.style.top = Math.round(ty * TILE - top) + 'px';
        wanted[key] = true;
      }
    }
    for (var k in tiles) {
      if (!wanted[k]) {
        tilesEl.removeChild(tiles[k]);
        delete tiles[k];
      }
    }
  }

  function drawRoute(left, top, w, h) {
    var dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!route) return;

    if (!routePx || routePx.zoom !== view.zoom) {
      routePx = {
        zoom: view.zoom,
        pts: route.map(function (c) { return geo.project(c[0], c[1], view.zoom); })
      };
    }
    var pts = routePx.pts;
    ctx.beginPath();
    ctx.moveTo(pts[0].x - left, pts[0].y - top);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x - left, pts[i].y - top);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 9;
    ctx.stroke();
    ctx.strokeStyle = '#1a73e8';
    ctx.lineWidth = 5;
    ctx.stroke();

    // Destination pin
    var end = pts[pts.length - 1];
    ctx.beginPath();
    ctx.arc(end.x - left, end.y - top, 6, 0, 2 * Math.PI);
    ctx.fillStyle = '#d93025';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  function drawMe(left, top) {
    if (!fix) return;
    var p = geo.project(fix.lat, fix.lon, view.zoom);
    var mx = p.x - left;
    var my = p.y - top;
    meEl.hidden = false;
    meEl.style.left = mx + 'px';
    meEl.style.top = my + 'px';

    var moving = typeof fix.heading === 'number' && !isNaN(fix.heading) && fix.speed > 1;
    meEl.classList.toggle('moving', moving);
    if (moving) arrowEl.style.transform = 'rotate(' + fix.heading + 'deg)';

    var r = fix.accuracy / geo.metersPerPixel(fix.lat, view.zoom);
    accuracyEl.hidden = r < 10;
    accuracyEl.style.left = mx + 'px';
    accuracyEl.style.top = my + 'px';
    accuracyEl.style.width = accuracyEl.style.height = Math.round(r * 2) + 'px';
  }

  function loadView() {
    try {
      var v = JSON.parse(localStorage.getItem(VIEW_KEY));
      if (v && isFinite(v.lat) && isFinite(v.lon) && isFinite(v.zoom)) return v;
    } catch (e) {}
    return null;
  }

  function saveView() {
    try {
      localStorage.setItem(VIEW_KEY, JSON.stringify(view));
    } catch (e) {}
  }

  window.addEventListener('resize', render);

  FM.map = {
    render: render,
    save: saveView,

    setFix: function (f) {
      var first = !fix;
      fix = f;
      if (follow) {
        view.lat = f.lat;
        view.lon = f.lon;
      }
      if (first) {
        view.zoom = Math.max(view.zoom, FIRST_FIX_ZOOM);
        saveView();
      }
      render();
    },

    setRoute: function (coords) {
      route = coords && coords.length > 1 ? coords : null;
      routePx = null;
      render();
    },

    pan: function (dx, dy) {
      var c = geo.project(view.lat, view.lon, view.zoom);
      var ll = geo.unproject(c.x + dx, c.y + dy, view.zoom);
      view.lat = geo.clamp(ll.lat, -85, 85);
      view.lon = ((ll.lon + 540) % 360) - 180;
      follow = false;
      render();
      saveView();
    },

    zoomBy: function (d) {
      view.zoom = geo.clamp(view.zoom + d, MIN_ZOOM, MAX_ZOOM);
      render();
      saveView();
    },

    recenter: function () {
      follow = true;
      if (fix) {
        view.lat = fix.lat;
        view.lon = fix.lon;
      }
      render();
    },

    following: function () {
      return follow;
    },

    // Where "near me" is: your position if known, otherwise the middle of the map.
    center: function () {
      return fix ? { lat: fix.lat, lon: fix.lon } : { lat: view.lat, lon: view.lon };
    }
  };
})(window.FM = window.FM || {});
