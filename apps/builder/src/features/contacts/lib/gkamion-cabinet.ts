import {
  type ContactAccessScope,
  contactCustomFieldService,
  contactService,
  readGkamionContactFields,
} from "@chatbotx.io/business"
import { getChildLogger } from "@chatbotx.io/logger"

import {
  isVerifiedGkamionMethod,
  matchesGkamionCustomerId,
  usableGkamionPhone,
  validGkamionCustomerId,
} from "./gkamion-contact-identity"

const log = getChildLogger("gkamion-cabinet")

export type GkamionCabinetLinkResult =
  | { status: "ok"; customerId: string; url: string }
  | { status: "not_found" }
  | {
      status: "unavailable"
      reason: "not_configured" | "missing_identifiers"
    }

type GkamionAdminConfig = {
  apiBaseUrl: string
  username: string
  password: string
  cabinetBaseUrl: string
}

type GkamionCustomerRow = {
  id?: number | string
  email?: string | null
  contact?: {
    phone?: string | null
    cell_phone?: string | null
  } | null
}

const API_V3_SUFFIX_RE = /\/api\/v3\/?$/i
const TRAILING_SLASH_RE = /\/$/

const stripTrailingSlash = (value: string): string =>
  value.replace(TRAILING_SLASH_RE, "")

const readGkamionAdminConfig = (): GkamionAdminConfig | null => {
  const apiBaseUrl = process.env.GKAMION_BASE_URL?.trim()
  const username = process.env.GKAMION_USERNAME?.trim()
  const password = process.env.GKAMION_PASSWORD?.trim()
  if (!(apiBaseUrl && username && password)) {
    return null
  }
  const cabinetBaseUrl = stripTrailingSlash(
    process.env.GKAMION_CABINET_URL?.trim() ||
      apiBaseUrl.replace(API_V3_SUFFIX_RE, "") ||
      "https://admin.gkamion.ru",
  )
  return {
    apiBaseUrl: stripTrailingSlash(apiBaseUrl),
    username,
    password,
    cabinetBaseUrl,
  }
}

export const isGkamionCabinetConfigured = (): boolean =>
  readGkamionAdminConfig() !== null

const buildCabinetUrl = (cabinetBaseUrl: string, customerId: string): string =>
  `${cabinetBaseUrl}/customers/${customerId}`

export const pickBestCustomer = (
  customers: GkamionCustomerRow[],
  query: { email?: string | null; phoneDigits?: string },
): GkamionCustomerRow | undefined => {
  const email = query.email?.trim().toLowerCase()
  const phone = usableGkamionPhone(query.phoneDigits)
  if (!(email || phone)) {
    return
  }
  const matches = customers.filter((customer) => {
    const emailMatches = Boolean(
      email && customer.email?.trim().toLowerCase() === email,
    )
    const phoneMatches = Boolean(
      phone &&
        [customer.contact?.phone, customer.contact?.cell_phone].some(
          (value) => usableGkamionPhone(value) === phone,
        ),
    )
    return (!email || emailMatches) && (!phone || phoneMatches)
  })
  const byId = new Map(
    matches.flatMap((customer) => {
      const id = validGkamionCustomerId(customer.id)
      return id ? [[id, customer] as const] : []
    }),
  )
  return byId.size === 1 ? byId.values().next().value : undefined
}

const gkamionAuthHeaders = (
  config: GkamionAdminConfig,
): Record<string, string> => ({
  Authorization: `Basic ${Buffer.from(`${config.username}:${config.password}`).toString("base64")}`,
  Accept: "application/json",
})

