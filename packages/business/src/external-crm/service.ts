import { and, db, eq, lte } from "@chatbotx.io/database/client"
import {
  findContactMatches,
  findExternalCustomerIdentity,
  findExternalOrder,
  findExternalOrderEvent,
  findLatestExternalSubjectEventAt,
  getExternalOrderHistory,
  listExternalOrdersForContact,
} from "@chatbotx.io/database/repositories"
import {
  contactModel,
  externalCustomerIdentityModel,
  externalOrderEventModel,
  externalOrderModel,
} from "@chatbotx.io/database/schema"
import type { ContactModel } from "@chatbotx.io/database/types"
import { emitContactCreated } from "@chatbotx.io/events"
import { distributedLock } from "@chatbotx.io/redis"
import { createId } from "@chatbotx.io/utils"
import { BaseService } from "../base.service"
import { normalizeIdentityPhoneToE164 } from "../contact/phone"
import { contactService } from "../contact/service"
import { notFoundException, validationException } from "../errors"
import { quotaEnforcementService } from "../quota-enforcement/service"
import { workspaceService } from "../workspace/service"
import {
  decideOrderEvent,
  notificationRunsCreated,
  readOrderNotificationPackage,
} from "./order-notification"
import { toContactOrderSnapshot } from "./order-snapshot"
import {
  orderNotificationSubject,
  startOrderNotificationFlows,
} from "./start-order-notifications"

const PROVIDER = "gkamion"
const LOCK_TIMEOUT_SECONDS = 30
const identityLockKey = (workspaceId: string, externalCustomerId: string) =>
  `external-crm:${workspaceId}:${PROVIDER}:customer:${externalCustomerId}`
const eventLockKey = (workspaceId: string, eventId: string) =>
  `external-crm:${workspaceId}:${PROVIDER}:event:${eventId}`

export type ExternalCustomerInput = {
  externalCustomerId: string
  firstName?: string
  lastName?: string
  email?: string
  phoneNumber?: string
}

export type ExternalOrderEventInput = {
  eventId: string
  externalCustomerId: string
  externalOrderId: string
  externalOrderItemId?: string
  eventType:
    | "orderCreated"
    | "paymentReceived"
    | "statusChanged"
    | "itemStatusChanged"
  status: string
  statusId?: number
  occurredAt: Date
  orderData: {
    itemSummary?: string
    amount?: number
    currency?: string
    paymentStatus?: string
    deliveryMethod?: string
    hasDebt?: boolean
    billUrl?: string
    orderNumber?: string
    phone?: string
    email?: string
  }
  customer?: Omit<ExternalCustomerInput, "externalCustomerId">
}

const SHORT_SNAPSHOT_KEYS = [
  "itemSummary",
  "amount",
  "currency",
  "paymentStatus",
  "deliveryMethod",
] as const

const shortOrderSnapshot = (
  orderData: ExternalOrderEventInput["orderData"],
): Record<string, unknown> => {
  const snapshot: Record<string, unknown> = {}
  for (const key of SHORT_SNAPSHOT_KEYS) {
    if (orderData[key] !== undefined) {
      snapshot[key] = orderData[key]
    }
  }
  return snapshot
}

const eventPayload = (
  event: ExternalOrderEventInput,
  runsCreated: boolean,
): Record<string, unknown> => ({
  ...shortOrderSnapshot(event.orderData),
  ...readOrderNotificationPackage(event.orderData),
  ...(event.statusId === undefined ? {} : { statusId: event.statusId }),
  ...(event.externalOrderItemId
    ? { externalOrderItemId: event.externalOrderItemId }
    : {}),
  notificationRunsCreated: runsCreated,
})

type ContactFields = Pick<
  ContactModel,
  "firstName" | "lastName" | "email" | "phoneNumber"
>

const toContactFields = (
  input: Omit<ExternalCustomerInput, "externalCustomerId">,
): Partial<ContactFields> => ({
  ...(input.firstName !== undefined && { firstName: input.firstName }),
  ...(input.lastName !== undefined && { lastName: input.lastName }),
  ...(input.email !== undefined && { email: input.email }),
  ...(input.phoneNumber !== undefined && { phoneNumber: input.phoneNumber }),
})

