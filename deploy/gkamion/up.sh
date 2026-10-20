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
docker compose -f "$ROOT/deploy/gkamion/docker-compose.prod.yml" up -d --no-build "$@"
docker compose -f "$ROOT/deploy/gkamion/docker-compose.prod.yml" ps
