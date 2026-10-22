import type { MessageModel } from "@chatbotx.io/database/types"

const SENDER_SIGNATURE_SEPARATOR = ": "
const WHITESPACE_RUN = /\s+/g

export type SignableMessage = Pick<
  MessageModel,
  "text" | "type" | "contentAttributes"
>

/**
 * Only direct text messages get a sender prefix. Empty (attachment-only)
 * messages, comment replies and channel templates do not.
 */
export const isSignableMessage = (message: SignableMessage): boolean => {
  if (!message.text?.trim()) {
    return false
  }
  if (message.type === "comment") {
    return false
  }
  return message.contentAttributes?.type !== "template"
}

/**
 * Returns `Name: text`. A blank or missing name returns the text unchanged, so
 * a sender without a name is never shown with an e-mail or a placeholder.
 */
export const applySenderSignature = (
  text: string,
  senderName: string | null | undefined,
): string => {
  const name = senderName?.replace(WHITESPACE_RUN, " ").trim()
  if (!name) {
    return text
  }
  return `${name}${SENDER_SIGNATURE_SEPARATOR}${text}`
}
