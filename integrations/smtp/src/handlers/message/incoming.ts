import {
  ChannelError,
  ChannelErrorCategory,
  type Context,
  contentTypes,
  getMediaStoragePrefix,
  guessFileTypeFromMimeType,
  type IncomingAttachment,
  type IncomingContact,
  messageTypes,
  type ReceivedMessageResult,
} from "@chatbotx.io/sdk"
import { createId } from "@chatbotx.io/utils"
import { z } from "zod"
import type { SmtpInboundPayload } from "../../inbound-mail"
import { logger } from "../../lib/logger"
import type { SmtpAuthValue } from "../../schema"
import { splitDisplayName } from "../../thread"

const inboundSchema = z.object({
  messageId: z.string().min(1),
  fromAddress: z.string().min(1),
  fromName: z.string().optional(),
  subject: z.string().optional(),
  text: z.string(),
  inReplyTo: z.string().optional(),
  references: z.array(z.string()).optional(),
  attachments: z
    .array(
      z.object({
        filename: z.string(),
        mimeType: z.string(),
        contentBase64: z.string(),
      }),
    )
    .optional(),
})

const storeAttachment = async (
  ctx: Context<SmtpAuthValue>,
  attachment: NonNullable<SmtpInboundPayload["attachments"]>[number],
): Promise<IncomingAttachment | null> => {
  if (!ctx.uploader) {
    return null
  }
  const bytes = Buffer.from(attachment.contentBase64, "base64")
  const originPath = `${getMediaStoragePrefix(ctx)}/${createId()}`
  await ctx.uploader.putObject(originPath, bytes, {
    ACL: "public-read",
    ContentType: attachment.mimeType,
  })
  return {
    sourceId: createId(),
    originPath,
    fileType: guessFileTypeFromMimeType(attachment.mimeType),
    mimeType: attachment.mimeType,
    size: bytes.byteLength,
    name: attachment.filename,
  }
}

export const receiveMessage = async ({
  ctx,
  data,
}: {
  ctx: Context<SmtpAuthValue>
  data: {
    integrationType: string
    integrationIdentifier: string
    payload: unknown
  }
}): Promise<ReceivedMessageResult> => {
  const parsed = inboundSchema.safeParse(data.payload)
  if (!parsed.success) {
    throw new ChannelError(
      "SMTP poll event is malformed",
      ChannelErrorCategory.PAYLOAD_INVALID,
    )
  }
  const mail = parsed.data
  const attachments: IncomingAttachment[] = []
  for (const attachment of mail.attachments ?? []) {
    try {
      const stored = await storeAttachment(ctx, attachment)
      if (stored) {
        attachments.push(stored)
      }
    } catch (err) {
      logger.warn(
        { err, filename: attachment.filename },
        "smtp inbound attachment could not be stored",
      )
    }
  }
  const name = splitDisplayName(mail.fromName, mail.fromAddress)
  const contact: IncomingContact = {
    sourceId: mail.fromAddress,
    email: mail.fromAddress,
    firstName: name.firstName,
    ...(name.lastName ? { lastName: name.lastName } : {}),
  }
  return {
    message: {
      sourceId: mail.messageId,
      messageType: messageTypes.enum.incoming,
      contentType: contentTypes.enum.text,
      text: mail.text,
      attachments,
      contentAttributes: {
        email: {
          ...(mail.subject ? { subject: mail.subject } : {}),
          messageId: mail.messageId,
          ...(mail.references ? { references: mail.references } : {}),
        },
      },
    },
    contact,
    postbackAction: null,
    quickReplyAction: null,
    ref: null,
  }
}
