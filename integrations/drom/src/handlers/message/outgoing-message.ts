import {
  flowStepToTextOutgoing,
  type MessageHandlers,
  messageToTextOutgoing,
  renderTextOutgoing,
  type TextChannelMedia,
  type TextChannelOutgoing,
  textHandledFlowStepTypes,
} from "@chatbotx.io/sdk"
import { sendDromMessage } from "../../apis/dialog"
import { uploadDromImage } from "../../apis/media"
import {
  DROM_MAX_IMAGE_BYTES,
  DROM_MAX_IMAGES_PER_MESSAGE,
  DROM_TEXT_LIMIT,
} from "../../constants"
import { DromAPIException, DromSessionExpiredException } from "../../exception"
import { mapToChannelError } from "../../lib/error-mapper"
import { makeDromOutgoingId } from "../../lib/ids"
import { logger } from "../../lib/logger"
import type { DromAuthValue } from "../../schema"

export const handledFlowStepTypes = textHandledFlowStepTypes

const filenameOf = (media: TextChannelMedia): string => {
  if (media.filename) {
    return media.filename
  }
  try {
    return new URL(media.url).pathname.split("/").pop() || "photo"
  } catch {
    return "photo"
  }
}

/** Media comes from the platform's own storage, never from buyer input. */
const uploadMedia = async (
  auth: DromAuthValue,
  media: TextChannelMedia,
): Promise<string> => {
  const response = await fetch(media.url)
  if (!response.ok) {
    throw new DromAPIException(
      `Failed to download outgoing media (status ${response.status})`,
      502,
    )
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > DROM_MAX_IMAGE_BYTES) {
    throw new DromAPIException("Outgoing media is too large", 413)
  }
  const mime =
    response.headers.get("content-type")?.split(";")[0]?.trim() ||
    "application/octet-stream"
  const { imageId } = await uploadDromImage(auth, {
    name: filenameOf(media),
    mime,
    bytes,
  })
  return imageId
}

/** Up to 8 photos are attached; the rest, and failed uploads, go out as links. */
const uploadAll = async (
  auth: DromAuthValue,
  media: TextChannelMedia[],
): Promise<{ imageIds: string[]; asLinks: TextChannelMedia[] }> => {
  const imageIds: string[] = []
  const asLinks: TextChannelMedia[] = []
  for (const item of media) {
    if (imageIds.length >= DROM_MAX_IMAGES_PER_MESSAGE) {
      asLinks.push(item)
      continue
    }
    try {
      imageIds.push(await uploadMedia(auth, item))
    } catch (err) {
      if (err instanceof DromSessionExpiredException) {
        throw err
      }
      logger.warn({ err }, "drom send: media upload failed, sending a link")
      asLinks.push(item)
    }
  }
  return { imageIds, asLinks }
}

const deliver = async (
  auth: DromAuthValue,
  dialogId: string,
  outgoing: TextChannelOutgoing,
): Promise<string[]> => {
  const { imageIds, asLinks } = await uploadAll(auth, outgoing.media ?? [])
  const texts = renderTextOutgoing(
    { text: outgoing.text, media: asLinks, buttons: outgoing.buttons },
    DROM_TEXT_LIMIT,
  )
  const [first = "", ...rest] = texts
  if (!(first || imageIds.length)) {
    return []
  }
  const ids: string[] = []
  const sent = await sendDromMessage(auth, { dialogId, text: first, imageIds })
  ids.push(makeDromOutgoingId(dialogId, sent.latestMessageId))
  for (const text of rest) {
    const next = await sendDromMessage(auth, { dialogId, text })
    ids.push(makeDromOutgoingId(dialogId, next.latestMessageId))
  }
  return ids
}

export const sendFlowStep: MessageHandlers<DromAuthValue>["sendFlowStep"] =
  async (props) => {
    try {
      const ids = await deliver(
        props.ctx.auth,
        props.data.contact.sourceId,
        flowStepToTextOutgoing(props.data.step, props.data.quickReplies),
      )
      return { messageIds: ids, sentCount: ids.length }
    } catch (error) {
      logger.error({ err: error }, "DROM sendFlowStep failed")
      throw mapToChannelError(error)
    }
  }

export const sendMessage: MessageHandlers<DromAuthValue>["sendMessage"] =
  async (props) => {
    const { contact, message, quickReplies } = props.data
    try {
      const ids = await deliver(
        props.ctx.auth,
        contact.sourceId,
        messageToTextOutgoing(message, quickReplies),
      )
      return { messageIds: ids, sentCount: ids.length }
    } catch (error) {
      logger.error({ err: error }, "DROM sendMessage failed")
      throw mapToChannelError(error)
    }
  }
