import {
  connectionStateService,
  resolveForeignKey,
  resolveOwnerId,
} from "@chatbotx.io/business/connection"
import {
  connectionCredentialsRejectedException,
  connectionNotConfiguredException,
  connectionNotPausableException,
  connectionNotResumableException,
  connectionProviderUnavailableException,
  toPublicErrorMessage,
} from "@chatbotx.io/business/errors"
import { connectionRepository } from "@chatbotx.io/database/repositories"
import type { ConnectionModel } from "@chatbotx.io/database/types"
import { findOrThrow, resolveAdapter } from "./internal"
import { logger } from "./logger"

type ConnectionRef = { connectionId: string; workspaceId: string }

const loadPausable = async (input: ConnectionRef) => {
  const connection = await findOrThrow(input)
  const adapter = resolveAdapter(connection.provider)
  if (!adapter.provider.startsPaused) {
    throw connectionNotPausableException(connection.provider)
  }
  const foreignKey = resolveForeignKey(connection)
  if (!(adapter.store && foreignKey)) {
    throw connectionNotConfiguredException(connection.provider)
  }
  const auth = await adapter.store.loadAuthByForeignKey(
    foreignKey,
    connection.workspaceId,
  )
  return { connection, adapter, auth }
}

/**
 * Operator switch-off: the provider stops delivering (webhook unsubscribe,
 * best-effort) and the connection moves to `paused`/`user_paused`, which
 * trial and tenant reactivation never lift.
 */
export const pause = async (input: ConnectionRef): Promise<ConnectionModel> => {
  const { connection, adapter, auth } = await loadPausable(input)
  if (adapter.provider.webhook) {
    try {
      await adapter.provider.webhook.unsubscribe({ auth })
    } catch (err) {
      logger.warn(
        { err, connectionId: connection.id, provider: connection.provider },
        "connection pause: webhook unsubscribe failed",
      )
      await connectionRepository.update({
        id: connection.id,
        workspaceId: connection.workspaceId,
        values: {
          lastError: toPublicErrorMessage(err, "Webhook unsubscribe failed"),
        },
      })
    }
  }
  return await connectionStateService.transition({
    connectionId: connection.id,
    event: "user.pause",
    ownerId: await resolveOwnerId(connection),
  })
}

/**
 * Operator switch-on: re-checks the stored credential, subscribes the
 * webhook, and only then moves to `connected`. Any failure leaves the
 * status unchanged so the toggle simply stays off.
 */
export const resume = async (
  input: ConnectionRef,
): Promise<ConnectionModel> => {
  const { connection, adapter, auth } = await loadPausable(input)
  if (connection.status === "connected" || connection.status === "degraded") {
    return connection
  }
  const isUserPaused =
    connection.status === "paused" && connection.statusReason === "user_paused"
  if (!(isUserPaused || connection.status === "needs_reauth")) {
    throw connectionNotResumableException()
  }

  const health = await adapter.provider.verify({ auth })
  if (!health.ok) {
    throw connectionCredentialsRejectedException(
      "The stored credentials were rejected by the provider.",
    )
  }
  if (adapter.provider.webhook) {
    try {
      await adapter.provider.webhook.subscribe({ auth })
    } catch (err) {
      logger.warn(
        { err, connectionId: connection.id, provider: connection.provider },
        "connection resume: webhook subscribe failed",
      )
      throw connectionProviderUnavailableException(502)
    }
  }
  return await connectionStateService.transition({
    connectionId: connection.id,
    event: "user.resume",
    ownerId: await resolveOwnerId(connection),
  })
}
