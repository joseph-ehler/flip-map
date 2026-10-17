// Map labels as page text above the tiles, so street and place names stay upright and sharp however
// the map turns. Each layout picks the most important labels that fit without overlapping each
// other, your position, or the cards. Labels live in world pixels and ride the map's transform;
// only their own rotation is recomputed, to stay readable.
(function (FM) {
  'use strict';

  var LIMIT = { explore: 14, drive: 6 };
  var FONTS = {
    road: '600 11px Inter, sans-serif',
    place: '600 11.5px Inter, sans-serif',
    'place big': '700 13px Inter, sans-serif',
    route: '700 11.5px Inter, sans-serif',
    'route-alt': '700 11.5px Inter, sans-serif'
  };
  var PAD = { road: [4, 6], place: [4, 6], 'place big': [4, 6], route: [14, 9], 'route-alt': [14, 9] }; // extra [width, height]
  var GAP = 4;
  // Route tags may sit just off their spot (above, below, beside) rather than not show at all.
  var TAG_NUDGES = [[0, 0], [0, -17], [0, 17], [-34, 0], [34, 0]];
  var FADE_MS = 220;

  var layer = document.getElementById('labels');
  var shown = {}; // key -> element
  var measure = document.createElement('canvas').getContext('2d');
  var widths = {};

  function textWidth(kind, text) {
    var key = kind + '|' + text;
    if (!(key in widths)) {
      measure.font = FONTS[kind];
      widths[key] = measure.measureText(text).width;
    }
    return widths[key];
  }

  // Road text runs along the road, flipped when needed so it never reads upside down.
  function readable(deg) {
    var a = ((deg % 360) + 540) % 360 - 180; // -180..180
    if (a > 90) a -= 180;
    if (a <= -90) a += 180;
    return a;
  }

  function overlaps(b, list) {
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]) return true;
    }
    return false;
  }

  // v: { zoom, rot, mode, world(x0, y0) -> world px, screen(world) -> screen px, w, h, top, bottom,
  //      avoid: [boxes], extra: [candidates], transition }
  function layout(v) {
    var drive = v.mode === 'drive';
    var scale = Math.pow(2, v.zoom);
    var cands = (v.extra || []).concat(FM.carto.labels(v.zoom));
    cands.sort(function (a, b) { return b.priority - a.priority; });

    var placed = (v.avoid || []).slice();
    var used = {};
    var keep = {};
    var count = 0;
    for (var i = 0; i < cands.length && count < LIMIT[v.mode]; i++) {
      var c = cands[i];
      var tag = c.kind.indexOf('route') === 0;
      if (v.zoom < c.minZoom || (used[c.text] && !tag)) continue;
      if (drive && c.kind !== 'road' && !tag) continue;
      var w = v.world(c.x * scale, c.y * scale);
      var s0 = v.screen(w);
      var a = c.kind === 'road' ? readable(c.angle - v.rot) : 0;
      var pad = PAD[c.kind];
      var tw = textWidth(c.kind, c.text) + pad[0];
      var th = (c.kind === 'place big' ? 13 : 11) + pad[1];
      var r = a * Math.PI / 180;
      var bw = Math.abs(tw * Math.cos(r)) + Math.abs(th * Math.sin(r));
      var bh = Math.abs(tw * Math.sin(r)) + Math.abs(th * Math.cos(r));
      var box = null;
      var nudges = tag ? TAG_NUDGES : [[0, 0]];
      for (var n = 0; n < nudges.length && !box; n++) {
        var sx = s0.x + nudges[n][0];
        var sy = s0.y + nudges[n][1];
        var b = [sx - bw / 2 - GAP, sy - bh / 2 - GAP, sx + bw / 2 + GAP, sy + bh / 2 + GAP];
        if (b[0] < 0 || b[2] > v.w || b[1] < v.top || b[3] > v.h - v.bottom || overlaps(b, placed)) continue;
        box = b;
        if (n) w = v.unscreen(sx, sy);
      }
      if (!box) continue;
      placed.push(box);
      used[c.text] = true;
      count++;
      keep[c.key || c.kind + '|' + c.text] = { c: c, w: w, a: a };
    }
    render(keep, v);
  }

  function render(keep, v) {
    Object.keys(keep).forEach(function (key) {
      var k = keep[key];
      var el = shown[key];
      var fresh = !el;
      if (fresh) {
        el = shown[key] = document.createElement('div');
        layer.appendChild(el);
      }
      if (el.className.replace(' on', '').replace(' leaving', '') !== 'label ' + k.c.kind) {
        el.className = 'label ' + k.c.kind + (fresh ? '' : ' on');
      }
      if (el.textContent !== k.c.text) el.textContent = k.c.text;
      // A label whose reading direction flips turns instantly rather than spinning.
      var flip = !fresh && Math.abs(k.a - el.fmA) > 90;
      el.fmA = k.a;
      el.style.transition = fresh || flip || v.transition === 'none'
        ? 'opacity ' + FADE_MS + 'ms ease'
        : 'opacity ' + FADE_MS + 'ms ease, ' + v.transition;
      el.style.left = k.w.x.toFixed(1) + 'px';
      el.style.top = k.w.y.toFixed(1) + 'px';
      el.style.transform = 'translate(-50%, -50%) rotate(' + (k.a + v.rot).toFixed(2) + 'deg)';
      el.classList.remove('leaving');
      if (fresh) {
        el.getBoundingClientRect(); // start the fade from transparent
        el.classList.add('on');
      }
    });
    Object.keys(shown).forEach(function (key) {
      if (keep[key]) return;
      var el = shown[key];
      delete shown[key];
      el.classList.add('leaving');
      el.classList.remove('on');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, FADE_MS);
    });
  }

  // On a zoom change every label's world position changes; start over without animation.
  function clear() {
    Object.keys(shown).forEach(function (key) {
      var el = shown[key];
      if (el.parentNode) el.parentNode.removeChild(el);
    });
    shown = {};
  }

  FM.labels = { layout: layout, clear: clear };
})(window.FM = window.FM || {});
