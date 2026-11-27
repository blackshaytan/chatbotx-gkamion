import {
  type ContactAccessScope,
  contactCustomFieldService,
  contactService,
  externalCrmService,
  readGkamionContactFields,
} from "@chatbotx.io/business"
import { getChildLogger } from "@chatbotx.io/logger"
import type { z } from "zod"
import type { listContactOrdersResponse } from "../schema/contact-orders"
import {
  gkamionAdminGet,
  isGkamionCabinetConfigured,
  pickBestCustomer,
  rememberGkamionOrderHistoryLink,
  searchGkamionCustomers,
} from "./gkamion-cabinet"
import {
  isVerifiedGkamionMethod,
  matchesGkamionCustomerId,
  usableGkamionPhone,
  validGkamionCustomerId,
} from "./gkamion-contact-identity"
import {
  fallbackStatusLabels,
  mapGkamionOrders,
  mergeStatusLabels,
  ordersFromBody,
  usableEmail,
  usablePersonName,
} from "./gkamion-orders"

const log = getChildLogger("gkamion-contact")

const STATUS_LABEL_TTL_MS = 6 * 60 * 60 * 1000
const ORDER_PAGE_SIZE = "100"

type ContactOrdersResult = {
  data: z.infer<typeof listContactOrdersResponse>["data"]
  profile?: z.infer<typeof listContactOrdersResponse>["profile"]
}

type GkamionCustomer = {
  id?: number | string | null
  name?: string | null
  family_name?: string | null
  email?: string | null
  contact?: { phone?: string | null; cell_phone?: string | null } | null
}

let statusLabelsCache: { at: number; labels: Map<number, string> } | null = null

const unwrapCustomer = (body: unknown): GkamionCustomer | null => {
  if (!body || typeof body !== "object") {
    return null
  }
  const record = body as { customer?: GkamionCustomer; id?: unknown }
  const customer =
    record.customer ?? (record.id == null ? null : (record as GkamionCustomer))
  if (!customer || customer.id == null || String(customer.id).trim() === "") {
    return null
  }
  return customer
}

const loadStatusLabels = async (): Promise<Map<number, string>> => {
  if (
    statusLabelsCache &&
    Date.now() - statusLabelsCache.at < STATUS_LABEL_TTL_MS
  ) {
    return statusLabelsCache.labels
  }
  const labels = fallbackStatusLabels()
  try {
    const body = await gkamionAdminGet("/order_status_types.json", {
      page: "1",
      per_page: "100",
    })
    mergeStatusLabels(body, labels)
  } catch (err) {
    log.warn({ err }, "gKamion order status labels unavailable")
  }
  statusLabelsCache = { at: Date.now(), labels }
  return labels
}

const customerById = async (
  customerId: string,
): Promise<GkamionCustomer | null> => {
  if (!validGkamionCustomerId(customerId)) {
    return null
  }
  try {
    const body = await gkamionAdminGet(`/customers/${customerId}`)
    return matchesGkamionCustomerId(body, customerId)
      ? unwrapCustomer(body)
      : null
  } catch (err) {
    if (err instanceof Error && err.message.includes("HTTP 404")) {
      return null
    }
    throw err
  }
}

const customerByContact = async (contact: {
  email: string | null
  phoneNumber: string | null
}): Promise<GkamionCustomer | null> => {
  const email = contact.email?.trim() || null
  const phoneDigits = usableGkamionPhone(contact.phoneNumber)?.slice(1) ?? ""
  const searchTerms = [
    phoneDigits.length >= 10 ? phoneDigits : null,
    email,
  ].filter((term): term is string => Boolean(term))

  for (const searchWord of searchTerms) {
    const customers = await searchGkamionCustomers(searchWord)
    const match = pickBestCustomer(customers, {
      email,
      phoneDigits: phoneDigits.length >= 10 ? phoneDigits : undefined,
    })
    if (match?.id != null) {
      return await customerById(String(match.id))
    }
  }
  return null
}

const resolveCustomer = async (input: {
  workspaceId: string
  contactId: string
  contact: { email: string | null; phoneNumber: string | null }
  gkamionCustomerId: string | null
  gkamionVerified: string | null
}): Promise<GkamionCustomer | null> => {
  if (isVerifiedGkamionMethod(input.gkamionVerified)) {
    const customerId = validGkamionCustomerId(input.gkamionCustomerId)
    return customerId ? await customerById(customerId) : null
  }
  const linkedCustomerId = validGkamionCustomerId(
    await externalCrmService.findLinkedCustomerId({
      workspaceId: input.workspaceId,
      contactId: input.contactId,
    }),
  )
  if (linkedCustomerId) {
    const customer = await customerById(linkedCustomerId)
    if (!customer) {
      return null
    }
    await rememberGkamionOrderHistoryLink({
      workspaceId: input.workspaceId,
      contactId: input.contactId,
      customerId: linkedCustomerId,
    })
    return customer
  }
  return await customerByContact(input.contact)
}

