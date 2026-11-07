import { and, db, eq, inArray, sql } from "@chatbotx.io/database/client"
import {
  channelTypes,
  smartDelayStatuses,
  smartDelayTypes,
} from "@chatbotx.io/database/partials"
import {
  contactOnSmartDelayModel,
  flowModel,
  flowRunModel,
  flowVersionModel,
  inboxModel,
} from "@chatbotx.io/database/schema"
import { webhookChannelOrigin } from "@chatbotx.io/events/context"
import {
  ORDER_NOTIFICATION_PAYLOAD_TYPE,
  type OrderNotificationMetadata,
} from "@chatbotx.io/flow-config"
import { createId } from "@chatbotx.io/utils"
import {
  IntegrationJobAction,
  integrationQueue,
} from "@chatbotx.io/worker-config"
import { normalizeContactInboxSourceId } from "../contact/contact-inbox-identity"
import { contactInboxService } from "../contact-inbox/service"
import { conversationService } from "../conversation/service"
import { logger } from "../logger"
import { resolveWorkspaceFreezeReasonById } from "../workspace-lifecycle/with-blocked-owner-guard"
import {
  flowMatchesOrderStatus,
  isCancelableNotificationWait,
  NOTIFICATION_LOG_RETENTION_DAYS,
  type OrderNotificationPackage,
  type OrderNotificationRunResult,
  type OrderNotificationSubject,
} from "./order-notification"

const PROVIDER = "gkamion"
const ORDER_EVENT_TYPES = ["orderCreated", "statusChanged"] as const

type PublishedFlow = {
  flowId: string
  flowVersionId: string
  nodes: { id: string; [key: string]: unknown }[]
}

const loadPublishedFlows = async (
  workspaceId: string,
): Promise<PublishedFlow[]> => {
  const versions = await db
    .select({
      flowId: flowVersionModel.flowId,
      flowVersionId: flowVersionModel.id,
      nodes: flowVersionModel.nodes,
      active: flowModel.active,
    })
    .from(flowVersionModel)
    .innerJoin(flowModel, eq(flowModel.id, flowVersionModel.flowId))
    .where(
      and(
        eq(flowVersionModel.workspaceId, workspaceId),
        eq(flowVersionModel.isDraft, false),
        eq(flowVersionModel.isLatest, true),
        eq(flowModel.active, true),
      ),
    )
  return versions.map((version) => ({
    flowId: version.flowId,
    flowVersionId: version.flowVersionId,
    nodes: version.nodes,
  }))
}

const cancelWaitingRuns = async (input: {
  workspaceId: string
  subject: OrderNotificationSubject
  externalOrderId: string
  externalOrderItemId?: string
}) => {
  const rows = await db
    .select({
      id: contactOnSmartDelayModel.id,
      metadata: contactOnSmartDelayModel.metadata,
    })
    .from(contactOnSmartDelayModel)
    .where(
      and(
        eq(contactOnSmartDelayModel.workspaceId, input.workspaceId),
        eq(contactOnSmartDelayModel.type, smartDelayTypes.enum.waitNode),
        inArray(contactOnSmartDelayModel.status, [
          smartDelayStatuses.enum.pending,
          smartDelayStatuses.enum.scheduled,
        ]),
        sql`${contactOnSmartDelayModel.metadata}->>'type' = 'orderNotification'`,
        sql`${contactOnSmartDelayModel.metadata}->>'subject' = ${input.subject}`,
        sql`${contactOnSmartDelayModel.metadata}->>'externalOrderId' = ${input.externalOrderId}`,
      ),
    )
  const runIds = rows.flatMap((row) => {
    const flowRunId = (row.metadata as { flowRunId?: unknown } | null)
      ?.flowRunId
    return typeof flowRunId === "string" ? [flowRunId] : []
  })
  const started = new Set<string>()
  if (runIds.length > 0) {
    const runs = await db
      .select({ id: flowRunModel.id, result: flowRunModel.result })
      .from(flowRunModel)
      .where(
        and(
          eq(flowRunModel.workspaceId, input.workspaceId),
          inArray(flowRunModel.id, runIds),
        ),
      )
    for (const run of runs) {
      const result = run.result as { sendStarted?: unknown } | null
      if (result?.sendStarted === true) {
        started.add(run.id)
      }
    }
  }
  const cancelIds = rows
    .filter((row) =>
      isCancelableNotificationWait({
        metadata: row.metadata,
        subject: input.subject,
        externalOrderId: input.externalOrderId,
        externalOrderItemId: input.externalOrderItemId,
        sendStartedRunIds: started,
      }),
    )
    .map((row) => row.id)
  if (cancelIds.length === 0) {
    return
  }
  await db
    .update(contactOnSmartDelayModel)
    .set({ status: smartDelayStatuses.enum.canceled })
    .where(inArray(contactOnSmartDelayModel.id, cancelIds))
}

