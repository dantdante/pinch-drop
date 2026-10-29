#!/usr/bin/env bash
#
# Publish the static site to the gh-pages branch.
#
#   bash scripts/publish-pages.sh
#   bash scripts/publish-pages.sh https://rise-of-zoom.onrender.com
#
# The address in the first argument becomes the apiBase in config.js, so
# the static site knows where the signalling server lives. Without it the
# site still works but shows the "signalling server unreachable" notice.
#
# The CI workflow does the same thing on every push — see
# .github/workflows/ci.yml.
#
set -euo pipefail

cd "$(dirname "$0")/.."

API_BASE="${1:-${SIGNALLING_URL:-}}"
BRANCH="gh-pages"
BUILD_DIR="$(mktemp -d)"
trap 'rm -rf "$BUILD_DIR"' EXIT

echo "→ building the static site"
node scripts/build-pages.js --api-base "$API_BASE" --out "$BUILD_DIR"

echo
echo "→ publishing to the $BRANCH branch"
cd "$BUILD_DIR"
git init -q -b "$BRANCH"
git config user.name "${GIT_USER_NAME:-Rise of Zoom}"
git config user.email "${GIT_USER_EMAIL:-bot@rise-of-zoom.local}"
git add -A
git commit -q -m "Static site for GitHub Pages"

if [ -z "${GITHUB_TOKEN:-}" ]; then
  echo
  echo "GITHUB_TOKEN is not set, so the branch was built but not pushed." >&2
  echo "Push it with:" >&2
  echo "  cd $BUILD_DIR" >&2
  echo "  git push --force https://github.com/<you>/rise-of-zoom.git $BRANCH" >&2
  exit 1
fi

BASIC=$(printf 'x-access-token:%s' "$GITHUB_TOKEN" | base64 | tr -d '\n')
git -c "http.https://github.com/.extraheader=AUTHORIZATION: basic $BASIC" \
  push --force "https://github.com/dantdante/rise-of-zoom.git" "$BRANCH"

echo
echo "Done. GitHub Pages rebuilds from the $BRANCH branch within a minute or two."
