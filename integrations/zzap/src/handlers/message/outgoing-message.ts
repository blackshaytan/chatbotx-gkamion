import {
  type SendFileStepSchema,
  type SendImageStepSchema,
  type SendQuickReplyStepSchema,
  type SendTextStepSchema,
  type StepType,
  stepTypes,
} from "@chatbotx.io/flow-config"
import type {
  ChannelSendFlowStepProps,
  MessageHandlers,
} from "@chatbotx.io/sdk"
import { sendZzapMessage } from "../../apis/messages"
import { mapToChannelError } from "../../lib/error-mapper"
import { logger } from "../../lib/logger"
import type { ZzapAuthValue } from "../../schema"
import {
  fromFlowButton,
  fromTemplateButton,
  toZzapTexts,
  type ZzapOutgoing,
} from "./to-zzap-text"

export const handledFlowStepTypes = [
  stepTypes.enum.sendText,
  stepTypes.enum.sendImage,
  stepTypes.enum.sendFile,
  stepTypes.enum.sendQuickReply,
] as const satisfies readonly StepType[]

const deliver = async (
  auth: ZzapAuthValue,
  userKey: string,
  outgoing: ZzapOutgoing,
): Promise<string[]> => {
  const ids: string[] = []
  for (const text of toZzapTexts(outgoing)) {
    const { messageId } = await sendZzapMessage(auth, { userKey, text })
    ids.push(messageId)
  }
  return ids
}

const stepToOutgoing = (
  props: ChannelSendFlowStepProps<ZzapAuthValue>,
): ZzapOutgoing => {
  const { step, quickReplies } = props.data
  const replies = (quickReplies ?? []).map(fromTemplateButton)
  const withReplies = (buttons: Parameters<typeof fromFlowButton>[0][]) => [
    ...buttons.map(fromFlowButton),
    ...replies,
  ]
  switch (step.stepType) {
    case stepTypes.enum.sendText: {
      const s = step as SendTextStepSchema
      return { text: s.text, buttons: withReplies(s.buttons) }
    }
    case stepTypes.enum.sendImage: {
      const s = step as SendImageStepSchema
      return { media: [{ url: s.url }], buttons: withReplies(s.buttons ?? []) }
    }
    case stepTypes.enum.sendFile: {
      const s = step as SendFileStepSchema
      return { media: [{ url: s.url }], buttons: withReplies(s.buttons) }
    }
    case stepTypes.enum.sendQuickReply: {
      const s = step as SendQuickReplyStepSchema
      return { text: s.message, buttons: withReplies(s.buttons) }
    }
    default:
      throw new Error(`Unsupported ZZAP flow step: ${step.stepType}`)
  }
}

export const sendFlowStep: MessageHandlers<ZzapAuthValue>["sendFlowStep"] =
  async (props) => {
    try {
      const ids = await deliver(
        props.ctx.auth,
        props.data.contact.sourceId,
        stepToOutgoing(props),
      )
      return { messageIds: ids, sentCount: ids.length }
    } catch (error) {
      logger.error({ err: error }, "ZZAP sendFlowStep failed")
      throw mapToChannelError(error)
    }
  }

export const sendMessage: MessageHandlers<ZzapAuthValue>["sendMessage"] =
  async (props) => {
    const { contact, message, quickReplies } = props.data
    try {
      const ids = await deliver(props.ctx.auth, contact.sourceId, {
        text: message.text ?? undefined,
        media: (message.attachments ?? [])
          .filter((attachment) => attachment.url)
          .map((attachment) => ({
            url: attachment.url as string,
            ...(attachment.name ? { filename: attachment.name } : {}),
          })),
        buttons: (quickReplies ?? []).map(fromTemplateButton),
      })
      return { messageIds: ids, sentCount: ids.length }
    } catch (error) {
      logger.error({ err: error }, "ZZAP sendMessage failed")
      throw mapToChannelError(error)
    }
  }
