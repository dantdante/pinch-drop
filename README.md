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
- Pre-join screen: name, camera preview, camera/microphone pickers.
- Peer-to-peer WebRTC mesh (audio + video), screen sharing, raise hand, emoji reactions.
- People panel and chat, click a tile to pin it, `M` / `V` / `H` keyboard shortcuts.
- Recording: the room composites to a canvas and mixes the audio tracks into a `.webm` you can
  download.
- Keyboard and layout both work down to phone widths.

---

## Control room (admin)

`/admin` — password required. Two credentials exist:

| Role | Password | Can do |
| --- | --- | --- |
| **Owner** | `6xtXBG78\|"o_iXDZY]3a` | everything, including changing either credential |
| **Operator** | `Jmw£V63Gt@9aRO@9(`E,` | everything except changing credentials |

> Both can be overridden with the `ADMIN_OWNER_PASSWORD` and `ADMIN_PASSWORD` environment
> variables, so they never have to live in source control.

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

Passwords are stored as scrypt hashes, sessions are HMAC-signed cookies, and every admin
endpoint is role-checked server-side.

---

## Layout

```
server/
  index.js    express app, REST API, socket.io signalling
  auth.js     password hashing, signed sessions, role guards, audit log
  rooms.js    live room registry, floor config, settings, blocklist
  config.js   floors, credentials, paths, limits
public/
  index.html  the tower / lobby
  room.html   pre-join + the call
  admin.html  control room
  css/        base.css · lobby.css · room.css · admin.css
  js/         lobby.js · room.js · admin.js
test/
  smoke.js    API + signalling integration tests (22 checks)
  mesh.js     two real browsers, verifies the WebRTC mesh carries video
  interact.js lift buttons, menu, sound, door transition, admin login
  mobile.js   phone-viewport screenshots
  shots.js    full screenshot sweep
```

### How the signalling works

1. A client joins with `room:join { roomId, name }`.
2. The server adds it to the room and replies with the roster.
3. The newcomer opens an `RTCPeerConnection` to every existing participant and sends an offer
   through the `rtc:signal` relay; the existing peers answer.
4. ICE candidates, media state (mute / camera / share / hand), chat and reactions travel over
   the same socket.

Rooms hold 12 people by default (`MAX_PARTICIPANTS`).

### Notes on production

- Put the app behind TLS — browsers only expose camera and microphone on a secure origin
  (localhost is exempt).
- The STUN servers in `public/js/room.js` are Google's public ones. Behind a strict NAT you
  will also want a TURN server; add it to the `ICE.iceServers` list.
- State is in memory. Rooms, floors, settings, the blocklist and the audit log live in `data/`
  as JSON; the session secret is generated on first boot.

### Environment variables

| Variable | Default |
| --- | --- |
| `PORT` | `4321` |
| `HOST` | `0.0.0.0` |
| `MAX_PARTICIPANTS` | `12` |
| `SESSION_SECRET` | generated into `data/session-secret` |
| `ADMIN_OWNER_PASSWORD` | the owner password above |
| `ADMIN_PASSWORD` | the operator password above |
