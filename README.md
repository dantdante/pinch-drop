# Rise of Zoom

A video-meeting tower. The lobby is a shaft: scroll and the lift climbs, each floor is an
elevator you can walk into, and behind every door is a live video room.

The visual language borrows from [riseof.digital](https://riseof.digital/) — dark editorial
typography, brass accents, film grain, numbered floors, a bilingual EN/TR voice, and elevator
doors that open as you arrive.

```
npm install
npm start          # → http://localhost:4321
```

---

## Publish it on GitHub

The repository is ready to push. One command does the rest:

```bash
./scripts/publish-github.sh
```

It creates the public repository, sets the description and topics, and pushes `main`.
It uses the **gh CLI** when it is installed and authenticated (`gh auth login`), or falls
back to the **GitHub API** when you provide a token:

```bash
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx ./scripts/publish-github.sh
```

Or push it yourself:

```bash
git remote add origin https://github.com/<you>/rise-of-zoom.git
git push -u origin main
```

### What is already set up in the repo

| File | What it does |
| --- | --- |
| `.github/workflows/ci.yml` | Runs the whole test suite on every push, then publishes GitHub Pages |
| `.github/workflows/docker.yml` | Builds `ghcr.io/<you>/rise-of-zoom` on a `v*` tag |
| `Dockerfile` / `docker-compose.yml` | The whole tower in one container |
| `scripts/publish-github.sh` | One-command repository creation and push |
| `public/config.js` | Where the client looks for the signalling server |
| `LICENSE` | MIT |

### Two ways to host it

**A · Everything in one place (recommended).** Run the Node server anywhere that speaks HTTPS
and WebSockets — a VPS, Fly.io, Railway, Render, a home server, a container host.

```bash
docker compose up -d          # or: npm start
```

**B · Static lobby on GitHub Pages + the signalling server elsewhere.** GitHub Pages serves
only files, so it can host the beautiful tower interface while the Node server does the
signalling. Set the API base in `public/config.js`:

```js
window.RISE_OF_ZOOM = { apiBase: 'https://your-tower.example.com' };
```

The `pages` job in `ci.yml` does this automatically using the **SIGNALLING_URL** repository
variable, so a Pages build points at your hosted backend with no edits.

---

## The tower

| Floor | Name | Room |
| --- | --- | --- |
| **G** | Lobby | the landing page |
| **01** | Identity | `/room/f01` |
| **02** | Design | `/room/f02` |
| **03** | Motion | `/room/f03` |
| **04** | Broadcast | `/room/f04` |
| **05** | Systems | `/room/f05` |
| **R** | Boardroom | `/room/roof` |

You also get private rooms from the lobby: type any code (`BOARD42`) and the server hands you a
room with that name, or it generates a six-character code for you.

### The lobby
- Scroll (or press the lift buttons on the landing panel) to move between floors.
- Doors slide open on the floor you reach, and closed again as you leave.
- **Sound on** starts a synthesised lift motor hum and arrival chime (WebAudio, no assets).
- The index overlay lists every floor; the left rail shows where the car currently sits.
- Floor occupancy and the "connected right now" counter poll live.

### Inside a room

**Video and audio**

- Peer-to-peer WebRTC mesh with **perfect negotiation**, so simultaneous offers never
  collide and a failed connection is recovered with an **ICE restart**.
- **TURN support** — set `TURN_URLS` on the server and calls also work behind symmetric NAT
  and strict corporate firewalls, not just on home networks.
- Live **level meters** on every tile, so you can see that your microphone is actually
  transmitting and who is speaking.
- Remote audio is autoplay-safe: if the browser blocks it, a "Tap for sound" prompt appears
  instead of silence.
- Screen sharing (with system audio where the browser offers it), raise hand, emoji
  reactions, people panel, chat, tile pinning, `M` / `V` / `H` shortcuts.
- Recording composites the room to a canvas and mixes the audio into a `.webm` you download.
- Hot-plugged headsets are picked up mid-call, and the device pickers refresh automatically.
- Keyboard and layout both work down to phone widths.

---

## Control room (admin)

`/admin` — password required. Two credentials exist:

| Role | Password | Can do |
| --- | --- | --- |
| **Owner** | `6xtXBG78\|"o_iXDZY]3a` | everything, including changing either credential |
| **Operator** | `Jmw£V63Gt@9aRO@9(`E,` | everything except changing credentials |

> Both can be overridden with the `ADMIN_OWNER_PASSWORD` and `ADMIN_PASSWORD` environment
> variables, so they never have to live in source control. A password changed in the control
> room is written to `data/credentials.json` and survives a restart.

What the control room does:

- **Overview** — live rooms, connected people, uptime, floor count, blocked addresses.
- **Rooms** — every live room with its participants; lock a room to refuse newcomers, or close
  it and disconnect everyone inside.
- **People** — everyone connected, with mute/camera/share state, join time and address; remove
  a participant on the spot.
- **Floors** — rename floors, rewrite taglines, open or close a floor. Changes appear on the
  public tower immediately.
- **Broadcast** — push a notice to every screen in the tower; take the whole tower offline for
  maintenance.
- **Security** — block or release an address, and (owner only) reset either password.
- **Audit** — every admin action is logged with a timestamp and the role that made it.

The dashboard updates **live over the signalling socket** (the badge in the top bar shows
`Live`), falling back to polling if the socket cannot be established.

Passwords are stored as scrypt hashes, sessions are HMAC-signed cookies, and every admin
endpoint is role-checked server-side.

---

## Layout

```
server/
  index.js    express app, REST API, socket.io signalling
  auth.js     password hashing, signed sessions, role guards, audit log
  rooms.js    live room registry, floor config, settings, blocklist
  config.js   floors, credentials, ICE servers, paths, limits
public/
  index.html  the tower / lobby
  room.html   pre-join + the call
  admin.html  control room
  config.js   deployment configuration (API base, optional ICE override)
  css/        base.css · lobby.css · room.css · admin.css
  js/         lobby.js · room.js · admin.js
test/
  smoke.js    API + signalling integration tests (22 checks)
  admin.js    drives the control room UI through every action
  audio.js    proves audio and video actually flow between two browsers
  interact.js lift buttons, menu, sound, door transition, admin login
  mesh.js     two real browsers, verifies the WebRTC mesh carries video
  mobile.js   phone-viewport screenshots
  shots.js    full screenshot sweep
```

### How the signalling works

1. A client joins with `room:join { roomId, name }`.
2. The server adds it to the room and replies with the roster.
3. The newcomer opens an `RTCPeerConnection` to every existing participant; the
   `onnegotiationneeded` handler sends the offer through the `rtc:signal` relay and the
   existing peers answer.
4. ICE candidates, media state (mute / camera / share / hand), chat and reactions travel over
   the same socket.
5. If a connection drops, the side that notices calls `restartIce()` and the new offer is
   negotiated automatically.

Rooms hold 12 people by default (`MAX_PARTICIPANTS`).

### Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4321` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address |
| `MAX_PARTICIPANTS` | `12` | People per room |
| `SESSION_SECRET` | generated into `data/session-secret` | Signs admin sessions |
| `ADMIN_OWNER_PASSWORD` | the owner password above | Owner credential |
| `ADMIN_PASSWORD` | the operator password above | Operator credential |
| `STUN_URLS` | Google's public STUN | Comma-separated STUN servers |
| `TURN_URLS` | — | Comma-separated TURN URLs — **set this for strict networks** |
| `TURN_USERNAME` | — | TURN credential name |
| `TURN_CREDENTIAL` | — | TURN credential |

### Notes on production

- Put the app behind **TLS** — browsers only expose camera and microphone on a secure origin
  (localhost is exempt). GitHub Pages is already HTTPS; your backend must be too.
- Add a **TURN** server. STUN alone fails for roughly one call in five on real networks.
  Set `TURN_URLS`, `TURN_USERNAME` and `TURN_CREDENTIAL` and every client picks it up
  automatically from `/api/ice`.
- State is in memory. Rooms, floors, settings, the blocklist, credentials and the audit log
  live in `data/` as JSON; the session secret is generated on first boot. On a read-only host
  the app detects that and keeps everything in memory instead of crashing.

### Running the tests

```bash
npm install
npm run setup:browser    # one-off: downloads Chromium for the browser tests
npm start                # in another terminal
npm test
```
