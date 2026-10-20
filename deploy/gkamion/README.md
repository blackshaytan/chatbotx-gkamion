# ChatbotX on the GKamion VPS

Public address: `https://chatbotx.gkamion.ru`, served by the host nginx like
`dashboard`, `n8n` and `hermes.gkamion.ru`. The containers listen on loopback
only (builder `127.0.0.1:3123`, realtime `:1999`, JavaScript executor `:3210`)
and use the infra stack of the root `docker-compose.yml` (postgres, redis,
rustfs, mailhog).

## Files

| File | Purpose |
|------|---------|
| `docker-compose.prod.yml` | builder, worker, realtime, javascript-executor (host network, memory limits) |
| `build.sh` | builds the images in a BuildKit container capped at 6 GB / 5 CPUs |
| `up.sh` | starts or restarts the containers (no build, no migrations) |
| `nginx/chatbotx.gkamion.ru.conf` | site config; `/ws/` goes to realtime |
| `enable-nginx.sh` | checks DNS, gets the certificate, installs the site with `nginx -t` + rollback |
| `verify-email.sh` | marks a sign-up email verified (no real SMTP yet) |
| `../../.env.prod` | gitignored overrides: `NODE_ENV`, public HTTPS URLs, loopback service URLs |

## First launch

1. DNS (Selectel): A record `chatbotx` → `78.17.117.235`.
2. `deploy/gkamion/build.sh` at a quiet hour (10–20 minutes of load).
3. `deploy/gkamion/up.sh`
4. `sudo deploy/gkamion/enable-nginx.sh`
5. Sign up at `https://chatbotx.gkamion.ru`, then `deploy/gkamion/verify-email.sh <email>`.

## Updating

`build.sh` → apply migrations explicitly if the release has any
(`pnpm --filter @chatbotx.io/database db:migrate`) → `up.sh`.

The production builder takes port 3123, so stop it
(`docker compose -f deploy/gkamion/docker-compose.prod.yml stop builder`)
before running `pnpm --filter builder dev`.
