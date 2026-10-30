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
const placeholderNameRegex = /^(клиент|покупатель)$/iu
const customerIdKeys = [
  "externalCustomerId",
  "external_customer_id",
  "customerId",
  "customer_id",
  "clientId",
  "client_id",
]
const customerSignalKeys = [
  ...customerIdKeys,
  "firstName",
  "first_name",
  "lastName",
  "last_name",
  "email",
  "emailAddress",
  "email_address",
  "phoneNumber",
  "phone_number",
  "phone",
  "mobile",
  "mobilePhone",
  "mobile_phone",
  "tel",
  "telephone",
  "family_name",
  "second_name",
]

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

const cleanPersonName = (value: string | undefined) => {
  if (!value) {
    return
  }
  const cleaned = value.replace(/#+/g, " ").replace(whitespaceRegex, " ").trim()
  if (!cleaned || placeholderNameRegex.test(cleaned)) {
    return
  }
  return cleaned
}

const personNames = (source: Record<string, unknown>) => {
  const explicitFirst = cleanPersonName(
    firstValue(source, ["firstName", "first_name"]),
  )
  const explicitLast = cleanPersonName(
    firstValue(source, ["lastName", "last_name", "surname"]),
  )
  const fullName = cleanPersonName(
    firstValue(source, ["fullName", "full_name"]),
  )
  if (explicitFirst || explicitLast || fullName) {
    const [fullNameFirst, ...fullNameRest] =
      fullName?.split(whitespaceRegex) ?? []
    return {
      firstName: explicitFirst ?? fullNameFirst,
      lastName:
        explicitLast ??
        (fullNameRest.length > 0 ? fullNameRest.join(" ") : undefined),
    }
  }

  const family = cleanPersonName(firstValue(source, ["family_name"]))
  const given = cleanPersonName(firstValue(source, ["name"]))
  const patronymic = cleanPersonName(firstValue(source, ["second_name"]))
  let givenParts = given?.split(whitespaceRegex) ?? []
  if (family && givenParts[0]?.toLowerCase() === family.toLowerCase()) {
    givenParts = givenParts.slice(1)
  }
  if (!family && givenParts.length >= 2) {
    return {
      firstName: givenParts.slice(1).join(" "),
      lastName: givenParts[0],
    }
  }

  const [firstToken, ...restTokens] = givenParts
  const rest = restTokens.join(" ")
  const firstName =
    [firstToken, rest || patronymic].filter(Boolean).join(" ") || undefined
  return { firstName, lastName: family }
}

const nestedContactPhone = (source: Record<string, unknown>) => {
  const contact = asRecord(source.contact)
  if (!contact) {
    return
  }
  return firstValue(contact, [
    "clean_cell_phone",
    "clean_phone",
    "cell_phone",
    "phone",
  ])
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
  let meaningfulRecord: Record<string, unknown> | undefined
  let fallback: Record<string, unknown> | undefined

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current || visited.has(current.value)) {
      continue
    }
    visited.add(current.value)

    const nestedCustomer =
      asRecord(current.value.customer) ??
      asRecord(current.value.client) ??
      asRecord(current.value.customer_data) ??
      asRecord(current.value.customerData)
    if (nestedCustomer) {
      customer = nestedCustomer
      break
    }

    if (
      !meaningfulRecord &&
      customerSignalKeys.some((key) => current.value[key] !== undefined)
    ) {
      meaningfulRecord = current.value
    }

    if (!fallback) {
      fallback = current.value
    }
    if (current.depth >= 4) {
      continue
    }

    for (const key of [
      "body",
      "data",
      "payload",
      "object",
      "resource",
      "client",
      "user",
    ]) {
      const nested = asRecord(current.value[key])
      if (nested) {
        queue.push({ value: nested, depth: current.depth + 1 })
      }
    }
  }

  const source = customer ?? meaningfulRecord ?? fallback ?? root
  const names = personNames(source)
  const contact = asRecord(source.contact)

  return {
    customer: {
      externalCustomerId: firstValue(source, [...customerIdKeys, "id"]),
      firstName: names.firstName,
      lastName: names.lastName,
      email:
        firstValue(source, ["email", "emailAddress", "email_address"]) ??
        (contact
          ? firstValue(contact, ["email", "emailAddress", "email_address"])
          : undefined),
      phoneNumber:
        firstValue(source, [
          "phoneNumber",
          "phone_number",
          "phone",
          "mobile",
          "mobilePhone",
          "mobile_phone",
          "tel",
          "telephone",
        ]) ?? nestedContactPhone(source),
    },
  }
}

export const syncExternalCustomerPublicRequest = z.preprocess(
  normalizeCustomerSyncRequest,
  z
    .object({ customer: externalCustomerPublicInput })
    .superRefine(({ customer }, context) => {
      if (
        customer.firstName === undefined &&
        customer.lastName === undefined &&
        customer.email === undefined &&
        customer.phoneNumber === undefined
      ) {
        context.addIssue({
          code: "custom",
          path: ["customer"],
          message: "At least one customer field must be provided",
        })
      }
    }),
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
