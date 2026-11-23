/**
 * Operator entry for `workspace-owner-transfer.ts`: wires the real services
 * and prints the plan. Dry run unless `--apply` is passed.
 *
 * Usage (from the repo root):
 *   pnpm --filter worker workspace:transfer-owner -- --workspace <id> --owner <userId> [--name "<name>"] [--apply]
 */
// Registers the audit recorder before any transfer runs, so the ownership
// change is audited. Must stay the first import.
import "@chatbotx.io/business/audit"
import { pathToFileURL } from "node:url"
import { userService, workspaceService } from "@chatbotx.io/business"
import { ChatbotXException } from "@chatbotx.io/business/errors"
import { logger } from "../src/lib/logger"
import {
  parseArgs,
  runTransfer,
  type TransferDeps,
} from "./workspace-owner-transfer"

const findWorkspace: TransferDeps["findWorkspace"] = async (id) => {
  try {
    const workspace = await workspaceService.findById({ id })
    return {
      id: workspace.id,
      name: workspace.name,
      ownerId: workspace.ownerId,
    }
  } catch (err) {
    if (err instanceof ChatbotXException && err.code === "notFound") {
      return
    }
    throw err
  }
}

const deps: TransferDeps = {
  findWorkspace,
  findUser: (id) => userService.findNameAndEmail(id),
  transfer: (workspaceId, newOwnerId) =>
    workspaceService.transferOwnership({ workspaceId, newOwnerId }),
  rename: (workspaceId, name) =>
    workspaceService.update({ id: workspaceId, data: { name } }),
}

const main = async (): Promise<void> => {
  const options = parseArgs(process.argv.slice(2))
  const report = await runTransfer(options, deps)
  process.stdout.write(`${report.lines.join("\n")}\n`)
}

const isDirectRun =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href

if (isDirectRun) {
  main()
    .then(() => process.exit(0))
    .catch((err: unknown) => {
      logger.error({ err }, "[transferWorkspaceOwner] failed")
      process.exit(1)
    })
}
