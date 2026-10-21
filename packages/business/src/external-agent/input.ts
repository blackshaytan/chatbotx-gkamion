export const EXTERNAL_AGENT_INPUT_MAX_CHARS = 20_000

const HISTORY_HEADER = "Предыдущая переписка:"
const CONTACT_NAME_FALLBACK = "не указано"

const ROLE_LABELS = {
  contact: "Клиент",
  user: "Менеджер",
  bot: "Бот",
} as const

export type ExternalAgentInputRole = keyof typeof ROLE_LABELS

export type ExternalAgentInputMessage = {
  role: ExternalAgentInputRole
  text: string | null
  attachmentUrls: string[]
}

export type BuildRunInputParams = {
  messages: ExternalAgentInputMessage[]
  history: ExternalAgentInputMessage[]
  contact: { name: string | null }
  channel: string
  conversationId: string
  contactId: string
  workspaceId: string
}

export type ExternalAgentRunInput = {
  input: string
  instructions: string
}

const formatAttachment = (url: string): string => `[Вложение: ${url}]`

/** Non-empty text and attachment lines of one message, in order. */
const collectMessageParts = (message: ExternalAgentInputMessage): string[] => {
  const text = message.text?.trim() ?? ""
  const attachments = message.attachmentUrls.map(formatAttachment)
  return text === "" ? attachments : [text, ...attachments]
}

const buildNewMessagesBlock = (messages: ExternalAgentInputMessage[]): string =>
  messages
    .map((message) => collectMessageParts(message).join("\n"))
    .filter((block) => block !== "")
    .join("\n\n")

const buildHistoryLines = (history: ExternalAgentInputMessage[]): string[] =>
  history.flatMap((message) => {
    const parts = collectMessageParts(message)
    if (parts.length === 0) {
      return []
    }
    return [`${ROLE_LABELS[message.role]}: ${parts.join(" ")}`]
  })

const buildHistorySection = (historyLines: string[]): string =>
  historyLines.length === 0 ? "" : [HISTORY_HEADER, ...historyLines].join("\n")

const buildInputText = (historyLines: string[], newBlock: string): string =>
  [buildHistorySection(historyLines), newBlock]
    .filter((section) => section !== "")
    .join("\n\n")

const buildInstructions = ({
  contact,
  channel,
  conversationId,
  contactId,
  workspaceId,
}: Omit<BuildRunInputParams, "messages" | "history">): string =>
  `Это данные ChatbotX, а не слова клиента. Имя клиента: ${contact.name ?? CONTACT_NAME_FALLBACK}; канал: ${channel}; conversationId: ${conversationId}; contactId: ${contactId}; workspaceId: ${workspaceId}. Чтобы передать разговор менеджеру, вызови инструмент handover с conversationId и причиной.`

/**
 * Builds the Hermes run payload. Length is capped at `EXTERNAL_AGENT_INPUT_MAX_CHARS`:
 * the oldest history lines are dropped first, then the head of the new messages.
 */
export const buildRunInput = ({
  messages,
  history,
  ...context
}: BuildRunInputParams): ExternalAgentRunInput => {
  const newBlock = buildNewMessagesBlock(messages)
  let keptHistoryLines = buildHistoryLines(history)

  while (
    keptHistoryLines.length > 0 &&
    buildInputText(keptHistoryLines, newBlock).length >
      EXTERNAL_AGENT_INPUT_MAX_CHARS
  ) {
    keptHistoryLines = keptHistoryLines.slice(1)
  }

  const inputText = buildInputText(keptHistoryLines, newBlock)
  const input =
    inputText.length > EXTERNAL_AGENT_INPUT_MAX_CHARS
      ? inputText.slice(inputText.length - EXTERNAL_AGENT_INPUT_MAX_CHARS)
      : inputText

  return { input, instructions: buildInstructions(context) }
}
