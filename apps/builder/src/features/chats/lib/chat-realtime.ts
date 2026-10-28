import { notificationService, sendToWorkspaceMember } from "@chatbotx.io/business"
import { getChildLogger } from "@chatbotx.io/logger"
import { RealtimeEventType } from "@chatbotx.io/partysocket-config"
import type { InternalMessageModel } from "@chatbotx.io/database/types"

const logger = getChildLogger("chats:realtime")

type ChatChangedInput = {
  workspaceId: string
  threadId: string
  memberUserIds: string[]
}

export const publishChatChanged = ({
  workspaceId,
  threadId,
  memberUserIds,
}: ChatChangedInput): void => {
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

export const deliverChatMessage = ({
  message,
  ...input
}: ChatChangedInput & { message: InternalMessageModel }): void => {
  publishChatChanged(input)
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