class ExternalCrmService extends BaseService {
  async syncCustomer(input: {
    workspaceId: string
    customer: ExternalCustomerInput
  }) {
    const { workspaceId } = input
    const workspace = await workspaceService.find({
      where: { id: workspaceId },
    })
    if (!workspace) {
      throw notFoundException("Workspace not found")
    }
    const customer = {
      ...input.customer,
      email: input.customer.email?.trim().toLowerCase(),
      phoneNumber: input.customer.phoneNumber
        ? (normalizeIdentityPhoneToE164(
            input.customer.phoneNumber,
            workspace.targetCountry,
          ) ?? input.customer.phoneNumber)
        : undefined,
    }
    return await distributedLock.runExclusive({
      key: identityLockKey(workspaceId, customer.externalCustomerId),
      timeoutInSeconds: LOCK_TIMEOUT_SECONDS,
      fn: async () => {
        const existing = await findExternalCustomerIdentity(db, {
          workspaceId,
          provider: PROVIDER,
          externalCustomerId: customer.externalCustomerId,
        })
        if (existing) {
          const fields = toContactFields(customer)
          const contact =
            Object.keys(fields).length > 0
              ? await contactService.update(
                  { workspaceId, id: existing.contactId },
                  fields,
                )
              : existing.contact
          return { contactId: contact.id, created: false }
        }

        const matches =
          customer.email || customer.phoneNumber
            ? await findContactMatches(db, {
                workspaceId,
                ...(customer.email && { email: customer.email }),
                ...(customer.phoneNumber && {
                  phoneNumber: customer.phoneNumber,
                }),
              })
            : []
        const matchedIds = [...new Set(matches.map(({ id }) => id))]
        if (matchedIds.length > 1) {
          throw validationException(
            "customer",
            "Customer details match more than one contact",
          )
        }

        if (matchedIds[0]) {
          const fields = toContactFields(customer)
          const contact =
            Object.keys(fields).length > 0
              ? await contactService.update(
                  { workspaceId, id: matchedIds[0] },
                  fields,
                )
              : await contactService.findByIdOrFail({
                  workspaceId,
                  id: matchedIds[0],
                })
          await db.insert(externalCustomerIdentityModel).values({
            workspaceId,
            provider: PROVIDER,
            externalCustomerId: customer.externalCustomerId,
            contactId: contact.id,
          })
          return { contactId: contact.id, created: false }
        }

        if (!(customer.email || customer.phoneNumber)) {
          throw validationException(
            "customer",
            "A new customer requires an email address or phone number",
          )
        }
        const contact = await quotaEnforcementService.createContactWithoutMac({
          ownerId: workspace.ownerId,
          workspaceId,
          create: async (tx) => {
            const [created] = await tx
              .insert(contactModel)
              .values({
                id: createId(),
                workspaceId,
                emailOptIn: false,
                ...toContactFields(customer),
              })
              .returning()
            await tx.insert(externalCustomerIdentityModel).values({
              workspaceId,
              provider: PROVIDER,
              externalCustomerId: customer.externalCustomerId,
              contactId: created.id,
            })
            return created
          },
        })
        await this.invalidateCacheTags([
          "contacts",
          `contacts:${workspaceId}`,
          `contacts:${contact.id}`,
        ])
        await emitContactCreated(
          workspaceId,
          contact.id,
          contact.firstName || undefined,
          contact.phoneNumber || undefined,
          contact.email || undefined,
        )
        return { contactId: contact.id, created: true }
      },
    })
  }

