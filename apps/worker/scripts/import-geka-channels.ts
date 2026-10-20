/**
 * Creates the MAX, ZZAP and DROM channels of a workspace from the Geka
 * snapshot that `scripts/collect-geka-secrets.sh` wrote to `.secrets/geka/`.
 *
 * Usage (from the repo root):
 *   pnpm geka:import --workspace <id> [--apply] [--only max,zzap,drom] [--from .secrets/geka]
 *
 * Without `--apply` it is a dry run: the masked plan is printed and nothing is
 * written. Every channel is created **paused** — the operator turns it on from
 * the channel settings. Re-running replaces the secrets; a paused channel also
 * gets a fresh cursor, an enabled one keeps its status and cursor. ZZAP and
 * DROM make no API call; MAX makes one read-only `GET /me` for the bot id and
 * name. The exit code is 1 if any channel failed.
 */
import { pathToFileURL } from "node:url"
import { connectionService } from "@chatbotx.io/connections"
import { toDromAuth } from "@chatbotx.io/integration-drom"
import { resolveMaxAuth } from "@chatbotx.io/integration-max"
import { toZzapAuth } from "@chatbotx.io/integration-zzap"
import type { AuthValue, PollCursor } from "@chatbotx.io/sdk"
import { logger } from "../src/lib/logger"
import { parseArgs, runGekaImport } from "./geka-import"

const main = async (): Promise<void> => {
  const options = parseArgs(
    process.argv.slice(2),
    process.env.INIT_CWD ?? process.cwd(),
  )
  const report = await runGekaImport(
    options,
    {
      resolveMaxAuth: (input) => resolveMaxAuth(input),
      toZzapAuth: (input) => toZzapAuth(input),
      toDromAuth: (input) => toDromAuth(input),
      importFromAuth: (input) =>
        connectionService.importFromAuth({
          ...input,
          auth: input.auth as AuthValue,
          pollCursor: input.pollCursor as PollCursor | null | undefined,
        }),
    },
    (err, channel) =>
      logger.error({ err, channel }, "[importGekaChannels] channel failed"),
  )
  process.stdout.write(`${report.lines.join("\n")}\n`)
  process.exit(report.failed > 0 ? 1 : 0)
}

const isDirectRun =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href

if (isDirectRun) {
  main().catch((err: unknown) => {
    logger.error({ err }, "[importGekaChannels] crashed")
    process.exit(1)
  })
}
