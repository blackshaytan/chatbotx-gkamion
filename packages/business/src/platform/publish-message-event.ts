import { getChildLogger } from "@chatbotx.io/logger"
import type { RealtimeEventData } from "@chatbotx.io/partysocket-config"
import { smtpOwnershipService } from "../inbox/smtp-ownership"
import {
  publishToWorkspaceParty,
  sendToWorkspaceMember,
} from "./realtime-broadcast"

const logger = getChildLogger("publish-message-event")

/**
 * Content-bearing message realtime: shared inboxes fan out to the workspace
 * party; personal SMTP is delivered only to the owner + admins. Fail closed —
 * if audience resolution throws, publish nothing (never leak to the room).
 */
export const publishMessageEvent = async (input: {
  workspaceId: string
  inboxId: string | null | undefined
  event: RealtimeEventData
}): Promise<void> => {
  const { workspaceId, inboxId, event } = input
  if (!inboxId) {
    publishToWorkspaceParty(workspaceId, event)
    return
  }

  let audience: string[] | null
  try {
    audience = await smtpOwnershipService.resolveAudienceUserIds({
      workspaceId,
      inboxId,
    })
  } catch (err) {
    logger.error(
      { err, workspaceId, inboxId },
      "Failed to resolve message event audience",
    )
    return
  }

  if (!audience) {
    publishToWorkspaceParty(workspaceId, event)
    return
  }

  const results = await Promise.allSettled(
    audience.map((userId) =>
      sendToWorkspaceMember({ workspaceId, userId }, event),
    ),
  )
  for (const result of results) {
    if (result.status === "rejected") {
      logger.error(
        { err: result.reason, workspaceId, inboxId },
        "Failed to send targeted message event",
      )
    }
  }
}
