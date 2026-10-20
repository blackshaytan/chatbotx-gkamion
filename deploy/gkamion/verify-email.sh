#!/usr/bin/env bash
# Marks one sign-up email as verified while ChatbotX has no real SMTP
# (verification mail goes to the local MailHog only).
#
# Usage: deploy/gkamion/verify-email.sh you@example.com
set -euo pipefail

EMAIL=${1:?usage: verify-email.sh <email>}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
DB_USER=$(sed -nE 's#^DATABASE_URL=postgres(ql)?://([^:]+):.*#\2#p' "$ROOT/.env" | tail -1)

docker exec -i chatbotx-postgres-1 psql -U "$DB_USER" -d chatbotx -v ON_ERROR_STOP=1 \
  -v email="$EMAIL" <<'SQL'
UPDATE "User" SET "emailVerified" = true WHERE lower(email) = lower(:'email')
RETURNING id, email, "emailVerified";
SQL
