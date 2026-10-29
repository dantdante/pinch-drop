/* ==========================================================
   Rise of Zoom — control room client
   ========================================================== */

(function () {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  /* Deployment configuration — see /config.js */
  const CFG = window.RISE_OF_ZOOM || {};
  const API = (CFG.apiBase || '').replace(/\/$/, '');
  const ROZ = window.ROZ || {};

  const gate = $('#gate');
  const dash = $('#dash');
  const toastEl = $('#toast');

  const state = {
    role: null,
    token: null,
    data: null,
    timer: null,
    socket: null,
    live: false
  };

  /* ---------------- live updates ---------------- */

  /**
   * The control room subscribes to the signalling server so the tables update
   * the moment something changes, instead of waiting for the next poll.
   */
  async function connectLive(token) {
    if (!token) return;
    /* The Socket.IO client is fetched from the signalling origin, which is
       not the page origin when the control room is served statically. */
    let ioClient;
    try {
      ioClient = await (ROZ.ensureSocketIO ? ROZ.ensureSocketIO() : Promise.resolve(window.io));
    } catch (err) {
      console.warn('live updates unavailable', err);
      renderLiveBadge();
      return;
    }
    if (state.socket) {
      state.socket.disconnect();
      state.socket = null;
    }
    const socket = ioClient(API || undefined, { transports: ['websocket', 'polling'] });
    state.socket = socket;
    socket.on('connect', () => {
      socket.emit('admin:subscribe', { token }, (ack) => {
        state.live = !!(ack && ack.ok);
        renderLiveBadge();
        if (state.live) load();
      });
    });
    socket.on('admin:refresh', () => load());
    socket.on('disconnect', () => {
      state.live = false;
      renderLiveBadge();
    });
  }

  function renderLiveBadge() {
    const el = $('#liveBadge');
    if (!el) return;
    el.dataset.state = state.live ? 'live' : 'idle';
    el.querySelector('span').textContent = state.live ? 'Live' : 'Polling';
  }

  /* ---------------- helpers ---------------- */

  const escapeHtml = (str) =>
    String(str === undefined || str === null ? '' : str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));

  let toastTimer = null;
  function toast(message, kind) {
    toastEl.textContent = message;
    toastEl.classList.toggle('is-warn', kind === 'warn');
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toastEl.hidden = true), 4000);
  }

  function timeAgo(ts) {
    const seconds = Math.floor((Date.now() - ts) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    return `${Math.floor(seconds / 3600)}h ago`;
  }

  function duration(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h) return `${h}h ${m}m`;
    if (m) return `${m}m ${s}s`;
    return `${s}s`;
  }

  async function api(path, options) {
    /* The session travels in an Authorization header as well as in the
       httpOnly cookie. A static front-end (GitHub Pages) cannot rely on the
       cookie, because browsers do not send cookies across origins. */
    const opts = Object.assign({}, options || {});
    opts.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    if (state.token && !opts.headers.Authorization) {
      opts.headers.Authorization = 'Bearer ' + state.token;
    }
    const res = await fetch(API + path, opts);
    let data = null;
    try {
      data = await res.json();
    } catch (_) {
      data = null;
    }
    if (res.status === 401) {
      showGate();
      throw new Error('unauthorised');
    }
    return { ok: res.ok && (!data || data.ok !== false), status: res.status, data };
  }

  /* ---------------- gate ---------------- */

  function showGate() {
    gate.hidden = false;
    dash.hidden = true;
    state.role = null;
    if (state.timer) clearInterval(state.timer);
    $('#passwordInput').value = '';
    $('#passwordInput').focus();
  }

  function showDash(role) {
    gate.hidden = true;
    dash.hidden = false;
    state.role = role;
    const chip = $('#roleChip');
    chip.textContent = role === 'owner' ? 'Owner' : 'Operator';
    chip.classList.toggle('is-owner', role === 'owner');
    $('#passwordHint').textContent =
      role === 'owner'
        ? 'Owner access. You may change either credential.'
        : 'Owner access required to change credentials.';
    $('#pwSave').disabled = role !== 'owner';
    $('#pwTarget').disabled = role !== 'owner';
    $('#pwValue').disabled = role !== 'owner';
    load();
    if (state.timer) clearInterval(state.timer);
    state.timer = setInterval(load, 6000);
  }

  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#passwordInput');
    const note = $('#gateNote');
    const btn = $('#loginBtn');
    btn.disabled = true;
    btn.textContent = 'Checking…';
    try {
      const res = await fetch(API + '/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: input.value })
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        note.textContent = 'That password was not accepted.';
        note.classList.add('is-error');
        input.select();
        return;
      }
      note.textContent = 'Two credentials exist: an owner password and an operator password.';
      note.classList.remove('is-error');
      state.token = data.token || null;
      showDash(data.role);
      connectLive(state.token);
    } catch (err) {
      note.textContent = 'The server did not answer. Try again.';
      note.classList.add('is-error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Unlock';
    }
  });

  $('#logoutBtn').addEventListener('click', async () => {
    await fetch(API + '/api/admin/logout', { method: 'POST' });
    if (state.socket) {
      state.socket.disconnect();
      state.socket = null;
    }
    state.live = false;
    showGate();
  });

  $('#refreshBtn').addEventListener('click', load);

  /* ---------------- tabs ---------------- */

  $$('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      $$('.tab').forEach((t) => t.classList.toggle('is-active', t === tab));
      $$('.panelview').forEach((v) => v.classList.toggle('is-active', v.dataset.view === tab.dataset.tab));
    });
  });

  /* ---------------- rendering ---------------- */

  async function load() {
    let res;
    try {
      res = await api('/api/admin/overview');
    } catch (err) {
      return;
    }
    if (!res.ok) return;
    state.data = res.data;
    renderStats(res.data.stats);
    renderRooms(res.data.rooms || []);
    renderPeople(res.data.rooms || []);
    renderFloors(res.data.floors || []);
    renderBlocklist(res.data.blocklist || []);
    renderAudit(res.data.audit || []);
    $('#maintenanceToggle').checked = !!res.data.settings.maintenance;
    $('#dashClock').textContent = new Date().toLocaleTimeString();
  }

  function renderStats(stats) {
    const cards = [
      { value: stats.rooms, label: 'Rooms live' },
      { value: stats.participants, label: 'People connected' },
      { value: stats.floors, label: 'Floors in tower' },
      { value: duration(stats.uptimeSeconds), label: 'Uptime' }
    ];
    if (stats.blocked) cards.push({ value: stats.blocked, label: 'Blocked addresses', warn: true });
    $('#statGrid').innerHTML = cards
      .map(
        (c) => `
        <div class="stat ${c.warn ? 'stat--warn' : ''}">
          <div class="stat__value">${escapeHtml(c.value)}</div>
          <div class="stat__label">${escapeHtml(c.label)}</div>
        </div>`
      )
      .join('');

    $('#cardSystem').innerHTML = `
      <p class="muted">Started ${escapeHtml(new Date(stats.startedAt).toLocaleString())}</p>
      <p class="muted">Uptime ${escapeHtml(duration(stats.uptimeSeconds))} · Capacity ${escapeHtml(stats.capacity || 12)} per room</p>
      <p class="muted">Blocklist holds ${escapeHtml(stats.blocked)} address(es).</p>`;

    $('#cardRooms').innerHTML = stats.rooms
      ? `<p class="muted">${escapeHtml(stats.rooms)} room(s) currently holding ${escapeHtml(stats.participants)} participant(s).</p>`
      : '<p class="muted">No rooms are live right now.</p>';
  }

  function renderRooms(rooms) {
    const tbody = $('#roomsTable tbody');
    if (!rooms.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="muted">No rooms are live.</td></tr>';
      return;
    }
    tbody.innerHTML = rooms
      .map((room) => {
        const names = room.details.map((p) => escapeHtml(p.name)).join(', ') || '—';
        return `
        <tr data-room="${escapeHtml(room.id)}">
          <td><span class="mono">${escapeHtml(room.id)}</span><span class="sub">${names}</span></td>
          <td><span class="pill ${room.kind === 'floor' ? 'pill--floor' : ''}">${escapeHtml(room.kind)}</span></td>
          <td>${room.participants}</td>
          <td>${escapeHtml(timeAgo(room.createdAt))}</td>
          <td><span class="pill ${room.locked ? 'pill--locked' : 'pill--live'}">${room.locked ? 'Locked' : 'Open'}</span></td>
          <td class="right">
            <button class="minibtn" data-act="lock" data-room="${escapeHtml(room.id)}" data-locked="${room.locked}">${room.locked ? 'Unlock' : 'Lock'}</button>
            <button class="minibtn minibtn--danger" data-act="close" data-room="${escapeHtml(room.id)}">Close</button>
          </td>
        </tr>`;
      })
      .join('');
  }

  function renderPeople(rooms) {
    const rows = [];
    rooms.forEach((room) => {
      room.details.forEach((p) => {
        rows.push({ room: room.id, p });
      });
    });
    const tbody = $('#peopleTable tbody');
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="muted">Nobody is connected.</td></tr>';
      return;
    }
    tbody.innerHTML = rows
      .map(
        ({ room, p }) => `
        <tr>
          <td>${escapeHtml(p.name)}</td>
          <td><span class="mono">${escapeHtml(room)}</span></td>
          <td>${escapeHtml(timeAgo(p.joinedAt))}</td>
          <td><span class="pill">${p.muted ? 'Muted' : 'Live'}${p.cameraOff ? ' · Cam off' : ''}${p.sharing ? ' · Sharing' : ''}${p.handRaised ? ' · ✋' : ''}</span></td>
          <td><span class="sub">${escapeHtml(p.address || '—')}</span></td>
          <td class="right">
            <button class="minibtn minibtn--danger" data-act="kick" data-room="${escapeHtml(room)}" data-pid="${escapeHtml(p.id)}">Remove</button>
          </td>
        </tr>`
      )
      .join('');
  }

  function renderFloors(floors) {
    $('#floorsList').innerHTML = floors
      .map(
        (f) => `
        <div class="floorrow" data-floor="${escapeHtml(f.id)}">
          <span class="floorrow__level">${escapeHtml(f.level)}</span>
          <input class="field" data-key="name" value="${escapeHtml(f.name)}" placeholder="Floor name" />
          <input class="field" data-key="tagline" value="${escapeHtml(f.tagline || '')}" placeholder="Tagline" />
          <span class="floorrow__toggle">
            <label class="switch">
              <input type="checkbox" data-key="enabled" ${f.enabled === false ? '' : 'checked'} />
              <span class="switch__track"><span class="switch__dot"></span></span>
            </label>
            <span>Open</span>
            <button class="minibtn" data-act="savefloor" data-floor="${escapeHtml(f.id)}">Save</button>
          </span>
        </div>`
      )
      .join('');
  }

  function renderBlocklist(list) {
    $('#blockList').innerHTML = list.length
      ? list
          .map(
            (b) => `<li><span>${escapeHtml(b.address)}</span>
              <button class="minibtn" data-act="unblock" data-address="${escapeHtml(b.address)}">Remove</button></li>`
          )
          .join('')
      : '<li><span>No addresses are blocked.</span></li>';
  }

  function renderAudit(list) {
    $('#auditList').innerHTML = list.length
      ? list
          .map(
            (entry) => `<li>
              <time>${escapeHtml(new Date(entry.at).toLocaleString())}</time>
              <b>${escapeHtml(entry.action)}</b>
              <span>${escapeHtml(entry.role || '—')} · ${escapeHtml(
                typeof entry.detail === 'object' ? JSON.stringify(entry.detail) : entry.detail || ''
              )}</span>
            </li>`
          )
          .join('')
      : '<li><span>No activity recorded yet.</span></li>';
  }

  /* ---------------- actions ---------------- */

  document.addEventListener('click', async (e) => {
    const button = e.target.closest('[data-act]');
    if (!button) return;
    const act = button.dataset.act;

    if (act === 'lock') {
      const locked = button.dataset.locked !== 'true';
      const res = await api(`/api/admin/rooms/${encodeURIComponent(button.dataset.room)}/lock`, {
        method: 'POST',
        body: JSON.stringify({ locked })
      });
      toast(res.ok ? `Room ${button.dataset.room} ${locked ? 'locked' : 'unlocked'}.` : 'Could not change the room.', res.ok ? '' : 'warn');
      load();
    }

    if (act === 'close') {
      if (!window.confirm(`Close room ${button.dataset.room}? Everyone inside will be disconnected.`)) return;
      const res = await api(`/api/admin/rooms/${encodeURIComponent(button.dataset.room)}/close`, { method: 'POST' });
      toast(res.ok ? `Room ${button.dataset.room} closed.` : 'Could not close the room.', res.ok ? '' : 'warn');
      load();
    }

    if (act === 'kick') {
      const res = await api('/api/admin/kick', {
        method: 'POST',
        body: JSON.stringify({ roomId: button.dataset.room, participantId: button.dataset.pid })
      });
      toast(res.ok ? 'Participant removed.' : 'Could not remove that participant.', res.ok ? '' : 'warn');
      load();
    }

    if (act === 'savefloor') {
      const row = button.closest('.floorrow');
      const patch = {};
      $$('[data-key]', row).forEach((input) => {
        patch[input.dataset.key] = input.type === 'checkbox' ? input.checked : input.value;
      });
      const res = await api(`/api/admin/floors/${encodeURIComponent(button.dataset.floor)}`, {
        method: 'POST',
        body: JSON.stringify(patch)
      });
      toast(res.ok ? 'Floor updated.' : 'Could not update the floor.', res.ok ? '' : 'warn');
      load();
    }

    if (act === 'unblock') {
      const res = await api('/api/admin/unblock', {
        method: 'POST',
        body: JSON.stringify({ address: button.dataset.address })
      });
      toast(res.ok ? 'Address released.' : 'Could not release that address.', res.ok ? '' : 'warn');
      load();
    }
  });

  $('#blockBtn').addEventListener('click', async () => {
    const address = $('#blockAddress').value.trim();
    if (!address) return;
    const res = await api('/api/admin/block', {
      method: 'POST',
      body: JSON.stringify({ address, reason: 'blocked from control room' })
    });
    if (res.ok) {
      $('#blockAddress').value = '';
      toast('Address blocked.');
      load();
    } else {
      toast('Could not block that address.', 'warn');
    }
  });

  $('#broadcastSend').addEventListener('click', async () => {
    const message = $('#broadcastText').value.trim();
    if (!message) return;
    const res = await api('/api/admin/broadcast', {
      method: 'POST',
      body: JSON.stringify({ message })
    });
    $('#broadcastStatus').textContent = res.ok ? `Delivered to ${res.data.delivered} screen(s).` : 'Failed.';
    if (res.ok) {
      $('#broadcastText').value = '';
      toast('Broadcast sent.');
    }
  });

  $('#maintenanceToggle').addEventListener('change', async (e) => {
    const res = await api('/api/admin/maintenance', {
      method: 'POST',
      body: JSON.stringify({ enabled: e.target.checked })
    });
    toast(res.ok ? (e.target.checked ? 'Tower taken offline.' : 'Tower back online.') : 'Could not change the mode.', res.ok ? '' : 'warn');
  });

  $('#pwSave').addEventListener('click', async () => {
    const target = $('#pwTarget').value;
    const password = $('#pwValue').value;
    if (!password || password.length < 6) {
      toast('Use at least 6 characters.', 'warn');
      return;
    }
    const res = await api('/api/admin/password', {
      method: 'POST',
      body: JSON.stringify({ target, password })
    });
    if (res.ok) {
      $('#pwValue').value = '';
      toast(`${target === 'owner' ? 'Owner' : 'Operator'} password updated.`);
      $('#passwordHint').textContent =
        target === 'owner'
          ? 'Owner access. You may change either credential.'
          : 'Owner access required to change credentials.';
    } else {
      toast('Could not update the password.', 'warn');
    }
  });

  /* ---------------- boot ---------------- */

  (async function boot() {
    try {
      const res = await fetch(API + '/api/admin/session');
      const data = await res.json();
      if (res.ok && data.ok) {
        state.token = data.token || null;
        showDash(data.role);
        connectLive(state.token);
        return;
      }
    } catch (_) {
      /* offline */
    }
    showGate();
  })();
})();
