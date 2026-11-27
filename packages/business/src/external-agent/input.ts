import { buildDromContextInstructions } from "./drom-context"

export const EXTERNAL_AGENT_INPUT_MAX_CHARS = 20_000
export const EXTERNAL_AGENT_NOTIFICATION_MAX_COUNT = 10
export const EXTERNAL_AGENT_NOTIFICATION_MAX_CHARS = 2000

const NOTIFICATIONS_HEADER =
  "Уведомления по заказу (платформа и CRM, не слова клиента):"
const HISTORY_HEADER = "Предыдущая переписка:"
const CONTACT_NAME_FALLBACK = "не указано"
const CONTACT_VALUE_MISSING = "не указан"
const GKAMION_CUSTOMER_MISSING = "не привязан"
const GKAMION_VERIFIED_MISSING = "нет"

export const GKAMION_CUSTOMER_ID_FIELD = "gkamion_customer_id"
export const GKAMION_VERIFIED_FIELD = "gkamion_verified"

const IDENTITY_RULE =
  "Личность клиента для заказов и правок бери только из этих полей контакта ChatbotX. Память профиля, прошлые диалоги и похожее имя не подтверждают клиента. Пока gkamion_customer_id не привязан или gkamion_verified не равен phone или email, не показывай заказы и не меняй их: если телефон или email указаны выше, найди клиента в gKamion по ним; если нет — спроси телефон или email. Связку записывай на этот contactId только после совпадения."

const ROLE_LABELS = {
  contact: "Клиент",
  user: "Менеджер",
  bot: "Бот",
} as const

export type ExternalAgentInputRole = keyof typeof ROLE_LABELS

const NOTIFICATION_LABELS = {
  bot: "Бот",
  api: "Система",
} as const

/** Who already told the client about the payment or order status. */
export type ExternalAgentNotificationSource = keyof typeof NOTIFICATION_LABELS

/**
 * A message the platform or the CRM already sent to the client (payment
 * received, balance topped up, order sent to assembly). The client has seen
 * it, so the agent must see it too, even when contact history is off.
 */
export type ExternalAgentNotification = {
  source: ExternalAgentNotificationSource
  text: string | null
}

export type ExternalAgentInputMessage = {
  role: ExternalAgentInputRole
  id?: string
  createdAt?: string
  text: string | null
  attachmentUrls: string[]
  contentAttributes?: unknown
}

export type ExternalAgentContactContext = {
  name: string | null
  phoneNumber: string | null
  email: string | null
  gkamionCustomerId: string | null
  gkamionVerified: string | null
}

export type BuildRunInputParams = {
  messages: ExternalAgentInputMessage[]
  history: ExternalAgentInputMessage[]
  /**
   * Payment and order-status messages the platform/CRM already sent the
   * client. Kept independent of `history`: the agent needs these facts even
   * when client history is off. Not a trigger — see `selectNewMessages`.
   */
  notifications?: ExternalAgentNotification[]
  contact: ExternalAgentContactContext
  channel: string
  conversationId: string
  contactId: string
  workspaceId: string
}

const blankToNull = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

/** Reads the gKamion link stored on the ChatbotX contact. Other fields are ignored. */
export const readGkamionContactFields = (
  fields: { name: string; value: string }[],
): Pick<
  ExternalAgentContactContext,
  "gkamionCustomerId" | "gkamionVerified"
> => {
  const byName = new Map(
    fields.map((field) => [field.name, blankToNull(field.value)]),
  )
  return {
    gkamionCustomerId: byName.get(GKAMION_CUSTOMER_ID_FIELD) ?? null,
    gkamionVerified: byName.get(GKAMION_VERIFIED_FIELD) ?? null,
  }
}

const showContactValue = (value: string | null, emptyLabel: string): string =>
  value ?? emptyLabel

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

