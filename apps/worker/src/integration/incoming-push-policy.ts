import type { ConversationModel } from "@chatbotx.io/database/types"

type ConversationBotState = Pick<
  ConversationModel,
  "botEnabled" | "botResumeAt"
>

/**
 * Worker copy of the builder's `isConversationActive`: the bot answers the
 * conversation when it is enabled, or when its pause has already ended
 * (`botResumeAt` in the past). Kept as a pure function so the worker does not
 * import from the builder.
 */
export const isBotActiveForConversation = (
  conversation: ConversationBotState,
  now: Date = new Date(),
): boolean => {
  if (conversation.botEnabled) {
    return true
  }
  if (!conversation.botResumeAt) {
    return false
  }
  return new Date(conversation.botResumeAt).getTime() < now.getTime()
}

/**
 * An inbox answered by the external agent does not push every client message
 * to managers while the bot is still handling the conversation. Managers hear
 * about it through the handover push, and again once the conversation is back
 * in their hands (bot off or paused past its end). Other inboxes are unchanged.
 */
export const shouldSendIncomingMessagePush = (input: {
  conversation: ConversationBotState
  isExternalAgentInbox: boolean
  now?: Date
}): boolean => {
  if (!input.isExternalAgentInbox) {
    return true
  }
  return !isBotActiveForConversation(input.conversation, input.now)
}
