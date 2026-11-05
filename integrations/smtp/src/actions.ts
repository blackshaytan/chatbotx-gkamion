import type { Context } from "@chatbotx.io/sdk"
import { createId } from "@chatbotx.io/utils"
import nodemailer from "nodemailer"
import type { SmtpAuthValue, SmtpOutboundMail } from "./schema"

export const sendMail = async (
  props: SmtpOutboundMail & { ctx: Context<SmtpAuthValue> },
): Promise<{ messageId: string }> => {
  const { ctx, ...mail } = props
  const { auth } = ctx

  const transporter = nodemailer.createTransport({
    host: auth.host,
    port: auth.port,
    secure: auth.port === 465,
    auth: { user: auth.username, pass: auth.password },
  })

  const info = await transporter.sendMail({
    from: mail.from,
    to: mail.to,
    subject: mail.subject,
    html: mail.html,
    ...(mail.text ? { text: mail.text } : {}),
    ...(mail.inReplyTo ? { inReplyTo: mail.inReplyTo } : {}),
    ...(mail.references ? { references: mail.references } : {}),
  })
  return {
    messageId: info.messageId || `<${createId()}@chatbotx.local>`,
  }
}