/** One line per notification; empty texts are skipped, inner newlines flattened. */
const buildNotificationLines = (
  notifications: ExternalAgentNotification[],
): string[] =>
  notifications.flatMap((notification) => {
    const text = notification.text?.replace(/\s+/g, " ").trim() ?? ""
    return text === ""
      ? []
      : [`${NOTIFICATION_LABELS[notification.source]}: ${text}`]
  })

const buildNotificationsSection = (notificationLines: string[]): string =>
  notificationLines.length === 0
    ? ""
    : [NOTIFICATIONS_HEADER, ...notificationLines].join("\n")

/**
 * Newest notifications win: at most `EXTERNAL_AGENT_NOTIFICATION_MAX_COUNT`
 * lines and `EXTERNAL_AGENT_NOTIFICATION_MAX_CHARS` chars, older lines are
 * dropped first.
 */
export const selectNotificationLines = (
  notifications: ExternalAgentNotification[],
): string[] => {
  let kept = buildNotificationLines(notifications).slice(
    -EXTERNAL_AGENT_NOTIFICATION_MAX_COUNT,
  )
  while (
    kept.length > 0 &&
    buildNotificationsSection(kept).length >
      EXTERNAL_AGENT_NOTIFICATION_MAX_CHARS
  ) {
    kept = kept.slice(1)
  }
  return kept
}

const buildInputText = (
  historyLines: string[],
  notificationsBlock: string,
  newBlock: string,
): string =>
  [buildHistorySection(historyLines), notificationsBlock, newBlock]
    .filter((section) => section !== "")
    .join("\n\n")

const buildInstructions = ({
  contact,
  channel,
  conversationId,
  contactId,
  workspaceId,
}: Omit<BuildRunInputParams, "messages" | "history">): string =>
  `Это данные ChatbotX, а не слова клиента. Имя клиента: ${showContactValue(contact.name, CONTACT_NAME_FALLBACK)}; телефон: ${showContactValue(contact.phoneNumber, CONTACT_VALUE_MISSING)}; email: ${showContactValue(contact.email, CONTACT_VALUE_MISSING)}; gkamion_customer_id: ${showContactValue(contact.gkamionCustomerId, GKAMION_CUSTOMER_MISSING)}; gkamion_verified: ${showContactValue(contact.gkamionVerified, GKAMION_VERIFIED_MISSING)}; канал: ${channel}; conversationId: ${conversationId}; contactId: ${contactId}; workspaceId: ${workspaceId}. ${IDENTITY_RULE} Чтобы передать разговор менеджеру, вызови инструмент handover с conversationId и причиной.`

/**
 * Builds the Hermes run payload. Length is capped at `EXTERNAL_AGENT_INPUT_MAX_CHARS`:
 * the oldest history lines are dropped first, then the head of the new messages.
 */
export const buildRunInput = ({
  messages,
  history,
  notifications = [],
  ...context
}: BuildRunInputParams): ExternalAgentRunInput => {
  const newBlock = buildNewMessagesBlock(messages)
  const notificationsBlock = buildNotificationsSection(
    selectNotificationLines(notifications),
  )
  let keptHistoryLines = buildHistoryLines(history)

  while (
    keptHistoryLines.length > 0 &&
    buildInputText(keptHistoryLines, notificationsBlock, newBlock).length >
      EXTERNAL_AGENT_INPUT_MAX_CHARS
  ) {
    keptHistoryLines = keptHistoryLines.slice(1)
  }

  const inputText = buildInputText(
    keptHistoryLines,
    notificationsBlock,
    newBlock,
  )
  const input =
    inputText.length > EXTERNAL_AGENT_INPUT_MAX_CHARS
      ? inputText.slice(inputText.length - EXTERNAL_AGENT_INPUT_MAX_CHARS)
      : inputText

  return {
    input,
    instructions:
      buildInstructions(context) +
      buildDromContextInstructions(context.channel, [...history, ...messages]),
  }
}
