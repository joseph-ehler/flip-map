// Vector tile decoding: a small protobuf reader plus the Mapbox Vector Tile format.
// Decodes only the layers the map asks for, into plain arrays the renderer can draw quickly.
(function (FM) {
  'use strict';

  var utf8 = new TextDecoder('utf-8');

  function Pbf(bytes) {
    this.buf = bytes;
    this.pos = 0;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  Pbf.prototype.varint = function () {
    var buf = this.buf;
    var b = buf[this.pos++];
    var val = b & 0x7f;
    if (b < 0x80) return val;
    b = buf[this.pos++];
    val |= (b & 0x7f) << 7;
    if (b < 0x80) return val;
    b = buf[this.pos++];
    val |= (b & 0x7f) << 14;
    if (b < 0x80) return val;
    b = buf[this.pos++];
    val |= (b & 0x7f) << 21;
    if (b < 0x80) return val;
    var mul = 268435456; // past 28 bits, keep going with plain arithmetic
    do {
      b = buf[this.pos++];
      val += (b & 0x7f) * mul;
      mul *= 128;
    } while (b >= 0x80);
    return val;
  };

  Pbf.prototype.string = function () {
    var len = this.varint();
    var s = utf8.decode(this.buf.subarray(this.pos, this.pos + len));
    this.pos += len;
    return s;
  };

  Pbf.prototype.packed = function () {
    var end = this.varint() + this.pos;
    var out = [];
    while (this.pos < end) out.push(this.varint());
    return out;
  };

  Pbf.prototype.skip = function (type) {
    if (type === 0) this.varint();
    else if (type === 1) this.pos += 8;
    else if (type === 2) this.pos += this.varint();
    else if (type === 5) this.pos += 4;
    else throw new Error('Unknown protobuf wire type ' + type);
  };

  function zigzag(n) {
    return n % 2 ? -(n + 1) / 2 : n / 2;
  }

  // Returns { layerName: { extent, features: [{ type, props, geom, bbox }] } }.
  // type: 1 point, 2 line, 3 polygon. geom: parts, each a flat [x0, y0, x1, y1, ...] array.
  function decode(arrayBuffer, wanted) {
    var p = new Pbf(new Uint8Array(arrayBuffer));
    var layers = {};
    while (p.pos < p.buf.length) {
      var tag = p.varint();
      if (tag >> 3 === 3 && (tag & 7) === 2) {
        var end = p.varint() + p.pos;
        var layer = readLayer(p, end, wanted);
        if (layer) layers[layer.name] = layer;
        p.pos = end;
      } else {
        p.skip(tag & 7);
      }
    }
    return layers;
  }

  function readLayer(p, end, wanted) {
    var name = '';
    var extent = 4096;
    var keys = [];
    var values = [];
    var ranges = [];
    while (p.pos < end) {
      var tag = p.varint();
      var field = tag >> 3;
      if (field === 1) {
        name = p.string();
        if (!wanted[name]) return null;
      } else if (field === 2) {
        var len = p.varint();
        ranges.push(p.pos, p.pos + len);
        p.pos += len;
      } else if (field === 3) {
        keys.push(p.string());
      } else if (field === 4) {
        values.push(readValue(p, p.varint() + p.pos));
      } else if (field === 5) {
        extent = p.varint();
      } else {
        p.skip(tag & 7);
      }
    }
    if (!wanted[name]) return null;
    var features = [];
    for (var i = 0; i < ranges.length; i += 2) features.push(readFeature(p, ranges[i], ranges[i + 1], keys, values));
    return { name: name, extent: extent, features: features };
  }

  function readValue(p, end) {
    var v = null;
    while (p.pos < end) {
      var tag = p.varint();
      var field = tag >> 3;
      if (field === 1) v = p.string();
      else if (field === 2) { v = p.view.getFloat32(p.pos, true); p.pos += 4; }
      else if (field === 3) { v = p.view.getFloat64(p.pos, true); p.pos += 8; }
      else if (field === 4 || field === 5) v = p.varint();
      else if (field === 6) v = zigzag(p.varint());
      else if (field === 7) v = !!p.varint();
      else p.skip(tag & 7);
    }
    return v;
  }

  function readFeature(p, start, end, keys, values) {
    p.pos = start;
    var type = 0;
    var tags = [];
    var cmds = [];
    while (p.pos < end) {
      var tag = p.varint();
      var field = tag >> 3;
      if (field === 2) tags = p.packed();
      else if (field === 3) type = p.varint();
      else if (field === 4) cmds = p.packed();
      else p.skip(tag & 7);
    }
    var props = {};
    for (var i = 0; i < tags.length; i += 2) props[keys[tags[i]]] = values[tags[i + 1]];
    var g = geometry(cmds);
    return { type: type, props: props, geom: g.parts, bbox: g.bbox };
  }

  function geometry(cmds) {
    var parts = [];
    var part = null;
    var x = 0;
    var y = 0;
    var minX = Infinity;
    var minY = Infinity;
    var maxX = -Infinity;
    var maxY = -Infinity;
    var i = 0;
    while (i < cmds.length) {
      var c = cmds[i++];
      var id = c & 7;
      var count = c >> 3;
      if (id === 1 || id === 2) {
        for (var k = 0; k < count; k++) {
          x += zigzag(cmds[i++]);
          y += zigzag(cmds[i++]);
          if (id === 1) {
            part = [x, y];
            parts.push(part);
          } else {
            part.push(x, y);
          }
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      } else if (id === 7 && part) {
        part.push(part[0], part[1]);
      }
    }
    return { parts: parts, bbox: [minX, minY, maxX, maxY] };
  }

  FM.mvt = { decode: decode };
})(window.FM = window.FM || {});
