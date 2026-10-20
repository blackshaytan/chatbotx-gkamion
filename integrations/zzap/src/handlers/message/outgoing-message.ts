import {
  flowStepToTextOutgoing,
  type MessageHandlers,
  messageToTextOutgoing,
  renderTextOutgoing,
  type TextChannelOutgoing,
  textHandledFlowStepTypes,
} from "@chatbotx.io/sdk"
import { sendZzapMessage } from "../../apis/messages"
import { ZZAP_TEXT_LIMIT } from "../../constants"
import { mapToChannelError } from "../../lib/error-mapper"
import { logger } from "../../lib/logger"
import type { ZzapAuthValue } from "../../schema"

export const handledFlowStepTypes = textHandledFlowStepTypes

const deliver = async (
  auth: ZzapAuthValue,
  userKey: string,
  outgoing: TextChannelOutgoing,
): Promise<string[]> => {
  const ids: string[] = []
  for (const text of renderTextOutgoing(outgoing, ZZAP_TEXT_LIMIT)) {
    const { messageId } = await sendZzapMessage(auth, { userKey, text })
    ids.push(messageId)
  }
  return ids
}

export const sendFlowStep: MessageHandlers<ZzapAuthValue>["sendFlowStep"] =
  async (props) => {
    try {
      const ids = await deliver(
        props.ctx.auth,
        props.data.contact.sourceId,
        flowStepToTextOutgoing(props.data.step, props.data.quickReplies),
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
      const ids = await deliver(
        props.ctx.auth,
        contact.sourceId,
        messageToTextOutgoing(message, quickReplies),
      )
      return { messageIds: ids, sentCount: ids.length }
    } catch (error) {
      logger.error({ err: error }, "ZZAP sendMessage failed")
      throw mapToChannelError(error)
    }
  }
