import {
  connectionStateService,
  resolveForeignKey,
  resolveOwnerId,
} from "@chatbotx.io/business/connection"
import { toPublicErrorMessage } from "@chatbotx.io/business/errors"
import type { IntegrationType } from "@chatbotx.io/database/partials"
import {
  connectionPollStateRepository,
  connectionRepository,
} from "@chatbotx.io/database/repositories"
import type { PollResult } from "@chatbotx.io/sdk"
import { findOrThrow, resolveAdapter } from "./internal"
import { logger } from "./logger"
import { CONNECTION_REGISTRY } from "./registry"

export const DEFAULT_POLL_INTERVAL_SECONDS = 60

export type PollEnqueue = (job: {
  integrationType: string
  integrationIdentifier: string
  payload: unknown
}) => Promise<void>

export type RunPollResult =
  | { status: "skipped"; reason: "not_connected" | "not_pollable" }
  | { status: "revoked" }
  | { status: "ok"; events: number }

export const listPollProviders = (): IntegrationType[] =>
  Object.entries(CONNECTION_REGISTRY)
    .filter(([, adapter]) => Boolean(adapter?.provider.poll))
    .map(([provider]) => provider as IntegrationType)

export const listDuePolls = async (now: Date = new Date()) =>
  await connectionPollStateRepository.listDue({
    providers: listPollProviders(),
    now,
    defaultIntervalSeconds: DEFAULT_POLL_INTERVAL_SECONDS,
  })

/**
 * One poll of one connection. The cursor is saved only after every event was
 * enqueued, so a crash in between re-delivers events (deduped downstream by
 * message `sourceId`) instead of losing them.
 */
export const runPoll = async (input: {
  connectionId: string
  workspaceId: string
  enqueue: PollEnqueue
  now?: Date
}): Promise<RunPollResult> => {
  const now = input.now ?? new Date()
  const connection = await findOrThrow(input)
  if (connection.status !== "connected") {
    return { status: "skipped", reason: "not_connected" }
  }
  const adapter = resolveAdapter(connection.provider)
  const poll = adapter.provider.poll
  const foreignKey = resolveForeignKey(connection)
  if (!(poll && adapter.store && foreignKey)) {
    return { status: "skipped", reason: "not_pollable" }
  }
  const auth = await adapter.store.loadAuthByForeignKey(
    foreignKey,
    connection.workspaceId,
  )
  const state = await connectionPollStateRepository.find(connection.id)
  await connectionPollStateRepository.upsert({
    connectionId: connection.id,
    workspaceId: connection.workspaceId,
    intervalSeconds: poll.intervalSeconds(auth),
    lastPolledAt: now,
  })

  let result: PollResult
  try {
    result = await poll.run({ auth, cursor: state?.cursor ?? null })
  } catch (err) {
    if (adapter.provider.isRevokedTokenError?.(err)) {
      await connectionStateService.markUnhealthy({
        connectionId: connection.id,
        ownerId: await resolveOwnerId(connection),
      })
      logger.warn(
        { err, connectionId: connection.id, provider: connection.provider },
        "channel poll: credentials revoked, connection needs reauth",
      )
      return { status: "revoked" }
    }
    await connectionRepository.update({
      id: connection.id,
      workspaceId: connection.workspaceId,
      values: { lastError: toPublicErrorMessage(err, "Polling failed") },
    })
    throw err
  }

  const integrationIdentifier = adapter.provider.describe(auth).sourceId
  for (const event of result.events) {
    await input.enqueue({
      integrationType: connection.provider,
      integrationIdentifier,
      payload: event.payload,
    })
  }
  await connectionPollStateRepository.upsert({
    connectionId: connection.id,
    workspaceId: connection.workspaceId,
    cursor: result.cursor,
    lastSucceededAt: now,
  })
  if (connection.lastError) {
    await connectionRepository.update({
      id: connection.id,
      workspaceId: connection.workspaceId,
      values: { lastError: null },
    })
  }
  return { status: "ok", events: result.events.length }
}
