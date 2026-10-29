/* ==========================================================
   Pinch Drop — lobby behaviour
   ========================================================== */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  /* Deployment configuration — see /config.js */
  const CFG = window.PINCH_DROP || {};
  const API = (CFG.apiBase || '').replace(/\/$/, '');
  const ROZ = window.PD || {};

const shaft = $('#shaft');
const floorTemplate = $('#floorTemplate');
const railFloors = $('#railFloors');
const railCar = $('#railCar');
const railCarLevel = $('#railCarLevel');
const indicatorLevel = $('#indicatorLevel');
const indicatorName = $('#indicatorName');
const menu = $('#menu');
const menuList = $('#menuList');
const transition = $('#transition');
const transitionLabel = $('#transitionLabel');

const state = {
  floors: [],
  sections: [],
  activeIndex: 0
};

/* ------------------------------------------------------------------ */
/* Fallback catalogue.                                               */
/*                                                                     */
/* When the lobby is served from a static host (GitHub Pages) and     */
/* the signalling server is unreachable — or not configured yet —     */
/* the tower still renders in full from this mirror of the server's   */
/* catalogue. The names, floors and copy are identical to the        */
/* defaults in server/config.js, so the building is never empty.      */
/* ------------------------------------------------------------------ */

const FALLBACK_FLOORS = [
  { id: 'lobby', level: 'G', name: 'Lobby', nameTr: 'Lobi',
    tagline: 'Every call starts on the ground floor.',
    taglineTr: 'Her görüşme zemin kattan başlar.',
    body: 'The lift is here, the doors are open, and the whole tower is one signal away. Choose a floor and step inside.',
    bodyTr: 'Asansör burada, kapılar açık, kule tek bir sinyal uzakta. Bir kat seçin ve içeri girin.',
    accent: 'brass', room: false, enabled: true },
  { id: 'f01', level: '01', name: 'Identity', nameTr: 'Kimlik',
    tagline: 'A room becomes a place.',
    taglineTr: 'Bir oda bir mekâna dönüşür.',
    body: 'Where names become marks and faces become the mark. The first floor is for introductions.',
    bodyTr: 'İsimlerin markaya, yüzlerin işarete dönüştüğü yer. İlk kat tanışmalar içindir.',
    accent: 'brass', room: true, enabled: true },
  { id: 'f02', level: '02', name: 'Design', nameTr: 'Tasarım',
    tagline: 'Then it learns to speak on paper.',
    taglineTr: 'Sonra kâğıtta konuşmayı öğrenir.',
    body: 'Every surface your team touches speaks with one voice, recognised before a single name is read.',
    bodyTr: 'Ekibinizin dokunduğu her yüzey tek bir sesle konuşur, adı okunmadan tanınır.',
    accent: 'amber', room: true, enabled: true },
  { id: 'f03', level: '03', name: 'Motion', nameTr: 'Hareket',
    tagline: 'Then it learns to move.',
    taglineTr: 'Sonra hareket etmeye öğrenir.',
    body: 'Timings, transitions, the camera that pans instead of cuts. Everything here has a rhythm.',
    bodyTr: 'Zamanlamalar, geçişler, kesme yerine kayan kamera. Buradaki her şeyin bir ritmi var.',
    accent: 'amber', room: true, enabled: true },
  { id: 'f04', level: '04', name: 'Broadcast', nameTr: 'Yayın',
    tagline: 'Then the whole office sees it.',
    taglineTr: 'Sonra bütün ofis görür.',
    body: 'The floor where the meeting stops being a meeting and becomes a transmission.',
    bodyTr: 'Toplantının toplantı olmaktan çıkıp bir yayına dönüştüğü kat.',
    accent: 'copper', room: true, enabled: true },
  { id: 'f05', level: '05', name: 'Systems', nameTr: 'Sistemler',
    tagline: 'Then it learns to think.',
    taglineTr: 'Sonra düşünmeyi öğrenir.',
    body: 'Dashboards, automations and the quiet machinery that keeps everyone else on time.',
    bodyTr: 'Panolar, otomasyonlar ve herkesi zamanında tutan sessiz makineler.',
    accent: 'copper', room: true, enabled: true },
  { id: 'roof', level: 'R', name: 'Boardroom', nameTr: 'Yönetim Kurulu',
    tagline: 'Small on the outside. Endless inside.',
    taglineTr: 'Dışarıdan küçük. İçi sonsuz.',
    body: 'The top floor. Longer tables, longer conversations, the same connection underneath.',
    bodyTr: 'En üst kat. Daha uzun masalar, daha uzun konuşmalar, altta aynı bağlantı.',
    accent: 'chrome', room: true, enabled: true }
];

