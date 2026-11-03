import { detectOptOutRequest, voiceAgentService } from "@chatbotx.io/business"
import { logger } from "../../lib/logger"

export async function applyVoiceOptOut(input: {
  workspaceId: string
  contactId: string
  messageType: string
  text: string | null
  senderIsContact: boolean
}): Promise<{ optedOut: boolean }> {
  if (
    input.messageType !== "incoming" ||
    !input.senderIsContact ||
    !input.text
  ) {
    return { optedOut: false }
  }

  const detection = detectOptOutRequest(input.text)
  if (!detection.matched) {
    return { optedOut: false }
  }

  try {
    await voiceAgentService.setAiCallOptOut({
      workspaceId: input.workspaceId,
      contactId: input.contactId,
      source: "clientChat",
      reason: input.text.slice(0, 500),
    })

    return { optedOut: true }
  } catch (err) {
    logger.error({ err, contactId: input.contactId }, "voice opt-out failed")
    return { optedOut: false }
  }
}
