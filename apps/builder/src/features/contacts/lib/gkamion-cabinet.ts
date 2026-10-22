import { type ContactAccessScope, contactService } from "@chatbotx.io/business"
import { getChildLogger } from "@chatbotx.io/logger"

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

const NON_DIGIT_RE = /\D/g
const API_V3_SUFFIX_RE = /\/api\/v3\/?$/i
const TRAILING_SLASH_RE = /\/$/

const digitsOnly = (value: string): string => value.replace(NON_DIGIT_RE, "")

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

const pickBestCustomer = (
  customers: GkamionCustomerRow[],
  query: { email?: string | null; phoneDigits?: string },
): GkamionCustomerRow | undefined => {
  if (customers.length === 0) {
    return
  }
  const email = query.email?.trim().toLowerCase()
  if (email) {
    const byEmail = customers.find(
      (customer) => customer.email?.trim().toLowerCase() === email,
    )
    if (byEmail) {
      return byEmail
    }
  }
  const phoneDigits = query.phoneDigits
  if (phoneDigits && phoneDigits.length >= 10) {
    const byPhone = customers.find((customer) => {
      const contact = customer.contact
      const candidates = [contact?.cell_phone, contact?.phone]
        .filter((value): value is string => Boolean(value))
        .map(digitsOnly)
      return candidates.some(
        (candidate) =>
          candidate === phoneDigits ||
          candidate.endsWith(phoneDigits) ||
          phoneDigits.endsWith(candidate),
      )
    })
    if (byPhone) {
      return byPhone
    }
  }
  return customers[0]
}

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
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.username}:${config.password}`).toString("base64")}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) {
    throw new Error(`gKamion customers search failed: HTTP ${response.status}`)
  }
  const body = (await response.json()) as {
    customers?: GkamionCustomerRow[]
    data?: GkamionCustomerRow[]
  }
  return body.customers ?? body.data ?? []
}

/**
 * Resolve the admin cabinet URL for a contact by looking up the gKamion
 * customer via phone and/or email (`GET /customers?search_word=…`).
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
  const email = contact.email?.trim() || null
  const phoneDigits = contact.phoneNumber ? digitsOnly(contact.phoneNumber) : ""

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