const runResult = (input: {
  eventId: string
  subject: OrderNotificationSubject
  externalOrderId: string
  externalOrderItemId?: string
  orderPackage: OrderNotificationPackage
  terminal?: boolean
  reason?: string
}): OrderNotificationRunResult => ({
  kind: "orderNotification",
  eventId: input.eventId,
  subject: input.subject,
  externalOrderId: input.externalOrderId,
  ...(input.externalOrderItemId
    ? { externalOrderItemId: input.externalOrderItemId }
    : {}),
  package: input.orderPackage,
  sendStarted: false,
  terminal: input.terminal === true,
  ...(input.reason ? { reason: input.reason } : {}),
  attempts: [],
  loggedAt: new Date().toISOString(),
})

const insertRun = async (input: {
  workspaceId: string
  flowId: string
  flowVersionId: string
  conversationId: string | null
  eventId: string
  result: OrderNotificationRunResult
}): Promise<{ id: string } | null> => {
  const [created] = await db
    .insert(flowRunModel)
    .values({
      id: createId(),
      workspaceId: input.workspaceId,
      flowId: input.flowId,
      flowVersionId: input.flowVersionId,
      conversationId: input.conversationId,
      notificationEventId: input.eventId,
      result: input.result as unknown as Record<string, unknown>,
    })
    .onConflictDoNothing({
      target: [
        flowRunModel.workspaceId,
        flowRunModel.notificationEventId,
        flowRunModel.flowId,
      ],
      where: sql`${flowRunModel.notificationEventId} IS NOT NULL`,
    })
    .returning({ id: flowRunModel.id })
  return created ?? null
}

const metadataFor = (input: {
  flowRunId: string
  eventId: string
  subject: OrderNotificationSubject
  externalOrderId: string
  externalOrderItemId?: string
  statusId: number
  orderPackage: OrderNotificationPackage
}): OrderNotificationMetadata => ({
  type: ORDER_NOTIFICATION_PAYLOAD_TYPE,
  flowRunId: input.flowRunId,
  eventId: input.eventId,
  subject: input.subject,
  externalOrderId: input.externalOrderId,
  ...(input.externalOrderItemId
    ? { externalOrderItemId: input.externalOrderItemId }
    : {}),
  statusId: input.statusId,
  package: input.orderPackage,
})

/**
 * Starts every published flow subscribed to this status. Waiting pauses of
 * the same order or item are cancelled first. The run keeps the package
 * copy it started with.
 */
