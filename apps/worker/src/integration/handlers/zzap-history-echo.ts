/**
 * ZZAP's message list does not return the text we posted. It replaces "₽"
 * with "?" and drops blank lines. The poll then hashes that altered text, so
 * the echo's sourceId never matches the row ChatbotX stored at send time.
 */
export const zzapHistoryEchoText = (text: string | null | undefined): string =>
  (text ?? "")
    .replaceAll("\r\n", "\n")
    .replaceAll("₽", "?")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n")

export const isSameZzapHistoryEcho = (
  stored: string | null | undefined,
  echoed: string | null | undefined,
): boolean => {
  const left = zzapHistoryEchoText(stored)
  const right = zzapHistoryEchoText(echoed)
  return left.length > 0 && left === right
}

/** A row ChatbotX created for its own send, not one previously imported from ZZAP. */
export const isChatbotXOutgoing = (message: {
  senderType: string
  senderId?: string | null
}): boolean =>
  message.senderType === "bot" ||
  message.senderType === "api" ||
  (message.senderType === "user" && message.senderId != null)
