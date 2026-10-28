import {
  CHAT_LIMITS,
  internalMessageKinds,
  taskSystemEventTypes,
} from "@chatbotx.io/database/partials"
import { zodBigintAsString } from "@chatbotx.io/utils"
import { z } from "zod"

const chatId = zodBigintAsString().describe(
  "Chat id. Get it from `chats.list` or `chats.open`.",
)
const userId = zodBigintAsString().describe(
  "Workspace member user id. Get it from `workspaceMembers.list`.",
)

export const chatIdPathParam = z.object({ id: chatId })

const attachmentResource = z.object({
  index: z.number().int(),
  name: z.string(),
  size: z.number().int(),
  mimeType: z.string(),
  url: z.string().describe("Signed download URL, valid for about one hour."),
})

export const chatMessagePublicResource = z.object({
  id: z.string(),
  kind: internalMessageKinds.describe("`comment` or a `system` event."),
  authorUserId: z.string().nullable(),
  authorLabel: z.string().nullable(),
  text: z.string().nullable(),
  attachments: z.array(attachmentResource),
  systemEvent: z
    .union([
      z.object({
        type: taskSystemEventTypes,
        from: z.string().nullable(),
        to: z.string().nullable(),
        byUserId: z.string().nullable(),
      }),
      z.object({
        type: z.literal("assistantFailed"),
        reason: z.enum(["unavailable", "timeout"]),
      }),
    ])
    .nullable(),
  deleted: z.boolean(),
  editedAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
})

export const chatPublicResource = z.object({
  id: z.string(),
  type: z.enum(["direct", "agent"]),
  title: z.string().nullable(),
  members: z.array(
    z.object({
      userId: z.string(),
      name: z.string().nullable(),
      removed: z.boolean(),
    }),
  ),
  lastMessageAt: z.coerce.date().nullable(),
  lastMessage: chatMessagePublicResource.nullable(),
  url: z.string().describe("Link to this chat in the web app."),
})

export const listChatsPublicRequest = z.object({
  userId: userId.optional().describe("Only chats containing this member."),
  includeEmpty: z.coerce
    .boolean()
    .optional()
    .describe("Include chats with no messages yet."),
  page: z.coerce.number().int().min(1).default(1).describe("Page number."),
  perPage: z.coerce
    .number()
    .int()
    .min(1)
    .max(CHAT_LIMITS.maxPageSize)
    .default(50)
    .describe("Maximum chats returned per page."),
})

export const listChatsPublicResponse = z.object({
  data: z.array(chatPublicResource),
  total: z.number().int(),
  pageCount: z.number().int(),
})

export const openChatPublicRequest = z.object({
  userIds: z
    .array(userId)
    .min(1)
    .max(2)
    .describe(
      "Two distinct members for a direct chat, or one member for an API-agent chat.",
    ),
})

export const messageIdPathParam = chatIdPathParam.extend({
  messageId: zodBigintAsString().describe(
    "Message id. Get it from `chats.messages.list`.",
  ),
})

export const listChatMessagesPublicRequest = chatIdPathParam.extend({
  beforeId: zodBigintAsString()
    .optional()
    .describe("Return messages before this message id."),
  afterId: zodBigintAsString()
    .optional()
    .describe("Return messages after this message id."),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(CHAT_LIMITS.maxPageSize)
    .optional()
    .describe("Maximum messages returned (defaults to 50)."),
})

export const listChatMessagesPublicResponse = z.object({
  data: z.array(chatMessagePublicResource),
  hasMore: z.boolean(),
})

const chatAttachmentInput = z.object({
  key: z
    .string()
    .min(1)
    .describe("Object key returned by `chats.attachments.upload`."),
  name: z.string().trim().min(1).max(255),
})

export const createChatMessagePublicRequest = chatIdPathParam
  .extend({
    text: z
      .string()
      .trim()
      .max(CHAT_LIMITS.maxMessageLength)
      .optional()
      .describe("Message text. Mentions are not supported."),
    attachments: z
      .array(chatAttachmentInput)
      .max(10)
      .optional()
      .describe("Files uploaded with `chats.attachments.upload`."),
  })
  .superRefine((value, ctx) => {
    if (!(value.text || value.attachments?.length)) {
      ctx.addIssue({
        code: "custom",
        message: "Provide message text and/or attachments.",
        path: ["text"],
      })
    }
  })

export const updateChatMessagePublicRequest = messageIdPathParam
  .extend({
    text: z
      .string()
      .trim()
      .min(1)
      .max(CHAT_LIMITS.maxMessageLength)
      .optional()
      .describe("Replacement message text. Mentions are not supported."),
  })
  .superRefine((value, ctx) => {
    if (value.text === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "Message text is required.",
        path: ["text"],
      })
    }
  })

export const uploadChatAttachmentRequest = chatIdPathParam.extend({
  file: z
    .file()
    .refine((file) => file.size <= 25 * 1024 * 1024, {
      message: "Max file size is 25MB.",
    })
    .describe("Multipart file body (one file, up to 25MB)."),
})

export const uploadChatAttachmentResponse = z.object({
  key: z.string(),
  name: z.string(),
  size: z.number().int(),
  mimeType: z.string(),
})