export const startOrderNotificationFlows = async (input: {
  workspaceId: string
  eventId: string
  subject: OrderNotificationSubject
  statusId: number
  externalOrderId: string
  externalOrderItemId?: string
  contactId: string
  orderPackage: OrderNotificationPackage
}) => {
  const flows = (await loadPublishedFlows(input.workspaceId)).filter((flow) =>
    flowMatchesOrderStatus(flow.nodes, {
      subject: input.subject,
      statusId: input.statusId,
    }),
  )
  if (flows.length === 0) {
    return
  }

  await cancelWaitingRuns(input)

  const { freezeReason } = await resolveWorkspaceFreezeReasonById(
    input.workspaceId,
  )
  if (freezeReason) {
    for (const flow of flows) {
      await insertRun({
        workspaceId: input.workspaceId,
        flowId: flow.flowId,
        flowVersionId: flow.flowVersionId,
        conversationId: null,
        eventId: input.eventId,
        result: runResult({
          ...input,
          terminal: true,
          reason: freezeReason,
        }),
      })
    }
    return
  }

  const inboxes = await contactInboxService.listByContactId({
    workspaceId: input.workspaceId,
    contactId: input.contactId,
  })
  let anchor = [...inboxes].sort((left, right) => {
    const leftAt = left.lastMessageAt?.getTime() ?? Number.NEGATIVE_INFINITY
    const rightAt = right.lastMessageAt?.getTime() ?? Number.NEGATIVE_INFINITY
    return rightAt - leftAt
  })[0]

  if (!anchor && input.orderPackage.email) {
    const smtpInboxes = await db
      .select({ id: inboxModel.id })
      .from(inboxModel)
      .where(
        and(
          eq(inboxModel.workspaceId, input.workspaceId),
          eq(inboxModel.channel, channelTypes.enum.smtp),
        ),
      )
    const smtpInbox = smtpInboxes.length === 1 ? smtpInboxes[0] : undefined
    const sourceId = smtpInbox
      ? normalizeContactInboxSourceId("smtp", input.orderPackage.email)
      : null
    if (smtpInbox && sourceId) {
      const connected = await contactInboxService.connectExistingContact({
        workspaceId: input.workspaceId,
        contactId: input.contactId,
        inboxId: smtpInbox.id,
        channel: channelTypes.enum.smtp,
        sourceId,
      })
      if (connected) {
        anchor = connected
      }
    }
  }

  const conversation = anchor
    ? await conversationService.findOrCreate({
        workspaceId: input.workspaceId,
        contactId: input.contactId,
        sourceId: null,
      })
    : null

  for (const flow of flows) {
    const created = await insertRun({
      workspaceId: input.workspaceId,
      flowId: flow.flowId,
      flowVersionId: flow.flowVersionId,
      conversationId: conversation?.id ?? null,
      eventId: input.eventId,
      result: runResult({
        ...input,
        ...(anchor ? {} : { terminal: true, reason: "noChannel" }),
      }),
    })
    if (!(created && anchor && conversation)) {
      continue
    }
    try {
      await integrationQueue.add(
        IntegrationJobAction.sendFlow,
        {
          type: IntegrationJobAction.sendFlow,
          data: {
            conversationId: conversation.id,
            contactInboxId: anchor.id,
            flowId: flow.flowId,
            flowVersionId: flow.flowVersionId,
            metadata: metadataFor({
              flowRunId: created.id,
              eventId: input.eventId,
              subject: input.subject,
              externalOrderId: input.externalOrderId,
              externalOrderItemId: input.externalOrderItemId,
              statusId: input.statusId,
              orderPackage: input.orderPackage,
            }),
            origin: webhookChannelOrigin(),
          },
        },
        { jobId: `order-notify:${created.id}` },
      )
    } catch (error) {
      logger.error(
        { err: error, flowRunId: created.id, eventId: input.eventId },
        "Failed to enqueue order notification flow",
      )
      await db.delete(flowRunModel).where(eq(flowRunModel.id, created.id))
      throw error
    }
  }
}

export const listSmtpInboxIds = async (
  workspaceId: string,
): Promise<string[]> => {
  const rows = await db
    .select({ id: inboxModel.id })
    .from(inboxModel)
    .where(
      and(
        eq(inboxModel.workspaceId, workspaceId),
        eq(inboxModel.channel, channelTypes.enum.smtp),
      ),
    )
  return rows.map((row) => row.id)
}

export const connectOrderNotificationEmail = async (input: {
  workspaceId: string
  contactId: string
  inboxId: string
  email: string
}) => {
  const sourceId = normalizeContactInboxSourceId("smtp", input.email)
  if (!sourceId) {
    return null
  }
  return await contactInboxService.connectExistingContact({
    workspaceId: input.workspaceId,
    contactId: input.contactId,
    inboxId: input.inboxId,
    channel: channelTypes.enum.smtp,
    sourceId,
  })
}

export const orderNotificationSubject = (
  eventType: string,
): OrderNotificationSubject | null => {
  if (eventType === "itemStatusChanged") {
    return "item"
  }
  if (
    ORDER_EVENT_TYPES.includes(eventType as (typeof ORDER_EVENT_TYPES)[number])
  ) {
    return "order"
  }
  return null
}

export const PROVIDER_GKAMION = PROVIDER

