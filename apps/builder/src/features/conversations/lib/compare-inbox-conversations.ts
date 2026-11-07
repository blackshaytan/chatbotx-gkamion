import type { ListConversationItemResource } from "../schema/resource"
import { isConversationUnread } from "./is-conversation-unread"

type InboxOrderConversation = Pick<
  ListConversationItemResource,
  "id" | "inboxActivityAt" | "agentLastReadAt" | "handedOverAt"
> & { unreadCount?: number }

const normalize = (conversation: InboxOrderConversation) => ({
  inboxActivityAt: conversation.inboxActivityAt ?? null,
  agentLastReadAt: conversation.agentLastReadAt ?? null,
  handedOverAt: conversation.handedOverAt ?? null,
  unreadCount: conversation.unreadCount ?? 0,
})

const activityTime = (value: Date | null): number | null => {
  if (!value) {
    return null
  }
  const time = new Date(value).getTime()
  return Number.isNaN(time) ? null : time
}

/**
 * Numeric ids sort like Postgres `bigint DESC`. Fixture ids that are not
 * integers fall back to string order so tests stay deterministic.
 */
const compareIdDesc = (leftId: string, rightId: string): number => {
  if (leftId === rightId) {
    return 0
  }
  try {
    const left = BigInt(leftId)
    const right = BigInt(rightId)
    if (left === right) {
      return 0
    }
    return left > right ? -1 : 1
  } catch {
    return leftId > rightId ? -1 : 1
  }
}

/**
 * Unread conversations first (badge count, client activity, or a handover
 * newer than the last read), then `inboxActivityAt` newest first (nulls
 * last), then id descending.
 */
export const compareInboxConversations = (
  left: InboxOrderConversation,
  right: InboxOrderConversation,
): number => {
  const leftUnread = isConversationUnread(normalize(left))
  const rightUnread = isConversationUnread(normalize(right))
  if (leftUnread !== rightUnread) {
    return leftUnread ? -1 : 1
  }

  const leftTime = activityTime(normalize(left).inboxActivityAt)
  const rightTime = activityTime(normalize(right).inboxActivityAt)
  if (leftTime !== rightTime) {
    if (leftTime === null) {
      return 1
    }
    if (rightTime === null) {
      return -1
    }
    return rightTime - leftTime
  }

  return compareIdDesc(left.id, right.id)
}

/** Changes when a conversation should move between unread and read, or by time. */
export const inboxAttentionOrderKey = (
  conversation: InboxOrderConversation,
): string => {
  const normalized = normalize(conversation)
  const unread = isConversationUnread(normalized) ? "1" : "0"
  const activity = activityTime(normalized.inboxActivityAt) ?? ""
  return `${unread}:${activity}`
}

export const sortInboxConversations = <T extends InboxOrderConversation>(
  conversations: readonly T[],
): T[] => [...conversations].sort(compareInboxConversations)

/**
 * Inserts `conversation` without letting a read row climb above an unread
 * one. An unread row is placed by the inbox order. A read row is pinned to
 * the top of the read group, under every unread row.
 */
export const insertInboxConversation = <T extends InboxOrderConversation>(
  list: readonly T[],
  conversation: T,
): T[] => {
  const rest = list.filter((item) => item.id !== conversation.id)
  if (isConversationUnread(conversation)) {
    return sortInboxConversations([conversation, ...rest])
  }
  const unread: T[] = []
  const read: T[] = []
  for (const item of rest) {
    if (isConversationUnread(item)) {
      unread.push(item)
    } else {
      read.push(item)
    }
  }
  return [...unread, conversation, ...read]
}
