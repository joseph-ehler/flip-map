// Every icon in the app, as inline SVG so it's crisp at any size and takes the surrounding text color.
(function (FM) {
  'use strict';

  // Degrees clockwise from straight ahead.
  var ANGLES = {
    'sharp left': -135,
    left: -90,
    'slight left': -45,
    straight: 0,
    'slight right': 45,
    right: 90,
    'sharp right': 135
  };

  function n(v) {
    return Math.round(v * 10) / 10;
  }

  function svg(viewBox, body, cls) {
    return '<svg class="' + (cls || 'icon') + '" viewBox="' + viewBox + '" aria-hidden="true">' + body + '</svg>';
  }

  function path(cls, d) {
    return '<path class="' + cls + '" d="' + d + '"/>';
  }

  // --- Maneuver glyphs (48x48): the road you're on comes up from the bottom; the path to take is
  // bold, other roads at the junction are faint. ---

  function arrowhead(x, y, a) {
    var r = a * Math.PI / 180;
    var fx = Math.sin(r);
    var fy = -Math.cos(r);
    return path('m-head', 'M' + n(x + fx * 9) + ' ' + n(y + fy * 9) +
      'L' + n(x - fy * 7.5 - fx) + ' ' + n(y + fx * 7.5 - fy) +
      'L' + n(x + fy * 7.5 - fx) + ' ' + n(y - fx * 7.5 - fy) + 'Z');
  }

  function turn(a, context) {
    var r = a * Math.PI / 180;
    var fx = Math.sin(r);
    var fy = -Math.cos(r);
    var len = a === 0 ? 12 : 13;
    var ex = 24 + fx * len;
    var ey = (a === 0 ? 25 : 24) + fy * len;
    var main = a === 0
      ? 'M24 44V' + n(ey)
      : 'M24 44V30Q24 24 ' + n(24 + fx * 6) + ' ' + n(24 + fy * 6) + 'L' + n(ex) + ' ' + n(ey);
    var ctx = '';
    if (context === 'straight') ctx = 'M24 24V5';
    else if (context === 'tee') ctx = 'M5 24H43';
    else if (context === 'fork') ctx = 'M24 30L' + n(24 - fx * 15) + ' ' + n(24 + fy * 15);
    return svg('0 0 48 48', (ctx ? path('m-ctx', ctx) : '') + path('m-main', main) + arrowhead(ex, ey, a), 'glyph');
  }

  function uturn() {
    return svg('0 0 48 48', path('m-main', 'M31 44V21a7 7 0 0 0-14 0v7') + arrowhead(17, 28, 180), 'glyph');
  }

  // US roundabouts run counterclockwise: enter at the bottom, go right and around to the exit.
  function roundabout(a) {
    var r = a * Math.PI / 180;
    var R = 7.5;
    var px = 24 + Math.sin(r) * R;
    var py = 23 - Math.cos(r) * R;
    var ex = px + Math.sin(r) * 6;
    var ey = py - Math.cos(r) * 6;
    var large = 180 - a > 180 ? 1 : 0;
    var main = 'M24 44V' + (23 + R) + 'A' + R + ' ' + R + ' 0 ' + large + ' 0 ' + n(px) + ' ' + n(py) +
      'L' + n(ex) + ' ' + n(ey);
    return svg('0 0 48 48', '<circle class="m-ctx" cx="24" cy="23" r="' + R + '"/>' + path('m-main', main) +
      arrowhead(ex, ey, a), 'glyph');
  }

  function arrive() {
    return svg('0 0 48 48',
      path('m-ctx', 'M15 42H33') +
      '<path class="m-fill" fill-rule="evenodd" d="M24 4a12 12 0 0 1 12 12c0 9-12 22-12 22S12 25 12 16A12 12 0 0 1 24 4zm0 7.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9z"/>',
      'glyph');
  }

  function maneuver(type, modifier) {
    var mod = modifier || 'straight';
    var a = ANGLES[mod] !== undefined ? ANGLES[mod] : 0;
    if (type === 'arrive') return arrive();
    if (type === 'roundabout' || type === 'rotary') return roundabout(mod === 'uturn' ? -170 : a);
    if (mod === 'uturn') return uturn();
    if (type === 'depart' || type === 'new name' || a === 0) return turn(0, 'none');
    if (type === 'fork') return turn(a, 'fork');
    if (type === 'end of road') return turn(a, 'tee');
    return turn(a, 'straight');
  }

  // --- Lane arrows (24x32): one per lane, every direction the lane allows drawn from one stem.
  // Directions that fit the route are bright; the rest, and lanes you shouldn't use, are dim. ---

  function lane(indications, valid, fits) {
    var body = '';
    var use = false;
    indications.forEach(function (ind) {
      var on = valid && fits(ind);
      use = use || on;
      body += laneBranch(ind, on ? 'l-on' : 'l-off');
    });
    body = path(use ? 'l-on' : 'l-off', indications[0] === 'uturn' ? 'M16 30V18' : 'M12 30V18') + body;
    return svg('0 0 24 32', body, use ? 'lane use' : 'lane'); // "use": a lane to be in
  }

  function laneBranch(ind, cls) {
    if (ind === 'none') return path(cls, 'M12 18V6');
    if (ind === 'uturn') {
      return path(cls, 'M16 18V15a5 5 0 0 0-10 0v4') + smallHead(6, 19, 180, cls);
    }
    var a = ANGLES[ind] !== undefined ? ANGLES[ind] : 0;
    var r = a * Math.PI / 180;
    var fx = Math.sin(r);
    var fy = -Math.cos(r);
    var ex = 12 + fx * 8;
    var ey = (a === 0 ? 10 : 18) + fy * (a === 0 ? 2 : 8);
    var d = a === 0 ? 'M12 18V' + n(ey) : 'M12 18L' + n(ex) + ' ' + n(ey);
    return path(cls, d) + smallHead(ex, ey, a, cls);
  }

  function smallHead(x, y, a, cls) {
    var r = a * Math.PI / 180;
    var fx = Math.sin(r);
    var fy = -Math.cos(r);
    return '<path class="' + cls + ' l-head" d="M' + n(x + fx * 5.5) + ' ' + n(y + fy * 5.5) +
      'L' + n(x - fy * 4.5) + ' ' + n(y + fx * 4.5) + 'L' + n(x + fy * 4.5) + ' ' + n(y - fx * 4.5) + 'Z"/>';
  }

  // --- Interface icons (24x24) ---

  var ICONS = {
    search: '<circle class="i-s" cx="10.5" cy="10.5" r="6.5"/>' + path('i-s', 'M15.5 15.5L20.5 20.5'),
    locate: path('i-f', 'M20.5 3.5L3.5 10.8l7.2 2.5 2.5 7.2z'),
    locateOutline: path('i-s', 'M20.5 3.5L3.5 10.8l7.2 2.5 2.5 7.2z'),
    compass: path('i-n', 'M12 3l3.2 9h-6.4z') + path('i-f', 'M12 21l-3.2-9h6.4z'),
    clock: '<circle class="i-s" cx="12" cy="12" r="8.5"/>' + path('i-s', 'M12 7.5V12l3 2'),
    pin: '<path class="i-f" fill-rule="evenodd" d="M12 2.5a7 7 0 0 1 7 7c0 5-7 12-7 12s-7-7-7-12a7 7 0 0 1 7-7zm0 4.3a2.7 2.7 0 1 0 0 5.4 2.7 2.7 0 0 0 0-5.4z"/>',
    food: path('i-s', 'M7 3.5v5.5a2.2 2.2 0 0 0 4.4 0V3.5M9.2 11.2V20.5M16.5 20.5V3.5c-2 1.2-3.2 4-3.2 7.5h3.2'),
    shop: path('i-s', 'M5.2 8.5h13.6l-1.1 12H6.3zM9 8.5V7a3 3 0 0 1 6 0v1.5'),
    fuel: path('i-s', 'M5.5 20.5V5.5a1.5 1.5 0 0 1 1.5-1.5h5.5a1.5 1.5 0 0 1 1.5 1.5v15M4 20.5h11.5M14 10h1.8a1.5 1.5 0 0 1 1.5 1.5v5a1.4 1.4 0 0 0 2.8 0V8.2l-2.4-2.4M8 7.5h3.5V11H8z'),
    park: path('i-f', 'M12 2.5l6.2 9h-3l4 6H4.8l4-6h-3z') + path('i-s', 'M12 17.5v4'),
    health: path('i-s i-bold', 'M12 5.5v13M5.5 12h13'),
    speaker: path('i-f', 'M3.5 9.2h3.8l4.9-4.4v14.4l-4.9-4.4H3.5z') + path('i-s', 'M15.5 9a4.2 4.2 0 0 1 0 6M18.2 6.5a7.8 7.8 0 0 1 0 11'),
    appearance: '<circle class="i-s" cx="12" cy="12" r="8"/>' + path('i-f', 'M12 4a8 8 0 0 1 0 16z'),
    rotate: path('i-f', 'M12 2.8l6.8 17.6-6.8-3.9-6.8 3.9z'),
    check: path('i-s i-bold', 'M5.5 12.5l4.2 4.2L18.5 7.5'),
    gauge: path('i-s', 'M4.5 16.5a7.5 7.5 0 1 1 15 0') + path('i-s i-bold', 'M12 16.5l3.6-4.6'),
    chevron: path('i-s', 'M9.5 5.5L16 12l-6.5 6.5')
  };

  function icon(name) {
    return svg('0 0 24 24', ICONS[name] || ICONS.pin);
  }

  // Eight spokes, brightest last; stepping the rotation reads as the classic activity indicator.
  var spinner = (function () {
    var spokes = '';
    for (var i = 0; i < 8; i++) {
      spokes += '<path class="i-s" opacity="' + (0.2 + i * 0.8 / 7).toFixed(2) + '" transform="rotate(' +
        (i * 45) + ' 12 12)" d="M12 3.5v4"/>';
    }
    return svg('0 0 24 24', spokes, 'icon spinner');
  })();

  FM.icons = {
    maneuver: maneuver,
    lane: lane,
    icon: icon,
    spinner: spinner
  };
})(window.FM = window.FM || {});
