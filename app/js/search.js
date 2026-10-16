// The "where to?" screen: type a place (T9 works in the text box), pick a result, start a route.
(function (FM) {
  'use strict';

  var geo = FM.geo;
  // OpenStreetMap's Nominatim: search on demand only (no autocomplete), at most one query per second.
  var SEARCH_URL = 'https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=8&q=';
  var RECENT_KEY = 'flipmap.recent';
  var MAX_RECENT = 6;
  var MIN_GAP_MS = 1100;

  var screen = document.getElementById('search');
  var input = document.getElementById('q');
  var msg = document.getElementById('search-msg');
  var list = document.getElementById('results');
  var places = [];
  var lastQuery = 0;

  function open() {
    screen.hidden = false;
    input.value = '';
    var recent = loadRecent();
    show(recent, recent.length ? 'Recent' : 'Type a place, then press OK');
    input.focus();
  }

  function close() {
    screen.hidden = true;
    input.blur();
  }

  function submit() {
    var q = input.value.trim();
    if (!q || Date.now() - lastQuery < MIN_GAP_MS) return;
    lastQuery = Date.now();

    // Prefer results within ~35 miles of you, without excluding farther ones.
    var c = FM.map.center();
    var box = [c.lon - 0.5, c.lat + 0.5, c.lon + 0.5, c.lat - 0.5].join(',');
    show([], 'Searching…');
    fetch(SEARCH_URL + encodeURIComponent(q) + '&viewbox=' + box)
      .then(function (res) {
        if (!res.ok) throw new Error('Search failed');
        return res.json();
      })
      .then(function (rows) {
        var found = rows.map(toPlace);
        found.sort(function (a, b) { return away(a) - away(b); });
        show(found, found.length ? '' : 'Nothing found');
        if (found.length) focusItem(0);
      })
      .catch(function () {
        show([], navigator.onLine === false ? 'No data connection' : 'Search failed');
      });
  }

  function toPlace(r) {
    var a = r.address || {};
    var street = [a.house_number, a.road].filter(Boolean).join(' ');
    var town = a.city || a.town || a.village || a.hamlet || a.suburb || a.county || '';
    return {
      name: r.name || street || r.display_name.split(', ')[0],
      address: [r.name ? street : '', town].filter(Boolean).join(', '),
      lat: +r.lat,
      lon: +r.lon
    };
  }

  function away(p) {
    var c = FM.map.center();
    return geo.distance(c.lat, c.lon, p.lat, p.lon);
  }

  function show(found, note) {
    places = found;
    list.innerHTML = '';
    found.forEach(function (p, i) {
      var li = document.createElement('li');
      var name = document.createElement('div');
      var sub = document.createElement('div');
      li.tabIndex = 0;
      li.setAttribute('data-i', i);
      name.className = 'name';
      name.textContent = p.name;
      sub.className = 'sub';
      sub.textContent = [geo.formatDistance(away(p)), p.address].filter(Boolean).join(' · ');
      li.appendChild(name);
      li.appendChild(sub);
      list.appendChild(li);
    });
    msg.textContent = note || '';
    msg.hidden = !note;
  }

  function focusItem(i) {
    var li = list.children[i];
    if (!li) return;
    li.focus();
    li.scrollIntoView({ block: 'nearest' });
  }

  function choose(p) {
    addRecent(p);
    close();
    FM.nav.go(p);
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

  FM.search = {
    open: open,

    isOpen: function () {
      return !screen.hidden;
    },

    softkeys: function () {
      return ['Cancel', selected() >= 0 ? 'Go' : 'Search', ''];
    },

    // Returns true when the key was used here; false lets it through (typing, deleting).
    key: function (e) {
      var i = selected();
      switch (e.key) {
        case 'Enter':
          if (i >= 0) choose(places[i]);
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
