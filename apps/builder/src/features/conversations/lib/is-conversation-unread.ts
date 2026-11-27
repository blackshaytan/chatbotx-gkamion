import { isAfter } from "date-fns"
import type { ListConversationItemResource } from "../schema/resource"

const isNewerThanRead = (
  at: Date | null,
  agentLastReadAt: Date | null,
): boolean =>
  at !== null && (agentLastReadAt === null || isAfter(at, agentLastReadAt))

// Client mirror of `conversationUnreadWhere` (@chatbotx.io/database/queries),
// plus the badge: a positive `unreadCount` is unread even when the activity
// stamp is not newer than `agentLastReadAt` (the count and the stamp can
// diverge). Callers that have no count leave it undefined.
export const isConversationUnread = (
  conversation: Pick<
    ListConversationItemResource,
    "inboxActivityAt" | "agentLastReadAt" | "handedOverAt"
  > & { unreadCount?: number },
): boolean =>
  (conversation.unreadCount ?? 0) > 0 ||
  isNewerThanRead(conversation.inboxActivityAt, conversation.agentLastReadAt) ||
  isNewerThanRead(conversation.handedOverAt, conversation.agentLastReadAt)
