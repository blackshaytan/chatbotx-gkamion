import { db } from "@chatbotx.io/database/client"
import { findExternalCustomerIdentity } from "@chatbotx.io/database/repositories"
import {
  IntegrationJobAction,
  integrationQueue,
} from "@chatbotx.io/worker-config"
import { contactInboxService } from "../contact-inbox/service"
import { conversationService } from "../conversation/service"
import { notFoundException } from "../errors"
import { resolveWorkspaceFreezeReasonById } from "../workspace-lifecycle/with-blocked-owner-guard"
import { planCascadeCandidates } from "./order-notification"
import { listSmtpInboxIds } from "./start-order-notifications"

const PROVIDER = "gkamion"
const RETENTION_SECONDS = 30 * 24 * 60 * 60
const ALREADY_QUEUED_PATTERN = /already exists/i

const clientNotificationJobId = (workspaceId: string, eventId: string) =>
  `client-notify:${workspaceId}:${eventId}`

const alreadyQueued = (error: unknown): boolean =>
  error instanceof Error && ALREADY_QUEUED_PATTERN.test(error.message)

export type DeliverClientNotificationInput = {
  workspaceId: string
  externalCustomerId: string
  eventId: string
  text: string
  messengerText?: string
  email?: string
  emailSubject?: string
  externalOrderId?: string
  statusId?: number
}

export type DeliverClientNotificationResult = {
  contactId: string
  conversationId?: string
  queued: boolean
  duplicate: boolean
  reason?: string
}

/**
 * Queues a rendered client notification onto the linked contact.
 * Does not start a flow. The same event id is one job for 30 days.
 */
export const queueClientNotification = async (
  input: DeliverClientNotificationInput,
): Promise<DeliverClientNotificationResult> => {
  const identity = await findExternalCustomerIdentity(db, {
    workspaceId: input.workspaceId,
    provider: PROVIDER,
    externalCustomerId: input.externalCustomerId,
  })
  if (!identity?.contactId) {
    throw notFoundException("Customer is not linked")
  }

  const contactId = String(identity.contactId)
  const { freezeReason } = await resolveWorkspaceFreezeReasonById(
    input.workspaceId,
  )
  if (freezeReason) {
    return {
      contactId,
      queued: false,
      duplicate: false,
      reason: freezeReason,
    }
  }

  const messengerText = input.messengerText ?? input.text
  const emailText = input.text
  const inboxes = await contactInboxService.listByContactId({
    workspaceId: input.workspaceId,
    contactId,
  })
  const smtpInboxIds = await listSmtpInboxIds(input.workspaceId)
  const candidates = planCascadeCandidates({
    inboxes,
    messengerText,
    emailText,
    email: input.email,
    smtpInboxCount: smtpInboxIds.length,
  })
  if (candidates.length === 0) {
    return {
      contactId,
      queued: false,
      duplicate: false,
      reason: "noChannel",
    }
  }

  const conversation = await conversationService.findOrCreate({
    workspaceId: input.workspaceId,
    contactId,
    sourceId: null,
  })
  const jobId = clientNotificationJobId(input.workspaceId, input.eventId)
  const existing = await integrationQueue.getJob(jobId)
  if (existing) {
    return {
      contactId,
      conversationId: conversation.id,
      queued: false,
      duplicate: true,
    }
  }

  try {
    await integrationQueue.add(
      IntegrationJobAction.deliverClientNotification,
      {
        type: IntegrationJobAction.deliverClientNotification,
        data: {
          workspaceId: input.workspaceId,
          contactId,
          conversationId: conversation.id,
          eventId: input.eventId,
          messengerText,
          emailText,
          emailSubject: input.emailSubject ?? "",
          email: input.email,
          externalOrderId: input.externalOrderId,
          statusId: input.statusId,
        },
      },
      {
        jobId,
        removeOnComplete: { age: RETENTION_SECONDS },
        removeOnFail: { age: RETENTION_SECONDS },
      },
    )
  } catch (error) {
    if (alreadyQueued(error)) {
      return {
        contactId,
        conversationId: conversation.id,
        queued: false,
        duplicate: true,
      }
    }
    throw error
  }

  return {
    contactId,
    conversationId: conversation.id,
    queued: true,
    duplicate: false,
  }
}
