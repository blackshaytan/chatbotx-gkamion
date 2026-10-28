import {
  type InternalMessageView,
  type ChatView,
  chatService,
  workspacePresenceService,
} from "@chatbotx.io/business"
import { ORPCError } from "@orpc/server"
import { z } from "zod"
import { workspaceAuthorizedMidddleware } from "@/middlewares/auth"
import { authorizedAPI } from "@/orpc"
import {
  withChatAttachmentUrls,
  withSingleChatAttachmentUrls,
} from "../lib/attachment-url"
import {
  deliverChatMessage,
  publishChatChanged,
} from "../lib/chat-realtime"
import { withChatUrl, withChatUrls } from "../lib/chat-url"
import { sessionChatActor, sessionChatScope } from "../lib/session"
import {
  chatMessagePrivateResource,
  chatMessagesPrivateResponse,
  chatPrivateListResponse,
  chatPrivateResource,
  chatUnreadTotalPrivateRequest,
  createChatMessagePrivateRequest,
  deleteChatMessagePrivateRequest,
  getChatPrivateRequest,
  listChatMessagesPrivateRequest,
  listChatsPrivateRequest,
  markChatReadPrivateRequest,
  openChatPrivateRequest,
  updateChatMessagePrivateRequest,
  uploadChatAttachmentPrivateRequest,
} from "../schema/private"
import { uploadChatAttachmentResponse } from "../schema/public"

const tags = ["Chats"]
const forbiddenForSupport = (context: { isSupportSession?: boolean }) => {
  if (context.isSupportSession) {
    throw new ORPCError("FORBIDDEN", {
      message: "Support sessions are read-only",
    })
  }
}

const toPrivateMessage = async (
  workspaceId: string,
  message: InternalMessageView,
) => await withSingleChatAttachmentUrls(workspaceId, message)

const toPrivateChat = async (
  workspaceId: string,
  chat: ChatView & { url: string },
) => ({
  id: chat.id,
  type: chat.type,
  title: chat.title,
  members: chat.members.map(({ userId, name, removed }) => ({
    userId,
    name,
    removed,
  })),
  lastMessageAt: chat.lastMessageAt,
  lastMessage: chat.lastMessage
    ? await toPrivateMessage(workspaceId, chat.lastMessage)
    : null,
  url: chat.url,
  unreadCount: chat.unreadCount,
  peerLastReadAt: chat.peerLastReadAt,
})

const chatMessagesPrivateRouter = {
  list: authorizedAPI
    .route({
      method: "GET",
      path: "/workspaces/{workspaceId}/chats/{id}/messages",
      summary: "List chat messages",
      tags,
    })
    .input(listChatMessagesPrivateRequest)
    .use(workspaceAuthorizedMidddleware, (input) => input.workspaceId)
    .output(chatMessagesPrivateResponse)
    .handler(async ({ context, input }) => {
      const page = await chatService.listMessages({
        workspaceId: input.workspaceId,
        threadId: input.id,
        scope: sessionChatScope(context),
        beforeId: input.beforeId,
        afterId: input.afterId,
        limit: input.limit,
      })
      return {
        ...page,
        data: await withChatAttachmentUrls(input.workspaceId, page.data),
      }
    }),
  create: authorizedAPI
    .route({
      method: "POST",
      path: "/workspaces/{workspaceId}/chats/{id}/messages",
      summary: "Send chat message",
      successStatus: 201,
      tags,
    })
    .input(createChatMessagePrivateRequest)
    .use(workspaceAuthorizedMidddleware, (input) => input.workspaceId)
    .output(chatMessagePrivateResource)
    .handler(async ({ context, input }) => {
      forbiddenForSupport(context)
      const result = await chatService.send({
        workspaceId: input.workspaceId,
        threadId: input.id,
        text: input.text ?? "",
        attachments: input.attachments ?? [],
        actor: sessionChatActor(context),
      })
      deliverChatMessage({
        workspaceId: input.workspaceId,
        threadId: input.id,
        memberUserIds: result.memberUserIds,
        message: result.message,
      })
      return await toPrivateMessage(
        input.workspaceId,
        result.message,
      )
    }),
  update: authorizedAPI
    .route({
      method: "PATCH",
      path: "/workspaces/{workspaceId}/chats/{id}/messages/{messageId}",
      summary: "Update chat message",
      tags,
    })
    .input(updateChatMessagePrivateRequest)
    .use(workspaceAuthorizedMidddleware, (input) => input.workspaceId)
    .output(chatMessagePrivateResource)
    .handler(async ({ context, input }) => {
      forbiddenForSupport(context)
      const result = await chatService.edit({
        workspaceId: input.workspaceId,
        threadId: input.id,
        messageId: input.messageId,
        text: input.text ?? "",
        actor: sessionChatActor(context),
      })
      publishChatChanged({
        workspaceId: input.workspaceId,
        threadId: input.id,
        memberUserIds: result.memberUserIds,
      })
      return await toPrivateMessage(
        input.workspaceId,
        result.message,
      )
    }),
  delete: authorizedAPI
    .route({
      method: "DELETE",
      path: "/workspaces/{workspaceId}/chats/{id}/messages/{messageId}",
      summary: "Delete chat message",
      successStatus: 204,
      tags,
    })
    .input(deleteChatMessagePrivateRequest)
    .use(workspaceAuthorizedMidddleware, (input) => input.workspaceId)
    .handler(async ({ context, input }) => {
      forbiddenForSupport(context)
      const result = await chatService.deleteMessage({
        workspaceId: input.workspaceId,
        threadId: input.id,
        messageId: input.messageId,
        actor: sessionChatActor(context),
      })
      publishChatChanged({
        workspaceId: input.workspaceId,
        threadId: input.id,
        memberUserIds: result.memberUserIds,
      })
    }),
}

