# Pinch Drop — status

_Last updated: 29 October 2026_

## Live right now

| Thing | Address | State |
| --- | --- | --- |
| **The website** | https://dantdante.github.io/pinch-drop/ | ✅ live — static on GitHub Pages |
| **The backend** | https://pinch-drop.onrender.com | ✅ live — Render, Docker image, `/api/health` |
| **The repo** | https://github.com/dantdante/pinch-drop | ✅ public, MIT |
| Local preview | http://0.0.0.0:4321 | ✅ running |

The two halves talk to each other over the public internet: the Pages site loads its
interface from GitHub, and `config.js` points it at the Render backend. Verified with
`node test/live.js` — 15/15, including real peer-to-peer video and a real audio signal
between two browsers on different origins.

## Layout

```
public/                 the interface — lobby, room, control room
  img/                  the pd monogram, favicon and apple-touch icon
  js/host.js            knows server mode vs static mode, builds the links
server/                 Express + Socket.IO signalling, floors, control room
scripts/build-pages.js  builds the static site for GitHub Pages
scripts/publish-pages.sh publishes it to the gh-pages branch
scripts/deploy-render.sh creates and deploys the Render service
scripts/publish-github.sh creates the repo and pushes
render.yaml             Render Blueprint
deploy.json             where the signalling server lives
Dockerfile              the whole tower in one image
```

## Test suite

```bash
node test/smoke.js        # 22/22  API, signalling, rooms, blocklist
node test/admin.js        # 16/16  control room, every action
node test/audio.js        # 6/6    real video + real audio signal
node test/interact.js     # 8/8    lift, doors, sound, roles
node test/offline.js      # 13/13  fallback catalogue, notice, cold start
node test/static-site.js  # 17/17  static host from a second origin
node test/mesh.js         # PASS   peer-to-peer video both ways
node test/live.js         # 15/15  the real deployment, over the internet
```

`test/live.js` drives the published site, not a local copy — it is the one that proves
the deployment works.

## Still to do

**The CI and Docker workflows are parked.** GitHub refuses to let a personal access
token *create* workflow files without the `workflow` scope, so `.github/workflows/` was
removed from `main`'s history and kept on the local branch `ci-workflows`.

To put them back, either:

- give the fine-grained token **Repository permissions → Workflows → Read and write**, or
- use a **classic** token with the `workflow` scope checked.

Then:

```bash
git checkout ci-workflows -- .github/workflows
git add .github/workflows
git commit -m "Add CI, GitHub Pages and Docker workflows"
git push origin main
```

The Pages site does not depend on this — `scripts/publish-pages.sh` publishes it
directly, and the `pages` job in `ci.yml` does the same thing automatically once the
workflows are back.

## Notes on the free tier

Render's free plan sleeps the service after 15 idle minutes, so the first request
after a pause waits for the container to wake. The lobby tells a sleeping backend
apart from a missing one: a hung request shows *"The signalling server is waking up"*
with a **Try again** button. Free plans also have no persistent disk, so floors, the
blocklist and the audit log reset when the service restarts. Both are fixed by moving
to the `starter` plan — uncomment the `disk:` block in `render.yaml` at the same time.

## Credentials

- Owner password: `6xtXBG78|"o_iXDZY]3a`
- Operator password: `Jmw£V63Gt@9aRO@9(`E,`

Both are set as environment variables on the Render service and are the defaults in
`server/config.js`. Changing a password in the control room writes it to
`data/credentials.json` — on Render that file lives on an ephemeral disk, so it resets
on redeploy unless a persistent disk is attached.
