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
| `build.sh` | local fallback build in a capped BuildKit container (the builder image does NOT fit: `next build` needs ~14–16 GB) |
| `up.sh` | pulls the GHCR images and starts or restarts the containers (no migrations) |
| `nginx/chatbotx.gkamion.ru.conf` | site config; `/ws/` goes to realtime |
| `enable-nginx.sh` | checks DNS, gets the certificate, installs the site with `nginx -t` + rollback |
| `verify-email.sh` | marks a sign-up email verified (no real SMTP yet) |
| `../../.env.prod` | gitignored overrides: `NODE_ENV`, public HTTPS URLs, loopback service URLs |

## First launch

1. DNS (Selectel): A record `chatbotx` → `78.17.117.235`.
2. Build on GitHub (repo `blackshaytan/chatbotx-gkamion`, workflow
   `.github/workflows/gkamion-images.yml`, manual):
   `gh workflow run gkamion-images.yml -R blackshaytan/chatbotx-gkamion`.
   Images: `ghcr.io/blackshaytan/chatbotx-gkamion-<service>:latest`.
3. `deploy/gkamion/up.sh` (public packages pull anonymously; for private ones set `GHCR_TOKEN` to a classic PAT with `read:packages`)
4. `sudo deploy/gkamion/enable-nginx.sh`
5. Sign up at `https://chatbotx.gkamion.ru`, then `deploy/gkamion/verify-email.sh <email>`.

## Updating

push the branch to `gkamion` → run the workflow → apply migrations explicitly if the release has any
(`pnpm --filter @chatbotx.io/database db:migrate`) → `up.sh`.

The production builder takes port 3123, so stop it
(`docker compose -f deploy/gkamion/docker-compose.prod.yml stop builder`)
before running `pnpm --filter builder dev`.
