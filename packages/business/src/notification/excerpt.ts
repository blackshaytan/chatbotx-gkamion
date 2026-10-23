import { splitInternalMentionText } from "@chatbotx.io/utils"

export const formatCommentExcerpt = (text: string, maxLength = 200): string => {
  const plain = splitInternalMentionText(text)
    .map((segment) =>
      segment.type === "text" ? segment.text : `@${segment.label}`,
    )
    .join("")
  if (plain.length <= maxLength) {
    return plain
  }
  return plain.slice(0, maxLength)
}
