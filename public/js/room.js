/* ==========================================================
   Rise of Zoom — room client
   WebRTC mesh with perfect negotiation, ICE restart, TURN support,
   audio metering and autoplay-safe remote audio.
   ========================================================== */

(function () {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const roomId = decodeURIComponent(location.pathname.replace(/^\/room\//, '').replace(/\/+$/, '')) || 'lobby';

  const grid = $('#grid');
  const emptyState = $('#emptystate');
  const side = $('#side');
  const chatEl = $('#chat');
  const peopleEl = $('#people');
  const floaters = $('#floaters');
  const prejoin = $('#prejoin');
  const preview = $('#preview');
  const toastEl = $('#toast');
  const connState = $('#connState');

  /* Deployment configuration — see /config.js */
  const CFG = window.RISE_OF_ZOOM || {};
  const API = (CFG.apiBase || '').replace(/\/$/, '');

  const socket = io(API || undefined, { transports: ['websocket', 'polling'], upgrade: true });

  const state = {
    selfId: null,
    name: '',
    localStream: null,
    screenStream: null,
    peers: new Map(),
    joined: false,
    micOn: false,
    camOn: true,
    sharing: false,
    handRaised: false,
    pinned: null,
    startedAt: null,
    unread: 0,
    iceServers: [],
    audioCtx: null,
    mixDest: null,
    meters: new Set(),
    lastRestart: 0,
    audioUnlocked: false
  };

  /* ==========================================================
     Small helpers
     ========================================================== */

  const initials = (name) =>
    String(name || '?')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0] || '')
      .join('')
      .toUpperCase() || '?';

  let toastTimer = null;
  function toast(message, kind) {
    toastEl.textContent = message;
    toastEl.classList.toggle('is-warn', kind === 'warn');
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toastEl.hidden = true), 4200);
  }

  function timeString(ms) {
    const total = Math.floor(ms / 1000);
    const mm = String(Math.floor(total / 60)).padStart(2, '0');
    const ss = String(total % 60).padStart(2, '0');
    return `${mm}:${ss}`;
  }

  const MIC_ON = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';
  const MIC_OFF = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 9.3V6a3 3 0 0 0-5.7-1.3"/><path d="M9 9v3a3 3 0 0 0 4.6 2.7M5 11a7 7 0 0 0 11 5.4M12 18v3"/><path d="M3 3l18 18"/></svg>';
  const CAM_OFF = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M2.5 6h13v12h-13z"/><path d="M15.5 10.5 21 7.5v9l-5.5-3z"/><path d="M3 3l18 18"/></svg>';
  const HAND = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 11V5.5a1.5 1.5 0 0 1 3 0V11m0-1.5v-4a1.5 1.5 0 0 1 3 0V11m0-2a1.5 1.5 0 0 1 3 0v6a6 6 0 0 1-6 6h-1a6 6 0 0 1-5.2-3l-1.6-2.8a1.4 1.4 0 0 1 2.3-1.6L8 15V8.5a1.5 1.5 0 0 1 3 0"/></svg>';
  const SHARE = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="2.5" y="4" width="19" height="13" rx="2"/><path d="M12 13V7M9 10l3-3 3 3"/></svg>';

  /* ==========================================================
     Audio: one context for meters, and a mixer for screen audio
     ========================================================== */

  /**
   * One AudioContext for the whole room. Browsers hand it back suspended until a
   * user gesture happens, and a suspended context returns silence from every
   * analyser — which is why the level meters read zero if we do not resume it.
   */
  function audioContext() {
    if (state.audioCtx) {
      if (state.audioCtx.state === 'suspended') state.audioCtx.resume().catch(() => {});
      return state.audioCtx;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    state.audioCtx = new Ctx();
    state.audioCtx.addEventListener('statechange', () => {
      if (state.audioCtx && state.audioCtx.state === 'suspended') {
        state.audioCtx.resume().catch(() => {});
      }
    });
    if (state.audioCtx.state === 'suspended') state.audioCtx.resume().catch(() => {});
    return state.audioCtx;
  }

  async function resumeAudio() {
    const ctx = audioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch (_) {
        /* the next gesture will try again */
      }
    }
  }

  /**
   * Attach a level meter to a stream. Returns a stop function.
   * The analyser is fed from the stream without touching the speakers — the
   * <video> element remains the thing that actually makes sound.
   */
  function attachMeter(stream, bar) {
    const ctx = audioContext();
    if (!ctx || !stream || !bar) return () => {};
    let source;
    let analyser;
    try {
      source = ctx.createMediaStreamSource(stream);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.75;
      source.connect(analyser);
    } catch (_) {
      return () => {};
    }
    const data = new Uint8Array(analyser.fftSize);
    const entry = { analyser, data, bar, active: true };
    state.meters.add(entry);
    return () => {
      entry.active = false;
      state.meters.delete(entry);
      try {
        source.disconnect();
      } catch (_) {
        /* noop */
      }
    };
  }

  function meterLoop() {
    if (state.audioCtx && state.audioCtx.state === 'suspended') {
      state.audioCtx.resume().catch(() => {});
    }
    state.meters.forEach((entry) => {
      if (!entry.active) return;
      entry.analyser.getByteTimeDomainData(entry.data);
      let sum = 0;
      for (let i = 0; i < entry.data.length; i++) {
        const v = (entry.data[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / entry.data.length);
      const level = Math.min(1, rms * 3.4);
      entry.bar.style.setProperty('--level', level.toFixed(3));
      entry.bar.classList.toggle('is-live', level > 0.02);
    });
    requestAnimationFrame(meterLoop);
  }

  /* ==========================================================
     ICE configuration (STUN + optional TURN relay)
     ========================================================== */

  async function loadIce() {
    try {
      const res = await fetch(API + '/api/ice');
      const data = await res.json();
      if (data && Array.isArray(data.iceServers) && data.iceServers.length) {
        state.iceServers = CFG.iceServers && CFG.iceServers.length ? CFG.iceServers : data.iceServers;
        const hasTurn = data.iceServers.some((s) => String(s.urls).includes('turn'));
        console.info(
          hasTurn
            ? '[rise-of-zoom] TURN relay available — calls work behind strict NAT'
            : '[rise-of-zoom] STUN only — set TURN_URLS on the server for strict networks'
        );
      }
    } catch (_) {
      state.iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
    }
  }

  /* ==========================================================
     Room metadata
     ========================================================== */

  async function loadRoomMeta() {
    try {
      const res = await fetch(`${API}/api/rooms/${encodeURIComponent(roomId)}`);
      const data = await res.json();
      const floor = data.floor;
      if (floor) {
        $('#roomLevel').textContent = floor.level;
        $('#roomName').textContent = floor.name;
        $('#prejoinTitle').textContent = `${floor.level} · ${floor.name}`;
      } else {
        $('#roomLevel').textContent = '◆';
        $('#roomName').textContent = 'Private room';
        $('#prejoinTitle').textContent = 'Private room';
        $('#roomCode').textContent = roomId;
      }
      document.title = `${floor ? floor.level + ' · ' + floor.name : roomId} — Rise of Zoom`;
    } catch (_) {
      $('#roomName').textContent = roomId;
    }
  }

  /* ==========================================================
     Devices + preview
     ========================================================== */

  async function listDevices() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      state.devices = {
        cams: devices.filter((d) => d.kind === 'videoinput'),
        mics: devices.filter((d) => d.kind === 'audioinput')
      };
      fillSelect($('#camSelect'), state.devices.cams, 'camera');
      fillSelect($('#micSelect'), state.devices.mics, 'microphone');
    } catch (_) {
      /* no devices */
    }
  }

  function fillSelect(select, devices, fallback) {
    if (!select) return;
    const current = select.value;
    select.innerHTML = '';
    if (!devices.length) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = `Default ${fallback}`;
      select.appendChild(opt);
      return;
    }
    devices.forEach((device, i) => {
      const opt = document.createElement('option');
      opt.value = device.deviceId;
      opt.textContent = device.label || `${fallback} ${i + 1}`;
      select.appendChild(opt);
    });
    if (current && devices.some((d) => d.deviceId === current)) select.value = current;
  }

  async function startPreview() {
    try {
      const camId = $('#camSelect').value;
      const micId = $('#micSelect').value;
      const constraints = {
        video: camId
          ? { deviceId: { exact: camId }, width: { ideal: 1280 }, height: { ideal: 720 } }
          : { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: micId
          ? { deviceId: { exact: micId }, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
          : { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      state.localStream = stream;
      preview.srcObject = stream;
      preview.hidden = false;
      $('#previewFallback').hidden = true;
      state.micOn = stream.getAudioTracks().length > 0;
      state.camOn = stream.getVideoTracks().length > 0;
      $('#previewBadge').textContent = state.micOn ? 'Ready' : 'No microphone';
      $('#prejoinNote').textContent = 'Your browser will ask for camera and microphone access.';
      $('#prejoinNote').classList.remove('is-error');
      await listDevices();
    } catch (err) {
      console.warn('camera/mic unavailable', err);
      state.localStream = null;
      preview.hidden = true;
      $('#previewFallback').hidden = false;
      $('#previewInitials').textContent = initials($('#nameInput').value || 'G');
      $('#previewBadge').textContent = 'Camera unavailable';
      $('#prejoinNote').textContent =
        'No camera or microphone was found. You can still join and appear as an avatar.';
      $('#prejoinNote').classList.add('is-error');
    }
  }

  async function restartPreview(kind) {
    if (!state.localStream) return startPreview();
    const old = state.localStream;
    const drop = old.getTracks().find((t) => t.kind === (kind === 'video' ? 'video' : 'audio'));
    const kept = new MediaStream();
    old.getTracks().forEach((track) => {
      if (track !== drop) kept.addTrack(track);
    });
    try {
      const deviceId = kind === 'video' ? $('#camSelect').value : $('#micSelect').value;
      const constraints =
        kind === 'video'
          ? { video: deviceId ? { deviceId: { exact: deviceId } } : true }
          : { audio: deviceId ? { deviceId: { exact: deviceId } } : true };
      const fresh = await navigator.mediaDevices.getUserMedia(constraints);
      fresh.getTracks().forEach((t) => kept.addTrack(t));
      old.getTracks().forEach((t) => t.stop());
      state.localStream = kept;
      preview.srcObject = kept;
      preview.hidden = !state.camOn;
      if (kind === 'audio') state.micOn = kept.getAudioTracks().length > 0;
      if (kind === 'video') state.camOn = kept.getVideoTracks().length > 0;
    } catch (err) {
      console.warn('could not switch device', err);
    }
  }

  /* ==========================================================
     Tiles
     ========================================================== */

  function createTile(id, name, isLocal) {
    const tile = document.createElement('div');
    tile.className = 'tile' + (isLocal ? ' is-local' : '');
    tile.dataset.id = id;
    tile.innerHTML = `
      <video autoplay playsinline ${isLocal ? 'muted' : ''}></video>
      <div class="tile__fallback"><span>${initials(name)}</span></div>
      <div class="tile__icons"></div>
      <div class="tile__status"><i></i><span></span></div>
      <div class="tile__bar">
        <span class="tile__meter"><i></i></span>
        <span class="tile__name">${escapeHtml(name)}</span>
        <span class="tile__tag" hidden>You</span>
      </div>`;

    if (isLocal) {
      const tag = $('.tile__tag', tile);
      tag.textContent = 'You';
      tag.hidden = false;
    }

    tile.addEventListener('click', (e) => {
      if (e.target.closest('.tile__icons')) return;
      if (isLocal) return;
      togglePin(id);
    });

    grid.appendChild(tile);
    return tile;
  }

  function escapeHtml(str) {
    return String(str).replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  }

  const localTile = () => grid.querySelector('.tile.is-local');

  function attachLocalStream() {
    const tile = localTile();
    if (!tile) return;
    const video = $('video', tile);
    video.srcObject = state.localStream;
    video.play().catch(() => {});
  }

  function setTileMedia(tile, media) {
    const icons = $('.tile__icons', tile);
    const items = [];
    if (media.muted) items.push({ icon: MIC_OFF, cls: 'is-off', title: 'Muted' });
    else items.push({ icon: MIC_ON, cls: '', title: 'Live mic' });
    if (media.cameraOff) items.push({ icon: CAM_OFF, cls: 'is-off', title: 'Camera off' });
    if (media.sharing) items.push({ icon: SHARE, cls: 'is-share', title: 'Sharing screen' });
    if (media.handRaised) items.push({ icon: HAND, cls: 'is-hand', title: 'Hand raised' });
    icons.innerHTML = items.map((i) => `<span class="tile__icon ${i.cls}" title="${i.title}">${i.icon}</span>`).join('');

    tile.classList.toggle('has-video', !media.cameraOff);
    tile.classList.toggle('is-cam-off', !!media.cameraOff);
  }

  function setTileStatus(tile, status, label) {
    const el = $('.tile__status', tile);
    if (!el) return;
    el.dataset.state = status;
    el.querySelector('span').textContent = label || '';
  }

  function updateLayout() {
    const count = grid.querySelectorAll('.tile').length;
    grid.classList.toggle('count-1', count === 1);
    grid.classList.toggle('count-2', count === 2);
    grid.classList.toggle('has-people', count > 1);
    emptyState.hidden = count > 1;
  }

  /* ==========================================================
     WebRTC — perfect negotiation
     ========================================================== */

  function isPolite(peerId) {
    // Deterministic: the peer with the lexicographically larger id yields.
    return String(state.selfId || '') > String(peerId || '');
  }

  function createPeer(id, name, initiator) {
    if (state.peers.has(id)) return state.peers.get(id);

    const pc = new RTCPeerConnection({ iceServers: state.iceServers, bundlePolicy: 'max-bundle' });
    const peer = {
      id,
      pc,
      stream: new MediaStream(),
      tile: null,
      name: name || 'Guest',
      media: { muted: true, cameraOff: false, sharing: false, handRaised: false },
      polite: isPolite(id),
      makingOffer: false,
      ignoreOffer: false,
      suppressNegotiation: !initiator,
      restartTimer: null
    };
    state.peers.set(id, peer);

    if (state.localStream) {
      state.localStream.getTracks().forEach((track) => pc.addTrack(track, state.localStream));
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('rtc:signal', { to: id, data: { type: 'ice', candidate: event.candidate.toJSON() } });
      }
    };

    pc.ontrack = (event) => {
      peer.stream.addTrack(event.track);
      const video = $('video', peer.tile);
      if (video && video.srcObject !== peer.stream) {
        video.srcObject = peer.stream;
        // Remote audio can be blocked by the autoplay policy — play() and
        // surface a "tap for sound" hint if the browser refuses.
        const attempt = video.play();
        if (attempt && attempt.catch) {
          attempt.catch(() => {
            video.muted = false;
            video.play().catch(() => {
              state.audioUnlocked = false;
              $('#audioHint').hidden = false;
            });
          });
        }
      }
      if (event.track.kind === 'audio') {
        peer.stopMeter = attachMeter(peer.stream, $('.tile__meter i', peer.tile));
      }
    };

    pc.onnegotiationneeded = async () => {
      if (peer.suppressNegotiation) return;
      try {
        peer.makingOffer = true;
        await pc.setLocalDescription();
        socket.emit('rtc:signal', { to: id, data: { type: 'offer', sdp: pc.localDescription } });
      } catch (err) {
        console.warn('negotiation failed', err);
      } finally {
        peer.makingOffer = false;
      }
    };

    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (peer.tile) {
        if (s === 'connected') setTileStatus(peer.tile, 'live', '');
        else if (s === 'connecting' || s === 'new') setTileStatus(peer.tile, 'connecting', 'connecting');
        else if (s === 'disconnected') setTileStatus(peer.tile, 'poor', 'reconnecting');
        else if (s === 'failed') setTileStatus(peer.tile, 'poor', 'no connection');
      }
      updateConnState();

      if (s === 'failed') {
        // Try an ICE restart before giving up on the peer.
        const now = Date.now();
        if (now - state.lastRestart > 8000) {
          state.lastRestart = now;
          try {
            pc.restartIce();
          } catch (_) {
            /* noop */
          }
        }
      }
      if (s === 'closed') cleanupPeer(id);
    };

    return peer;
  }

  function ensureTile(peer) {
    if (!peer.tile) {
      peer.tile = createTile(peer.id, peer.name, false);
      setTileMedia(peer.tile, peer.media);
      setTileStatus(peer.tile, 'connecting', 'connecting');
      updateLayout();
      updatePeople();
    }
    return peer.tile;
  }

  function cleanupPeer(id) {
    const peer = state.peers.get(id);
    if (!peer) return;
    try {
      peer.pc.close();
    } catch (_) {
      /* noop */
    }
    if (peer.stopMeter) peer.stopMeter();
    state.peers.delete(id);
    if (peer.tile) {
      peer.tile.remove();
      if (state.pinned === id) unpin();
    }
    updateLayout();
    updatePeople();
    updateConnState();
  }

  socket.on('rtc:signal', async ({ from, data }) => {
    try {
      let peer = state.peers.get(from);
      if (!peer) {
        peer = createPeer(from, 'Guest', false);
        ensureTile(peer);
      }
      const pc = peer.pc;

      if (data.type === 'offer') {
        const collision = peer.makingOffer || pc.signalingState !== 'stable';
        peer.ignoreOffer = !peer.polite && collision;
        if (peer.ignoreOffer) return;

        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        await pc.setLocalDescription();
        socket.emit('rtc:signal', { to: from, data: { type: 'answer', sdp: pc.localDescription } });
        peer.suppressNegotiation = false;
      } else if (data.type === 'answer') {
        if (pc.signalingState === 'have-local-offer') {
          await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        }
      } else if (data.type === 'ice' && data.candidate) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (_) {
          /* candidate can arrive before the remote description */
        }
      }
    } catch (err) {
      console.warn('signal error', err);
    }
  });

  /* ==========================================================
     Socket lifecycle
     ========================================================== */

  socket.on('room:joined', async (payload) => {
    state.selfId = payload.selfId;
    state.joined = true;

    const tile = createTile(state.selfId, state.name, true);
    setTileMedia(tile, { muted: !state.micOn, cameraOff: !state.camOn, sharing: false, handRaised: false });
    setTileStatus(tile, 'live', '');
    attachLocalStream();
    if (state.localStream) {
      state.localStopMeter = attachMeter(state.localStream, $('.tile__meter i', tile));
    }
    updateLayout();
    updatePeople();
    updateConnState();

    (payload.chat || []).forEach((m) => appendChat(m, true));

    // The newcomer offers to everyone already in the room.
    for (const participant of payload.participants || []) {
      const peer = createPeer(participant.id, participant.name, true);
      peer.media = {
        muted: participant.muted,
        cameraOff: participant.cameraOff,
        sharing: participant.sharing,
        handRaised: participant.handRaised
      };
      ensureTile(peer);
    }
  });

  socket.on('room:peer-joined', ({ participant }) => {
    if (!participant || participant.id === state.selfId) return;
    const peer = createPeer(participant.id, participant.name, false);
    peer.media = {
      muted: participant.muted,
      cameraOff: participant.cameraOff,
      sharing: participant.sharing,
      handRaised: participant.handRaised
    };
    ensureTile(peer);
    systemChat(`${participant.name} entered the room.`);
    updateConnState();
  });

  socket.on('room:peer-left', ({ id, reason }) => {
    const peer = state.peers.get(id);
    if (peer) systemChat(`${peer.name} ${reason === 'disconnected' ? 'lost connection' : 'left the room'}.`);
    cleanupPeer(id);
  });

  socket.on('room:peer-media', ({ id, state: media }) => {
    const peer = state.peers.get(id);
    if (!peer) return;
    Object.assign(peer.media, media);
    if (peer.tile) setTileMedia(peer.tile, peer.media);
  });

  socket.on('room:hand', ({ id, raised }) => {
    const peer = state.peers.get(id);
    if (!peer) return;
    peer.media.handRaised = raised;
    if (peer.tile) setTileMedia(peer.tile, peer.media);
  });

  socket.on('room:chat', (message) => {
    appendChat(message);
    if (side.dataset.open !== 'true') {
      state.unread += 1;
      $('#chatState').textContent = String(state.unread);
    }
  });

  socket.on('room:reaction', ({ name, emoji }) => {
    spawnFloater(emoji);
    if (name) systemChat(`${name} reacted ${emoji}`);
  });

  socket.on('server:broadcast', ({ message }) => {
    toast(message, 'warn');
    systemChat(`Notice: ${message}`);
  });

  socket.on('room:closed', ({ reason }) => {
    toast(reason || 'The room was closed.', 'warn');
    setTimeout(() => (location.href = '/'), 1800);
  });

  socket.on('server:kicked', ({ reason }) => {
    toast(reason || 'You were removed from the room.', 'warn');
    setTimeout(() => (location.href = '/'), 1800);
  });

  socket.on('server:blocked', ({ reason }) => {
    toast(reason || 'Access denied.', 'warn');
    setTimeout(() => (location.href = '/'), 1800);
  });

  socket.on('connect_error', () => {
    $('#prejoinNote').textContent = 'Cannot reach the signalling server. Check your connection.';
    $('#prejoinNote').classList.add('is-error');
  });

  socket.on('disconnect', () => {
    if (state.joined) {
      toast('Signal lost — reconnecting…', 'warn');
      updateConnState();
    }
  });

  socket.on('connect', () => {
    if (state.joined && state.roomJoined) {
      toast('Signal restored.', 'warn');
    }
  });

  /* ==========================================================
     People + chat
     ========================================================== */

  function updatePeople() {
    const list = [];
    list.push({
      id: state.selfId,
      name: `${state.name} (you)`,
      muted: !state.micOn,
      handRaised: state.handRaised,
      host: true
    });
    state.peers.forEach((peer) => {
      list.push({
        id: peer.id,
        name: peer.name,
        muted: peer.media.muted,
        handRaised: peer.media.handRaised,
        host: false
      });
    });

    peopleEl.innerHTML = list
      .map(
        (p) => `
        <li>
          <span class="people__avatar">${initials(p.name.replace(' (you)', ''))}</span>
          <span class="people__name">${escapeHtml(p.name)}</span>
          ${p.handRaised ? '<span class="people__tag is-hand">Hand</span>' : ''}
          ${p.host ? '<span class="people__tag is-host">You</span>' : ''}
          <span class="people__meta">${p.muted ? 'Muted' : 'Live'}</span>
        </li>`
      )
      .join('');

    $('#peopleCount').textContent = String(list.length);
    $('#peopleState').textContent = String(list.length);
  }

  function appendChat(message, silent) {
    const div = document.createElement('div');
    div.className = 'chat__msg';
    div.innerHTML = `<span class="chat__who">${escapeHtml(message.from)}</span><span class="chat__text">${escapeHtml(message.text)}</span>`;
    chatEl.appendChild(div);
    chatEl.scrollTop = chatEl.scrollHeight;
    if (!silent) {
      const count = Number($('#chatCount').textContent || 0) + 1;
      $('#chatCount').textContent = String(count);
    }
  }

  function systemChat(text) {
    const div = document.createElement('div');
    div.className = 'chat__msg chat__sys';
    div.textContent = text;
    chatEl.appendChild(div);
    chatEl.scrollTop = chatEl.scrollHeight;
  }

  function spawnFloater(emoji) {
    const el = document.createElement('div');
    el.className = 'floater';
    el.textContent = emoji;
    el.style.left = `${30 + Math.random() * 40}%`;
    floaters.appendChild(el);
    setTimeout(() => el.remove(), 3400);
  }

  function updateConnState() {
    if (!connState) return;
    const peers = Array.from(state.peers.values());
    const failed = peers.filter((p) => p.pc.connectionState === 'failed').length;
    const connecting = peers.filter(
      (p) => p.pc.connectionState === 'connecting' || p.pc.connectionState === 'new'
    ).length;
    const label = connState.querySelector('span');
    if (failed) {
      connState.dataset.state = 'poor';
      label.textContent = 'Some peers unreachable';
    } else if (connecting) {
      connState.dataset.state = 'connecting';
      label.textContent = 'Connecting…';
    } else if (peers.length) {
      connState.dataset.state = 'live';
      label.textContent = 'Connected';
    } else {
      connState.dataset.state = 'idle';
      label.textContent = 'Waiting for others';
    }
  }

  /* ==========================================================
     Toolbar
     ========================================================== */

  function publishMedia(patch) {
    socket.emit('rtc:media', patch);
    const tile = localTile();
    if (tile) {
      setTileMedia(tile, {
        muted: patch.muted !== undefined ? patch.muted : !state.micOn,
        cameraOff: patch.cameraOff !== undefined ? patch.cameraOff : !state.camOn,
        sharing: patch.sharing !== undefined ? patch.sharing : state.sharing,
        handRaised: patch.handRaised !== undefined ? patch.handRaised : state.handRaised
      });
    }
  }

  function toggleMic() {
    if (!state.localStream) return;
    const tracks = state.localStream.getAudioTracks();
    if (!tracks.length) {
      toast('No microphone detected on this device.', 'warn');
      return;
    }
    state.micOn = !state.micOn;
    tracks.forEach((t) => (t.enabled = state.micOn));
    $('#micBtn').dataset.on = String(state.micOn);
    $('#micBtn').querySelector('.dock__label').textContent = state.micOn ? 'Mute' : 'Unmute';
    $('#micState').textContent = state.micOn ? '' : 'OFF';
    publishMedia({ muted: !state.micOn });
    updatePeople();
  }

  function toggleCam() {
    if (!state.localStream) return;
    const tracks = state.localStream.getVideoTracks();
    if (!tracks.length) {
      toast('No camera detected on this device.', 'warn');
      return;
    }
    state.camOn = !state.camOn;
    tracks.forEach((t) => (t.enabled = state.camOn));
    $('#camBtn').dataset.on = String(state.camOn);
    $('#camBtn').querySelector('.dock__label').textContent = state.camOn ? 'Camera' : 'Start video';
    $('#camState').textContent = state.camOn ? '' : 'OFF';
    publishMedia({ cameraOff: !state.camOn });
  }

  /** Replace the outgoing video track on every peer with the screen capture. */
  function replaceVideoTrack(track) {
    state.peers.forEach((peer) => {
      const sender = peer.pc.getSenders().find((s) => s.track && s.track.kind === 'video');
      if (sender) sender.replaceTrack(track).catch(() => {});
    });
  }

  function replaceAudioTrack(track) {
    state.peers.forEach((peer) => {
      const sender = peer.pc.getSenders().find((s) => s.track && s.track.kind === 'audio');
      if (sender) sender.replaceTrack(track).catch(() => {});
    });
  }

  async function toggleShare() {
    if (state.sharing) {
      const camTrack = state.localStream ? state.localStream.getVideoTracks()[0] : null;
      if (camTrack) replaceVideoTrack(camTrack);
      if (state.screenStream) state.screenStream.getTracks().forEach((t) => t.stop());
      state.screenStream = null;
      state.sharing = false;
      $('#shareBtn').dataset.on = 'false';
      $('#shareBtn').querySelector('.dock__label').textContent = 'Share';
      $('#shareState').textContent = '';
      publishMedia({ sharing: false });
      return;
    }

    try {
      const screen = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      state.screenStream = screen;
      state.sharing = true;
      const screenTrack = screen.getVideoTracks()[0];
      replaceVideoTrack(screenTrack);
      screenTrack.onended = () => toggleShare();
      $('#shareBtn').dataset.on = 'true';
      $('#shareBtn').querySelector('.dock__label').textContent = 'Stop share';
      $('#shareState').textContent = 'LIVE';
      publishMedia({ sharing: true });
      toast(screen.getAudioTracks().length ? 'Sharing your screen with audio.' : 'You are sharing your screen.');
    } catch (_) {
      toast('Screen sharing was cancelled.', 'warn');
    }
  }

  function toggleHand() {
    state.handRaised = !state.handRaised;
    $('#handBtn').dataset.on = String(state.handRaised);
    $('#handState').textContent = state.handRaised ? '↑' : '';
    socket.emit('room:raise-hand', { raised: state.handRaised });
    publishMedia({ handRaised: state.handRaised });
    updatePeople();
  }

  function togglePin(id) {
    if (state.pinned === id) {
      unpin();
      return;
    }
    unpin();
    const peer = state.peers.get(id);
    if (!peer || !peer.tile) return;
    state.pinned = id;
    peer.tile.classList.add('is-pinned');
    grid.classList.add('has-pinned');
    $('#pinbar').hidden = false;
    $('#pinName').textContent = peer.name;
  }

  function unpin() {
    if (state.pinned) {
      const tile = grid.querySelector(`.tile[data-id="${state.pinned}"]`);
      if (tile) tile.classList.remove('is-pinned');
    }
    state.pinned = null;
    grid.classList.remove('has-pinned');
    $('#pinbar').hidden = true;
  }

  function toggleSide(open) {
    const isOpen = side.dataset.open === 'true';
    const next = open === undefined ? !isOpen : open;
    side.dataset.open = String(next);
    $('#peopleBtn').dataset.on = String(next);
    $('#chatBtn').dataset.on = String(next);
    if (next) {
      state.unread = 0;
      $('#chatState').textContent = '0';
    }
  }

  /* ==========================================================
     Recording (canvas composite → webm)
     ========================================================== */

  const recorder = {
    active: false,
    canvas: null,
    ctx: null,
    stream: null,
    rec: null,
    chunks: [],
    raf: null,
    audioCtx: null
  };

  async function toggleRecord() {
    if (recorder.active) {
      stopRecording();
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 720;
    const ctx = canvas.getContext('2d');
    recorder.canvas = canvas;
    recorder.ctx = ctx;
    recorder.chunks = [];

    const stream = canvas.captureStream(30);

    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      recorder.audioCtx = audioCtx;
      const destination = audioCtx.createMediaStreamDestination();
      const sources = [];
      if (state.localStream) sources.push(state.localStream);
      state.peers.forEach((p) => sources.push(p.stream));
      sources.forEach((src) => {
        if (!src.getAudioTracks().length) return;
        try {
          audioCtx.createMediaStreamSource(src).connect(destination);
        } catch (_) {
          /* noop */
        }
      });
      destination.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
    } catch (_) {
      /* audio may be unavailable */
    }

    recorder.stream = stream;
    const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
      ? 'video/webm;codecs=vp9,opus'
      : 'video/webm';
    recorder.rec = new MediaRecorder(stream, { mimeType: mime });
    recorder.rec.ondataavailable = (e) => {
      if (e.data && e.data.size) recorder.chunks.push(e.data);
    };
    recorder.rec.onstop = () => {
      const blob = new Blob(recorder.chunks, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `rise-of-zoom-${roomId}-${Date.now()}.webm`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast('Recording saved to your downloads.');
    };
    recorder.rec.start(1000);
    recorder.active = true;
    $('#recBtn').dataset.on = 'true';
    $('#recBadge').hidden = false;
    toast('Recording started.');

    const draw = () => {
      if (!recorder.active) return;
      const tiles = Array.from(grid.querySelectorAll('.tile'));
      const cols = Math.ceil(Math.sqrt(tiles.length || 1));
      const rows = Math.ceil((tiles.length || 1) / cols);
      const w = canvas.width / cols;
      const h = canvas.height / rows;
      ctx.fillStyle = '#08090b';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      tiles.forEach((tile, i) => {
        const video = $('video', tile);
        const x = (i % cols) * w;
        const y = Math.floor(i / cols) * h;
        if (video && video.readyState >= 2 && !tile.classList.contains('is-cam-off')) {
          const vw = video.videoWidth;
          const vh = video.videoHeight;
          if (vw && vh) {
            const scale = Math.max(w / vw, h / vh);
            const dw = vw * scale;
            const dh = vh * scale;
            ctx.save();
            ctx.translate(x + w / 2, y + h / 2);
            if (tile.classList.contains('is-local')) ctx.scale(-1, 1);
            ctx.drawImage(video, -dw / 2, -dh / 2, dw, dh);
            ctx.restore();
          }
        } else {
          ctx.fillStyle = '#111418';
          ctx.fillRect(x, y, w, h);
        }
      });
      recorder.raf = requestAnimationFrame(draw);
    };
    draw();
  }

  function stopRecording() {
    recorder.active = false;
    if (recorder.raf) cancelAnimationFrame(recorder.raf);
    if (recorder.rec && recorder.rec.state !== 'inactive') recorder.rec.stop();
    if (recorder.audioCtx) recorder.audioCtx.close().catch(() => {});
    recorder.audioCtx = null;
    $('#recBtn').dataset.on = 'false';
    $('#recBadge').hidden = true;
  }

  /* ==========================================================
     Join + leave
     ========================================================== */

  async function joinRoom() {
    const name = ($('#nameInput').value || '').trim() || 'Guest';
    state.name = name;

    if (state.localStream) {
      state.localStream.getAudioTracks().forEach((t) => (t.enabled = state.micOn));
      state.localStream.getVideoTracks().forEach((t) => (t.enabled = state.camOn));
    }

    // The click on "Join" is the user gesture that lets the AudioContext run.
    await resumeAudio();

    const result = await new Promise((resolve) => {
      socket.emit('room:join', { roomId, name }, (res) => resolve(res));
      setTimeout(() => resolve({ ok: false, error: 'timeout' }), 8000);
    });

    if (!result || !result.ok) {
      const error = (result && result.error) || 'unknown';
      const messages = {
        locked: 'This room is locked by an administrator.',
        full: 'This room is full.',
        maintenance: (result && result.message) || 'The tower is under maintenance.',
        blocked: 'Your address has been blocked.',
        timeout: 'The server did not answer. Try again.'
      };
      $('#prejoinNote').textContent = messages[error] || 'Could not join the room.';
      $('#prejoinNote').classList.add('is-error');
      return;
    }

    prejoin.hidden = true;
    state.startedAt = Date.now();
    state.roomJoined = true;
    startClock();
    requestAnimationFrame(meterLoop);
  }

  function leaveRoom(silent) {
    socket.emit('room:leave');
    state.peers.forEach((peer) => {
      try {
        peer.pc.close();
      } catch (_) {
        /* noop */
      }
    });
    state.peers.clear();
    if (state.localStream) state.localStream.getTracks().forEach((t) => t.stop());
    if (state.screenStream) state.screenStream.getTracks().forEach((t) => t.stop());
    if (recorder.active) stopRecording();
    if (!silent) location.href = '/';
  }

  function startClock() {
    const tick = () => {
      if (!state.startedAt) return;
      $('#clock').textContent = timeString(Date.now() - state.startedAt);
    };
    tick();
    setInterval(tick, 1000);
  }

  /* ==========================================================
     Wiring
     ========================================================== */

  $('#micBtn').addEventListener('click', toggleMic);
  $('#camBtn').addEventListener('click', toggleCam);
  $('#shareBtn').addEventListener('click', toggleShare);
  $('#handBtn').addEventListener('click', toggleHand);
  $('#recBtn').addEventListener('click', toggleRecord);
  $('#peopleBtn').addEventListener('click', () => toggleSide());
  $('#chatBtn').addEventListener('click', () => toggleSide());
  $('#sideClose').addEventListener('click', () => toggleSide(false));
  $('#unpin').addEventListener('click', unpin);

  $$('.dock__btn--emoji').forEach((btn) => {
    btn.addEventListener('click', () => {
      socket.emit('room:reaction', { emoji: btn.dataset.emoji });
      spawnFloater(btn.dataset.emoji);
    });
  });

  $$('.side__tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      $$('.side__tab').forEach((t) => t.classList.toggle('is-active', t === tab));
      $$('.side__panel').forEach((p) => p.classList.toggle('is-active', p.dataset.panel === tab.dataset.tab));
    });
  });

  $('#chatForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#chatInput');
    const text = input.value.trim();
    if (!text) return;
    socket.emit('room:chat', { text });
    input.value = '';
  });

  $('#leaveBtn').addEventListener('click', () => leaveRoom());
  $('#joinBtn').addEventListener('click', joinRoom);

  $('#nameInput').addEventListener('input', (e) => {
    $('#previewInitials').textContent = initials(e.target.value || 'G');
  });

  $('#prejoinMic').addEventListener('click', (e) => {
    state.micOn = !state.micOn;
    if (state.localStream) state.localStream.getAudioTracks().forEach((t) => (t.enabled = state.micOn));
    e.currentTarget.textContent = state.micOn ? 'Mute mic' : 'Unmute mic';
  });

  $('#prejoinCam').addEventListener('click', (e) => {
    state.camOn = !state.camOn;
    if (state.localStream) state.localStream.getVideoTracks().forEach((t) => (t.enabled = state.camOn));
    preview.hidden = !state.camOn;
    e.currentTarget.textContent = state.camOn ? 'Stop camera' : 'Start camera';
  });

  $('#camSelect').addEventListener('change', () => restartPreview('video'));
  $('#micSelect').addEventListener('change', () => restartPreview('audio'));

  $('#copyCode').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(roomId);
      toast('Invite code copied.');
    } catch (_) {
      toast(`Invite code: ${roomId}`);
    }
  });

  // Unlock audio if the browser blocked autoplay for a remote stream.
  const audioHint = $('#audioHint');
  if (audioHint) {
    audioHint.addEventListener('click', () => {
      state.peers.forEach((peer) => {
        const video = $('video', peer.tile);
        if (video) video.play().catch(() => {});
      });
      audioHint.hidden = true;
    });
  }

  // Hot-plug: a headset plugged in mid-call should be picked up.
  if (navigator.mediaDevices && 'ondevicechange' in navigator.mediaDevices) {
    navigator.mediaDevices.addEventListener('devicechange', async () => {
      await listDevices();
      if (state.joined) toast('Devices changed — check your camera and microphone.');
    });
  }

  window.addEventListener('beforeunload', () => socket.emit('room:leave'));
  ['pointerdown', 'keydown'].forEach((evt) => {
    document.addEventListener(evt, () => {
      if (state.joined) resumeAudio();
    }, { passive: true });
  });

  document.addEventListener('keydown', (e) => {
    if (state.joined && !e.metaKey && !e.ctrlKey) {
      if (e.key === 'm') toggleMic();
      if (e.key === 'v') toggleCam();
      if (e.key === 'h') toggleHand();
    }
  });

  /* ==========================================================
     Boot
     ========================================================== */

  // handy for debugging from the console
  window.__roz = state;

  loadIce();
  loadRoomMeta();
  startPreview();
  updatePeople();
  updateConnState();
})();
