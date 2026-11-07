import {
  classifyChannelFailure,
  connectOrderNotificationEmail,
  contactInboxService,
  conversationService,
  listSmtpInboxIds,
  planCascadeCandidates,
  resolveWorkspaceFreezeReasonById,
  runNotificationCascade,
} from "@chatbotx.io/business"
import { messageTypes, senderTypes } from "@chatbotx.io/database/partials"
import { createMessageRepository } from "@chatbotx.io/database/repositories"
import type { ContactInboxModel } from "@chatbotx.io/database/types"
import { ChannelError } from "@chatbotx.io/sdk"
import type { IntegrationJobDeliverClientNotification } from "@chatbotx.io/worker-config"
import { sendMessageToChannel } from "../../chat/handlers/send-message"
import { logger } from "../../lib/logger"

const TIMEOUT_PATTERN = /timeout|timed out|socket hang up/i

const isTimeout = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false
  }
  const code = "code" in error ? String(error.code) : ""
  return (
    error.name === "AbortError" ||
    error.name === "TimeoutError" ||
    code === "ETIMEDOUT" ||
    code === "ECONNRESET" ||
    code === "ECONNABORTED" ||
    TIMEOUT_PATTERN.test(error.message)
  )
}

const failureOutcome = (error: unknown): "rejected" | "unclear" =>
  classifyChannelFailure({
    category: error instanceof ChannelError ? error.category : null,
    timedOut: isTimeout(error),
  })

const resolveInbox = async (input: {
  candidateId: string | null
  inboxes: ContactInboxModel[]
  smtpInboxId?: string
  email?: string
  workspaceId: string
  contactId: string
}): Promise<ContactInboxModel | null> => {
  if (input.candidateId) {
    return (
      input.inboxes.find((inbox) => inbox.id === input.candidateId) ??
      (await contactInboxService.findBy({
        where: { id: input.candidateId },
      })) ??
      null
    )
  }
  if (!(input.smtpInboxId && input.email)) {
    return null
  }
  return await connectOrderNotificationEmail({
    workspaceId: input.workspaceId,
    contactId: input.contactId,
    inboxId: input.smtpInboxId,
    email: input.email,
  })
}

export const handleDeliverClientNotification = async (
  data: IntegrationJobDeliverClientNotification["data"],
): Promise<void> => {
  const { freezeReason } = await resolveWorkspaceFreezeReasonById(
    data.workspaceId,
  )
  if (freezeReason) {
    logger.info(
      {
        eventId: data.eventId,
        contactId: data.contactId,
        externalOrderId: data.externalOrderId,
        reason: freezeReason,
      },
      "Client notification skipped",
    )
    return
  }

  const conversation = await conversationService.findOrCreate({
    workspaceId: data.workspaceId,
    contactId: data.contactId,
    sourceId: null,
  })
  const inboxes = await contactInboxService.listByContactId({
    workspaceId: data.workspaceId,
    contactId: data.contactId,
  })
  const smtpInboxIds = await listSmtpInboxIds(data.workspaceId)
  const candidates = planCascadeCandidates({
    inboxes,
    messengerText: data.messengerText,
    emailText: data.emailText,
    email: data.email,
    smtpInboxCount: smtpInboxIds.length,
  })
  const result = await runNotificationCascade({
    candidates,
    attempts: [],
    messengerText: data.messengerText,
    emailText: data.emailText,
    send: async (candidate) => {
      const contactInbox = await resolveInbox({
        candidateId: candidate.contactInboxId,
        inboxes,
        smtpInboxId: smtpInboxIds[0],
        email: data.email,
        workspaceId: data.workspaceId,
        contactId: data.contactId,
      })
      if (!contactInbox) {
        return { outcome: "rejected", reason: "noDialog" }
      }
      const text =
        candidate.channel === "smtp" ? data.emailText : data.messengerText
      const subject = data.emailSubject.trim() || "Notification"
      const repository = await createMessageRepository()
      const createdAt = new Date()
      let messageId: string | null = null
      try {
        const message = await repository.create({
          workspaceId: data.workspaceId,
          conversationId: conversation.id,
          contactInboxId: contactInbox.id,
          messageType: messageTypes.enum.outgoing,
          contentType: "text",
          senderType: senderTypes.enum.bot,
          sourceId: null,
          text,
          contentAttributes:
            candidate.channel === "smtp" ? { emailSubject: subject } : null,
          createdAt,
        })
        messageId = message.id
        const sent = await sendMessageToChannel(
          { conversation, contactInbox, message },
          0,
          true,
        )
        if (sent.sentCount > 0) {
          await conversationService.recordOutboundFlowStep({
            workspaceId: data.workspaceId,
            conversationId: conversation.id,
            contactInboxId: contactInbox.id,
            contactId: data.contactId,
            at: createdAt,
            bumpActivity: true,
          })
          return { outcome: "accepted" }
        }
        await repository.deleteById(message.id, data.workspaceId, createdAt)
        return { outcome: "rejected", reason: "notAccepted" }
      } catch (error) {
        const outcome = failureOutcome(error)
        if (outcome === "rejected" && messageId) {
          await repository.deleteById(messageId, data.workspaceId, createdAt)
        }
        logger.error(
          {
            err: error,
            channel: candidate.channel,
            eventId: data.eventId,
            conversationId: conversation.id,
          },
          "Client notification channel send failed",
        )
        return {
          outcome,
          reason: error instanceof Error ? error.message : outcome,
        }
      }
    },
    record: () => Promise.resolve(),
  })

  if (result.status === "error") {
    logger.info(
      {
        eventId: data.eventId,
        contactId: data.contactId,
        externalOrderId: data.externalOrderId,
        statusId: data.statusId,
        reason: result.reason,
      },
      "Client notification finished without an accepted channel",
    )
  }
}