  async recordOrderEvent(input: {
    workspaceId: string
    event: ExternalOrderEventInput
  }) {
    const { workspaceId, event } = input
    return await distributedLock.runExclusive({
      key: eventLockKey(workspaceId, event.eventId),
      timeoutInSeconds: LOCK_TIMEOUT_SECONDS,
      fn: async () => {
        if (
          event.eventType === "itemStatusChanged" &&
          !event.externalOrderItemId
        ) {
          throw validationException(
            "externalOrderItemId",
            "An item status event requires externalOrderItemId",
          )
        }

        const orderPackage = readOrderNotificationPackage(event.orderData)
        const phone = event.customer?.phoneNumber ?? orderPackage.phone
        const email = event.customer?.email ?? orderPackage.email
        const hasPhoneOrEmail = Boolean(phone || email)
        const existing = await findExternalOrderEvent(db, {
          workspaceId,
          provider: PROVIDER,
          eventId: event.eventId,
        })
        let identity = await findExternalCustomerIdentity(db, {
          workspaceId,
          provider: PROVIDER,
          externalCustomerId: event.externalCustomerId,
        })
        if (!(identity || hasPhoneOrEmail)) {
          throw validationException(
            "customer",
            "Link the customer or include a phone number or email address",
          )
        }
        if (!identity) {
          await this.syncCustomer({
            workspaceId,
            customer: {
              externalCustomerId: event.externalCustomerId,
              ...event.customer,
              ...(email ? { email } : {}),
              ...(phone ? { phoneNumber: phone } : {}),
            },
          })
          identity = await findExternalCustomerIdentity(db, {
            workspaceId,
            provider: PROVIDER,
            externalCustomerId: event.externalCustomerId,
          })
        }
        if (!identity) {
          throw notFoundException(
            "Customer is not linked. Sync the customer before recording an order event",
          )
        }

        const subject = orderNotificationSubject(event.eventType)
        const latestAcceptedAt = subject
          ? await findLatestExternalSubjectEventAt(db, {
              workspaceId,
              provider: PROVIDER,
              externalOrderId: event.externalOrderId,
              eventTypes:
                subject === "item"
                  ? ["itemStatusChanged"]
                  : ["orderCreated", "paymentReceived", "statusChanged"],
              ...(subject === "item" && event.externalOrderItemId
                ? { externalOrderItemId: event.externalOrderItemId }
                : {}),
              exceptEventId: event.eventId,
            })
          : null
        const decision = decideOrderEvent({
          linked: true,
          hasPhoneOrEmail,
          existing: existing
            ? { runsCreated: notificationRunsCreated(existing.data) }
            : null,
          latestAcceptedAt,
          occurredAt: event.occurredAt,
        })
        if (decision.kind === "duplicate") {
          return {
            duplicate: true,
            contactId: identity.contactId,
            orderId: event.externalOrderId,
          }
        }

        const startsFlows =
          (decision.kind === "accept" || decision.kind === "resume") &&
          subject !== null &&
          event.statusId !== undefined
        if (!existing) {
          const snapshot = shortOrderSnapshot(event.orderData)
          await db.transaction(async (tx) => {
            await tx.insert(externalOrderEventModel).values({
              workspaceId,
              provider: PROVIDER,
              eventId: event.eventId,
              externalOrderId: event.externalOrderId,
              eventType: event.eventType,
              status: event.status,
              data: eventPayload(event, !startsFlows),
              occurredAt: event.occurredAt,
            })
            if (subject === "item") {
              return
            }
            await tx
              .insert(externalOrderModel)
              .values({
                workspaceId,
                provider: PROVIDER,
                externalOrderId: event.externalOrderId,
                externalCustomerId: event.externalCustomerId,
                contactId: identity.contactId,
                status: event.status,
                data: snapshot,
                lastEventAt: event.occurredAt,
              })
              .onConflictDoUpdate({
                target: [
                  externalOrderModel.workspaceId,
                  externalOrderModel.provider,
                  externalOrderModel.externalOrderId,
                ],
                set: {
                  externalCustomerId: event.externalCustomerId,
                  contactId: identity.contactId,
                  status: event.status,
                  data: snapshot,
                  lastEventAt: event.occurredAt,
                  updatedAt: new Date(),
                },
                setWhere: lte(externalOrderModel.lastEventAt, event.occurredAt),
              })
          })
        }

        if (startsFlows && subject && event.statusId !== undefined) {
          await startOrderNotificationFlows({
            workspaceId,
            eventId: event.eventId,
            subject,
            statusId: event.statusId,
            externalOrderId: event.externalOrderId,
            externalOrderItemId: event.externalOrderItemId,
            contactId: identity.contactId,
            orderPackage,
          })
          const stored = await findExternalOrderEvent(db, {
            workspaceId,
            provider: PROVIDER,
            eventId: event.eventId,
          })
          if (stored) {
            await db
              .update(externalOrderEventModel)
              .set({
                data: {
                  ...(stored.data as Record<string, unknown>),
                  notificationRunsCreated: true,
                },
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(externalOrderEventModel.workspaceId, workspaceId),
                  eq(externalOrderEventModel.provider, PROVIDER),
                  eq(externalOrderEventModel.eventId, event.eventId),
                ),
              )
          }
        }

        return {
          duplicate: decision.kind === "resume",
          contactId: identity.contactId,
          orderId: event.externalOrderId,
        }
      },
    })
  }

  async listOrdersForContact(input: {
    workspaceId: string
    contactId: string
  }) {
    const orders = await listExternalOrdersForContact({
      workspaceId: input.workspaceId,
      provider: PROVIDER,
      contactId: input.contactId,
    })
    return orders.map((order) => toContactOrderSnapshot(order))
  }

  async listCustomerOrders(input: {
    workspaceId: string
    externalCustomerId: string
  }) {
    const identity = await findExternalCustomerIdentity(db, {
      workspaceId: input.workspaceId,
      provider: PROVIDER,
      externalCustomerId: input.externalCustomerId,
    })
    if (!identity) {
      throw notFoundException("Customer is not linked")
    }
    return {
      contactId: identity.contactId,
      orders: await listExternalOrdersForContact({
        workspaceId: input.workspaceId,
        provider: PROVIDER,
        contactId: identity.contactId,
      }),
    }
  }

  async getOrderHistory(input: {
    workspaceId: string
    externalOrderId: string
  }) {
    const order = await findExternalOrder(db, {
      workspaceId: input.workspaceId,
      provider: PROVIDER,
      externalOrderId: input.externalOrderId,
    })
    if (!order) {
      throw notFoundException("Order not found")
    }
    return {
      order,
      events: await getExternalOrderHistory({
        workspaceId: input.workspaceId,
        provider: PROVIDER,
        externalOrderId: input.externalOrderId,
      }),
    }
  }
}

export const externalCrmService = new ExternalCrmService()
