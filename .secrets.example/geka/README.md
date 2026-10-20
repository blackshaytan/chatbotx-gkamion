# Geka settings snapshot (example)

`.secrets/geka/` (gitignored, dir `700`, files `600`) holds a copy of Geka's
MAX, ZZAP and DROM settings, so the import never reads anything outside the
project. This folder shows its layout with empty values.

| File | Source on the server |
|------|----------------------|
| `max.env` | Geka `.env`: `MAX_BOT_TOKEN`, `MAX_WEBHOOK_SECRET` |
| `zzap.env` | Dashboard `.env`: `ZZAP_*` (`CODE_OBJECT`/`TYPE_OBJECT`/`TEST_MODE` default to `-1`/`0`/`false`) |
| `drom.env` | `DROM_SELLER_LOGIN` from the `login` cookie, `DROM_POLL_INTERVAL` from Geka `.env` |
| `drom-cookies.json` | Geka's Playwright cookie file |
| `drom-state.json` | Geka's DROM `poll-state.json` (becomes the initial DROM cursor) |

```bash
pnpm geka:collect                          # copy (add --force to overwrite)
pnpm geka:import --workspace <id>          # dry run, masked
pnpm geka:import --workspace <id> --apply  # create the channels, paused
```

Channels are created paused and are turned on from the channel settings.
Before turning one on, switch the matching Geka part off and re-run the import
so the paused channel gets fresh secrets and a fresh cursor.