/* ------------------------------------------------------------------ */
/* Sound: a lift motor hum and an arrival chime, synthesised live.    */
/* ------------------------------------------------------------------ */

const audio = {
  ctx: null,
  on: false,
  master: null,

  init() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(this.ctx.destination);

    // motor hum
    const hum = this.ctx.createOscillator();
    hum.type = 'sawtooth';
    hum.frequency.value = 52;
    const humFilter = this.ctx.createBiquadFilter();
    humFilter.type = 'lowpass';
    humFilter.frequency.value = 180;
    const humGain = this.ctx.createGain();
    humGain.gain.value = 0.16;
    hum.connect(humFilter).connect(humGain).connect(this.master);
    hum.start();

    // air hiss
    const noiseLen = this.ctx.sampleRate * 2;
    const buffer = this.ctx.createBuffer(1, noiseLen, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < noiseLen; i++) data[i] = (Math.random() * 2 - 1) * 0.5;
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
    const noiseFilter = this.ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.value = 900;
    noiseFilter.Q.value = 0.6;
    const noiseGain = this.ctx.createGain();
    noiseGain.gain.value = 0.035;
    noise.connect(noiseFilter).connect(noiseGain).connect(this.master);
    noise.start();
  },

  toggle(on) {
    this.init();
    if (!this.ctx) return false;
    this.on = on;
    if (on && this.ctx.state === 'suspended') this.ctx.resume();
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(on ? 0.5 : 0, now, 0.25);
    return true;
  },

  ding() {
    if (!this.on || !this.ctx) return;
    const now = this.ctx.currentTime;
    [
      [784, 0],
      [1175, 0.16]
    ].forEach(([freq, delay]) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, now + delay);
      gain.gain.linearRampToValueAtTime(0.16, now + delay + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + 0.9);
      osc.connect(gain).connect(this.master);
      osc.start(now + delay);
      osc.stop(now + delay + 1);
    });
  },

  arrive() {
    if (!this.on || !this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(120, now);
    osc.frequency.exponentialRampToValueAtTime(40, now + 0.35);
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
    osc.connect(gain).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.45);
  }
};

/* ------------------------------------------------------------------ */
/* Build the tower                                                     */
/* ------------------------------------------------------------------ */

function buildPanel(section) {
  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.innerHTML = `<div class="panel__title">Lift</div>`;
  state.sections.forEach((sec, i) => {
    const btn = document.createElement('button');
    btn.className = 'panel__btn';
    btn.type = 'button';
    btn.dataset.level = sec.dataset.level;
    btn.dataset.index = String(i);
    btn.title = sec.dataset.title || sec.dataset.level;
    btn.textContent = sec.dataset.level;
    btn.addEventListener('click', () => goToFloor(i));
    panel.appendChild(btn);
  });
  section.querySelector('.floor__bay').appendChild(panel);
}

async function loadTower() {
  let floors = [];
  let reachable = true;
  let waking = false;
  try {
    const res = await (PD.fetchWithTimeout
      ? PD.fetchWithTimeout(API + '/api/floors', null, 15000)
      : fetch(API + '/api/floors'));
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    floors = data.floors || [];
  } catch (err) {
    console.warn('floor fetch failed', err);
    reachable = false;
    /* A timed-out request usually means the backend is asleep and waking
       up — a free hosting tier sleeps the container after a few idle
       minutes, and the first request waits for it. */
    waking = err && (err.name === 'AbortError' || /timeout/i.test(String(err.message || '')));
    floors = FALLBACK_FLOORS;
  }

  showApiNotice(reachable, waking);

  state.floors = floors;

  const hero = $('.floor--hero');
  hero.dataset.title = 'Lobby';

  floors
    .filter((f) => f.room !== false && f.enabled !== false)
    .forEach((floor) => {
      const node = floorTemplate.content.cloneNode(true);
      const section = node.querySelector('.floor');
      section.dataset.floor = floor.id;
      section.dataset.level = floor.level;
      section.dataset.title = floor.name;
      section.dataset.kind = 'room';

      $('.f-level', section).textContent = `${floor.level} · ${floor.name}`;
      $('.floor__numeral', section).textContent = floor.level;
      $('.f-tr', section).textContent = floor.nameTr || '';
      $('.display--floor', section).textContent = floor.tagline || floor.name;
      $('.f-body', section).textContent = floor.body || '';
      $('.f-body-tr', section).textContent = floor.bodyTr || '';
      const occ = $('.occ-count', section);
      occ.textContent = String(floor.occupants || 0);
      const link = $('.floor__foot .btn', section);
      link.dataset.href = PD.roomUrl ? PD.roomUrl(floor.id) : `/room/${floor.id}`;
      link.setAttribute('role', 'link');
      link.addEventListener('click', (e) => {
        e.preventDefault();
        goToRoom(floor.id, `${floor.level} · ${floor.name}`);
      });

      shaft.appendChild(section);
    });

  state.sections = $$('.floor', shaft);
  state.sections.forEach((sec, i) => buildPanel(sec));

  buildRail();
  buildMenu();
  observeFloors();
  refreshOccupancy();
  setInterval(refreshOccupancy, 6000);
}

