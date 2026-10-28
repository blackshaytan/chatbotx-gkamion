import { RealtimeEventType } from "@chatbotx.io/partysocket-config"
import type { InternalMessageView } from "../internal-thread/view"
import { logger } from "../logger"
import { notificationService } from "../notification/service"
import { sendToWorkspaceMember } from "../platform/realtime-broadcast"

type ChatDeliveryInput = {
  workspaceId: string
  threadId: string
  memberUserIds: string[]
}

export const publishStaffChatChanged = ({
  workspaceId,
  threadId,
  memberUserIds,
}: ChatDeliveryInput): void => {
  for (const userId of new Set(memberUserIds)) {
    sendToWorkspaceMember(
      { workspaceId, userId },
      { eventType: RealtimeEventType.chatChanged, data: { threadId } },
    ).catch((err) =>
      logger.warn(
        { err, threadId, userId, workspaceId },
        "Failed to deliver chat realtime event",
      ),
    )
  }
}

export const deliverStaffChatMessage = ({
  message,
  ...input
}: ChatDeliveryInput & {
  message: Pick<
    InternalMessageView,
    "authorLabel" | "authorUserId" | "createdAt" | "id" | "text"
  >
}): void => {
  publishStaffChatChanged(input)
  notificationService
    .notifyChatMessage({
      workspaceId: input.workspaceId,
      threadId: input.threadId,
      actorUserId: message.authorUserId,
      actorLabel: message.authorLabel,
      excerpt: message.text,
      messageId: message.id,
      messageAt: message.createdAt,
    })
    .catch((err) =>
      logger.warn(
        { err, threadId: input.threadId, workspaceId: input.workspaceId },
        "Failed to deliver chat notification",
      ),
    )
}
