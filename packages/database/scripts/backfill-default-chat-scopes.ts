/**
 * Gives each existing default workspace token the explicit Chats permission
 * while preserving every current resource scope.
 *
 * Usage (safe preview):
 *   pnpm --filter @chatbotx.io/database backfill:default-chat-scopes
 * Apply only after production approval:
 *   pnpm --filter @chatbotx.io/database backfill:default-chat-scopes -- --apply
 */
import { and, eq, isNull } from "drizzle-orm"
import { db } from "../src/client"
import { workspaceApiTokenScopes } from "../src/partials"
import { workspaceApiTokenModel } from "../src/schema/workspace-api-token"

const apply = process.argv.includes("--apply")
const scopes = [...workspaceApiTokenScopes.options]

const main = async (): Promise<void> => {
  const candidates = await db
    .select({ id: workspaceApiTokenModel.id })
    .from(workspaceApiTokenModel)
    .where(
      and(
        eq(workspaceApiTokenModel.isDefault, true),
        isNull(workspaceApiTokenModel.scopes),
      ),
    )

  const changedTokenIds = candidates.map((candidate) => candidate.id)
  if (apply && changedTokenIds.length > 0) {
    await db
      .update(workspaceApiTokenModel)
      .set({ scopes })
      .where(
        and(
          eq(workspaceApiTokenModel.isDefault, true),
          isNull(workspaceApiTokenModel.scopes),
        ),
      )
  }

  console.log(
    JSON.stringify({
      dryRun: !apply,
      changedCount: changedTokenIds.length,
      changedTokenIds,
    }),
  )
}

await main()
