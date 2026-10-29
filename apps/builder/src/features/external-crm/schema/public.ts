import {
  createSelectSchema,
  externalOrderEventModel,
  externalOrderModel,
} from "@chatbotx.io/database/schema"
import { z } from "zod"

const externalOrderData = z.object({
  itemSummary: z.string().max(4000).optional(),
  amount: z.number().finite().nonnegative().optional(),
  currency: z.string().length(3).optional(),
  paymentStatus: z.string().max(100).optional(),
  deliveryMethod: z.string().max(100).optional(),
})

const whitespaceRegex = /\s+/

export const externalCustomerPublicInput = z.object({
  externalCustomerId: z.string().trim().min(1).max(255),
  firstName: z.string().trim().max(255).optional(),
  lastName: z.string().trim().max(255).optional(),
  email: z.string().trim().email().toLowerCase().optional(),
  phoneNumber: z.string().trim().max(40).optional(),
})

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined

const firstValue = (record: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    const value = record[key]
    if (
      (typeof value === "string" && value.trim().length > 0) ||
      (typeof value === "number" && Number.isSafeInteger(value))
    ) {
      return String(value).trim()
    }
  }
  return
}

const normalizeCustomerSyncRequest = (input: unknown) => {
  const root = asRecord(input)
  if (!root) {
    return input
  }

  // Accept the explicit API shape and common GKamion webhook envelopes.
  const queue: Array<{ value: Record<string, unknown>; depth: number }> = [
    { value: root, depth: 0 },
  ]
  const visited = new Set<Record<string, unknown>>()
  let customer: Record<string, unknown> | undefined
  let fallback: Record<string, unknown> | undefined

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current || visited.has(current.value)) {
      continue
    }
    visited.add(current.value)

    const nestedCustomer = asRecord(current.value.customer)
    if (nestedCustomer) {
      customer = nestedCustomer
      break
    }

    if (!fallback) {
      fallback = current.value
    }
    if (current.depth >= 4) {
      continue
    }

    for (const key of ["body", "data", "payload", "object", "resource"]) {
      const nested = asRecord(current.value[key])
      if (nested) {
        queue.push({ value: nested, depth: current.depth + 1 })
      }
    }
  }

  const source = customer ?? fallback ?? root
  const externalCustomerId = firstValue(source, [
    "externalCustomerId",
    "external_customer_id",
    "customerId",
    "customer_id",
    "id",
  ])
  const firstName = firstValue(source, ["firstName", "first_name", "name"])
  const lastName = firstValue(source, ["lastName", "last_name", "surname"])
  const fullName = firstValue(source, ["fullName", "full_name"])
  const [fullNameFirst, ...fullNameRest] =
    fullName?.split(whitespaceRegex) ?? []

  return {
    customer: {
      externalCustomerId,
      firstName: firstName ?? fullNameFirst,
      lastName:
        lastName ??
        (fullNameRest.length > 0 ? fullNameRest.join(" ") : undefined),
      email: firstValue(source, ["email", "emailAddress", "email_address"]),
      phoneNumber: firstValue(source, [
        "phoneNumber",
        "phone_number",
        "phone",
        "mobile",
        "tel",
      ]),
    },
  }
}

export const syncExternalCustomerPublicRequest = z.preprocess(
  normalizeCustomerSyncRequest,
  z.object({ customer: externalCustomerPublicInput }),
)

export const recordExternalOrderEventPublicRequest = z.object({
  eventId: z.string().trim().min(1).max(255),
  externalCustomerId: z.string().trim().min(1).max(255),
  externalOrderId: z.string().trim().min(1).max(255),
  eventType: z.enum(["orderCreated", "paymentReceived", "statusChanged"]),
  status: z.string().trim().min(1).max(100),
  occurredAt: z.iso.datetime().transform((value) => new Date(value)),
  orderData: externalOrderData,
  customer: externalCustomerPublicInput
    .omit({ externalCustomerId: true })
    .optional(),
})

export const getExternalCustomerPublicRequest = z.object({
  externalCustomerId: z.string().trim().min(1).max(255),
})

export const externalOrderPublicResource = createSelectSchema(
  externalOrderModel,
  {
    id: z.string(),
    contactId: z.string(),
    workspaceId: z.string(),
  },
)

export const externalOrderEventPublicResource = createSelectSchema(
  externalOrderEventModel,
  {
    id: z.string(),
    workspaceId: z.string(),
  },
)

export const getExternalCustomerPublicResponse = z.object({
  contactId: z.string(),
  orders: z.array(externalOrderPublicResource),
})

export const getExternalOrderHistoryPublicResponse = z.object({
  order: externalOrderPublicResource,
  events: z.array(externalOrderEventPublicResource),
})
