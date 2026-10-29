#!/usr/bin/env bash
#
# Publish Rise of Zoom to GitHub.
#
#   ./scripts/publish-github.sh                 # using the gh CLI
#   GITHUB_TOKEN=ghp_xxx ./scripts/publish-github.sh
#
set -euo pipefail

REPO_SLUG="${REPO_SLUG:-rise-of-zoom}"
DESCRIPTION="A video-meeting tower — take the lift, pick a floor, step into the room."
TOPICS="webrtc,videoconference,zoom-clone,socket-io,elevator,rise-of-digital"

cd "$(dirname "$0")/.."

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "→ initialising a repository"
  git init -q -b main
fi

if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
  echo "→ committing"
  git add -A
  git -c user.name="${GIT_USER_NAME:-Rise of Zoom}" \
      -c user.email="${GIT_USER_EMAIL:-bot@rise-of-zoom.local}" \
      commit -q -m "Rise of Zoom — tower, control room and real-time media"
fi

if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  echo "→ creating the GitHub repository with gh"
  gh repo create "$REPO_SLUG" --public --description "$DESCRIPTION" --push --add-topic $TOPICS
  echo
  echo "Done. Open: $(gh repo view "$REPO_SLUG" --json url -q .url)"
  exit 0
fi

if [ -z "${GITHUB_TOKEN:-}" ]; then
  echo "Neither the gh CLI nor GITHUB_TOKEN is available." >&2
  echo "" >&2
  echo "Pick one:" >&2
  echo "  1. install gh and run:  gh auth login" >&2
  echo "  2. create a personal access token (repo scope) and re-run with:" >&2
  echo "     GITHUB_TOKEN=ghp_xxx $0" >&2
  echo "" >&2
  echo "Or push by hand:" >&2
  echo "  git remote add origin https://github.com/<you>/$REPO_SLUG.git" >&2
  echo "  git push -u origin main" >&2
  exit 1
fi

echo "→ creating the repository through the GitHub API"
USER=$(curl -fsS -H "Authorization: Bearer $GITHUB_TOKEN" https://api.github.com/user | sed -n 's/.*"login": *"\([^"]*\)".*/\1/p' | head -1)
if [ -z "$USER" ]; then
  echo "Could not read the authenticated user — is the token valid?" >&2
  exit 1
fi

HTTP_CODE=$(curl -sS -o /tmp/roz-repo.json -w '%{http_code}' -X POST \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/user/repos \
  -d "{\"name\":\"$REPO_SLUG\",\"description\":\"$DESCRIPTION\",\"private\":false,\"topics\":[\"$(echo $TOPICS | tr ' ' ',')\"]}")

if [ "$HTTP_CODE" != "201" ] && [ "$HTTP_CODE" != "422" ]; then
  echo "Repository creation failed (HTTP $HTTP_CODE):" >&2
  cat /tmp/roz-repo.json >&2
  echo >&2
  exit 1
fi
if [ "$HTTP_CODE" = "422" ]; then
  echo "→ repository $USER/$REPO_SLUG already exists — pushing to it"
fi

git remote remove origin 2>/dev/null || true
git remote add origin "https://github.com/$USER/$REPO_SLUG.git"

# Push with the token as an ephemeral HTTP header so it never lands in .git/config.
BASIC=$(printf 'x-access-token:%s' "$GITHUB_TOKEN" | base64 | tr -d '\n')
git -c "http.https://github.com/.extraheader=AUTHORIZATION: basic $BASIC" push -u origin main

# Leave the remote pointing at the clean URL — no credentials inside the repo config.
git remote set-url origin "https://github.com/$USER/$REPO_SLUG.git"

echo
echo "Done. Open: https://github.com/$USER/$REPO_SLUG"
echo "Next: deploy to Railway (New project → Deploy from GitHub repo),"
echo "or enable GitHub Pages — set the SIGNALLING_URL repository variable to your backend."
