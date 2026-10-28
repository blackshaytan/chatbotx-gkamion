import {
  type ChatView,
  chatService,
  type InternalMessageView,
  staffAssistantService,
  workspacePresenceService,
} from "@chatbotx.io/business"
import { z } from "zod"
import {
  possibleErrorsOnDeletingResource,
  possibleErrorsOnFindingResource,
  possibleErrorsOnListingResource,
  possibleErrorsOnMutatingResource,
} from "@/lib/orpc/orpc-error-helper"
import type { RequestApiToken } from "@/middlewares/context"
import { workspaceTokenAuthAPIForScope } from "@/orpc"
import { apiTokenChatActor } from "../lib/actor"
import {
  withChatAttachmentUrls,
  withSingleChatAttachmentUrls,
} from "../lib/attachment-url"
import { deliverChatMessage, publishChatChanged } from "../lib/chat-realtime"
import { withChatUrl, withChatUrls } from "../lib/chat-url"
import {
  chatIdPathParam,
  chatMessagePublicResource,
  chatPublicResource,
  createChatMessagePublicRequest,
  listChatMessagesPublicRequest,
  listChatMessagesPublicResponse,
  listChatsPublicRequest,
  listChatsPublicResponse,
  messageIdPathParam,
  openChatPublicRequest,
  updateChatMessagePublicRequest,
  uploadChatAttachmentRequest,
  uploadChatAttachmentResponse,
} from "../schema/public"

const workspaceTokenAuthAPI = workspaceTokenAuthAPIForScope("chats")
const tags = ["Chats"]
const chatIdFrom = "Get chat ids from `chats.list` or `chats.open`."

const resolveTokenActor = async (
  workspaceId: string,
  apiToken: RequestApiToken | undefined,
) => {
  const channel = await staffAssistantService.resolveAgentChannel({
    workspaceId,
    tokenId: apiToken?.id ?? "api",
    tokenName: apiToken?.name ?? "API",
  })
  return channel.kind === "staff"
    ? ({ kind: "api", label: channel.title } as const)
    : apiTokenChatActor(apiToken)
}

const toPublicMessage = async (
  workspaceId: string,
  message: InternalMessageView,
) => await withSingleChatAttachmentUrls(workspaceId, message)

const toPublicChat = async (
  workspaceId: string,
  chat: ChatView & { url: string },
) => {
  const withUrl = chat
  return {
    id: withUrl.id,
    type: withUrl.type,
    title: withUrl.title,
    members: withUrl.members.map(({ userId, name, removed }) => ({
      userId,
      name,
      removed,
    })),
    lastMessageAt: withUrl.lastMessageAt,
    lastMessage: withUrl.lastMessage
      ? await toPublicMessage(workspaceId, withUrl.lastMessage)
      : null,
    url: withUrl.url,
  }
}

const chatMessagesPublicRouter = {
  list: workspaceTokenAuthAPI
    .route({
      method: "GET",
      path: "/v1/chats/{id}/messages",
      summary: "List chat messages",
      description: `${chatIdFrom} Returns comments and system events. Page with one of \`beforeId\` or \`afterId\`; get message ids from this operation.`,
      tags,
    })
    .input(listChatMessagesPublicRequest)
    .output(listChatMessagesPublicResponse)
    .errors(possibleErrorsOnFindingResource)
    .handler(async ({ context, input }) => {
      const page = await chatService.listMessages({
        workspaceId: context.workspace.id,
        threadId: input.id,
        scope: { kind: "workspace" },
        beforeId: input.beforeId,
        afterId: input.afterId,
        limit: input.limit,
      })
      return {
        ...page,
        data: await withChatAttachmentUrls(context.workspace.id, page.data),
      }
    }),
  create: workspaceTokenAuthAPI
    .route({
      method: "POST",
      path: "/v1/chats/{id}/messages",
      summary: "Send chat message",
      description: `${chatIdFrom} Sends on behalf of the API token; its name is shown as author. Mentions are not supported. Upload each optional file first with \`chats.attachments.upload\`, then pass its \`key\` and \`name\`.`,
      successStatus: 201,
      tags,
    })
    .input(createChatMessagePublicRequest)
    .output(chatMessagePublicResource)
    .errors(possibleErrorsOnMutatingResource)
    .handler(async ({ context, input }) => {
      const result = await chatService.send({
        workspaceId: context.workspace.id,
        threadId: input.id,
        text: input.text ?? "",
        attachments: input.attachments ?? [],
        actor: await resolveTokenActor(context.workspace.id, context.apiToken),
      })
      deliverChatMessage({
        workspaceId: context.workspace.id,
        threadId: input.id,
        memberUserIds: result.memberUserIds,
        message: result.message,
      })
      return await toPublicMessage(context.workspace.id, result.message)
    }),
  update: workspaceTokenAuthAPI
    .route({
      method: "PATCH",
      path: "/v1/chats/{id}/messages/{messageId}",
      summary: "Update chat message",
      description: `${chatIdFrom} Get \`messageId\` from \`chats.messages.list\`. An API token can edit only messages it sent. Mentions are not supported.`,
      tags,
    })
    .input(updateChatMessagePublicRequest)
    .output(chatMessagePublicResource)
    .errors(possibleErrorsOnMutatingResource)
    .handler(async ({ context, input }) => {
      const result = await chatService.edit({
        workspaceId: context.workspace.id,
        threadId: input.id,
        messageId: input.messageId,
        text: input.text ?? "",
        actor: await resolveTokenActor(context.workspace.id, context.apiToken),
      })
      publishChatChanged({
        workspaceId: context.workspace.id,
        threadId: input.id,
        memberUserIds: result.memberUserIds,
      })
      return await toPublicMessage(context.workspace.id, result.message)
    }),
  delete: workspaceTokenAuthAPI
    .route({
      method: "DELETE",
      path: "/v1/chats/{id}/messages/{messageId}",
      summary: "Delete chat message",
      description: `${chatIdFrom} Get \`messageId\` from \`chats.messages.list\`. Soft-deletes the message.`,
      successStatus: 204,
      tags,
    })
    .input(messageIdPathParam)
    .errors(possibleErrorsOnDeletingResource)
    .handler(async ({ context, input }) => {
      const result = await chatService.deleteMessage({
        workspaceId: context.workspace.id,
        threadId: input.id,
        messageId: input.messageId,
        actor: apiTokenChatActor(context.apiToken),
      })
      publishChatChanged({
        workspaceId: context.workspace.id,
        threadId: input.id,
        memberUserIds: result.memberUserIds,
      })
    }),
}

