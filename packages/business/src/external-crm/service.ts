import { db, lte } from "@chatbotx.io/database/client"
import {
  findContactMatches,
  findExternalCustomerIdentity,
  findExternalOrder,
  findExternalOrderEvent,
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
  eventType: "orderCreated" | "paymentReceived" | "statusChanged"
  status: string
  occurredAt: Date
  orderData: {
    itemSummary?: string
    amount?: number
    currency?: string
    paymentStatus?: string
    deliveryMethod?: string
  }
  customer?: Omit<ExternalCustomerInput, "externalCustomerId">
}

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
        const duplicate = await findExternalOrderEvent(db, {
          workspaceId,
          provider: PROVIDER,
          eventId: event.eventId,
        })
        if (duplicate) {
          const order = await findExternalOrder(db, {
            workspaceId,
            provider: PROVIDER,
            externalOrderId: duplicate.externalOrderId,
          })
          return {
            duplicate: true,
            contactId: order?.contactId,
            orderId: duplicate.externalOrderId,
          }
        }

        let identity = await findExternalCustomerIdentity(db, {
          workspaceId,
          provider: PROVIDER,
          externalCustomerId: event.externalCustomerId,
        })
        if (!identity && event.customer) {
          await this.syncCustomer({
            workspaceId,
            customer: {
              externalCustomerId: event.externalCustomerId,
              ...event.customer,
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

        return await db.transaction(async (tx) => {
          const seen = await findExternalOrderEvent(tx, {
            workspaceId,
            provider: PROVIDER,
            eventId: event.eventId,
          })
          if (seen) {
            return {
              duplicate: true,
              contactId: identity.contactId,
              orderId: seen.externalOrderId,
            }
          }
          await tx.insert(externalOrderEventModel).values({
            workspaceId,
            provider: PROVIDER,
            eventId: event.eventId,
            externalOrderId: event.externalOrderId,
            eventType: event.eventType,
            status: event.status,
            data: event.orderData,
            occurredAt: event.occurredAt,
          })
          await tx
            .insert(externalOrderModel)
            .values({
              workspaceId,
              provider: PROVIDER,
              externalOrderId: event.externalOrderId,
              externalCustomerId: event.externalCustomerId,
              contactId: identity.contactId,
              status: event.status,
              data: event.orderData,
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
                data: event.orderData,
                lastEventAt: event.occurredAt,
                updatedAt: new Date(),
              },
              setWhere: lte(externalOrderModel.lastEventAt, event.occurredAt),
            })
          return {
            duplicate: false,
            contactId: identity.contactId,
            orderId: event.externalOrderId,
          }
        })
      },
    })
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