export const chatsAuthenticatedAPI = {
  list: authorizedAPI
    .route({
      method: "GET",
      path: "/workspaces/{workspaceId}/chats",
      summary: "List chats",
      tags,
    })
    .input(listChatsPrivateRequest)
    .use(workspaceAuthorizedMidddleware, (input) => input.workspaceId)
    .output(chatPrivateListResponse)
    .handler(async ({ context, input }) => {
      const page = await chatService.list({
        workspaceId: input.workspaceId,
        scope: sessionChatScope(context),
        participantUserId: input.userId,
        includeEmpty: input.includeEmpty,
        page: input.page,
        perPage: input.perPage,
      })
      const chats = await withChatUrls(input.workspaceId, page.data)
      return {
        ...page,
        data: await Promise.all(
          chats.map(async (chat) => toPrivateChat(input.workspaceId, chat)),
        ),
      }
    }),
  get: authorizedAPI
    .route({
      method: "GET",
      path: "/workspaces/{workspaceId}/chats/{id}",
      summary: "Get chat",
      tags,
    })
    .input(getChatPrivateRequest)
    .use(workspaceAuthorizedMidddleware, (input) => input.workspaceId)
    .output(chatPrivateResource)
    .handler(async ({ context, input }) =>
      toPrivateChat(
        input.workspaceId,
        await withChatUrl(
          input.workspaceId,
          await chatService.get({
            workspaceId: input.workspaceId,
            threadId: input.id,
            scope: sessionChatScope(context),
          }),
        ),
      ),
    ),
  open: authorizedAPI
    .route({
      method: "POST",
      path: "/workspaces/{workspaceId}/chats/open",
      summary: "Open direct chat",
      successStatus: 201,
      tags,
    })
    .input(openChatPrivateRequest)
    .use(workspaceAuthorizedMidddleware, (input) => input.workspaceId)
    .output(z.object({ chat: chatPrivateResource, created: z.boolean() }))
    .handler(async ({ context, input }) => {
      forbiddenForSupport(context)
      if (input.userIds.length !== 1 || input.userIds[0] === context.user.id) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Choose one other workspace member",
        })
      }
      const result = await chatService.open({
        workspaceId: input.workspaceId,
        userIds: [context.user.id, input.userIds[0]],
      })
      return {
        created: result.created,
        chat: await toPrivateChat(
          input.workspaceId,
          await withChatUrl(input.workspaceId, result.chat),
        ),
      }
    }),
  attachments: {
    upload: authorizedAPI
      .route({
        method: "POST",
        path: "/workspaces/{workspaceId}/chats/{id}/attachments",
        summary: "Upload chat attachment",
        successStatus: 201,
        tags,
      })
      .input(uploadChatAttachmentPrivateRequest)
      .use(workspaceAuthorizedMidddleware, (input) => input.workspaceId)
      .output(uploadChatAttachmentResponse)
      .handler(async ({ context, input }) => {
        forbiddenForSupport(context)
        return await chatService.uploadAttachment({
          workspaceId: input.workspaceId,
          threadId: input.id,
          file: input.file,
          actor: sessionChatActor(context),
        })
      }),
  },
  messages: chatMessagesPrivateRouter,
  markRead: authorizedAPI
    .route({
      method: "POST",
      path: "/workspaces/{workspaceId}/chats/{id}/read",
      summary: "Mark chat read",
      tags,
    })
    .input(markChatReadPrivateRequest)
    .use(workspaceAuthorizedMidddleware, (input) => input.workspaceId)
    .output(z.object({ changed: z.boolean() }))
    .handler(async ({ context, input }) => {
      if (context.isSupportSession) {
        return { changed: false }
      }
      const result = await chatService.markRead({
        workspaceId: input.workspaceId,
        threadId: input.id,
        userId: context.user.id,
        upToMessageId: input.upToMessageId,
      })
      if (result.changed) {
        publishChatChanged({
          workspaceId: input.workspaceId,
          threadId: input.id,
          memberUserIds: result.memberUserIds,
        })
      }
      return { changed: result.changed }
    }),
  unreadTotal: authorizedAPI
    .route({
      method: "GET",
      path: "/workspaces/{workspaceId}/chats/unread-total",
      summary: "Count unread chats",
      tags,
    })
    .input(chatUnreadTotalPrivateRequest)
    .use(workspaceAuthorizedMidddleware, (input) => input.workspaceId)
    .output(z.object({ total: z.number().int() }))
    .handler(async ({ context, input }) =>
      context.isSupportSession
        ? { total: 0 }
        : await chatService.countUnreadTotal({
            workspaceId: input.workspaceId,
            userId: context.user.id,
          }),
    ),
  presence: authorizedAPI
    .route({
      method: "GET",
      path: "/workspaces/{workspaceId}/chats/presence",
      summary: "List online workspace members",
      tags,
    })
    .input(chatUnreadTotalPrivateRequest)
    .use(workspaceAuthorizedMidddleware, (input) => input.workspaceId)
    .output(z.object({ onlineUserIds: z.array(z.string()) }))
    .handler(async ({ input }) => ({
      onlineUserIds: await workspacePresenceService.listOnlineMembers(
        input.workspaceId,
      ),
    })),
}
