#!/usr/bin/env bash
#
# Deploy Rise of Zoom to Railway.
#
#   RAILWAY_TOKEN=xxxxxxxx railway up -y -d
#
# or just run this script with the token in the environment:
#
#   RAILWAY_TOKEN=xxxxxxxx bash scripts/deploy-railway.sh
#
# What it does:
#   1. checks the token is good and says who it belongs to
#   2. creates the project + service and uploads the source
#   3. waits for the deployment to finish
#   4. asks Railway for a public domain and prints it
#
# The repository already carries a railway.json, so Railway builds the
# Dockerfile, exposes the port it is given and health-checks /api/health.
#
set -euo pipefail

cd "$(dirname "$0")/.."

RAILWAY="npx --no-install railway"

if [ -z "${RAILWAY_TOKEN:-}" ]; then
  echo "RAILWAY_TOKEN is not set." >&2
  echo "Create one at https://railway.app/account/tokens and re-run:" >&2
  echo "  RAILWAY_TOKEN=xxxx bash scripts/deploy-railway.sh" >&2
  exit 1
fi

echo "→ who am I"
$RAILWAY whoami

echo
echo "→ deploying (this uploads the source and starts a build)"
$RAILWAY up -y -d .

echo
echo "→ waiting for the deployment"
for i in $(seq 1 40); do
  STATUS=$($RAILWAY deployment list --json 2>/dev/null | head -c 2000 | grep -o '"status":"[A-Z_]*"' | head -1 | cut -d'"' -f4 || true)
  echo "   status: ${STATUS:-unknown}"
  case "$STATUS" in
    SUCCESS) break ;;
    FAILED|CRASHED|REMOVED)
      echo "The deployment failed — run: $RAILWAY logs" >&2
      exit 1
      ;;
  esac
  sleep 6
done

echo
echo "→ domains"
$RAILWAY domain || true

echo
echo "Done. Set the Pages site to point at the domain above:"
echo "  node scripts/build-pages.js --api-base https://<domain> --out _site"
