#!/usr/bin/env bash
#
# Deploy Pinch Drop to Render.
#
#   RENDER_API_KEY=rnd_xxx bash scripts/deploy-render.sh
#
# The Render CLI (https://render.com/docs/cli) does the work:
#
#   1. creates the web service from the GitHub repository
#   2. triggers the first deploy and waits for it
#   3. prints the public address
#
# Afterwards the static site on GitHub Pages can point at that address:
#
#   node scripts/build-pages.js --api-base https://pinch-drop.onrender.com
#
set -euo pipefail

cd "$(dirname "$0")/.."

RENDER="${RENDER:-render}"
REPO="https://github.com/dantdante/pinch-drop"
SERVICE_NAME="${SERVICE_NAME:-pinch-drop}"
REGION="${REGION:-oregon}"
PLAN="${PLAN:-free}"

if [ -z "${RENDER_API_KEY:-}" ]; then
  echo "RENDER_API_KEY is not set." >&2
  echo "Create a key at https://render.com/docs/api and re-run:" >&2
  echo "  RENDER_API_KEY=rnd_xxx bash scripts/deploy-render.sh" >&2
  exit 1
fi

if ! command -v "$RENDER" >/dev/null 2>&1 && [ ! -x "$HOME/.local/bin/render" ]; then
  echo "The Render CLI is not installed. Install it with:" >&2
  echo "  curl -fsSL https://raw.githubusercontent.com/render-oss/cli/refs/heads/main/bin/install.sh | sh" >&2
  exit 1
fi

RENDER="$RENDER"
if ! command -v "$RENDER" >/dev/null 2>&1; then
  RENDER="$HOME/.local/bin/render"
fi

export RENDER_OUTPUT=json
export RENDER_CLI_DISABLE_ANALYTICS=1

echo "→ workspaces"
WORKSPACES=$("$RENDER" workspaces -o json --confirm 2>/dev/null || echo '[]')
WORKSPACE_ID=$(printf '%s' "$WORKSPACES" | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  try {
    const w=JSON.parse(s);
    const list=Array.isArray(w)?w:(w.workspaces||w.data||[]);
    if(!list.length) process.exit(1);
    process.stdout.write(list[0].id||list[0].workspaceId||'');
  } catch(e){ process.exit(1); }
});")

if [ -z "$WORKSPACE_ID" ]; then
  echo "Could not read the workspace. Check that the API key is valid." >&2
  echo "$WORKSPACES" | head -c 500 >&2
  exit 1
fi
echo "   using workspace $WORKSPACE_ID"

echo
echo "→ creating the service"
SERVICE=$("$RENDER" services create \
  --workspace "$WORKSPACE_ID" \
  --name "$SERVICE_NAME" \
  --type web_service \
  --repo "$REPO" \
  --branch main \
  --runtime docker \
  --plan "$PLAN" \
  --region "$REGION" \
  --health-check-path /api/health \
  --env-var NODE_ENV=production \
  --env-var HOST=0.0.0.0 \
  --env-var "ADMIN_OWNER_PASSWORD=${ADMIN_OWNER_PASSWORD:-6xtXBG78|\"o_iXDZY]3a}" \
  --env-var "ADMIN_PASSWORD=${ADMIN_PASSWORD:-Jmw£V63Gt@9aRO@9(\`E,}" \
  --env-var ALLOWED_ORIGINS=https://dantdante.github.io \
  --output json --confirm 2>&1) || {
    echo "$SERVICE" | tail -20 >&2
    exit 1
  }

SERVICE_ID=$(printf '%s' "$SERVICE" | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  try {
    const j=JSON.parse(s);
    const svc=j.service||j;
    process.stdout.write(svc.id||svc.serviceId||'');
  } catch(e){}
});")

if [ -z "$SERVICE_ID" ]; then
  echo "The service was created but I could not read its id:" >&2
  printf '%s' "$SERVICE" | head -c 800 >&2
  exit 1
fi
echo "   service $SERVICE_ID"

echo
echo "→ deploying (this builds the Docker image — it can take a few minutes)"
"$RENDER" deploys create "$SERVICE_ID" --wait --output json --confirm 2>&1 | tail -5

echo
echo "→ the public address"
"$RENDER" services --output json --confirm 2>/dev/null | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  try {
    const j=JSON.parse(s);
    const list=Array.isArray(j)?j:(j.services||j.data||[]);
    const svc=list.find(x=>x.id==='$SERVICE_ID')||list[0];
    if(!svc){console.log('  (service not listed yet)');return;}
    console.log('  name :', svc.name);
    console.log('  url  :', svc.serviceDetails&&svc.serviceDetails.url || svc.url || '(unknown)');
    console.log('  state:', svc.serviceDetails&&svc.serviceDetails.runtime || svc.state || '');
  } catch(e){ console.log('  (could not read the service list)'); }
});"

echo
echo "Next: point the static site at the address above."
echo "  node scripts/build-pages.js --api-base https://<address> --out _site"
