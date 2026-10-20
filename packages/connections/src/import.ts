import {
  isActiveConnectionStatus,
  resolveForeignKey,
  resolveOwnerId,
} from "@chatbotx.io/business/connection"
import {
  connectionNotConfiguredException,
  connectionNotPausableException,
} from "@chatbotx.io/business/errors"
import type { IntegrationType } from "@chatbotx.io/database/partials"
import {
  connectionPollStateRepository,
  connectionRepository,
} from "@chatbotx.io/database/repositories"
import type { ConnectionModel } from "@chatbotx.io/database/types"
import type { AuthValue, PollCursor } from "@chatbotx.io/sdk"
import { connectAndPersist, resolveAdapter } from "./internal"

export type ImportFromAuthResult = {
  connection: ConnectionModel
  outcome: "created" | "revived" | "updatedAuth"
}

/**
 * Migration path for settings copied from another system: persists an
 * already-built `auth` without the provider's live `fromCredentials` probe.
 * Only `startsPaused` providers qualify, so an import can never start
 * delivery — a new or inactive connection ends `paused` (no webhook
 * subscribe) and gets `pollCursor` when one is passed (`null` clears it). An
 * active connection only gets the new auth: status and cursor stay as the
 * operator left them.
 */
export const importFromAuth = async (input: {
  workspaceId: string
  provider: IntegrationType
  auth: AuthValue
  pollCursor?: PollCursor | null
  actorUserId?: string | null
}): Promise<ImportFromAuthResult> => {
  const adapter = resolveAdapter(input.provider)
  const { provider } = adapter
  if (!provider.startsPaused) {
    throw connectionNotPausableException(input.provider)
  }
  if (!adapter.store) {
    throw connectionNotConfiguredException(input.provider)
  }
  const descriptor = provider.describe(input.auth)
  const existing = await connectionRepository.findByProviderSourceId({
    workspaceId: input.workspaceId,
    provider: input.provider,
    sourceId: descriptor.sourceId,
  })

  if (existing && isActiveConnectionStatus(existing.status)) {
    const foreignKey = resolveForeignKey(existing)
    const saved =
      foreignKey !== null &&
      (await adapter.store.saveAuthByForeignKey(
        foreignKey,
        existing.workspaceId,
        input.auth,
      ))
    if (!saved) {
      throw new Error(
        `Connection ${existing.id} auth persistence did not match a satellite row`,
      )
    }
    return { connection: existing, outcome: "updatedAuth" }
  }

  const connection = await connectAndPersist({
    adapter,
    provider: input.provider,
    workspaceId: input.workspaceId,
    auth: input.auth,
    descriptor,
    extraConfig: {},
    existing,
    ownerId: await resolveOwnerId({
      kind: provider.kind,
      workspaceId: input.workspaceId,
    }),
    actorUserId: input.actorUserId,
    reuseExistingInboxId: true,
    missingOwnerError: new Error(
      "Channel connection requires a workspace owner",
    ),
  })
  if (provider.poll && input.pollCursor !== undefined) {
    await connectionPollStateRepository.upsert({
      connectionId: connection.id,
      workspaceId: connection.workspaceId,
      intervalSeconds: provider.poll.intervalSeconds(input.auth),
      cursor: input.pollCursor,
    })
  }
  return { connection, outcome: existing ? "revived" : "created" }
}
