import type { BaseConfig, Context } from "@chatbotx.io/sdk"
import { customAuthSchema } from "@chatbotx.io/sdk"
import { z } from "zod"

export const smtpProviders = z.enum([
  "google",
  "outlook",
  "yahoo",
  "sendgrid",
  "mailgun",
  "amazon_ses",
  "zoho",
  "postmark",
  "brevo",
  "other",
])
export type SmtpProvider = z.infer<typeof smtpProviders>

export type SmtpConfig = BaseConfig

export const smtpHostMap: Record<SmtpProvider, { host: string; port: number }> =
  {
    google: { host: "smtp.gmail.com", port: 587 },
    outlook: { host: "smtp.office365.com", port: 587 },
    yahoo: { host: "smtp.mail.yahoo.com", port: 587 },
    sendgrid: { host: "smtp.sendgrid.net", port: 587 },
    mailgun: { host: "smtp.mailgun.org", port: 587 },
    amazon_ses: { host: "email-smtp.us-east-1.amazonaws.com", port: 587 },
    zoho: { host: "smtp.zoho.com", port: 587 },
    postmark: { host: "smtp.postmarkapp.com", port: 587 },
    brevo: { host: "smtp-relay.brevo.com", port: 587 },
    other: { host: "", port: 0 },
  }

export const getEncryption = (port: number): "ssl" | "tls" =>
  port === 465 ? "ssl" : "tls"

/**
 * Mailbox providers can be polled over IMAP. Transactional relays
 * (SendGrid, Mailgun, SES, Postmark, Brevo) have no mailbox.
 */
export const MAILBOX_SMTP_PROVIDERS = [
  "google",
  "outlook",
  "yahoo",
  "zoho",
  "other",
] as const

export const canReceiveSmtp = (provider: string): boolean =>
  (MAILBOX_SMTP_PROVIDERS as readonly string[]).includes(provider)

export const imapHostMap: Partial<
  Record<SmtpProvider, { host: string; port: number }>
> = {
  google: { host: "imap.gmail.com", port: 993 },
  outlook: { host: "outlook.office365.com", port: 993 },
  yahoo: { host: "imap.mail.yahoo.com", port: 993 },
  zoho: { host: "imap.zoho.com", port: 993 },
}

export const smtpReceiveEnabled = (auth: {
  provider: string
  receiveEnabled?: boolean
}): boolean => canReceiveSmtp(auth.provider) && (auth.receiveEnabled ?? true)

export const resolveImapEndpoint = (auth: {
  provider: string
  host: string
  imapHost?: string
  imapPort?: number
}): { host: string; port: number } | null => {
  if (!canReceiveSmtp(auth.provider)) {
    return null
  }
  if (auth.provider !== "other") {
    return imapHostMap[auth.provider as SmtpProvider] ?? null
  }
  const host = auth.imapHost?.trim() || auth.host.trim()
  if (!host) {
    return null
  }
  return {
    host,
    port: auth.imapPort && auth.imapPort > 0 ? auth.imapPort : 993,
  }
}

const EMAIL_IN_TEXT = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i
const ANGLED_ADDRESS = /<([^<>]+)>/

export const extractEmailAddress = (value: string): string | null => {
  const angled = value.match(ANGLED_ADDRESS)
  const candidate = (angled?.[1] ?? value).trim()
  const found = candidate.match(EMAIL_IN_TEXT)
  return found?.[0]?.toLowerCase() ?? null
}

export const ownMailboxAddresses = (auth: {
  username: string
  fromAddress?: string
}): Set<string> => {
  const addresses = new Set<string>()
  const username = extractEmailAddress(auth.username)
  if (username) {
    addresses.add(username)
  }
  if (auth.fromAddress) {
    const from = extractEmailAddress(auth.fromAddress)
    if (from) {
      addresses.add(from)
    }
  }
  return addresses
}

export const smtpAuthSchema = customAuthSchema.extend({
  provider: smtpProviders,
  host: z.string().trim().min(1).max(255),
  port: z.number().int().positive().max(65_535),
  username: z.string().trim().min(1).max(255),
  password: z.string().trim().min(1).max(255),
  fromAddress: z.string().trim().min(1).max(255).optional(),
  receiveEnabled: z.boolean().optional(),
  imapHost: z.string().trim().min(1).max(255).optional(),
  imapPort: z.number().int().positive().max(65_535).optional(),
})
export type SmtpAuthValue = z.infer<typeof smtpAuthSchema>

export {
  emailReplyContext,
  emailReplyFromAttributes,
  type SmtpEmailReply,
} from "./thread"

export type SmtpOutboundMail = {
  from: string
  to: string
  subject: string
  html: string
  text?: string
  inReplyTo?: string
  references?: string
}

export type SmtpActions<IAuth extends SmtpAuthValue = SmtpAuthValue> = {
  sendMail: (props: SmtpOutboundMail & { ctx: Context<IAuth> }) => Promise<{
    messageId: string
  }>
}
