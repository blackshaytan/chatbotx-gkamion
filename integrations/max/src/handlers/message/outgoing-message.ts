import {
  type SendAudioStepSchema,
  type SendCarouselStepSchema,
  type SendFileStepSchema,
  type SendImageStepSchema,
  type SendMultipleImagesStepSchema,
  type SendQuickReplyStepSchema,
  type SendTextStepSchema,
  type SendVideoStepSchema,
  type StepType,
  stepTypes,
} from "@chatbotx.io/flow-config"
import type {
  ChannelSendFlowStepProps,
  MessageHandlers,
} from "@chatbotx.io/sdk"
import { sendMaxMessage } from "../../apis/messages"
import { toMaxMediaAttachment } from "../../apis/uploads"
import { mapToChannelError } from "../../lib/error-mapper"
import { logger } from "../../lib/logger"
import type { MaxAttachmentRequest, MaxAuthValue } from "../../schema"
import {
  expandText,
  fromFlowButton,
  fromTemplateButton,
  type MaxOutgoing,
  toKeyboard,
} from "./to-max-messages"

export const handledFlowStepTypes = [
  stepTypes.enum.sendText,
  stepTypes.enum.sendImage,
  stepTypes.enum.sendVideo,
  stepTypes.enum.sendMultipleImages,
  stepTypes.enum.sendAudio,
  stepTypes.enum.sendFile,
  stepTypes.enum.sendGif,
  stepTypes.enum.sendQuickReply,
  stepTypes.enum.sendCarousel,
] as const satisfies readonly StepType[]

/** MAX refuses a file mixed with image/video in one message — split it out. */
const separateFiles = (outgoing: MaxOutgoing): MaxOutgoing[] => {
  const media = outgoing.media ?? []
  const files = media.filter((item) => item.kind === "file")
  const visual = media.filter((item) => item.kind !== "file")
  if (files.length === 0 || visual.length === 0) {
    return [outgoing]
  }
  return [{ media: visual }, { ...outgoing, media: files }]
}

export const deliverMaxOutgoing = async (props: {
  token: string
  userId: string
  outgoing: MaxOutgoing
}): Promise<string[]> => {
  const ids: string[] = []
  for (const message of expandText(props.outgoing).flatMap(separateFiles)) {
    const attachments: MaxAttachmentRequest[] = []
    for (const item of message.media ?? []) {
      attachments.push(
        await toMaxMediaAttachment({ token: props.token, ...item }),
      )
    }
    const keyboard = toKeyboard(message.buttons ?? [])
    if (keyboard) {
      attachments.push(keyboard)
    }
    ids.push(
      await sendMaxMessage({
        token: props.token,
        userId: props.userId,
        body: {
          ...(message.text ? { text: message.text } : {}),
          ...(attachments.length > 0 ? { attachments } : {}),
        },
      }),
    )
  }
  return ids
}

const stepToOutgoing = (
  props: ChannelSendFlowStepProps<MaxAuthValue>,
): MaxOutgoing[] => {
  const { step, flowId, quickReplies } = props.data
  const replies = (quickReplies ?? []).map(fromTemplateButton)
  const flowButtons = (buttons: Parameters<typeof fromFlowButton>[1][]) => [
    ...buttons.map((button) => fromFlowButton(flowId, button)),
    ...replies,
  ]
  switch (step.stepType) {
    case stepTypes.enum.sendText: {
      const s = step as SendTextStepSchema
      return [{ text: s.text, buttons: flowButtons(s.buttons) }]
    }
    case stepTypes.enum.sendImage:
    case stepTypes.enum.sendGif: {
      const s = step as SendImageStepSchema
      return [
        {
          media: [{ kind: "image", url: s.url }],
          buttons: flowButtons(s.buttons ?? []),
        },
      ]
    }
    case stepTypes.enum.sendVideo: {
      const s = step as SendVideoStepSchema
      return [
        {
          media: [{ kind: "video", url: s.url }],
          buttons: flowButtons(s.buttons),
        },
      ]
    }
    case stepTypes.enum.sendAudio: {
      const s = step as SendAudioStepSchema
      return [
        {
          media: [{ kind: "audio", url: s.url }],
          buttons: flowButtons(s.buttons),
        },
      ]
    }
    case stepTypes.enum.sendFile: {
      const s = step as SendFileStepSchema
      return [
        {
          media: [{ kind: "file", url: s.url }],
          buttons: flowButtons(s.buttons),
        },
      ]
    }
    case stepTypes.enum.sendMultipleImages: {
      const s = step as SendMultipleImagesStepSchema
      return [
        {
          media: s.images.map((image) => ({
            kind: "image" as const,
            url: image.url,
          })),
          buttons: replies,
        },
      ]
    }
    case stepTypes.enum.sendQuickReply: {
      const s = step as SendQuickReplyStepSchema
      return [{ text: s.message, buttons: flowButtons(s.buttons) }]
    }
    case stepTypes.enum.sendCarousel: {
      const s = step as SendCarouselStepSchema
      return s.cards.map((card) => {
        const title = "title" in card ? card.title : undefined
        const subtitle = "subtitle" in card ? card.subtitle : undefined
        const imageUrl = "image" in card ? card.image?.url : undefined
        return {
          text: [title, subtitle].filter(Boolean).join("\n") || undefined,
          media: imageUrl ? [{ kind: "image" as const, url: imageUrl }] : [],
          buttons:
            "buttons" in card
              ? card.buttons.map((button) => fromFlowButton(flowId, button))
              : [],
        }
      })
    }
    default:
      throw new Error(`Unsupported MAX flow step: ${step.stepType}`)
  }
}

export const sendFlowStep: MessageHandlers<MaxAuthValue>["sendFlowStep"] =
  async (props) => {
    const userId = props.data.contact.sourceId
    try {
      const ids: string[] = []
      for (const outgoing of stepToOutgoing(props)) {
        ids.push(
          ...(await deliverMaxOutgoing({
            token: props.ctx.auth.secretText,
            userId,
            outgoing,
          })),
        )
      }
      return { messageIds: ids, sentCount: ids.length }
    } catch (error) {
      logger.error({ err: error }, "MAX sendFlowStep failed")
      throw mapToChannelError(error)
    }
  }

const ATTACHMENT_KIND = {
  image: "image",
  video: "video",
  audio: "audio",
} as const

export const sendMessage: MessageHandlers<MaxAuthValue>["sendMessage"] = async (
  props,
) => {
  const { contact, message, quickReplies } = props.data
  try {
    const ids = await deliverMaxOutgoing({
      token: props.ctx.auth.secretText,
      userId: contact.sourceId,
      outgoing: {
        text: message.text ?? undefined,
        media: (message.attachments ?? [])
          .filter((attachment) => attachment.url)
          .map((attachment) => ({
            kind:
              ATTACHMENT_KIND[
                attachment.fileType as keyof typeof ATTACHMENT_KIND
              ] ?? "file",
            url: attachment.url as string,
          })),
        buttons: (quickReplies ?? []).map(fromTemplateButton),
      },
    })
    return { messageIds: ids, sentCount: ids.length }
  } catch (error) {
    logger.error({ err: error }, "MAX sendMessage failed")
    throw mapToChannelError(error)
  }
}
