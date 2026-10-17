// Network requests with a time limit. A request that hangs is abandoned, and aborted where the browser
// supports it, so the app can say so and try again instead of waiting for ever.
(function (FM) {
  'use strict';

  // Resolves with the parsed JSON. Rejects with `slowMessage` after `ms`, with an error carrying
  // `status` for an HTTP error, or with the browser's TypeError when there's no connection.
  function getJSON(url, ms, slowMessage) {
    var ctl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = null;
    var limit = new Promise(function (resolve, reject) {
      timer = setTimeout(function () {
        if (ctl) ctl.abort();
        reject(new Error(slowMessage || 'No answer'));
      }, ms);
    });
    var request = fetch(url, ctl ? { signal: ctl.signal } : undefined).then(function (res) {
      if (!res.ok) {
        var e = new Error('HTTP ' + res.status);
        e.status = res.status;
        throw e;
      }
      return res.json();
    });
    return Promise.race([request, limit]).then(function (value) {
      clearTimeout(timer);
      return value;
    }, function (err) {
      clearTimeout(timer);
      throw err;
    });
  }

  FM.net = { getJSON: getJSON };
})(window.FM = window.FM || {});
