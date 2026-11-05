export type SmtpEmailReply = {
  subject?: string
  inReplyTo?: string
  references?: string
}

const RE_SUBJECT = /^re:/i
const WHITESPACE = /\s+/

const readString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined

export const bracketMessageId = (id: string): string => {
  const trimmed = id.trim()
  if (!trimmed) {
    return trimmed
  }
  return trimmed.startsWith("<") ? trimmed : `<${trimmed}>`
}

export const replySubject = (
  subject: string | undefined,
  fallback: string,
): string => {
  const trimmed = subject?.replace(/\s+/g, " ").trim()
  if (!trimmed) {
    return fallback
  }
  return RE_SUBJECT.test(trimmed) ? trimmed : `Re: ${trimmed}`
}

export const readEmailReply = (value: unknown): SmtpEmailReply | undefined => {
  if (!value || typeof value !== "object") {
    return
  }
  const record = value as Record<string, unknown>
  const subject = readString(record.subject)
  const inReplyTo = readString(record.inReplyTo)
  const references = readString(record.references)
  if (!(subject || inReplyTo || references)) {
    return
  }
  return {
    ...(subject ? { subject } : {}),
    ...(inReplyTo ? { inReplyTo } : {}),
    ...(references ? { references } : {}),
  }
}

export const emailReplyFromAttributes = (
  contentAttributes: unknown,
): SmtpEmailReply | undefined => {
  if (!contentAttributes || typeof contentAttributes !== "object") {
    return
  }
  return readEmailReply(
    (contentAttributes as { emailReply?: unknown }).emailReply,
  )
}

type StoredEmail = {
  subject?: unknown
  messageId?: unknown
  references?: unknown
}

/**
 * Threading headers for a reply to the latest inbound mail. `sourceId` is the
 * fallback Message-ID when the stored email block is missing.
 */
export const emailReplyContext = (
  message:
    | {
        sourceId?: string | null
        contentAttributes?: unknown
      }
    | null
    | undefined,
): SmtpEmailReply => {
  const stored = message?.contentAttributes
  const email: StoredEmail | undefined =
    stored && typeof stored === "object"
      ? ((stored as { email?: StoredEmail }).email ?? undefined)
      : undefined
  const messageId =
    readString(email?.messageId) ?? readString(message?.sourceId ?? undefined)
  const prior = Array.isArray(email?.references)
    ? email.references.filter(
        (item): item is string =>
          typeof item === "string" && item.trim() !== "",
      )
    : []
  const references =
    messageId && !prior.includes(messageId) ? [...prior, messageId] : prior
  const subject = readString(email?.subject)
  return {
    ...(subject ? { subject } : {}),
    ...(messageId ? { inReplyTo: messageId } : {}),
    ...(references.length > 0 ? { references: references.join(" ") } : {}),
  }
}

const MAX_INBOUND_TEXT = 20_000

export const visibleInboundText = (
  subject: string | undefined,
  body: string,
): string => {
  const trimmed = body.trim()
  const withSubject = subject?.trim()
    ? `Subject: ${subject.trim()}\n\n${trimmed || "(empty)"}`
    : trimmed || "(empty)"
  if (withSubject.length <= MAX_INBOUND_TEXT) {
    return withSubject
  }
  return `${withSubject.slice(0, MAX_INBOUND_TEXT)}\n\n…`
}

export const splitDisplayName = (
  name: string | undefined,
  email: string,
): { firstName: string; lastName?: string } => {
  const cleaned = name?.replace(/["']/g, "").trim()
  if (!cleaned || cleaned.toLowerCase() === email) {
    return { firstName: email.split("@")[0] || email }
  }
  const [first, ...rest] = cleaned.split(WHITESPACE)
  if (!first) {
    return { firstName: email.split("@")[0] || email }
  }
  return rest.length > 0
    ? { firstName: first, lastName: rest.join(" ") }
    : { firstName: first }
}

export const escapeHtml = (value: string): string =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")

export const textToHtml = (text: string): string =>
  `<div>${escapeHtml(text).replaceAll("\n", "<br>")}</div>`

export const fallbackSubjectFromText = (text: string): string => {
  const line = text
    .split("\n")
    .map((part) => part.trim())
    .find((part) => part.length > 0)
  if (!line) {
    return "Message"
  }
  return line.length > 120 ? `${line.slice(0, 117)}…` : line
}