function buildRail() {
  railFloors.innerHTML = '';
  state.sections.forEach((sec) => {
    const li = document.createElement('li');
    li.dataset.level = sec.dataset.level;
    li.innerHTML = `<b>${sec.dataset.level}</b><span>${sec.dataset.title || ''}</span>`;
    railFloors.appendChild(li);
  });
}

function buildMenu() {
  menuList.innerHTML = '';
  state.sections.forEach((sec, i) => {
    const li = document.createElement('li');
    const isHero = i === 0;
    const href = isHero ? '/' : (sec.dataset.href || '#');
    li.innerHTML = `
      <a class="menu__link" href="${href}" data-index="${i}">
        <span class="menu__num">${String(i).padStart(2, '0')}</span>
        <span class="menu__title">${sec.dataset.title || 'Floor'}<em>${sec.dataset.level}</em></span>
        <span class="menu__cta">Fly in →</span>
      </a>`;
    li.querySelector('.menu__link').addEventListener('click', (e) => {
      e.preventDefault();
      closeMenu();
      goToFloor(i);
    });
    menuList.appendChild(li);
  });
}

/* ------------------------------------------------------------------ */
/* Navigation                                                          */
/* ------------------------------------------------------------------ */

function goToFloor(index) {
  const section = state.sections[index];
  if (!section) return;
  section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  audio.ding();
}

function setActive(index) {
  if (index === state.activeIndex && state.activeIndex !== 0) return;
  state.activeIndex = index;
  const section = state.sections[index];
  if (!section) return;

  indicatorLevel.textContent = section.dataset.level;
  indicatorName.textContent = section.dataset.title || '';

  $$('.rail__floors li', railFloors).forEach((li, i) => {
    li.classList.toggle('active', i === index);
  });

  $$('.panel__btn').forEach((btn) => {
    btn.classList.toggle('active', Number(btn.dataset.index) === index);
  });

  moveRailCar(index);
  audio.arrive();
}

function moveRailCar(index) {
  const rail = $('.rail');
  if (!rail) return;
  const total = Math.max(state.sections.length - 1, 1);
  const railHeight = rail.clientHeight - 60;
  const top = 30 + (index / total) * railHeight;
  railCar.style.top = `${top}px`;
  railCarLevel.textContent = state.sections[index]?.dataset.level || 'G';
}

function observeFloors() {
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        const section = entry.target;
        if (entry.isIntersecting && entry.intersectionRatio > 0.45) {
          const index = state.sections.indexOf(section);
          section.classList.add('is-open');
          setActive(index);
        } else if (!entry.isIntersecting) {
          section.classList.remove('is-open');
        }
      });
    },
    { threshold: [0, 0.25, 0.45, 0.7] }
  );
  state.sections.forEach((sec) => io.observe(sec));
}

/* ------------------------------------------------------------------ */
/* Menu                                                                */
/* ------------------------------------------------------------------ */

function openMenu() {
  menu.hidden = false;
  $('#menuToggle').setAttribute('aria-expanded', 'true');
  document.body.style.overflow = 'hidden';
}
function closeMenu() {
  menu.hidden = true;
  $('#menuToggle').setAttribute('aria-expanded', 'false');
  document.body.style.overflow = '';
}

$('#menuToggle').addEventListener('click', () => (menu.hidden ? openMenu() : closeMenu()));
$('#menuClose').addEventListener('click', closeMenu);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !menu.hidden) closeMenu();
});

/* ------------------------------------------------------------------ */
/* Sound toggle                                                        */
/* ------------------------------------------------------------------ */

