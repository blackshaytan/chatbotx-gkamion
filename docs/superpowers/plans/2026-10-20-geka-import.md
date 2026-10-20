# Plan 4 — Geka settings import (MAX, ZZAP, DROM)

Spec: `docs/superpowers/specs/2026-10-17-ru-channels-max-zzap-drom-design.md`, section 5.

Goal: copy Geka's live channel settings into one project folder
(`.secrets/geka/`), then create the three channels in a workspace **paused**.
The operator turns each one on from ChatbotX settings when Geka is switched off.

## Live sources (read-only)

| Data | Source |
|------|--------|
| MAX token, webhook secret | `/GKamion/new-chat-bot/.env` (`MAX_BOT_TOKEN`, `MAX_WEBHOOK_SECRET`) — the env of the running Geka (`deploy-tmtr-runner-1`); the n8n copy holds the same token |
| ZZAP key and limits | `/GKamion/Dashboard/.env` (`ZZAP_*`); `code_object`/`type_object`/`test_mode` fall back to the Dashboard defaults `-1`/`0`/`false` |
| DROM cookies | `/GKamion/new-chat-bot/deploy/data/logs/drom-cookies.playwright.json` (Playwright list) |
| DROM poll state | `/GKamion/new-chat-bot/deploy/data/logs/drom-spike/poll-state.json` |
| DROM seller login | the `login` cookie (numeric Drom account id) unless `DROM_SELLER_LOGIN` is set |

Deviations from the spec, approved by the user:

- MAX needs the bot id and name, which Geka never stored. `--apply` makes one
  read-only `GET /me` to MAX (no webhook change). ZZAP and DROM make no calls.
- The import lives in `apps/worker/scripts/` (it needs the business services
  and the integration packages), invoked through `pnpm geka:import`.

## Tasks

1. **Ignore + example.** `.secrets/` is already ignored. Add
   `.secrets.example/geka/` with `max.env`, `zzap.env`, `drom.env` key-only
   examples and a `README.md` describing the sources.
2. **`scripts/collect-geka-secrets.sh`.** Read-only copy into
   `.secrets/geka/` (dir 700, files 600). Every source path is overridable by
   env (`GEKA_ENV_FILE`, `DASHBOARD_ENV_FILE`, `GEKA_DROM_COOKIES`,
   `GEKA_DROM_STATE`, `GEKA_DEST`). A missing source is a warning. Existing
   files are kept unless `--force`. Prints a masked summary only.
   Test: `apps/worker/__tests__/collect-geka-secrets.test.ts` runs it against
   temp fixtures (copies, `--force`, mode 600, no secret in stdout).
3. **SDK-free auth builders exported.** `toZzapAuth` from
   `@chatbotx.io/integration-zzap`; `resolveMaxAuth({ secretText, webhookSecret? })`
   from `@chatbotx.io/integration-max` (the `GET /me` lookup that
   `fromCredentials` already does).
4. **`connectionService.importFromAuth`** (`packages/connections/src/import.ts`).
   Input: workspace, provider, prebuilt auth, optional poll cursor.
   - Only `startsPaused` providers (otherwise throws) — import never activates.
   - No existing row, or an inactive one (`paused`, `needs_reauth`,
     `disconnected`): `connectAndPersist`, which ends `paused` without a
     webhook subscribe; the poll cursor is written.
   - Active row: auth saved in place, status and cursor untouched.
   Tests: `packages/connections/__tests__/import.test.ts`.
5. **Import script** `apps/worker/scripts/import-geka-channels.ts`
   `--workspace <id> [--apply] [--only max,zzap,drom] [--from .secrets/geka]`.
   Pure part (`scripts/geka-import/*.ts`): read only `--from`, parse env/JSON,
   build per-channel plans, map Geka's DROM state to the DROM cursor
   (`last_inbound_id` → `lastInboundId`, `seen_deal_ids`, `order_url` →
   `fetchedDealUrls`, `updated_at` s → ms), ZZAP cursor `since` = now (Moscow
   format). Dry run prints the masked plan and writes nothing.
   Tests: `apps/worker/__tests__/import-geka-channels.test.ts`.
6. **Verify.** Tests of touched packages, tsc, ultracite, invariant-guard.
7. **Run on real data** — only with explicit user approval: collect, dry run,
   then `--apply`.

## Operator notes

Before turning a channel on, switch the matching Geka part off and re-run the
import: a paused channel gets fresh secrets and a fresh cursor, so ChatbotX does
not replay messages Geka already answered. An enabled channel is never touched
except for its secrets.
