import { TASK_LIMITS } from "@chatbotx.io/database/partials"

export const toMarkdownQuote = (
  text: string,
  maxLength: number = TASK_LIMITS.maxDescriptionLength,
): string => {
  const normalizedText = text.replaceAll("\r\n", "\n").replaceAll("\r", "\n")

  if (!normalizedText.trim()) {
    return ""
  }

  const quoted = normalizedText
    .split("\n")
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n")
    .slice(0, maxLength)
    .trimEnd()

  if (quoted.endsWith("\n>")) {
    return quoted.slice(0, -2)
  }

  return quoted
}

export const canCreateTaskFromMessage = (message: {
  messageType: string
  deletedAt: Date | string | null
}): boolean => message.messageType === "incoming" && message.deletedAt === null
