import { zodBigintAsString } from "@chatbotx.io/utils"
import { z } from "zod"
import {
  chatMessagePublicResource,
  chatPublicResource,
  createChatMessagePublicRequest,
  listChatMessagesPublicRequest,
  listChatsPublicRequest,
  messageIdPathParam,
  openChatPublicRequest,
  updateChatMessagePublicRequest,
  uploadChatAttachmentRequest,
} from "./public"

const withWorkspaceId = { workspaceId: zodBigintAsString() }

export const chatMessagePrivateResource = chatMessagePublicResource

export const chatPrivateResource = chatPublicResource.extend({
  unreadCount: z.number().int().nonnegative(),
  peerLastReadAt: z.date().nullable(),
})

export const listChatsPrivateRequest =
  listChatsPublicRequest.extend(withWorkspaceId)
export const getChatPrivateRequest = z.object({
  ...withWorkspaceId,
  id: zodBigintAsString(),
})
export const openChatPrivateRequest =
  openChatPublicRequest.extend(withWorkspaceId)
export const listChatMessagesPrivateRequest =
  listChatMessagesPublicRequest.extend(withWorkspaceId)
export const createChatMessagePrivateRequest =
  createChatMessagePublicRequest.extend(withWorkspaceId)
export const updateChatMessagePrivateRequest =
  updateChatMessagePublicRequest.extend(withWorkspaceId)
export const deleteChatMessagePrivateRequest =
  messageIdPathParam.extend(withWorkspaceId)
export const uploadChatAttachmentPrivateRequest =
  uploadChatAttachmentRequest.extend(withWorkspaceId)
export const markChatReadPrivateRequest = z.object({
  ...withWorkspaceId,
  id: zodBigintAsString(),
  upToMessageId: zodBigintAsString().optional(),
})
export const chatUnreadTotalPrivateRequest = z.object(withWorkspaceId)

export const chatPrivateListResponse = z.object({
  data: z.array(chatPrivateResource),
  total: z.number().int(),
  pageCount: z.number().int(),
})
export const chatMessagesPrivateResponse = z.object({
  data: z.array(chatMessagePrivateResource),
  hasMore: z.boolean(),
})
