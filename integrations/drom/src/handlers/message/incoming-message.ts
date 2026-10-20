import {
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
import { downloadDromImage } from "../../apis/media"
import { DromException, DromSessionExpiredException } from "../../exception"
import { logger } from "../../lib/logger"
import type { DromImage } from "../../parse"
import type { DromAuthValue } from "../../schema"
import { type DromInboundEvent, parseDromEvent } from "../event"

const NUMERIC = /^\d+$/

const storeImage = async (
  ctx: Context<DromAuthValue>,
  image: DromImage,
): Promise<IncomingAttachment> => {
  const { bytes, mime, filename } = await downloadDromImage(
    ctx.auth,
    image.origUrl,
  )
  const originPath = `${getMediaStoragePrefix(ctx)}/${createId()}`
  await ctx.uploader?.putObject(originPath, Buffer.from(bytes), {
    ACL: "public-read",
    ContentType: mime,
  })
  return {
    sourceId: createId(),
    originPath,
    fileType: guessFileTypeFromMimeType(mime),
    mimeType: mime,
    size: bytes.byteLength,
    name: filename,
  }
}

/** Photos that cannot be stored stay reachable as links in the text. */
const storeImages = async (
  ctx: Context<DromAuthValue>,
  images: DromImage[],
): Promise<{ attachments: IncomingAttachment[]; links: string[] }> => {
  const attachments: IncomingAttachment[] = []
  const links: string[] = []
  for (const image of images) {
    try {
      attachments.push(await storeImage(ctx, image))
    } catch (err) {
      if (err instanceof DromSessionExpiredException) {
        throw err
      }
      logger.warn({ err }, "drom receive: chat photo not stored")
      links.push(`📎 ${image.origUrl}`)
    }
  }
  return { attachments, links }
}

const toContact = (event: DromInboundEvent): IncomingContact => {
  const login = NUMERIC.test(event.interlocutor) ? "" : event.interlocutor
  return {
    sourceId: event.dialogId,
    firstName: event.deal?.buyerName || event.interlocutor || event.dialogId,
    ...(login ? { sourceUsername: login } : {}),
    ...(event.deal?.phone ? { phoneNumber: event.deal.phone } : {}),
    ...(event.deal?.email ? { email: event.deal.email } : {}),
  }
}

export const receiveMessage = async ({
  ctx,
  data,
}: {
  ctx: Context<DromAuthValue>
  data: {
    integrationType: string
    integrationIdentifier: string
    payload: unknown
  }
}): Promise<ReceivedMessageResult> => {
  const event = parseDromEvent(data.payload)
  if (!event) {
    throw new DromException("DROM poll event is malformed")
  }
  const { attachments, links } = await storeImages(ctx, event.images)
  return {
    message: {
      sourceId: event.sourceId,
      messageType: messageTypes.enum.incoming,
      contentType: contentTypes.enum.text,
      text: [event.text, ...links].join("\n"),
      attachments,
      contentAttributes: {
        dromContext: {
          dialogId: event.dialogId,
          listing: event.listing,
          deal: event.deal,
        },
      },
    },
    contact: toContact(event),
    postbackAction: null,
    quickReplyAction: null,
    ref: null,
  }
}
