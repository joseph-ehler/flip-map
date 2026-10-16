// Map math and US-unit formatting. Shared by every other script through window.FM.
(function (FM) {
  'use strict';

  var TILE = 256;
  var RAD = Math.PI / 180;
  var EARTH_RADIUS = 6371008.8;
  var M_PER_MILE = 1609.344;
  var FT_PER_M = 3.28084;
  var COMPASS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];

  function clamp(v, lo, hi) {
    return Math.min(Math.max(v, lo), hi);
  }

  // --- Web Mercator (same scheme as OSM / Google tiles) ---

  function worldSize(z) {
    return TILE * Math.pow(2, z);
  }

  function project(lat, lon, z) {
    var size = worldSize(z);
    var sin = clamp(Math.sin(lat * RAD), -0.9999, 0.9999);
    return {
      x: (lon + 180) / 360 * size,
      y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size
    };
  }

  function unproject(x, y, z) {
    var size = worldSize(z);
    var n = Math.PI - 2 * Math.PI * y / size;
    return {
      lat: Math.atan(Math.sinh(n)) / RAD,
      lon: x / size * 360 - 180
    };
  }

  function metersPerPixel(lat, z) {
    return 156543.03392 * Math.cos(lat * RAD) / Math.pow(2, z);
  }

  // --- Distances on the ground ---

  function distance(lat1, lon1, lat2, lon2) {
    var dLat = (lat2 - lat1) * RAD;
    var dLon = (lon2 - lon1) * RAD;
    var a = Math.pow(Math.sin(dLat / 2), 2) +
      Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.pow(Math.sin(dLon / 2), 2);
    return 2 * EARTH_RADIUS * Math.asin(Math.sqrt(a));
  }

  function bearing(lat1, lon1, lat2, lon2) {
    var y = Math.sin((lon2 - lon1) * RAD) * Math.cos(lat2 * RAD);
    var x = Math.cos(lat1 * RAD) * Math.sin(lat2 * RAD) -
      Math.sin(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.cos((lon2 - lon1) * RAD);
    return (Math.atan2(y, x) / RAD + 360) % 360;
  }

  // Closest approach of a point to segment a-b ([lat, lon] pairs). Flat-earth math, fine at street scale.
  // Returns the gap in meters and how far along the segment (0-1) the closest point is.
  function toSegment(lat, lon, a, b) {
    var kx = Math.cos(lat * RAD) * 111320;
    var ky = 110574;
    var ax = (a[1] - lon) * kx;
    var ay = (a[0] - lat) * ky;
    var dx = (b[1] - a[1]) * kx;
    var dy = (b[0] - a[0]) * ky;
    var len2 = dx * dx + dy * dy;
    var t = len2 ? clamp(-(ax * dx + ay * dy) / len2, 0, 1) : 0;
    var px = ax + t * dx;
    var py = ay + t * dy;
    return { dist: Math.sqrt(px * px + py * py), t: t };
  }

  function compass(deg) {
    return COMPASS[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
  }

  // --- Formatting ---

  function formatDistance(m) {
    var ft = m * FT_PER_M;
    if (ft < 1000) return (ft < 100 ? Math.round(ft / 10) * 10 : Math.round(ft / 50) * 50) + ' ft';
    var mi = m / M_PER_MILE;
    return (mi < 10 ? mi.toFixed(1) : Math.round(mi)) + ' mi';
  }

  function spokenDistance(m) {
    var ft = m * FT_PER_M;
    if (ft < 1000) return Math.max(50, Math.round(ft / 50) * 50) + ' feet';
    var mi = m / M_PER_MILE;
    if (mi < 0.35) return 'a quarter mile';
    if (mi < 0.65) return 'half a mile';
    if (mi < 1.25) return '1 mile';
    return (mi < 10 ? mi.toFixed(1) : Math.round(mi)) + ' miles';
  }

  function formatDuration(s) {
    var min = Math.max(1, Math.round(s / 60));
    if (min < 60) return min + ' min';
    return Math.floor(min / 60) + ' h ' + (min % 60) + ' min';
  }

  FM.geo = {
    clamp: clamp,
    project: project,
    unproject: unproject,
    metersPerPixel: metersPerPixel,
    distance: distance,
    bearing: bearing,
    toSegment: toSegment,
    compass: compass,
    formatDistance: formatDistance,
    spokenDistance: spokenDistance,
    formatDuration: formatDuration
  };
})(window.FM = window.FM || {});
