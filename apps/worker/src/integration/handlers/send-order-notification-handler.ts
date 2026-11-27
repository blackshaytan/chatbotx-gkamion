import {
  classifyChannelFailure,
  closeOrderNotificationRun,
  connectOrderNotificationEmail,
  contactInboxService,
  conversationService,
  listSmtpInboxIds,
  markOrderNotificationSendStarted,
  planCascadeCandidates,
  readOrderNotificationRun,
  recordOrderNotificationAttempt,
  renderOrderNotificationText,
  resolveWorkspaceFreezeReasonById,
  runNotificationCascade,
} from "@chatbotx.io/business"
import { messageTypes, senderTypes } from "@chatbotx.io/database/partials"
import { createMessageRepository } from "@chatbotx.io/database/repositories"
import type { ContactInboxModel } from "@chatbotx.io/database/types"
import {
  ORDER_NOTIFICATION_PAYLOAD_TYPE,
  type SendOrderNotificationStepSchema,
} from "@chatbotx.io/flow-config"
import { ChannelError } from "@chatbotx.io/sdk"
import { resolveContactVariablesDeep } from "@chatbotx.io/variables"
import { sendMessageToChannel } from "../../chat/handlers/send-message"
import { logger } from "../../lib/logger"
import type { ExecuteStepProps } from "./flow-utils"
import type { ExecuteStepResult } from "./step"

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

export async function handleSendOrderNotification(
  props: ExecuteStepProps<SendOrderNotificationStepSchema>,
): Promise<ExecuteStepResult> {
  const metadata = props.metadata
  if (metadata?.type !== ORDER_NOTIFICATION_PAYLOAD_TYPE) {
    return {
      status: "error",
      errorMessage: "Order notification is missing its event package",
      result: null,
    }
  }

  const workspaceId = props.conversation.workspaceId
  const run = await readOrderNotificationRun({
    workspaceId,
    flowRunId: metadata.flowRunId,
  })
  if (run?.terminal) {
    return {
      status: "error",
      errorMessage: run.reason ?? "Order notification already finished",
      result: null,
    }
  }

  const { freezeReason } = await resolveWorkspaceFreezeReasonById(workspaceId)
  if (freezeReason) {
    await closeOrderNotificationRun({
      workspaceId,
      flowRunId: metadata.flowRunId,
      reason: freezeReason,
    })
    return {
      status: "error",
      errorMessage: freezeReason,
      result: null,
    }
  }

  await markOrderNotificationSendStarted({
    workspaceId,
    flowRunId: metadata.flowRunId,
  })

  const orderPackage = metadata.package
  const messengerText = await fillText(
    renderOrderNotificationText(props.step.messengerText, orderPackage),
    props,
  )
  const emailText = await fillText(
    renderOrderNotificationText(props.step.emailText, orderPackage),
    props,
  )
  const emailSubject = await fillText(
    renderOrderNotificationText(props.step.emailSubject, orderPackage),
    props,
  )
  const inboxes = await contactInboxService.listByContactId({
    workspaceId,
    contactId: props.conversation.contactId,
  })
  const smtpInboxIds = await listSmtpInboxIds(workspaceId)
  const candidates = planCascadeCandidates({
    inboxes,
    messengerText,
    emailText,
    email: orderPackage.email,
    smtpInboxCount: smtpInboxIds.length,
  })

  const result = await runNotificationCascade({
    candidates,
    attempts: run?.attempts ?? [],
    messengerText,
    emailText,
    send: async (candidate) => {
      const contactInbox = await resolveInbox({
        candidateId: candidate.contactInboxId,
        inboxes,
        smtpInboxId: smtpInboxIds[0],
        email: orderPackage.email,
        workspaceId,
        contactId: props.conversation.contactId,
      })
      if (!contactInbox) {
        return { outcome: "rejected", reason: "noDialog" }
      }
      const text = candidate.channel === "smtp" ? emailText : messengerText
      const subject =
        emailSubject.trim() || orderPackage.orderNumber || "Notification"
      const repository = await createMessageRepository()
      const createdAt = new Date()
      let messageId: string | null = null
      try {
        const message = await repository.create({
          workspaceId,
          conversationId: props.conversation.id,
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
          {
            conversation: props.conversation,
            contactInbox,
            message,
          },
          0,
          true,
        )
        if (sent.sentCount > 0) {
          await conversationService.recordOutboundFlowStep({
            workspaceId,
            conversationId: props.conversation.id,
            contactInboxId: contactInbox.id,
            contactId: props.conversation.contactId,
            at: createdAt,
            bumpActivity: true,
            currentStep: props.step.id,
          })
          return { outcome: "accepted" }
        }
        await repository.deleteById(message.id, workspaceId, createdAt)
        return { outcome: "rejected", reason: "notAccepted" }
      } catch (error) {
        const outcome = failureOutcome(error)
        if (outcome === "rejected" && messageId) {
          await repository.deleteById(messageId, workspaceId, createdAt)
        }
        logger.error(
          {
            err: error,
            channel: candidate.channel,
            conversationId: props.conversation.id,
          },
          "Order notification channel send failed",
        )
        return {
          outcome,
          reason: error instanceof Error ? error.message : outcome,
        }
      }
    },
    record: async (attempt) => {
      await recordOrderNotificationAttempt({
        workspaceId,
        flowRunId: metadata.flowRunId,
        attempt,
      })
    },
  })

  if (result.status === "error") {
    await closeOrderNotificationRun({
      workspaceId,
      flowRunId: metadata.flowRunId,
      reason: result.reason,
    })
    return {
      status: "error",
      errorMessage: result.reason,
      result: null,
    }
  }
  return { status: "success", result: null }
}

const fillText = async (
  text: string,
  props: ExecuteStepProps<SendOrderNotificationStepSchema>,
): Promise<string> => {
  try {
    return await resolveContactVariablesDeep(
      props.conversation.contactId,
      text,
      {
        contactInbox: props.contactInbox,
        conversation: props.conversation,
      },
    )
  } catch (error) {
    logger.error(
      { err: error, conversationId: props.conversation.id },
      "Order notification text variables failed",
    )
    return text
  }
}

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
