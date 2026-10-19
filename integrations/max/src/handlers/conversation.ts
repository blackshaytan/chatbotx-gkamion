import type { ConversationHandlers } from "@chatbotx.io/sdk"
import { sendTypingOn } from "../apis/bot"
import type { MaxAuthValue } from "../schema"

const sendTyping: ConversationHandlers<MaxAuthValue>["sendTyping"] = async ({
  ctx,
  data: { contact, typing },
}) => {
  if (typing && contact.sourceId) {
    await sendTypingOn(ctx.auth.secretText, contact.sourceId)
  }
}

export const conversationHandlers = { sendTyping }
