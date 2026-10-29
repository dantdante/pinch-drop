/* ==========================================================
   Rise of Zoom — hosting helper
   ----------------------------------------------------------
   One small file that knows how the app is being served, so
   the rest of the client never has to guess:

     • same-origin server mode  (node server/index.js)
         home   →  /
         admin  →  /admin
         room   →  /room/f01

     • static-host mode  (GitHub Pages)
         home   →  ./index.html
         admin  →  ./admin.html
         room   →  ./room.html?room=f01

   The mode is read from /config.js → window.RISE_OF_ZOOM.
   ========================================================== */

(function () {
  'use strict';

  const CFG = window.RISE_OF_ZOOM || {};
  const API = (CFG.apiBase || '').replace(/\/$/, '');
  const STATIC = !!CFG.static;

  /* Where the pages live. */
  const homeUrl = () => (STATIC ? './index.html' : '/');
  const adminUrl = () => (STATIC ? './admin.html' : '/admin');

  /* The room page is a server route in one mode and a static file with a
     query string in the other. */
  const roomUrl = (id) =>
    STATIC
      ? `./room.html?room=${encodeURIComponent(id)}`
      : `/room/${encodeURIComponent(id)}`;

  /* Where the Socket.IO client library is served from. On a static host the
     page origin has no socket server, so the script has to come from the
     signalling backend. */
  const socketScriptUrl = () =>
    API ? `${API}/socket.io/socket.io.js` : '/socket.io/socket.io.js';

  /* Loads the Socket.IO client on demand and resolves with `io`. On a
     same-origin deploy this is a no-op if the library is already there. */
  let socketLoader = null;
  function ensureSocketIO() {
    if (typeof window.io === 'function') return Promise.resolve(window.io);
    if (socketLoader) return socketLoader;

    socketLoader = new Promise((resolve, reject) => {
      const src = socketScriptUrl();
      const tag = document.createElement('script');
      tag.src = src;
      tag.async = true;
      tag.onload = () => {
        if (typeof window.io === 'function') resolve(window.io);
        else reject(new Error('socket.io loaded but did not register'));
      };
      tag.onerror = () => reject(new Error(`could not load ${src}`));
      document.head.appendChild(tag);
    });

    return socketLoader;
  }

  /* A fetch that gives up after `ms` instead of hanging forever. A free
     hosting tier sleeps the backend after a few idle minutes, so the very
     first request can sit there for a minute while the container wakes. */
  function fetchWithTimeout(url, options, ms) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), ms || 15000) : null;
    const opts = Object.assign({}, options || {});
    if (controller) opts.signal = controller.signal;

    const p = fetch(url, opts);

    if (!timer) return p;

    return p.finally(() => clearTimeout(timer));
  }

  window.ROZ = {
    CFG,
    API,
    STATIC,
    homeUrl,
    adminUrl,
    roomUrl,
    socketScriptUrl,
    ensureSocketIO,
    fetchWithTimeout
  };
})();
