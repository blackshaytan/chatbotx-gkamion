import {
  ChannelError,
  ChannelErrorCategory,
  flowStepToTextOutgoing,
  type MessageHandlers,
  messageToTextOutgoing,
  renderTextOutgoing,
} from "@chatbotx.io/sdk"
import { sendMail } from "../../actions"
import { logger } from "../../lib/logger"
import { extractEmailAddress, type SmtpAuthValue } from "../../schema"
import {
  emailReplyFromAttributes,
  fallbackSubjectFromText,
  readEmailReply,
  replySubject,
  type SmtpEmailReply,
  textToHtml,
} from "../../thread"

const EMAIL_BODY_LIMIT = 200_000

const readFromAddress = (props: {
  auth: SmtpAuthValue
  integrationDetail?: unknown
}): string => {
  const detail = props.integrationDetail
  const stored =
    detail && typeof detail === "object"
      ? (detail as { fromAddress?: unknown }).fromAddress
      : undefined
  if (typeof stored === "string" && stored.trim()) {
    return stored.trim()
  }
  if (props.auth.fromAddress?.trim()) {
    return props.auth.fromAddress.trim()
  }
  if (props.auth.username.includes("@")) {
    return props.auth.username
  }
  throw new ChannelError(
    "SMTP integration has no from address",
    ChannelErrorCategory.PAYLOAD_INVALID,
  )
}

const deliver = async (props: {
  auth: SmtpAuthValue
  integrationDetail?: unknown
  ctx: Parameters<MessageHandlers<SmtpAuthValue>["sendMessage"]>[0]["ctx"]
  toSourceId: string
  text: string
  reply?: SmtpEmailReply
}): Promise<{ messageIds: string[]; sentCount: number }> => {
  const to = extractEmailAddress(props.toSourceId)
  if (!to) {
    throw new ChannelError(
      "SMTP contact has no email address",
      ChannelErrorCategory.INVALID_RECIPIENT,
    )
  }
  const chunks = renderTextOutgoing({ text: props.text }, EMAIL_BODY_LIMIT)
  const body = chunks.join("\n\n") || "(empty)"
  const subject = replySubject(
    props.reply?.subject,
    fallbackSubjectFromText(body),
  )
  try {
    const sent = await sendMail({
      ctx: props.ctx,
      from: readFromAddress(props),
      to,
      subject,
      text: body,
      html: textToHtml(body),
      ...(props.reply?.inReplyTo ? { inReplyTo: props.reply.inReplyTo } : {}),
      ...(props.reply?.references
        ? { references: props.reply.references }
        : {}),
    })
    return { messageIds: [sent.messageId], sentCount: 1 }
  } catch (error) {
    logger.error({ err: error }, "SMTP send failed")
    if (error instanceof ChannelError) {
      throw error
    }
    const code =
      error && typeof error === "object" && "code" in error
        ? (error as { code?: unknown }).code
        : undefined
    throw new ChannelError(
      error instanceof Error ? error.message : "SMTP send failed",
      code === "EAUTH"
        ? ChannelErrorCategory.AUTH_FAILED
        : ChannelErrorCategory.NETWORK_ERROR,
    )
  }
}

export const sendMessage: MessageHandlers<SmtpAuthValue>["sendMessage"] =
  async (props) => {
    const outgoing = messageToTextOutgoing(
      props.data.message,
      props.data.quickReplies,
    )
    const text = renderTextOutgoing(outgoing, EMAIL_BODY_LIMIT).join("\n\n")
    return await deliver({
      auth: props.ctx.auth,
      integrationDetail: props.ctx.integrationDetail,
      ctx: props.ctx,
      toSourceId: props.data.contact.sourceId,
      text,
      reply: emailReplyFromAttributes(props.data.message.contentAttributes),
    })
  }

export const sendFlowStep: MessageHandlers<SmtpAuthValue>["sendFlowStep"] =
  async (props) => {
    let text: string
    try {
      text = renderTextOutgoing(
        flowStepToTextOutgoing(props.data.step, props.data.quickReplies),
        EMAIL_BODY_LIMIT,
      ).join("\n\n")
    } catch (error) {
      throw new ChannelError(
        error instanceof Error ? error.message : "Unsupported email step",
        ChannelErrorCategory.PAYLOAD_INVALID,
      )
    }
    const reply = readEmailReply(
      (props.data as { emailReply?: unknown }).emailReply,
    )
    return await deliver({
      auth: props.ctx.auth,
      integrationDetail: props.ctx.integrationDetail,
      ctx: props.ctx,
      toSourceId: props.data.contact.sourceId,
      text,
      reply,
    })
  }
