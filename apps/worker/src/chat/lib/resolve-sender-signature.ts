import { externalAgentService, userService } from "@chatbotx.io/business"
import { logger } from "../../lib/logger"
import {
  applySenderSignature,
  isSignableMessage,
  type SignableMessage,
} from "./sender-signature"

export type SignableOutgoingMessage = SignableMessage & {
  senderType: string
  senderId: string | null
}

export type SenderSignatureInput<T extends SignableOutgoingMessage> = {
  workspaceId: string
  inboxId: string
  message: T
  /** `externalAgent` for an AI agent reply; manager replies are detected by `senderType`. */
  signAs?: "externalAgent"
}

const findManagerName = async (
  userId: string | null,
): Promise<string | null> => {
  if (!userId) {
    return null
  }
  const user = await userService.findNameAndEmail(userId)
  return user?.name ?? null
}

/**
 * Returns the message with its text prefixed by the sender's name, for the
 * channel send only; the stored row is never touched. Returns the same message
 * when nothing is signed. Never throws: a failed lookup sends the text unsigned.
 */
export const resolveSignedMessage = async <T extends SignableOutgoingMessage>(
  input: SenderSignatureInput<T>,
): Promise<T> => {
  const { workspaceId, inboxId, message, signAs } = input
  const isAgentReply = signAs === "externalAgent"
  const isManagerReply = message.senderType === "user"
  if (!((isAgentReply || isManagerReply) && isSignableMessage(message))) {
    return message
  }

  try {
    const runtime = await externalAgentService.getRuntime({
      workspaceId,
      inboxId,
    })
    if (!runtime?.agent.signMessages) {
      return message
    }
    const senderName = isAgentReply
      ? runtime.agent.botName
      : await findManagerName(message.senderId)
    const text = applySenderSignature(message.text ?? "", senderName)
    if (text === message.text) {
      return message
    }
    return { ...message, text }
  } catch (err) {
    logger.warn(
      { err, workspaceId, inboxId, senderType: message.senderType },
      "Sender signature skipped: unable to resolve the sender name",
    )
    return message
  }
}
