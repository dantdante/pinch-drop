/* ==========================================================
   Pinch Drop — deployment configuration
   ----------------------------------------------------------
   This file is safe to edit before publishing and is the one
   place the client learns where the signalling server lives.

   • apiBase: ""                 → same origin (default, one-server deploy)
   • apiBase: "https://host"     → static site on GitHub Pages talking to a
                                   separately hosted signalling server
   ========================================================== */

window.PINCH_DROP = {
  apiBase: '',
  // static: true when the page is served as plain files (GitHub Pages) and
  // the signalling server lives on another origin. It switches the room and
  // admin links to relative paths. Leave false for the one-server deploy.
  static: false,
  // Optional: override the ICE servers from the client side too.
  // iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  // iceServers: [{ urls: 'turn:turn.example.com', username: 'u', credential: 'p' }]
};
