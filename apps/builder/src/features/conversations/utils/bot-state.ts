import type { ConversationModel } from "@chatbotx.io/database/types"
import { isFuture, isPast } from "date-fns"

export const BOT_DISABLE_DURATION_MS = 24 * 60 * 60 * 1000

/** Fields a bot-state update writes when the bot is turned back on. */
export const BOT_RESUMED_PATCH = {
  botEnabled: true,
  botResumeAt: null,
  handoverCategory: null,
  handedOverAt: null,
  managerJoinedAt: null,
} as const

export function isConversationActive(
  conversation: Pick<ConversationModel, "botEnabled" | "botResumeAt">,
): boolean {
  if (conversation.botEnabled) {
    return true
  }

  if (!conversation.botResumeAt) {
    return false
  }

  return isPast(new Date(conversation.botResumeAt))
}

/** The bot is off and a manager was asked to take over (no automatic resume after a handover). */
export function isAwaitingManager(
  conversation: Pick<ConversationModel, "botEnabled" | "botResumeAt"> & {
    handedOverAt: Date | string | null
  },
): boolean {
  return (
    !isConversationActive(conversation) && Boolean(conversation.handedOverAt)
  )
}

/** When a paused bot resumes, or null when the bot is not paused in the future. */
export function getBotPausedUntil(
  conversation: Pick<ConversationModel, "botEnabled" | "botResumeAt">,
): Date | null {
  if (isConversationActive(conversation) || !conversation.botResumeAt) {
    return null
  }

  const resumeAt = new Date(conversation.botResumeAt)
  return isFuture(resumeAt) ? resumeAt : null
}
