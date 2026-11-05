import { conversationService } from "@chatbotx.io/business"
import type { ConversationModel } from "@chatbotx.io/database/types"
import {
  emailReplyContext,
  type SmtpEmailReply,
} from "@chatbotx.io/integration-smtp/schema"

export const loadSmtpEmailReply = async (props: {
  conversation: Pick<
    ConversationModel,
    "id" | "workspaceId" | "lastActivityAt" | "createdAt"
  >
  contactInboxId: string
}): Promise<SmtpEmailReply> => {
  const last = await conversationService.findLastIncomingMessage(props)
  return emailReplyContext(last)
}