const emptyProfilePatch = (input: {
  contact: {
    firstName: string | null
    lastName: string | null
    email: string | null
    phoneNumber: string | null
  }
  customer: GkamionCustomer
}): {
  firstName?: string
  lastName?: string
  email?: string
  phoneNumber?: string
} => {
  const patch: {
    firstName?: string
    lastName?: string
    email?: string
    phoneNumber?: string
  } = {}
  const givenName = usablePersonName(input.customer.name)
  const familyName = usablePersonName(input.customer.family_name)
  const email = usableEmail(input.customer.email)
  if (!input.contact.firstName?.trim() && givenName) {
    patch.firstName = givenName
  }
  if (!input.contact.lastName?.trim() && familyName) {
    patch.lastName = familyName
  }
  if (!input.contact.email?.trim() && email) {
    patch.email = email
  }
  if (!input.contact.phoneNumber?.trim()) {
    const phone =
      usableGkamionPhone(input.customer.contact?.phone) ??
      usableGkamionPhone(input.customer.contact?.cell_phone)
    if (phone) {
      patch.phoneNumber = phone
    }
  }
  return patch
}

const displayName = (
  firstName: string | null,
  lastName: string | null,
): string | null => {
  const name = [firstName, lastName]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(" ")
  return name || null
}

/**
 * Live gKamion orders for a contact, filling empty name, email and phone from the
 * customer record. Returns null when gKamion is not configured, the contact
 * cannot be matched, or the admin API fails — the caller then keeps the
 * stored order snapshots.
 */
export const listContactOrdersWithGkamion = async (input: {
  workspaceId: string
  contactId: string
  accessScope?: ContactAccessScope
}): Promise<ContactOrdersResult> => {
  const stored = async (): Promise<ContactOrdersResult> => ({
    data: await externalCrmService.listOrdersForContact({
      workspaceId: input.workspaceId,
      contactId: input.contactId,
    }),
  })

  // Authorization must precede both the live API and stored-snapshot fallback.
  // Do not catch access errors and turn them into an unscoped stored-order read.
  const contact = await contactService.findByIdOrFail({
    workspaceId: input.workspaceId,
    id: input.contactId,
    accessScope: input.accessScope,
  })
  if (!isGkamionCabinetConfigured()) {
    return await stored()
  }

  try {
    const fields = await contactCustomFieldService.listWithDefinitions({
      contactId: input.contactId,
    })
    const link = readGkamionContactFields(fields)
    const customer = await resolveCustomer({
      workspaceId: input.workspaceId,
      contactId: input.contactId,
      contact,
      gkamionCustomerId: link.gkamionCustomerId,
      gkamionVerified: link.gkamionVerified,
    })
    if (!customer?.id) {
      return await stored()
    }

    const customerId = String(customer.id)
    const [labels, ordersBody] = await Promise.all([
      loadStatusLabels(),
      gkamionAdminGet("/orders", {
        page: "1",
        per_page: ORDER_PAGE_SIZE,
        "search[customer_id_eq]": customerId,
      }),
    ])
    const patch = emptyProfilePatch({ contact, customer })
    if (Object.keys(patch).length > 0) {
      await contactService.update(
        {
          workspaceId: input.workspaceId,
          id: input.contactId,
          accessScope: input.accessScope,
        },
        patch,
      )
    }
    const firstName = patch.firstName ?? contact.firstName ?? null
    const lastName = patch.lastName ?? contact.lastName ?? null
    const email = patch.email ?? contact.email ?? null

    return {
      data: mapGkamionOrders(ordersFromBody(ordersBody), customerId, labels),
      profile: {
        firstName,
        lastName,
        email,
        phoneNumber: patch.phoneNumber ?? contact.phoneNumber ?? null,
        fullName: displayName(firstName, lastName),
        gkamionCustomerId: customerId,
        updated: Object.keys(patch).length > 0,
      },
    }
  } catch (err) {
    log.error(
      { err, contactId: input.contactId, workspaceId: input.workspaceId },
      "Failed to pull gKamion contact orders",
    )
    return await stored()
  }
}
