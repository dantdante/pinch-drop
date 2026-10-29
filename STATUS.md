# Pinch Drop — status

_Last updated: 29 October 2026_

## Live right now

| Thing | Address | State |
| --- | --- | --- |
| GitHub Pages site | https://dantdante.github.io/pinch-drop/ | ✅ live, 14 assets, tower renders 7 floors |
| GitHub repo | https://github.com/dantdante/pinch-drop | ✅ public, MIT, 8 topics |
| Local preview | http://0.0.0.0:4321 | ✅ running |
| Render backend | — | ⏳ waiting on a Render API key |

The Pages site currently shows the "signalling server unreachable" notice because no
backend exists yet. It renders the complete tower from a built-in fallback catalogue
while it waits.

## What is committed but not pushed

Two commits sit on top of `origin/main` because GitHub refuses to let a token
**create** workflow files without the `workflow` scope:

```
2eec4d0  Add CI, GitHub Pages and Docker workflows
ebb5d50  Add a Render deployment script
```

Push them with:

```bash
cd /home/user/pinch-drop
TOKEN=<github token>
BASIC=$(printf 'x-access-token:%s' "$TOKEN" | base64 | tr -d '\n')
git -c "http.https://github.com/.extraheader=AUTHORIZATION: basic $BASIC" push origin main
```

## Waiting on the user

1. **Render API key** — https://render.com/docs/api → Create API key (`rnd_…`).
   With it, `bash scripts/deploy-render.sh` creates the web service, deploys the
   Docker image and prints the `onrender.com` address.

2. **Workflows permission** — the fine-grained GitHub token needs
   *Repository permissions → Workflows → Read and write*.
   If that does not take effect, a **classic** token with the `workflow` scope
   checked works too.

## Test suite

All seven suites pass (the server must be running on 4321):

```bash
node test/smoke.js        # 22/22  API, signalling, rooms, blocklist
node test/admin.js        # 16/16  control room, every action
node test/audio.js        # 6/6    real video + real audio signal
node test/interact.js     # 8/8    lift, doors, sound, roles
node test/offline.js      # 13/13  fallback catalogue, notice, cold start
node test/static-site.js  # 17/17  static host from a second origin
node test/mesh.js         # PASS   peer-to-peer video both ways
```

## After Render is up

```bash
# 1 · point the static site at the backend and publish it
GITHUB_TOKEN=<token> bash scripts/publish-pages.sh https://<name>.onrender.com

# 2 · set the variable so CI builds with the same address
#     Settings → Secrets and variables → Actions → Variables
#     SIGNALLING_URL = https://<name>.onrender.com

# 3 · check it end to end
curl https://<name>.onrender.com/api/health
```

## Layout

```
server/       Express + Socket.IO signalling, floors, control room
public/       the interface — lobby, room, control room
public/js/host.js      knows server mode vs static mode, builds the links
scripts/build-pages.js builds the static site for GitHub Pages
scripts/publish-pages.sh publishes it to the gh-pages branch
scripts/deploy-render.sh creates and deploys the Render service
scripts/publish-github.sh creates the repo and pushes
render.yaml   Render Blueprint
Dockerfile    the whole tower in one image
```
