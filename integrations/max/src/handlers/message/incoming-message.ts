import {
  type Context,
  contentTypes,
  getMediaStoragePrefix,
  guessFileTypeFromMimeType,
  type IncomingAttachment,
  messageTypes,
  type ReceivedMessageResult,
} from "@chatbotx.io/sdk"
import { createId } from "@chatbotx.io/utils"
import { MaxException } from "../../exception"
import type { MaxAuthValue } from "../../schema"
import { type MaxInboundMedia, parseMaxUpdate } from "../parse-update"

const FALLBACK_MIME: Record<MaxInboundMedia["kind"], string> = {
  image: "image/jpeg",
  video: "video/mp4",
  audio: "audio/ogg",
  file: "application/octet-stream",
}

const storeMedia = async (
  ctx: Context<MaxAuthValue>,
  media: MaxInboundMedia,
): Promise<IncomingAttachment> => {
  const response = await fetch(media.url)
  if (!response.ok) {
    throw new MaxException(
      `Failed to download MAX attachment (status ${response.status})`,
    )
  }
  const mimeType =
    response.headers.get("content-type")?.split(";")[0] ??
    FALLBACK_MIME[media.kind]
  const bytes = await response.arrayBuffer()
  const originPath = `${getMediaStoragePrefix(ctx)}/${createId()}`
  await ctx.uploader?.putObject(originPath, Buffer.from(bytes), {
    ACL: "public-read",
    ContentType: mimeType,
  })
  return {
    sourceId: createId(),
    originPath,
    fileType: guessFileTypeFromMimeType(mimeType),
    mimeType,
    size: bytes.byteLength,
    ...(media.filename ? { name: media.filename } : {}),
  }
}

export const receiveMessage = async ({
  ctx,
  data,
}: {
  ctx: Context<MaxAuthValue>
  data: {
    integrationType: string
    integrationIdentifier: string
    payload: unknown
  }
}): Promise<ReceivedMessageResult> => {
  const inbound = parseMaxUpdate(data.payload)
  if (!inbound) {
    throw new MaxException("MAX update is not a user message")
  }
  const base = {
    sourceId: inbound.sourceId,
    messageType: messageTypes.enum.incoming,
    contentType: contentTypes.enum.text,
  }
  switch (inbound.kind) {
    case "callback":
      return {
        message: { ...base, text: inbound.payload, attachments: [] },
        contact: inbound.contact,
        postbackAction: inbound.payload,
        quickReplyAction: null,
        ref: null,
      }
    case "started":
      return {
        message: {
          ...base,
          text: inbound.ref ? `/start ${inbound.ref}` : "/start",
          attachments: [],
        },
        contact: inbound.contact,
        postbackAction: null,
        quickReplyAction: null,
        ref: inbound.ref,
      }
    default: {
      const attachments: IncomingAttachment[] = []
      for (const media of inbound.media) {
        attachments.push(await storeMedia(ctx, media))
      }
      return {
        message: { ...base, text: inbound.text, attachments },
        contact: inbound.contact,
        postbackAction: null,
        quickReplyAction: null,
        ref: null,
      }
    }
  }
}
