import { isAfter } from "date-fns"
import type { ListConversationItemResource } from "../schema/resource"

const isNewerThanRead = (
  at: Date | null,
  agentLastReadAt: Date | null,
): boolean =>
  at !== null && (agentLastReadAt === null || isAfter(at, agentLastReadAt))

// Client mirror of `conversationUnreadWhere` (@chatbotx.io/database/queries).
export const isConversationUnread = (
  conversation: Pick<
    ListConversationItemResource,
    "inboxActivityAt" | "agentLastReadAt" | "handedOverAt"
  >,
): boolean =>
  isNewerThanRead(conversation.inboxActivityAt, conversation.agentLastReadAt) ||
  isNewerThanRead(conversation.handedOverAt, conversation.agentLastReadAt)
