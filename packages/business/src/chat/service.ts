import { type DatabaseClient, db } from "@chatbotx.io/database/client"
import {
  CHAT_LIMITS,
  type ChatThreadType,
  type InternalMessageAttachment,
} from "@chatbotx.io/database/partials"
import { chatRepository } from "@chatbotx.io/database/repositories"
import { BaseService } from "../base.service"
import {
  ChatbotXException,
  notFoundException,
  validationException,
} from "../errors"
import {
  resolveChatAttachments,
  uploadChatAttachment,
} from "../internal-thread/attachments"
import { internalThreadService } from "../internal-thread/service"
import { toInternalMessageView } from "../internal-thread/view"
import { notificationService } from "../notification/service"
import { isStaffAssistantAvailable } from "../staff-assistant/availability"
import type { ChatScope } from "./actor"
import { actorParticipantUserId, type ChatActor, toTaskActor } from "./actor"
import {
  buildAgentChatKey,
  buildDirectKey,
  type ChatAgentChannel,
  chatAgentTitle,
} from "./direct-key"
import { type ChatView, toChatView } from "./view"

class ChatService extends BaseService {
  async openAgentChannel(input: {
    workspaceId: string
    userId: string
    channel: ChatAgentChannel
  }): Promise<{ chat: ChatView; created: boolean }> {
    return await this.open({
      workspaceId: input.workspaceId,
      userIds: [input.userId],
      channel: input.channel,
    })
  }

  async open(input: {
    workspaceId: string
    userIds: string[]
    channel?: ChatAgentChannel
  }): Promise<{ chat: ChatView; created: boolean }> {
    if (
      input.userIds.length === 0 ||
      input.userIds.length > 2 ||
      new Set(input.userIds).size !== input.userIds.length
    ) {
      throw validationException(
        "userIds",
        "A direct chat requires valid unique members",
      )
    }
    const members = await chatRepository.listWorkspaceMemberUserIds({
      workspaceId: input.workspaceId,
      userIds: input.userIds,
    })
    if (members.length !== input.userIds.length) {
      throw validationException(
        "userIds",
        "Chat members must belong to the workspace",
      )
    }
    const isAgent = input.userIds.length === 1
    if (isAgent !== (input.channel !== undefined)) {
      throw validationException("userIds", "Invalid chat members")
    }
    const type: ChatThreadType = isAgent ? "agent" : "direct"
    const directKey = isAgent
      ? buildAgentChatKey(input.userIds[0], input.channel as ChatAgentChannel)
      : buildDirectKey(input.userIds[0], input.userIds[1])
    const title = isAgent
      ? chatAgentTitle(input.channel as ChatAgentChannel)
      : null
    const result = await db.transaction((tx) =>
      chatRepository.getOrCreate({
        ...input,
        type,
        directKey,
        title,
        memberUserIds: input.userIds,
        tx,
      }),
    )
    const rows = await chatRepository.listMembers({
      workspaceId: input.workspaceId,
      threadIds: [result.thread.id],
    })
    return {
      created: result.created,
      chat: toChatView({
        thread: result.thread,
        members: rows.map((row) => ({
          ...row,
          removed: !row.isWorkspaceMember,
        })),
        lastMessage: null,
        unreadCount: 0,
        viewerUserId: null,
      }),
    }
  }

  async list(input: {
    workspaceId: string
    scope: ChatScope
    page: number
    perPage: number
    participantUserId?: string
    includeEmpty?: boolean
  }) {
    if (input.perPage > CHAT_LIMITS.maxPageSize) {
      throw validationException("perPage", "Page size is too large")
    }
    const memberUserId =
      input.scope.kind === "member" ? input.scope.userId : null
    const result = await chatRepository.listThreads({
      workspaceId: input.workspaceId,
      memberUserId,
      participantUserId: input.participantUserId,
      includeEmpty: input.includeEmpty ?? false,
      limit: input.perPage,
      offset: (input.page - 1) * input.perPage,
    })
    const members = await chatRepository.listMembers({
      workspaceId: input.workspaceId,
      threadIds: result.rows.map((row) => row.id),
    })
    const lastMessageIds = await chatRepository.listLastMessageIds({
      workspaceId: input.workspaceId,
      threadIds: result.rows.map((row) => row.id),
    })
    const messages = await chatRepository.listMessagesByIds({
      workspaceId: input.workspaceId,
      ids: [...lastMessageIds.values()],
    })
    const messagesById = new Map(
      messages.map((message) => [message.id, message]),
    )
    const unread = memberUserId
      ? await internalThreadService.countUnread({
          workspaceId: input.workspaceId,
          userId: memberUserId,
          threadIds: result.rows.map((row) => row.id),
        })
      : new Map<string, number>()
    return {
      data: result.rows.map((thread) => {
        const lastMessageId = lastMessageIds.get(thread.id)
        const lastMessage = lastMessageId
          ? messagesById.get(lastMessageId)
          : undefined
        return toChatView({
          thread,
          members: members
            .filter((member) => member.threadId === thread.id)
            .map((member) => ({
              ...member,
              removed: !member.isWorkspaceMember,
            })),
          lastMessage: lastMessage ? toInternalMessageView(lastMessage) : null,
          unreadCount: unread.get(thread.id) ?? 0,
          viewerUserId: memberUserId,
        })
      }),
      total: result.total,
      pageCount: Math.ceil(result.total / input.perPage),
    }
  }