const searchCustomers = async (
  config: GkamionAdminConfig,
  searchWord: string,
): Promise<GkamionCustomerRow[]> => {
  const url = new URL(`${config.apiBaseUrl}/customers`)
  url.searchParams.set("search_word", searchWord)
  url.searchParams.set("per_page", "10")
  url.searchParams.set("page", "1")

  const response = await fetch(url, {
    method: "GET",
    headers: gkamionAuthHeaders(config),
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) {
    throw new Error(`gKamion customers search failed: HTTP ${response.status}`)
  }
  const body = (await response.json()) as {
    customers?: GkamionCustomerRow[]
    data?: GkamionCustomerRow[]
  }
  const customers = body.customers ?? body.data ?? []
  // A full page may hide another exact match: do not choose from a partial search.
  return Array.isArray(customers) && customers.length < 10 ? customers : []
}

export const searchGkamionCustomers = async (
  searchWord: string,
): Promise<GkamionCustomerRow[]> => {
  const config = readGkamionAdminConfig()
  if (!config) {
    return []
  }
  return await searchCustomers(config, searchWord)
}

/** GET against the gKamion admin API. Throws when the call fails. */
export const gkamionAdminGet = async (
  path: string,
  searchParams?: Record<string, string>,
): Promise<unknown> => {
  const config = readGkamionAdminConfig()
  if (!config) {
    throw new Error("gKamion admin API is not configured")
  }
  const url = new URL(
    `${config.apiBaseUrl}${path.startsWith("/") ? path : `/${path}`}`,
  )
  for (const [key, value] of Object.entries(searchParams ?? {})) {
    url.searchParams.set(key, value)
  }
  const response = await fetch(url, {
    method: "GET",
    headers: gkamionAuthHeaders(config),
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) {
    throw new Error(`gKamion ${path} failed: HTTP ${response.status}`)
  }
  return await response.json()
}

/**
 * Resolve a verified binding first; otherwise require a unique exact phone/email match.
 */
export const resolveGkamionCabinetLinkForContact = async (input: {
  workspaceId: string
  contactId: string
  accessScope?: ContactAccessScope
}): Promise<GkamionCabinetLinkResult> => {
  const config = readGkamionAdminConfig()
  if (!config) {
    return { status: "unavailable", reason: "not_configured" }
  }

  const contact = await contactService.findByIdOrFail({
    workspaceId: input.workspaceId,
    id: input.contactId,
    accessScope: input.accessScope,
  })
  const fields = await contactCustomFieldService.listWithDefinitions({
    contactId: input.contactId,
  })
  const link = readGkamionContactFields(fields)
  if (isVerifiedGkamionMethod(link.gkamionVerified)) {
    const customerId = validGkamionCustomerId(link.gkamionCustomerId)
    if (!customerId) {
      return { status: "not_found" }
    }
    try {
      const body = await gkamionAdminGet(`/customers/${customerId}`)
      if (!matchesGkamionCustomerId(body, customerId)) {
        return { status: "not_found" }
      }
      return {
        status: "ok",
        customerId,
        url: buildCabinetUrl(config.cabinetBaseUrl, customerId),
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes("HTTP 404")) {
        return { status: "not_found" }
      }
      throw err
    }
  }
  const email = contact.email?.trim() || null
  const phoneDigits = usableGkamionPhone(contact.phoneNumber)?.slice(1) ?? ""

  if (!(email || phoneDigits.length >= 10)) {
    return { status: "unavailable", reason: "missing_identifiers" }
  }

  // Prefer phone digits (stable) then email — both work with search_word.
  const searchTerms = [
    phoneDigits.length >= 10 ? phoneDigits : null,
    email,
  ].filter((term): term is string => Boolean(term))

  try {
    for (const searchWord of searchTerms) {
      const customers = await searchCustomers(config, searchWord)
      const match = pickBestCustomer(customers, {
        email,
        phoneDigits: phoneDigits.length >= 10 ? phoneDigits : undefined,
      })
      if (match?.id != null) {
        const customerId = String(match.id)
        return {
          status: "ok",
          customerId,
          url: buildCabinetUrl(config.cabinetBaseUrl, customerId),
        }
      }
    }
    return { status: "not_found" }
  } catch (err) {
    log.error(
      { err, contactId: input.contactId, workspaceId: input.workspaceId },
      "Failed to resolve gKamion cabinet link",
    )
    throw err
  }
}
