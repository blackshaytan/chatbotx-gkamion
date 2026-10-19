import { auditService } from "@chatbotx.io/business/audit"
import { connectionService } from "@chatbotx.io/connections"
import { startConnect } from "@/features/connections/lib/connect-flow"
import { resolvePlatformOwnerId } from "@/lib/platform-credential-owner"

type MaxActor = {
  workspaceId: string
  userId: string
}

/** Same path as `POST /v1/connections` with `provider: "max"`; the channel lands switched off. */
export const connectMax = async (input: MaxActor & { botToken: string }) => {
  const ownerId = await resolvePlatformOwnerId({
    userId: input.userId,
    workspaceId: input.workspaceId,
  })
  const { connection } = await startConnect({
    workspaceId: input.workspaceId,
    provider: "max",
    config: { secretText: input.botToken },
    redirectUrl: undefined,
    ownerId,
    actor: { actorUserId: input.userId },
  })
  if (!connection) {
    throw new Error("MAX connect did not return a connection")
  }
  await auditService.record({
    action: "connect",
    detail: `connected the MAX channel (#${connection.id})`,
    userId: input.userId,
    workspaceId: input.workspaceId,
  })
  return { connectionId: connection.id, status: connection.status }
}

export const setMaxEnabled = async (
  input: MaxActor & { connectionId: string; enabled: boolean },
) => {
  const ref = {
    connectionId: input.connectionId,
    workspaceId: input.workspaceId,
  }
  const connection = input.enabled
    ? await connectionService.resume(ref)
    : await connectionService.pause(ref)
  await auditService.record({
    action: input.enabled ? "resume" : "pause",
    detail: `switched the MAX channel ${input.enabled ? "on" : "off"} (#${connection.id})`,
    userId: input.userId,
    workspaceId: input.workspaceId,
  })
  return { status: connection.status }
}

export const disconnectMax = async (
  input: MaxActor & { connectionId: string },
) => {
  await connectionService.disconnect({
    connectionId: input.connectionId,
    workspaceId: input.workspaceId,
  })
  await auditService.record({
    action: "disconnect",
    detail: `disconnected the MAX channel (#${input.connectionId})`,
    userId: input.userId,
    workspaceId: input.workspaceId,
  })
}