  async get(input: {
    workspaceId: string
    threadId: string
    scope: ChatScope
  }): Promise<ChatView> {
    const userId = input.scope.kind === "member" ? input.scope.userId : null
    const found = await chatRepository.findAccessible({
      workspaceId: input.workspaceId,
      threadId: input.threadId,
      userId,
    })
    if (!found) {
      throw notFoundException("Chat not found")
    }
    const members = await chatRepository.listMembers({
      workspaceId: input.workspaceId,
      threadIds: [input.threadId],
    })
    const lastMessageIds = await chatRepository.listLastMessageIds({
      workspaceId: input.workspaceId,
      threadIds: [input.threadId],
    })
    const messages = await chatRepository.listMessagesByIds({
      workspaceId: input.workspaceId,
      ids: [...lastMessageIds.values()],
    })
    const unread = userId
      ? await internalThreadService.countUnread({
          workspaceId: input.workspaceId,
          userId,
          threadIds: [input.threadId],
        })
      : new Map<string, number>()
    return toChatView({
      thread: found.thread,
      members: members.map((member) => ({
        ...member,
        removed: !member.isWorkspaceMember,
      })),
      lastMessage: messages[0] ? toInternalMessageView(messages[0]) : null,
      unreadCount: unread.get(input.threadId) ?? 0,
      viewerUserId: userId,
    })
  }

  async countUnreadTotal(input: { workspaceId: string; userId: string }) {
    return { total: await chatRepository.countUnreadTotal(input) }
  }

  async send(input: {
    workspaceId: string
    threadId: string
    text: string
    attachments: Pick<InternalMessageAttachment, "key" | "name">[]
    actor: ChatActor
  }) {
    if (input.text.length > CHAT_LIMITS.maxMessageLength) {
      throw validationException("text", "Message is too long")
    }
    const userId = actorParticipantUserId(input.actor)
    await this.requireChat({ ...input, userId })
    const attachments = await resolveChatAttachments({
      workspaceId: input.workspaceId,
      threadId: input.threadId,
      items: input.attachments.map(({ key, name }) => ({ key, name })),
    })
    const message = await db.transaction(async (tx) => {
      const chat = await this.requireChat({ ...input, userId, tx })
      if (
        userId &&
        chat.thread.type === "agent" &&
        chat.thread.directKey === `agent:${userId}:staff` &&
        !(await isStaffAssistantAvailable(input.workspaceId, tx))
      ) {
        throw new ChatbotXException(
          "Staff assistant is unavailable",
          "staffAssistantUnavailable",
          400,
        )
      }
      const members = await chatRepository.listMembers({
        workspaceId: input.workspaceId,
        threadIds: [input.threadId],
        tx,
      })
      if (members.some((member) => !member.isWorkspaceMember)) {
        throw validationException(
          "chat",
          "Chat participant was removed from the workspace",
        )
      }
      const created = await internalThreadService.postComment({
        ...input,
        attachments,
        actor: toTaskActor(input.actor),
        parseMentions: false,
        tx,
      })
      await chatRepository.touchLastMessage({
        workspaceId: input.workspaceId,
        threadId: input.threadId,
        messageId: created.id,
        tx,
      })
      return { created, members }
    })
    return {
      message: message.created,
      memberUserIds: message.members.map((member) => member.userId),
      recipientUserIds: message.members
        .map((member) => member.userId)
        .filter((id) => id !== userId),
    }
  }

