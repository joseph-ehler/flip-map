// The search sheet: type a place (T9 works in the field) and pick a result. Recents show when it's empty.
(function (FM) {
  'use strict';

  var geo = FM.geo;
  var icons = FM.icons;
  // OpenStreetMap's Nominatim: search on demand only (no autocomplete), at most one query per second.
  var SEARCH_URL = 'https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=8&q=';
  var RECENT_KEY = 'flipmap.recent';
  var MAX_RECENT = 6;
  var MIN_GAP_MS = 1100;

  // Result badges: an icon and a color per kind of place.
  var KINDS = {
    recent: ['clock', 'gray'],
    food: ['food', 'orange'],
    shop: ['shop', 'yellow'],
    fuel: ['fuel', 'blue'],
    park: ['park', 'green'],
    health: ['health', 'red'],
    place: ['pin', 'red']
  };

  function $(id) {
    return document.getElementById(id);
  }

  var input = $('q');
  var fieldIcon = $('q-icon');
  var head = $('s-head');
  var list = $('results');
  var empty = $('s-empty');
  var places = [];
  var lastQuery = 0;
  var lastChosen = 0;

  function open(keep) {
    if (keep && places.length) {
      focusItem(lastChosen);
      return;
    }
    input.value = '';
    var recent = loadRecent();
    recent.forEach(function (p) { p.kind = 'recent'; });
    if (recent.length) show(recent, 'Recents');
    else show([], '', ['Search Maps', 'Find a place or an address.']);
    input.focus();
  }

  function submit() {
    var q = input.value.trim();
    if (!q || Date.now() - lastQuery < MIN_GAP_MS) return;
    lastQuery = Date.now();

    // Prefer results within ~35 miles of you, without excluding farther ones.
    var c = FM.map.center();
    var box = [c.lon - 0.5, c.lat + 0.5, c.lon + 0.5, c.lat - 0.5].join(',');
    busy(true);
    fetch(SEARCH_URL + encodeURIComponent(q) + '&viewbox=' + box)
      .then(function (res) {
        if (!res.ok) throw new Error('Search failed');
        return res.json();
      })
      .then(function (rows) {
        var found = rows.map(toPlace);
        found.sort(function (a, b) { return away(a) - away(b); });
        if (found.length) {
          show(found, 'Results');
          focusItem(0);
        } else {
          show([], '', ['No Results', 'Try another spelling, or add a city.']);
        }
      })
      .catch(function () {
        show([], '', navigator.onLine === false
          ? ['You’re Offline', 'Search needs a data connection.']
          : ['Search Unavailable', 'Try again in a moment.']);
      })
      .then(function () { busy(false); });
  }

  function busy(on) {
    fieldIcon.innerHTML = on ? icons.spinner : icons.icon('search');
  }

  function toPlace(r) {
    var a = r.address || {};
    var street = [a.house_number, a.road].filter(Boolean).join(' ');
    var town = a.city || a.town || a.village || a.hamlet || a.suburb || a.county || '';
    return {
      name: r.name || street || r.display_name.split(', ')[0],
      address: [r.name ? street : '', town].filter(Boolean).join(', '),
      lat: +r.lat,
      lon: +r.lon,
      kind: kindOf(r.category, r.type)
    };
  }

  function kindOf(cat, type) {
    if (cat === 'shop') return 'shop';
    if (cat === 'amenity') {
      if (/^(restaurant|cafe|fast_food|bar|pub|food_court|ice_cream|biergarten)$/.test(type)) return 'food';
      if (/^(fuel|charging_station)$/.test(type)) return 'fuel';
      if (/^(hospital|clinic|pharmacy|doctors|dentist)$/.test(type)) return 'health';
    }
    if (cat === 'leisure' || cat === 'natural') return 'park';
    return 'place';
  }

  function away(p) {
    var c = FM.map.center();
    return geo.distance(c.lat, c.lon, p.lat, p.lon);
  }

  function show(found, heading, emptyText) {
    places = found;
    list.innerHTML = '';
    found.forEach(function (p, i) {
      var kind = KINDS[p.kind] || KINDS.place;
      var li = document.createElement('li');
      li.tabIndex = 0;
      li.setAttribute('data-i', i);
      li.innerHTML = '<span class="badge tint-' + kind[1] + '">' + icons.icon(kind[0]) + '</span>' +
        '<span class="row-text"><span class="row-title clip"></span><span class="row-sub clip"></span></span>';
      li.querySelector('.row-title').textContent = p.name;
      li.querySelector('.row-sub').textContent = [geo.formatDistance(away(p)), p.address].filter(Boolean).join(' · ');
      list.appendChild(li);
    });
    head.textContent = heading || '';
    head.hidden = !heading;
    empty.hidden = !emptyText;
    if (emptyText) {
      empty.innerHTML = '<b></b><span></span>';
      empty.firstChild.textContent = emptyText[0];
      empty.lastChild.textContent = emptyText[1];
    }
  }

  function focusItem(i) {
    var li = list.children[i];
    if (!li) return;
    li.focus();
    li.scrollIntoView({ block: 'nearest' });
  }

  function choose(i) {
    var p = places[i];
    lastChosen = i;
    addRecent(p);
    if (FM.search.onchoose) FM.search.onchoose(p);
  }

  function close() {
    input.blur();
    if (FM.search.onclose) FM.search.onclose();
  }

  function loadRecent() {
    try {
      return JSON.parse(localStorage.getItem(RECENT_KEY)) || [];
    } catch (e) {
      return [];
    }
  }

  function addRecent(p) {
    var recent = loadRecent().filter(function (r) {
      return r.name !== p.name || geo.distance(r.lat, r.lon, p.lat, p.lon) > 50;
    });
    recent.unshift({ name: p.name, address: p.address, lat: p.lat, lon: p.lon });
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(recent.slice(0, MAX_RECENT)));
    } catch (e) {}
  }

  function selected() {
    var el = document.activeElement;
    return el && el.parentNode === list ? +el.getAttribute('data-i') : -1;
  }

  busy(false);

  FM.search = {
    open: open,
    onchoose: null,
    onclose: null,

    softkeys: function () {
      return ['Cancel', selected() >= 0 ? 'Select' : 'Search', ''];
    },

    // Returns true when the key was used here; false lets it through (typing, deleting).
    // k is the key as app.js reads it (the OK key normalized to "Enter").
    key: function (e, k) {
      var i = selected();
      switch (k || e.key) {
        case 'Enter':
          if (i >= 0) choose(i);
          else submit();
          return true;
        case 'ArrowDown':
          focusItem(i + 1);
          return true;
        case 'ArrowUp':
          if (i > 0) focusItem(i - 1);
          else input.focus();
          return true;
        case 'Backspace':
        case 'Escape':
          if (i < 0 && input.value) return false; // delete a character
          if (i >= 0) input.focus();
          else close();
          return true;
        case 'SoftLeft':
          close();
          return true;
      }
      return false;
    }
  };
})(window.FM = window.FM || {});