const chatAttachmentsPublicRouter = {
  upload: workspaceTokenAuthAPI
    .route({
      method: "POST",
      path: "/v1/chats/{id}/attachments",
      summary: "Upload chat attachment",
      description: `${chatIdFrom} Multipart upload (one file, up to 25MB). Returns \`key\` and \`name\` for \`chats.messages.create\`.`,
      successStatus: 201,
      tags,
    })
    .input(uploadChatAttachmentRequest)
    .output(uploadChatAttachmentResponse)
    .errors(possibleErrorsOnMutatingResource)
    .handler(
      async ({ context, input }) =>
        await chatService.uploadAttachment({
          workspaceId: context.workspace.id,
          threadId: input.id,
          file: input.file,
          actor: apiTokenChatActor(context.apiToken),
        }),
    ),
}

export const chatsPublicRouter = {
  list: workspaceTokenAuthAPI
    .route({
      method: "GET",
      path: "/v1/chats",
      summary: "List chats",
      description:
        "Lists workspace chats. Filter by a member `userId` from `workspaceMembers.list`.",
      tags,
    })
    .input(listChatsPublicRequest)
    .output(listChatsPublicResponse)
    .errors(possibleErrorsOnListingResource)
    .handler(async ({ context, input }) => {
      const page = await chatService.list({
        workspaceId: context.workspace.id,
        scope: { kind: "workspace" },
        participantUserId: input.userId,
        includeEmpty: input.includeEmpty,
        page: input.page,
        perPage: input.perPage,
      })
      return {
        ...page,
        data: await Promise.all(
          (await withChatUrls(context.workspace.id, page.data)).map(
            async (chat) => toPublicChat(context.workspace.id, chat),
          ),
        ),
      }
    }),
  get: workspaceTokenAuthAPI
    .route({
      method: "GET",
      path: "/v1/chats/{id}",
      summary: "Get chat",
      description: `Gets one chat. ${chatIdFrom}`,
      tags,
    })
    .input(chatIdPathParam)
    .output(chatPublicResource)
    .errors(possibleErrorsOnFindingResource)
    .handler(
      async ({ context, input }) =>
        await toPublicChat(
          context.workspace.id,
          await withChatUrl(
            context.workspace.id,
            await chatService.get({
              workspaceId: context.workspace.id,
              threadId: input.id,
              scope: { kind: "workspace" },
            }),
          ),
        ),
    ),
  open: workspaceTokenAuthAPI
    .route({
      method: "POST",
      path: "/v1/chats/open",
      summary: "Open chat",
      description:
        "Opens a chat between two members, or an API-agent chat with one member. Get user ids from `workspaceMembers.list`.",
      successStatus: 201,
      tags,
    })
    .input(openChatPublicRequest)
    .output(z.object({ chat: chatPublicResource, created: z.boolean() }))
    .errors(possibleErrorsOnMutatingResource)
    .handler(async ({ context, input }) => {
      const result =
        input.userIds.length === 1
          ? await chatService.openAgentChannel({
              workspaceId: context.workspace.id,
              userId: input.userIds[0],
              channel: await staffAssistantService.resolveAgentChannel({
                workspaceId: context.workspace.id,
                tokenId: context.apiToken?.id ?? "api",
                tokenName: context.apiToken?.name ?? "API",
              }),
            })
          : await chatService.open({
              workspaceId: context.workspace.id,
              userIds: input.userIds,
            })
      return {
        created: result.created,
        chat: await toPublicChat(
          context.workspace.id,
          await withChatUrl(context.workspace.id, result.chat),
        ),
      }
    }),
  messages: chatMessagesPublicRouter,
  attachments: chatAttachmentsPublicRouter,
  presence: workspaceTokenAuthAPI
    .route({
      method: "GET",
      path: "/v1/chats/presence",
      summary: "List online workspace members",
      description: "Returns user ids for workspace members currently online.",
      tags,
    })
    .output(z.object({ onlineUserIds: z.array(z.string()) }))
    .errors(possibleErrorsOnListingResource)
    .handler(async ({ context }) => ({
      onlineUserIds: await workspacePresenceService.listOnlineMembers(
        context.workspace.id,
      ),
    })),
}
