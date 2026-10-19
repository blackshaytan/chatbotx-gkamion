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
import { ZzapException } from "../../exception"
import {
  isAllowedZzapFileUrl,
  parseZzapMedia,
  type ZzapMedia,
} from "../../lib/media"
import type { ZzapAuthValue } from "../../schema"
import { parseZzapEvent, type ZzapInboundEvent } from "../event"

const FALLBACK_MIME: Record<ZzapMedia["kind"], string> = {
  image: "image/jpeg",
  file: "application/octet-stream",
}

const storeMedia = async (
  ctx: Context<ZzapAuthValue>,
  media: ZzapMedia,
): Promise<IncomingAttachment> => {
  const response = await fetch(media.url)
  if (!response.ok) {
    throw new ZzapException(
      `Failed to download ZZAP attachment (status ${response.status})`,
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
    name: media.filename,
  }
}

const toContact = (event: ZzapInboundEvent): IncomingContact => {
  const name = event.buyer?.name || event.userName
  return {
    sourceId: event.userKey,
    ...(name ? { firstName: name } : {}),
    ...(event.buyer?.phone ? { phoneNumber: event.buyer.phone } : {}),
    ...(event.buyer?.email ? { email: event.buyer.email } : {}),
  }
}

export const receiveMessage = async ({
  ctx,
  data,
}: {
  ctx: Context<ZzapAuthValue>
  data: {
    integrationType: string
    integrationIdentifier: string
    payload: unknown
  }
}): Promise<ReceivedMessageResult> => {
  const event = parseZzapEvent(data.payload)
  if (!event) {
    throw new ZzapException("ZZAP poll event is malformed")
  }
  const { text, media } = parseZzapMedia(event.text)
  const attachments: IncomingAttachment[] = []
  let body = text
  if (media && isAllowedZzapFileUrl(media.url)) {
    attachments.push(await storeMedia(ctx, media))
  } else if (media) {
    body = [text, `📎 ${media.filename}\n${media.url}`]
      .filter(Boolean)
      .join("\n")
  }
  return {
    message: {
      sourceId: event.sourceId,
      messageType: messageTypes.enum.incoming,
      contentType: contentTypes.enum.text,
      text: body,
      attachments,
    },
    contact: toContact(event),
    postbackAction: null,
    quickReplyAction: null,
    ref: null,
  }
}
