// Flip Cartography: draws vector map data (OpenFreeMap, OpenMapTiles schema) into canvas tiles in our
// own style. Two appearances (day, night) and two densities: explore shows the neighborhood, drive
// shows the roads. Labels aren't drawn here; this collects them for labels.js to place upright.
(function (FM) {
  'use strict';

  var TILEJSON_URL = 'https://tiles.openfreemap.org/planet';
  var SOURCE_KEY = 'flipmap.vector';
  var SOURCE_MAX_Z = 14; // data stops at z14; closer zooms magnify it
  var MAX_SOURCES = 14; // decoded tiles kept in memory
  var TILE = 256;
  var DPR = Math.min(window.devicePixelRatio || 1, 2);
  var WANTED = {
    water: 1, waterway: 1, landcover: 1, landuse: 1, park: 1, aeroway: 1,
    building: 1, transportation: 1, transportation_name: 1, place: 1
  };

  // Road classes, bottom to top. Width in px at zoom 16; each zoom step multiplies by 2^0.8.
  var ROADS = ['path', 'track', 'rail', 'service', 'minor', 'tertiary', 'secondary', 'primary', 'trunk', 'motorway'];
  var WIDTH16 = { path: 1.3, track: 1.6, rail: 1.3, service: 3, minor: 5, tertiary: 6.5, secondary: 7, primary: 8, trunk: 9, motorway: 10 };
  var CLASS_ALIAS = { busway: 'service', bus_guideway: 'service', transit: 'rail', motorway_construction: 'motorway' };
  // First zoom each class appears at, per density.
  var MIN_ZOOM = {
    explore: { motorway: 5, trunk: 6, primary: 8, secondary: 10, tertiary: 11, minor: 13, service: 15, track: 15, path: 16, rail: 12 },
    drive: { motorway: 5, trunk: 6, primary: 8, secondary: 10, tertiary: 11, minor: 13, service: 17, track: 99, path: 99, rail: 99 }
  };

  // Day: warm, quiet paper. Night: deep charcoal with roads lifted out of it, not an inverted day map.
  var PALETTES = {
    day: {
      land: '#f3f1ec', green: '#d3e6c5', wood: '#cbe0be', water: '#aacdec', building: '#e3ded4',
      runway: '#dbd6cd', rail: '#c7c1b7', path: '#d8d2c7',
      fill: { motorway: '#f5bf53', trunk: '#f8d27d', primary: '#fce3a4', secondary: '#ffffff', tertiary: '#ffffff', minor: '#ffffff', service: '#ffffff' },
      edge: { motorway: '#cf9229', trunk: '#d8a84f', primary: '#d9b977', secondary: '#c4bdaf', tertiary: '#c9c2b5', minor: '#d1cbc0', service: '#d9d4cb' }
    },
    night: {
      land: '#1a1c20', green: '#1c2820', wood: '#1c2920', water: '#0f2134', building: '#24272c',
      runway: '#2a2d32', rail: '#2c2f35', path: '#292c31',
      fill: { motorway: '#8f7646', trunk: '#726855', primary: '#5a5f69', secondary: '#4e535c', tertiary: '#484c55', minor: '#3e4148', service: '#34373d' },
      edge: { motorway: '#4a3f2c', trunk: '#3f3a31', primary: '#33363d', secondary: '#2d3036', tertiary: '#2b2e34', minor: '#27292e', service: '#25272c' }
    }
  };

  // Labels: importance and the first zoom they may show at.
  var ROAD_LABEL = {
    motorway: [13, 10], trunk: [12, 11], primary: [11, 12], secondary: [10, 13], tertiary: [9, 14], minor: [7, 15], service: [4, 16]
  };
  var PLACE_LABEL = {
    city: [20, 5], town: [18, 9], village: [14, 11], suburb: [12, 12], quarter: [10, 13], neighbourhood: [9, 14], hamlet: [8, 13]
  };

  var template = loadTemplate();
  var theme = 'day';
  var density = 'explore';
  var sources = {};
  var stamp = 0;

  // --- Where the data lives (OpenFreeMap publishes a new version every few weeks) ---

  function loadTemplate() {
    try {
      return localStorage.getItem(SOURCE_KEY);
    } catch (e) {
      return null;
    }
  }

  function refreshTemplate() {
    fetch(TILEJSON_URL)
      .then(function (res) { return res.json(); })
      .then(function (j) {
        var url = j.tiles && j.tiles[0];
        if (!url || url === template) return;
        var first = !template;
        template = url;
        try {
          localStorage.setItem(SOURCE_KEY, url);
        } catch (e) {}
        if (first && FM.carto.onready) FM.carto.onready();
      })
      .catch(function () {});
  }

  // --- Source tiles (z <= 14), fetched once, decoded, kept for a while ---

  function source(z, x, y) {
    var key = z + '/' + x + '/' + y;
    var s = sources[key];
    if (!s) {
      s = sources[key] = { key: key, z: z, x: x, y: y, data: null, labels: null, failed: false, waiting: [] };
      fetch(template.replace('{z}', z).replace('{x}', x).replace('{y}', y))
        .then(function (res) {
          if (!res.ok) throw new Error('tile ' + res.status);
          return res.arrayBuffer();
        })
        .then(function (buf) {
          s.data = FM.mvt.decode(buf, WANTED);
          s.labels = collectLabels(s);
        })
        .catch(function () {
          s.failed = true;
          setTimeout(function () { if (sources[key] === s) delete sources[key]; }, 10000);
        })
        .then(function () {
          var waiting = s.waiting;
          s.waiting = [];
          waiting.forEach(function (fn) { fn(); });
        });
      evict();
    }
    s.used = ++stamp;
    return s;
  }

  function evict() {
    var keys = Object.keys(sources);
    if (keys.length <= MAX_SOURCES) return;
    keys.sort(function (a, b) { return sources[a].used - sources[b].used; });
    keys.slice(0, keys.length - MAX_SOURCES).forEach(function (k) {
      if (sources[k].data || sources[k].failed) delete sources[k];
    });
  }

  // --- Drawing one display tile ---

  // Draws tile z/x/y into canvas; calls done(true) once drawn, or done(false) if the data failed.
  function draw(canvas, z, x, y, done) {
    var sz = Math.min(z, SOURCE_MAX_Z);
    var k = Math.pow(2, z - sz);
    var s = source(sz, Math.floor(x / k), Math.floor(y / k));
    if (!s.data) {
      if (s.failed) {
        done(false);
        return;
      }
      s.waiting.push(function () {
        if (canvas.isConnected !== false) draw(canvas, z, x, y, done);
      });
      return;
    }
    paint(canvas.getContext('2d'), s, z, x, y, k);
    done(true);
  }

  function paint(ctx, s, z, x, y, k) {
    var pal = PALETTES[theme];
    var layers = s.data;
    var ext = (layers.transportation || layers.water || { extent: 4096 }).extent;
    var scale = TILE * k / ext; // display px per tile unit
    var ox = (x - s.x * k) * TILE;
    var oy = (y - s.y * k) * TILE;
    var pad = 24 / scale;
    var win = [ox / scale - pad, oy / scale - pad, (ox + TILE) / scale + pad, (oy + TILE) / scale + pad];
    var drive = density === 'drive';

    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = pal.land;
    ctx.fillRect(0, 0, TILE, TILE);
    ctx.setTransform(DPR * scale, 0, 0, DPR * scale, -ox * DPR, -oy * DPR);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Ground: greens are softer while driving, so roads carry the picture.
    var green = drive ? mix(pal.green, pal.land, 0.45) : pal.green;
    var wood = drive ? mix(pal.wood, pal.land, 0.45) : pal.wood;
    fillWhere(ctx, layers.park, win, green);
    fillWhere(ctx, layers.landcover, win, green, function (p) { return p.class === 'grass' || p.class === 'wetland'; });
    fillWhere(ctx, layers.landcover, win, wood, function (p) { return p.class === 'wood'; });
    fillWhere(ctx, layers.landuse, win, green, function (p) {
      return p.class === 'cemetery' || p.class === 'pitch' || p.class === 'playground' || p.class === 'golf_course';
    });
    fillWhere(ctx, layers.water, win, pal.water, function (p) { return p.class !== 'swimming_pool'; });
    strokeWhere(ctx, layers.waterway, win, pal.water, (z >= 14 ? 2.4 : 1.4) * zoomFactor(z) / scale, function (p) {
      return p.class === 'river' || p.class === 'canal' || (!drive && z >= 15);
    });
    fillWhere(ctx, layers.aeroway, win, pal.runway, function (p) { return p.class === 'runway' || p.class === 'taxiway'; });
    if (!drive && z >= 15) fillWhere(ctx, layers.building, win, pal.building);

    drawRoads(ctx, layers.transportation, win, z, scale, pal);
  }

  function zoomFactor(z) {
    return Math.pow(2, (z - 16) * 0.8);
  }

  function hits(b, w) {
    return b[2] >= w[0] && b[0] <= w[2] && b[3] >= w[1] && b[1] <= w[3];
  }

  function trace(ctx, parts) {
    for (var p = 0; p < parts.length; p++) {
      var g = parts[p];
      ctx.moveTo(g[0], g[1]);
      for (var i = 2; i < g.length; i += 2) ctx.lineTo(g[i], g[i + 1]);
    }
  }

  function fillWhere(ctx, layer, win, color, test) {
    if (!layer) return;
    var any = false;
    ctx.beginPath();
    layer.features.forEach(function (f) {
      if (f.type !== 3 || !hits(f.bbox, win) || (test && !test(f.props))) return;
      trace(ctx, f.geom);
      any = true;
    });
    if (!any) return;
    ctx.fillStyle = color;
    ctx.fill();
  }

  function strokeWhere(ctx, layer, win, color, width, test) {
    if (!layer) return;
    var any = false;
    ctx.beginPath();
    layer.features.forEach(function (f) {
      if (f.type !== 2 || !hits(f.bbox, win) || (test && !test(f.props))) return;
      trace(ctx, f.geom);
      any = true;
    });
    if (!any) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
  }

  // Roads in three stacks (tunnels, ground, bridges). In each: every edge first, then every fill,
  // smallest class first, so junctions merge cleanly and bigger roads sit on top.
  function drawRoads(ctx, layer, win, z, scale, pal) {
    if (!layer) return;
    var minZoom = MIN_ZOOM[density];
    var stacks = { tunnel: {}, ground: {}, bridge: {} };
    layer.features.forEach(function (f) {
      if (f.type !== 2 || !hits(f.bbox, win)) return;
      var p = f.props;
      var cls = CLASS_ALIAS[p.class] || p.class;
      if (!(cls in WIDTH16) || z < minZoom[cls]) return;
      var stack = stacks[p.brunnel === 'tunnel' ? 'tunnel' : p.brunnel === 'bridge' ? 'bridge' : 'ground'];
      var key = cls + (p.ramp ? ':ramp' : '');
      (stack[key] = stack[key] || []).push(f);
    });

    var f16 = zoomFactor(z);
    ['tunnel', 'ground', 'bridge'].forEach(function (name) {
      var stack = stacks[name];
      ctx.globalAlpha = name === 'tunnel' ? 0.45 : 1;
      [true, false].forEach(function (edges) {
        ROADS.forEach(function (cls) {
          [cls, cls + ':ramp'].forEach(function (key) {
            var feats = stack[key];
            if (!feats) return;
            var w = WIDTH16[cls] * f16 * (key === cls ? 1 : 0.65);
            var line = cls === 'rail' || cls === 'path' || cls === 'track';
            if (edges) {
              if (line || w < 2.2 || name === 'tunnel') return;
              stroke(ctx, feats, pal.edge[cls], (w + (z >= 15 ? 2 : 1.5)) / scale);
            } else {
              var color = line ? pal[cls === 'track' ? 'path' : cls] : pal.fill[cls];
              stroke(ctx, feats, color, Math.max(w, line ? 0.8 : 1) / scale);
            }
          });
        });
      });
    });
    ctx.globalAlpha = 1;
  }

  function stroke(ctx, feats, color, width) {
    ctx.beginPath();
    feats.forEach(function (f) { trace(ctx, f.geom); });
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
  }

  function mix(a, b, t) {
    var pa = parseInt(a.slice(1), 16);
    var pb = parseInt(b.slice(1), 16);
    var out = 0;
    for (var shift = 16; shift >= 0; shift -= 8) {
      var ca = (pa >> shift) & 255;
      var cb = (pb >> shift) & 255;
      out |= Math.round(ca + (cb - ca) * t) << shift;
    }
    return '#' + (0x1000000 + out).toString(16).slice(1);
  }

  // --- Label candidates, in zoom-0 pixels so they work at any zoom ---

  function collectLabels(s) {
    var out = [];
    var layers = s.data;
    var size = TILE / Math.pow(2, s.z);

    var names = layers.transportation_name;
    if (names) {
      var best = {};
      names.features.forEach(function (f) {
        var name = f.props.name;
        var rule = ROAD_LABEL[f.props.class];
        if (f.type !== 2 || !name || !rule) return;
        f.geom.forEach(function (g) {
          // Anchor on the longest straight stretch; that's where text fits best.
          for (var i = 0; i + 3 < g.length; i += 2) {
            var dx = g[i + 2] - g[i];
            var dy = g[i + 3] - g[i + 1];
            var len = dx * dx + dy * dy;
            var b = best[name];
            if (b && b.len >= len) continue;
            best[name] = {
              len: len, rule: rule, ext: names.extent,
              gx: g[i] + dx / 2, gy: g[i + 1] + dy / 2, angle: Math.atan2(dy, dx) * 180 / Math.PI
            };
          }
        });
      });
      Object.keys(best).forEach(function (name) {
        var b = best[name];
        out.push({
          kind: 'road', text: FM.geo.shortRoad(name), priority: b.rule[0], minZoom: b.rule[1],
          x: (s.x + b.gx / b.ext) * size, y: (s.y + b.gy / b.ext) * size, angle: b.angle
        });
      });
    }

    var places = layers.place;
    if (places) {
      places.features.forEach(function (f) {
        var rule = PLACE_LABEL[f.props.class];
        if (f.type !== 1 || !f.props.name || !rule) return;
        var g = f.geom[0];
        out.push({
          kind: rule[0] >= 18 ? 'place big' : 'place', text: f.props.name, priority: rule[0], minZoom: rule[1],
          x: (s.x + g[0] / places.extent) * size, y: (s.y + g[1] / places.extent) * size, angle: 0
        });
      });
    }
    return out;
  }

  FM.carto = {
    onready: null,

    ready: function () {
      return !!template;
    },

    draw: draw,

    setStyle: function (t, d) {
      var changed = t !== theme || d !== density;
      theme = t;
      density = d;
      return changed;
    },

    density: function () {
      return density;
    },

    // Labels from the source tiles at this zoom's data level that are loaded right now.
    labels: function (z) {
      var sz = Math.min(z, SOURCE_MAX_Z);
      var out = [];
      Object.keys(sources).forEach(function (k) {
        var s = sources[k];
        if (s.z === sz && s.labels) out = out.concat(s.labels);
      });
      return out;
    }
  };

  refreshTemplate();
})(window.FM = window.FM || {});
