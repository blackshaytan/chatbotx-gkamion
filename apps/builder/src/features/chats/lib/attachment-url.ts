import { resolveTenantSettings } from "@chatbotx.io/business"
import { signMediaToken } from "@chatbotx.io/encryption"

type ChatAttachmentMeta = {
  index: number
  name: string
  size: number
  mimeType: string
}

type MessageWithAttachmentMeta = {
  id: string
  attachments: readonly ChatAttachmentMeta[]
}

type ChatAttachmentUrl = ChatAttachmentMeta & { url: string }

const signAttachmentUrl = async (input: {
  appUrl: string
  workspaceId: string
  messageId: string
  index: number
}): Promise<string> =>
  `${input.appUrl}/media/chat-attachment/${await signMediaToken({
    workspaceId: input.workspaceId,
    kind: "chatAttachment",
    refId: `${input.messageId}:${input.index}`,
  })}`

export const withChatAttachmentUrls = async <
  T extends MessageWithAttachmentMeta,
>(
  workspaceId: string,
  messages: T[],
): Promise<
  Array<Omit<T, "attachments"> & { attachments: ChatAttachmentUrl[] }>
> => {
  const { appUrl } = await resolveTenantSettings({ workspaceId })
  return await Promise.all(
    messages.map(async (message) => ({
      ...message,
      attachments: await Promise.all(
        message.attachments.map(async (attachment) => ({
          ...attachment,
          url: await signAttachmentUrl({
            appUrl,
            workspaceId,
            messageId: message.id,
            index: attachment.index,
          }),
        })),
      ),
    })),
  )
}

export const withSingleChatAttachmentUrls = async <
  T extends MessageWithAttachmentMeta,
>(
  workspaceId: string,
  message: T,
): Promise<Omit<T, "attachments"> & { attachments: ChatAttachmentUrl[] }> => {
  const [mapped] = await withChatAttachmentUrls(workspaceId, [message])
  if (!mapped) {
    throw new Error("Expected one message")
  }
  return mapped
}
