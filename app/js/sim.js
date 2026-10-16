// Fake GPS for trying the app on a computer: open index.html?sim
// Circles downtown Chicago until a route is set, then drives the route at ~30 mph.
// Press 0 to swerve off the route and watch it reroute.
(function (FM) {
  'use strict';

  var geo = FM.geo;
  var SPEED = 13.4; // m/s
  var LAT0 = 41.8827;
  var LON0 = -87.6233;
  var RADIUS = 400;
  var M_PER_DEG = 111320;

  var t = 0;
  var driving = null; // the route object being driven
  var along = 0; // meters along it
  var offset = 0; // meters off to the side of it
  var detour = 0; // seconds left of drifting away

  function tick(onFix) {
    var r = FM.nav.route();
    if (r !== driving) {
      driving = r;
      along = 0;
      offset = 0;
    }
    var p = r ? onRoute(r) : onCircle();
    onFix({
      coords: { latitude: p.lat, longitude: p.lon, accuracy: 8, heading: p.heading, speed: SPEED },
      timestamp: Date.now()
    });
    t++;
  }

  function onCircle() {
    var a = t * SPEED / RADIUS;
    return {
      lat: LAT0 + RADIUS * Math.sin(a) / M_PER_DEG,
      lon: LON0 + RADIUS * Math.cos(a) / (M_PER_DEG * Math.cos(LAT0 * Math.PI / 180)),
      heading: (Math.atan2(-Math.sin(a), Math.cos(a)) * 180 / Math.PI + 360) % 360
    };
  }

  function onRoute(r) {
    if (detour > 0) {
      detour--;
      offset += 25;
    } else {
      along = Math.min(along + SPEED, r.total);
    }
    var i = 0;
    while (i < r.cum.length - 2 && r.cum[i + 1] < along) i++;
    var a = r.coords[i];
    var b = r.coords[i + 1];
    var seg = r.cum[i + 1] - r.cum[i];
    var f = seg ? (along - r.cum[i]) / seg : 0;
    var heading = geo.bearing(a[0], a[1], b[0], b[1]);
    var side = (heading + 90) * Math.PI / 180;
    var lat = a[0] + (b[0] - a[0]) * f;
    return {
      lat: lat + offset * Math.cos(side) / M_PER_DEG,
      lon: a[1] + (b[1] - a[1]) * f + offset * Math.sin(side) / (M_PER_DEG * Math.cos(lat * Math.PI / 180)),
      heading: heading
    };
  }

  FM.sim = {
    enabled: /[?&]sim\b/.test(location.search),

    start: function (onFix) {
      setInterval(function () { tick(onFix); }, 1000);
    },

    detour: function () {
      detour = 6;
    }
  };
})(window.FM = window.FM || {});