  async markRead(input: {
    workspaceId: string
    threadId: string
    userId: string
    upToMessageId?: string
  }) {
    const chat = await chatRepository.findAccessible({
      workspaceId: input.workspaceId,
      threadId: input.threadId,
      userId: input.userId,
    })
    if (!chat) {
      return { changed: false, memberUserIds: [] }
    }
    if (input.upToMessageId) {
      const found = await chatRepository.listMessagesByIds({
        workspaceId: input.workspaceId,
        ids: [input.upToMessageId],
      })
      if (found[0]?.threadId !== input.threadId) {
        throw validationException(
          "upToMessageId",
          "Message does not belong to this chat",
        )
      }
    }
    const result = await db.transaction(async (tx) => {
      const readAt = await chatRepository.markReadMonotonic({
        workspaceId: input.workspaceId,
        threadId: input.threadId,
        userId: input.userId,
        upToMessageId: input.upToMessageId ?? null,
        tx,
      })
      if (!readAt) {
        return { changed: false, memberUserIds: [] }
      }
      await notificationService.markReadForEntity({
        workspaceId: input.workspaceId,
        userId: input.userId,
        entityType: "chat",
        entityId: input.threadId,
        upTo: readAt,
        tx,
      })
      const members = await chatRepository.listMembers({
        workspaceId: input.workspaceId,
        threadIds: [input.threadId],
        tx,
      })
      return {
        changed: true,
        memberUserIds: members.map((member) => member.userId),
      }
    })
    return result
  }

  async listMessages(input: {
    workspaceId: string
    threadId: string
    scope: ChatScope
    beforeId?: string
    afterId?: string
    limit?: number
  }) {
    if (input.beforeId && input.afterId) {
      throw validationException("cursor", "Only one message cursor is allowed")
    }
    const limit = input.limit ?? CHAT_LIMITS.defaultPageSize
    if (limit > CHAT_LIMITS.maxPageSize) {
      throw validationException("limit", "Page size is too large")
    }
    const userId = input.scope.kind === "member" ? input.scope.userId : null
    await this.requireChat({ ...input, userId })
    const cursor = input.beforeId ?? input.afterId
    if (cursor) {
      const messages = await chatRepository.listMessagesByIds({
        workspaceId: input.workspaceId,
        ids: [cursor],
      })
      if (messages[0]?.threadId !== input.threadId) {
        throw validationException(
          "cursor",
          "Message does not belong to this chat",
        )
      }
    }
    const result = await chatRepository.listMessages({ ...input, limit })
    return {
      data: result.rows.map(toInternalMessageView),
      hasMore: result.hasMore,
    }
  }

  async edit(input: {
    workspaceId: string
    threadId: string
    messageId: string
    text: string
    actor: ChatActor
  }) {
    if (input.text.length > CHAT_LIMITS.maxMessageLength) {
      throw validationException("text", "Message is too long")
    }
    const userId = actorParticipantUserId(input.actor)
    const result = await db.transaction(async (tx) => {
      await this.requireChat({ ...input, userId, tx })
      const message = await internalThreadService.editComment({
        workspaceId: input.workspaceId,
        threadId: input.threadId,
        id: input.messageId,
        text: input.text,
        actor: toTaskActor(input.actor),
        parseMentions: false,
        tx,
      })
      const members = await chatRepository.listMembers({
        workspaceId: input.workspaceId,
        threadIds: [input.threadId],
        tx,
      })
      return { message, memberUserIds: members.map((member) => member.userId) }
    })
    return result
  }

  async deleteMessage(input: {
    workspaceId: string
    threadId: string
    messageId: string
    actor: ChatActor
  }) {
    const userId = actorParticipantUserId(input.actor)
    const result = await db.transaction(async (tx) => {
      await this.requireChat({ ...input, userId, tx })
      const message = await internalThreadService.deleteComment({
        workspaceId: input.workspaceId,
        threadId: input.threadId,
        id: input.messageId,
        actor: toTaskActor(input.actor),
        isOwner: false,
        tx,
      })
      const members = await chatRepository.listMembers({
        workspaceId: input.workspaceId,
        threadIds: [input.threadId],
        tx,
      })
      return { message, memberUserIds: members.map((member) => member.userId) }
    })
    return result
  }

  async uploadAttachment(input: {
    workspaceId: string
    threadId: string
    file: File
    actor: ChatActor
  }) {
    await this.requireChat({
      workspaceId: input.workspaceId,
      threadId: input.threadId,
      userId: actorParticipantUserId(input.actor),
    })
    return await uploadChatAttachment(input)
  }

  async findAttachment(input: {
    workspaceId: string
    messageId: string
    index: number
  }) {
    const message = await chatRepository.findAttachmentMessage(input)
    if (message?.kind !== "comment" || message.deletedAt) {
      return null
    }
    const attachment = message.attachments[input.index]
    return attachment ?? null
  }

  private async requireChat(input: {
    workspaceId: string
    threadId: string
    userId: string | null
    tx?: DatabaseClient
  }) {
    const found = await chatRepository.findAccessible(input)
    if (!found) {
      throw notFoundException("Chat not found")
    }
    return found
  }
}

export const chatService = new ChatService()
