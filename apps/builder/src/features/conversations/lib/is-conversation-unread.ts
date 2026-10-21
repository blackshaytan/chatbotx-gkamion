import { isAfter } from "date-fns"
import type { ListConversationItemResource } from "../schema/resource"

// Client mirror of `conversationUnreadWhere` (@chatbotx.io/database/queries).
export const isConversationUnread = (
  conversation: Pick<
    ListConversationItemResource,
    "inboxActivityAt" | "agentLastReadAt"
  >,
): boolean =>
  conversation.inboxActivityAt !== null &&
  (conversation.agentLastReadAt === null ||
    isAfter(conversation.inboxActivityAt, conversation.agentLastReadAt))
