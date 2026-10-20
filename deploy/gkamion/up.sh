#!/usr/bin/env bash
# Starts (or restarts after a build) the ChatbotX production containers.
# Database migrations are NOT run here: apply them explicitly with
#   pnpm --filter @chatbotx.io/database db:migrate
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
[ -f "$ROOT/.env.prod" ] || {
  echo ".env.prod is missing; see deploy/gkamion/README.md" >&2
  exit 1
}
COMPOSE=(docker compose -f "$ROOT/deploy/gkamion/docker-compose.prod.yml")
gh auth token | docker login ghcr.io -u "$(gh api user --jq .login)" --password-stdin >/dev/null
"${COMPOSE[@]}" pull "$@"
"${COMPOSE[@]}" up -d --no-build "$@"
"${COMPOSE[@]}" ps
