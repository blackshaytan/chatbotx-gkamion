import { simpleParser } from "mailparser"
import { extractEmailAddress } from "./schema"
import { bracketMessageId, visibleInboundText } from "./thread"

const MAX_ATTACHMENT_BYTES = 1_000_000
const MAX_ATTACHMENTS = 3
const WHITESPACE = /\s+/

export type SmtpInboundAttachment = {
  filename: string
  mimeType: string
  contentBase64: string
}

export type SmtpInboundPayload = {
  messageId: string
  fromAddress: string
  fromName?: string
  subject?: string
  text: string
  inReplyTo?: string
  references?: string[]
  attachments?: SmtpInboundAttachment[]
}

type ParsedAttachment = {
  filename?: string
  contentType?: string
  content?: Buffer
  size?: number
}

type ParsedAddress = { address?: string; name?: string }

export type ParsedInboundSource = {
  messageId?: string
  subject?: string
  text?: string
  html?: string | false
  inReplyTo?: string
  references?: string | string[]
  from?: { value?: ParsedAddress[] }
  attachments?: ParsedAttachment[]
}

const stripHtml = (html: string): string =>
  html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim()

const referenceList = (references: string | string[] | undefined): string[] => {
  const values = Array.isArray(references)
    ? references
    : references?.split(WHITESPACE)
  return (values ?? [])
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .map(bracketMessageId)
}

const bodyText = (mail: ParsedInboundSource): string => {
  const text = mail.text?.trim()
  if (text) {
    return text
  }
  if (typeof mail.html === "string" && mail.html.trim()) {
    return stripHtml(mail.html)
  }
  return ""
}

const collectAttachments = (
  attachments: ParsedAttachment[] | undefined,
): { kept: SmtpInboundAttachment[]; omitted: number } => {
  const kept: SmtpInboundAttachment[] = []
  let omitted = 0
  for (const attachment of attachments ?? []) {
    const content = attachment.content
    const size = attachment.size ?? content?.byteLength ?? 0
    if (
      !(content && size > 0 && size <= MAX_ATTACHMENT_BYTES) ||
      kept.length >= MAX_ATTACHMENTS
    ) {
      if (content || size > 0) {
        omitted += 1
      }
      continue
    }
    kept.push({
      filename: attachment.filename?.trim() || "attachment",
      mimeType:
        attachment.contentType?.split(";")[0]?.trim() ||
        "application/octet-stream",
      contentBase64: content.toString("base64"),
    })
  }
  return { kept, omitted }
}

/**
 * `null` when the message is our own copy or has no sender — the caller still
 * advances the UID so one skipped message cannot stall the mailbox.
 */
export const toSmtpInboundPayload = (
  mail: ParsedInboundSource,
  ownAddresses: Set<string>,
  fallbackId: string,
): SmtpInboundPayload | null => {
  const from = mail.from?.value?.find((item) => item.address)
  const fromAddress = from?.address ? extractEmailAddress(from.address) : null
  if (!fromAddress || ownAddresses.has(fromAddress)) {
    return null
  }
  const subject = mail.subject?.replace(/\s+/g, " ").trim() || undefined
  const { kept, omitted } = collectAttachments(mail.attachments)
  const omittedNote =
    omitted > 0
      ? `\n\n(${omitted} attachment${omitted === 1 ? "" : "s"} not imported)`
      : ""
  const references = referenceList(mail.references)
  const inReplyTo = mail.inReplyTo?.trim()
    ? bracketMessageId(mail.inReplyTo)
    : undefined
  const messageId = mail.messageId?.trim()
    ? bracketMessageId(mail.messageId)
    : fallbackId
  return {
    messageId,
    fromAddress,
    ...(from?.name?.trim() ? { fromName: from.name.trim() } : {}),
    ...(subject ? { subject } : {}),
    text: `${visibleInboundText(subject, bodyText(mail))}${omittedNote}`,
    ...(inReplyTo ? { inReplyTo } : {}),
    ...(references.length > 0 ? { references } : {}),
    ...(kept.length > 0 ? { attachments: kept } : {}),
  }
}

export const parseRawMail = async (
  source: Buffer,
  ownAddresses: Set<string>,
  fallbackId: string,
): Promise<SmtpInboundPayload | null> => {
  const parsed = await simpleParser(source)
  return toSmtpInboundPayload(parsed, ownAddresses, fallbackId)
}
