import {
  buildAttachmentProxyUrl,
  contactInboxService,
  conversationService,
  type ExternalAgentInputMessage,
  type ExternalAgentInputRole,
  externalAgentService,
  isFailedOriginPath,
  messageService,
} from "@chatbotx.io/business"
import type { MessageWithAttachments } from "@chatbotx.io/database/repositories"
import type {
  ContactInboxModel,
  ConversationModel,
} from "@chatbotx.io/database/types"
import { distributedLock } from "@chatbotx.io/redis"
import { ChatJobAction, chatQueue } from "@chatbotx.io/worker-config"
import { logger } from "../../lib/logger"

const LOCK_TIMEOUT_SECONDS = 60
const LOCK_RETRY_TIMEOUT_SECONDS = 10
const MESSAGE_FETCH_LIMIT = 30
const MESSAGE_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000
const FIRST_TURN_MESSAGE_LIMIT = 10
const HISTORY_MESSAGE_LIMIT = 10
const ATTACHMENT_LINK_TTL_MS = 24 * 60 * 60 * 1000
const RESUME_TRIGGER_GRACE_MS = 60_000
const JOB_ID_SEPARATOR = /:/g

export type ExternalAgentJobRef = {
  workspaceId: string
  conversationId: string
  contactInboxId: string
}

export type ExternalAgentConversationContext = {
  conversation: ConversationModel
  contactInbox: ContactInboxModel
}

export const withExternalAgentLock = async <T>(
  conversationId: string,
  fn: () => Promise<T>,
): Promise<T> =>
  await distributedLock.runExclusive({
    key: `externalAgent:${conversationId}`,
    timeoutInSeconds: LOCK_TIMEOUT_SECONDS,
    retryTimeoutInSeconds: LOCK_RETRY_TIMEOUT_SECONDS,
    fn,
  })

/** BullMQ rejects custom job ids that contain `:`. */
export const toJobIdPart = (value: string): string =>
  value.replace(JOB_ID_SEPARATOR, "-")

export const loadConversationContext = async (
  ref: ExternalAgentJobRef,
): Promise<ExternalAgentConversationContext | null> => {
  const conversation = await conversationService.findByUncached({
    where: { id: ref.conversationId, workspaceId: ref.workspaceId },
  })
  if (!conversation) {
    return null
  }
  const contactInbox = await contactInboxService.findByUncached({
    where: { id: ref.contactInboxId, contactId: conversation.contactId },
  })
  if (!contactInbox) {
    return null
  }
  return { conversation, contactInbox }
}

export const listRecentMessages = async (
  ref: ExternalAgentJobRef,
): Promise<MessageWithAttachments[]> =>
  await messageService.listLastMessagesWithAttachments({
    conversationId: ref.conversationId,
    workspaceId: ref.workspaceId,
    limit: MESSAGE_FETCH_LIMIT,
    sinceTime: new Date(Date.now() - MESSAGE_LOOKBACK_MS),
  })

const isContactMessage = (message: MessageWithAttachments): boolean =>
  message.messageType === "incoming" && message.senderType === "contact"

/**
 * Contact messages the agent has not seen yet, oldest first.
 *
 * With a cursor: contact messages created after it. A cursor without
 * `cursorMessageId` was just reset by a bot resume, which stamps `now` after
 * the message that triggered the resume was saved, so that trigger counts too.
 * Without a cursor (first turn): contact messages after the last outgoing one.
 */
export const selectNewMessages = (input: {
  messages: MessageWithAttachments[]
  cursorAt: Date | null
  cursorMessageId: string | null
  triggerMessageId?: string
}): MessageWithAttachments[] => {
  const { messages, cursorAt, cursorMessageId, triggerMessageId } = input
  if (!cursorAt) {
    const lastOutgoingIndex = messages.findLastIndex(
      (message) => message.messageType === "outgoing",
    )
    return messages
      .slice(lastOutgoingIndex + 1)
      .filter(isContactMessage)
      .slice(-FIRST_TURN_MESSAGE_LIMIT)
  }

  const cursorTime = cursorAt.getTime()
  const isResumeTrigger = (message: MessageWithAttachments): boolean =>
    cursorMessageId === null &&
    message.id === triggerMessageId &&
    message.createdAt.getTime() >= cursorTime - RESUME_TRIGGER_GRACE_MS

  return messages.filter(
    (message) =>
      isContactMessage(message) &&
      message.id !== cursorMessageId &&
      (message.createdAt.getTime() > cursorTime || isResumeTrigger(message)),
  )
}

/** The messages right before the first new one, as background for the agent. */
export const selectHistory = (
  messages: MessageWithAttachments[],
  newMessages: MessageWithAttachments[],
): MessageWithAttachments[] => {
  const [firstNew] = newMessages
  const firstNewIndex = firstNew ? messages.indexOf(firstNew) : -1
  if (firstNewIndex <= 0) {
    return []
  }
  return messages.slice(
    Math.max(0, firstNewIndex - HISTORY_MESSAGE_LIMIT),
    firstNewIndex,
  )
}

const toInputRole = (
  senderType: MessageWithAttachments["senderType"],
): ExternalAgentInputRole => {
  if (senderType === "contact") {
    return "contact"
  }
  if (senderType === "user" || senderType === "api") {
    return "user"
  }
  return "bot"
}

export const toInputMessages = async (
  workspaceId: string,
  messages: MessageWithAttachments[],
): Promise<ExternalAgentInputMessage[]> =>
  await Promise.all(
    messages.map(async (message) => ({
      role: toInputRole(message.senderType),
      text: message.text,
      attachmentUrls: await Promise.all(
        message.attachments
          .filter((attachment) => !isFailedOriginPath(attachment.originPath))
          .map((attachment) =>
            buildAttachmentProxyUrl(
              {
                workspaceId,
                attachmentId: attachment.id,
                messageCreatedAt: message.createdAt,
              },
              ATTACHMENT_LINK_TTL_MS,
            ),
          ),
      ),
    })),
  )

/** `jobId` makes a re-run of the same step reuse the queued send instead of sending twice. */
export const sendClientText = async (input: {
  context: ExternalAgentConversationContext
  text: string
  jobId?: string
}): Promise<void> => {
  await chatQueue.add(
    ChatJobAction.sendChatMessage,
    {
      type: ChatJobAction.sendChatMessage,
      data: {
        conversation: input.context.conversation,
        contactInbox: input.context.contactInbox,
        text: input.text,
      },
    },
    input.jobId ? { jobId: toJobIdPart(input.jobId) } : undefined,
  )
}

export const handOverToHuman = async (input: {
  ref: ExternalAgentJobRef
  context: ExternalAgentConversationContext
  event: "unavailable" | "timeout"
  error: unknown
}): Promise<void> => {
  await externalAgentService.failToHuman({
    workspaceId: input.ref.workspaceId,
    conversationId: input.ref.conversationId,
    contactInboxId: input.ref.contactInboxId,
    event: input.event,
    error: input.error,
    sendText: (text) => sendClientText({ context: input.context, text }),
  })
}

export const stopRunQuietly = async (
  client: { stop: (runId: string) => Promise<void> },
  runId: string,
): Promise<void> => {
  try {
    await client.stop(runId)
  } catch (err) {
    logger.warn({ err, runId }, "External agent: unable to stop the run")
  }
}
