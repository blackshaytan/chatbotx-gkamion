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

export const toTaskDescriptionFromChatMessage = ({
  author,
  date,
  maxLength = TASK_LIMITS.maxDescriptionLength,
  text,
}: {
  author: string
  date: string
  maxLength?: number
  text: string
}): string => {
  const attribution = `— ${author}, ${date}`

  if (attribution.length + 2 >= maxLength) {
    return attribution.slice(0, maxLength).trimEnd()
  }

  const quote = toMarkdownQuote(text, maxLength - attribution.length - 2)

  return quote ? `${quote}\n\n${attribution}` : attribution
}

export const canCreateTaskFromMessage = (message: {
  messageType: string
  deletedAt?: Date | string | null
}): boolean => message.messageType === "incoming" && message.deletedAt == null

export const canCreateTaskFromChatMessage = (message: {
  deleted: boolean
  kind: "comment" | "system"
}): boolean => message.kind === "comment" && !message.deleted
