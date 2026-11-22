#!/bin/sh
# Deploys the server side from what's committed, so it can be replayed and
# reviewed like the rest of the repo. Run from the repo root:
#   tools/deploy.sh functions [name ...]   # Edge Functions (default: all)
#   tools/deploy.sh r2-cors                # audio bucket CORS from infra/r2-cors.json
#   tools/deploy.sh all
# Needs a logged-in Supabase CLI and Wrangler (Cloudflare).
set -eu
cd "$(dirname "$0")/.."

PROJECT=rnpuwanpgundhfmvzrne
BUCKET=daily-reading-audio

functions() {
  [ $# -gt 0 ] || set -- $(ls supabase/functions)
  for f in "$@"; do
    echo "Deploying function $f"
    supabase functions deploy "$f" --project-ref "$PROJECT" --no-verify-jwt --use-api < /dev/null
  done
}

r2_cors() {
  echo "Setting CORS on $BUCKET"
  npx -y wrangler@4 r2 bucket cors set "$BUCKET" --file infra/r2-cors.json --force
  npx -y wrangler@4 r2 bucket cors list "$BUCKET"
}

case "${1:-}" in
  functions) shift; functions "$@" ;;
  r2-cors) r2_cors ;;
  all) functions; r2_cors ;;
  *) sed -n '2,7p' "$0"; exit 1 ;;
esac
