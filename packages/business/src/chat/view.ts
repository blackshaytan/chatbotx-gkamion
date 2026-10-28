import type { ChatThreadType } from "@chatbotx.io/database/partials"
import type { InternalThreadModel } from "@chatbotx.io/database/types"
import type { InternalMessageView } from "../internal-thread/view"
import { isStaffChatKey } from "./direct-key"

export type ChatMemberView = {
  userId: string
  name: string | null
  removed: boolean
  lastReadAt: Date | null
}

export type ChatView = {
  id: string
  type: ChatThreadType
  title: string | null
  members: ChatMemberView[]
  lastMessageAt: Date | null
  lastMessage: InternalMessageView | null
  unreadCount: number
  peerLastReadAt: Date | null
  isStaffAssistant: boolean
  assistantRunning: boolean
}

export const toChatView = (input: {
  thread: InternalThreadModel
  members: ChatMemberView[]
  lastMessage: InternalMessageView | null
  unreadCount: number
  viewerUserId: string | null
}): ChatView => {
  const peer =
    input.thread.type === "direct" && input.viewerUserId !== null
      ? input.members.find((member) => member.userId !== input.viewerUserId)
      : undefined
  return {
    id: input.thread.id,
    type: input.thread.type as ChatThreadType,
    title: input.thread.title,
    members: input.members,
    lastMessageAt: input.thread.lastMessageAt,
    lastMessage: input.lastMessage,
    unreadCount: input.viewerUserId === null ? 0 : input.unreadCount,
    peerLastReadAt: peer?.lastReadAt ?? null,
    isStaffAssistant: isStaffChatKey(input.thread.directKey),
    assistantRunning: false,
  }
}
