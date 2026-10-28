import type { InternalMessageModel } from "@chatbotx.io/database/types"
import { signMediaToken } from "@chatbotx.io/encryption"
import { resolveTenantSettings } from "../platform/settings"
import type { StaffAssistantInputMessage } from "./input"

const STAFF_ATTACHMENT_TTL_MS = 24 * 60 * 60 * 1000

/** Sign scoped message attachment links for a Hermes run. */
export const toStaffAssistantInputMessages = async (input: {
  workspaceId: string
  userId: string
  messages: InternalMessageModel[]
}): Promise<StaffAssistantInputMessage[]> => {
  const { appUrl } = await resolveTenantSettings({
    workspaceId: input.workspaceId,
  })
  return await Promise.all(
    input.messages.map(async (message) => ({
      role:
        message.authorUserId === input.userId
          ? ("employee" as const)
          : ("assistant" as const),
      text: message.text,
      attachmentUrls: await Promise.all(
        message.attachments.map(
          async (_attachment, index) =>
            `${appUrl}/media/chat-attachment/${await signMediaToken(
              {
                workspaceId: input.workspaceId,
                kind: "chatAttachment",
                refId: `${message.id}:${index}`,
              },
              STAFF_ATTACHMENT_TTL_MS,
            )}`,
        ),
      ),
    })),
  )
}