$('#soundToggle').addEventListener('click', (e) => {
  const btn = e.currentTarget;
  const willPlay = btn.getAttribute('aria-pressed') !== 'true';
  const ok = audio.toggle(willPlay);
  btn.setAttribute('aria-pressed', willPlay ? 'true' : 'false');
  $('#soundLabel').textContent = willPlay ? 'Sound on' : 'Sound off';
  btn.querySelector('.eq').classList.toggle('on', willPlay);
  if (willPlay && ok) audio.ding();
});

/* ------------------------------------------------------------------ */
/* Room code                                                          */
/* ------------------------------------------------------------------ */

$('#joinForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('#joinCode');
  const code = input.value.trim().toUpperCase();
  if (!code) {
    input.focus();
    return;
  }
  try {
    const res = await fetch(API + '/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code })
    });
    const data = await res.json();
    if (data.ok) {
      goToRoom(data.room.id, data.room.id);
      return;
    }
    if (data.error === 'room_exists') {
      goToRoom(data.room.id, data.room.id);
      return;
    }
  } catch (err) {
    console.warn(err);
  }
  input.value = '';
  input.placeholder = 'Not found';
  setTimeout(() => (input.placeholder = 'ROOM'), 1800);
});

/* ------------------------------------------------------------------ */
/* Door transition                                                     */
/* ------------------------------------------------------------------ */

function goToRoom(roomId, label) {
  transition.hidden = false;
  transitionLabel.textContent = label || roomId;
  transition.classList.add('closing');
  setTimeout(() => {
    window.location.href = PD.roomUrl
      ? PD.roomUrl(roomId)
      : `/room/${encodeURIComponent(roomId)}`;
  }, 780);
}

$('#callLift').addEventListener('click', () => {
  const next = Math.min(state.activeIndex + 1, state.sections.length - 1);
  goToFloor(next);
});

/* ------------------------------------------------------------------ */
/* Occupancy polling                                                   */
/* ------------------------------------------------------------------ */

async function refreshOccupancy() {
  try {
    const res = await fetch(API + '/api/floors');
    const data = await res.json();
    if (!data.floors) return;
    data.floors.forEach((floor) => {
      const section = state.sections.find((s) => s.dataset.floor === floor.id);
      if (section) {
        const occ = $('.occ-count', section);
        if (occ) occ.textContent = String(floor.occupants || 0);
      }
    });
    try {
      const statsRes = await fetch(API + '/api/stats');
      const statsData = await statsRes.json();
      $('#liveCount').textContent = String(statsData.stats.participants);
    } catch (_) {
      /* keep the last value */
    }
  } catch (err) {
    /* offline — keep last value */
  }
}

/* ------------------------------------------------------------------ */
/* Parallax                                                            */
/* ------------------------------------------------------------------ */

let ticking = false;
window.addEventListener(
  'scroll',
  () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      state.sections.forEach((section) => {
        const rect = section.getBoundingClientRect();
        const progress = (rect.top + rect.height / 2 - window.innerHeight / 2) / window.innerHeight;
        section.style.setProperty('--parallax', `${progress * -40}px`);
      });
      ticking = false;
    });
  },
  { passive: true }
);

window.addEventListener('resize', () => moveRailCar(state.activeIndex));

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

const apiNotice = $('#apiNotice');
const apiNoticeClose = $('#apiNoticeClose');
const apiNoticeText = $('#apiNoticeText');
const apiNoticeRetry = $('#apiNoticeRetry');

function showApiNotice(reachable, waking) {
  if (!apiNotice) return;
  apiNotice.hidden = reachable;
  apiNotice.classList.toggle('is-on', !reachable);
  apiNotice.classList.toggle('is-waking', !!waking);

  if (!reachable && apiNoticeText) {
    apiNoticeText.innerHTML = waking
      ? '<strong>The signalling server is waking up.</strong> Free hosting sleeps the ' +
        'server after a few idle minutes — this can take a minute.'
      : '<strong>Signalling server unreachable.</strong> The tower is showing its ' +
        'default catalogue — set <code>apiBase</code> in <code>config.js</code> to point ' +
        'at the backend.';
  }

}

if (apiNoticeClose) {
  apiNoticeClose.addEventListener('click', () => {
    if (apiNotice) apiNotice.hidden = true;
  });
}

if (apiNoticeRetry) {
  apiNoticeRetry.addEventListener('click', () => loadTower());
}

loadTower();
