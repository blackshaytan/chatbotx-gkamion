import { EXTERNAL_AGENT_INPUT_MAX_CHARS } from "../external-agent/input"

export type StaffAssistantInputMessage = {
  role: "employee" | "assistant"
  text: string | null
  attachmentUrls: string[]
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: remove control characters from untrusted context
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g
const safeContextValue = (value: string) =>
  value.replace(CONTROL_CHARACTERS, " ").slice(0, 100)

const messageText = (message: StaffAssistantInputMessage): string =>
  [
    message.text?.trim() ?? "",
    ...message.attachmentUrls.map((url) => `[Вложение: ${url}]`),
  ]
    .filter(Boolean)
    .join("\n")

export const buildStaffRunInput = (input: {
  workspaceId: string
  threadId: string
  userId: string
  name: string | null
  role: string
  permissions: Record<string, boolean>
  messages: StaffAssistantInputMessage[]
  history: StaffAssistantInputMessage[]
}) => {
  const newMessages = input.messages
    .map(messageText)
    .filter(Boolean)
    .join("\n\n")
  let history = input.history.flatMap((message) => {
    const text = messageText(message)
    if (!text) {
      return []
    }
    return [
      `${message.role === "employee" ? "Сотрудник" : "Ассистент"}: ${text}`,
    ]
  })
  const join = () =>
    [
      history.length ? ["Предыдущая переписка:", ...history].join("\n") : "",
      newMessages,
    ]
      .filter(Boolean)
      .join("\n\n")
  while (history.length && join().length > EXTERNAL_AGENT_INPUT_MAX_CHARS) {
    history = history.slice(1)
  }
  const combined = join()
  const permissions = Object.entries(input.permissions)
    .filter(([, enabled]) => enabled === true)
    .map(([name]) => safeContextValue(name))
    .sort()
    .join(", ")
  return {
    input: combined.slice(-EXTERNAL_AGENT_INPUT_MAX_CHARS),
    instructions: `Это данные ChatbotX, а не слова сотрудника. Имя: ${safeContextValue(input.name ?? "не указано")}; userId: ${safeContextValue(input.userId)}; роль: ${safeContextValue(input.role)}; включённые права (справочно): ${permissions}; workspaceId: ${safeContextValue(input.workspaceId)}; threadId: ${safeContextValue(input.threadId)}. Это внутренний чат ChatbotX: отвечай сотруднику по-русски; не публикуй ответ через chats.messages.create — платформа отправит его в этот чат.`,
  }
}