const readRun = async (input: {
  workspaceId: string
  flowRunId: string
}): Promise<OrderNotificationRunResult | null> => {
  const [run] = await db
    .select({ result: flowRunModel.result })
    .from(flowRunModel)
    .where(
      and(
        eq(flowRunModel.id, input.flowRunId),
        eq(flowRunModel.workspaceId, input.workspaceId),
      ),
    )
  const result = run?.result as OrderNotificationRunResult | null
  return result?.kind === "orderNotification" ? result : null
}

export const readOrderNotificationRun = readRun

export const markOrderNotificationSendStarted = async (input: {
  workspaceId: string
  flowRunId: string
}) => {
  const result = await readRun(input)
  if (!result || result.sendStarted) {
    return result
  }
  const next = { ...result, sendStarted: true }
  await db
    .update(flowRunModel)
    .set({
      result: next as unknown as Record<string, unknown>,
      updatedAt: new Date(),
    })
    .where(eq(flowRunModel.id, input.flowRunId))
  return next
}

export const recordOrderNotificationAttempt = async (input: {
  workspaceId: string
  flowRunId: string
  attempt: OrderNotificationRunResult["attempts"][number]
}) => {
  const result = await readRun(input)
  if (!result) {
    return
  }
  await db
    .update(flowRunModel)
    .set({
      result: {
        ...result,
        sendStarted: true,
        attempts: [...result.attempts, input.attempt],
      } as unknown as Record<string, unknown>,
      updatedAt: new Date(),
    })
    .where(eq(flowRunModel.id, input.flowRunId))
}

export const closeOrderNotificationRun = async (input: {
  workspaceId: string
  flowRunId: string
  reason: string
}) => {
  const result = await readRun(input)
  if (!result) {
    return
  }
  await db
    .update(flowRunModel)
    .set({
      result: {
        ...result,
        terminal: true,
        reason: input.reason,
      } as unknown as Record<string, unknown>,
      updatedAt: new Date(),
    })
    .where(eq(flowRunModel.id, input.flowRunId))
}

export const purgeOrderNotificationLogs = async (input: {
  now: Date
  limit: number
}): Promise<number> => {
  const cutoff = new Date(
    input.now.getTime() - NOTIFICATION_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString()
  const rows = await db
    .select({ id: flowRunModel.id })
    .from(flowRunModel)
    .where(
      and(
        sql`${flowRunModel.result}->>'kind' = 'orderNotification'`,
        sql`(${flowRunModel.result}->>'terminal' = 'true' OR ${flowRunModel.result}->>'sendStarted' = 'true')`,
        sql`${flowRunModel.result}->>'loggedAt' < ${cutoff}`,
      ),
    )
    .limit(input.limit)
  if (rows.length === 0) {
    return 0
  }
  await db
    .update(flowRunModel)
    .set({ result: null, updatedAt: new Date() })
    .where(
      inArray(
        flowRunModel.id,
        rows.map((row) => row.id),
      ),
    )
  return rows.length
}

/**
 * A blocked owner never receives the notification. The run is closed with
 * the freeze reason and is not started again.
 */
export const settleBlockedOrderNotification = async (input: {
  workspaceId: string
  flowRunId?: string
  smartDelayId?: string
  reason: string
}) => {
  if (input.flowRunId) {
    const [run] = await db
      .select({ result: flowRunModel.result })
      .from(flowRunModel)
      .where(
        and(
          eq(flowRunModel.id, input.flowRunId),
          eq(flowRunModel.workspaceId, input.workspaceId),
        ),
      )
    const result = run?.result as OrderNotificationRunResult | null
    if (result?.kind === "orderNotification" && result.terminal !== true) {
      await db
        .update(flowRunModel)
        .set({
          result: {
            ...result,
            terminal: true,
            reason: input.reason,
          } as unknown as Record<string, unknown>,
          updatedAt: new Date(),
        })
        .where(eq(flowRunModel.id, input.flowRunId))
    }
  }
  if (input.smartDelayId) {
    await db
      .update(contactOnSmartDelayModel)
      .set({ status: smartDelayStatuses.enum.canceled })
      .where(
        and(
          eq(contactOnSmartDelayModel.id, input.smartDelayId),
          eq(contactOnSmartDelayModel.workspaceId, input.workspaceId),
          inArray(contactOnSmartDelayModel.status, [
            smartDelayStatuses.enum.pending,
            smartDelayStatuses.enum.scheduled,
          ]),
        ),
      )
  }
}
