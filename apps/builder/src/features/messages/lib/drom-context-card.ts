/**
 * DROM hands the agent two pieces of native context on an incoming message:
 * the ad the customer wrote from (`dromContext.listing`) and, once they buy,
 * the deal they placed (`dromContext.deal`). The integration stores both under
 * `contentAttributes.dromContext`, which nothing in the builder painted — an
 * agent reading the thread saw the customer's words only, with no way back to
 * the card they applied from.
 *
 * This module turns that record into a card model. Rendering lives in
 * `../components/drom-context-card.tsx`; the same data reaches AI agents
 * through the public messages API (`contentAttributes`), so no separate
 * operation is needed.
 */

/** Every link DROM context can carry must stay on the marketplace origin. */
const DROM_CARD_URL = /^https:\/\/baza\.drom\.ru\/[^\s"'<>]+$/i
const DROM_DEAL_URL = "https://baza.drom.ru/deal/"
const NUMERIC_ID = /^\d{1,20}$/

export type DromListingCard = {
  /** Customer wrote from this ad. */
  kind: "listing"
  href: string
  title: string
  price: number | null
}

export type DromDealCard = {
  /** Customer placed this order. */
  kind: "deal"
  href: string
  title: string
  price: number | null
  itemsCount: number
}

export type DromContextCardData = DromListingCard | DromDealCard

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

const asText = (value: unknown): string =>
  typeof value === "string" ? value.trim() : ""

/** Only http(s) DROM links are trusted; channel data is never sanitized for us. */
const asDromUrl = (value: unknown): string | null => {
  const url = asText(value)
  return DROM_CARD_URL.test(url) ? url : null
}

const asAmount = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : null

const asQuantity = (value: unknown): number => {
  const qty =
    typeof value === "number" && Number.isFinite(value) ? Math.round(value) : 0
  return qty > 0 ? qty : 1
}

const dealItems = (deal: Record<string, unknown>): Record<string, unknown>[] =>
  Array.isArray(deal.items)
    ? deal.items.map(asRecord).filter((item) => item !== null)
    : []

/**
 * Order total, or `null` when any line has no price — a partial sum would read
 * as the order value and lie about it.
 */
const dealTotal = (items: Record<string, unknown>[]): number | null => {
  if (items.length === 0) {
    return null
  }
  let total = 0
  for (const item of items) {
    const price = asAmount(item.price)
    if (price === null) {
      return null
    }
    total += price * asQuantity(item.qty)
  }
  return total
}

const dealCard = (deal: Record<string, unknown>): DromDealCard | null => {
  const dealId = asText(deal.dealId)
  if (!NUMERIC_ID.test(dealId)) {
    return null
  }
  const items = dealItems(deal)
  const first = items[0]
  return {
    kind: "deal",
    // An unknown `orderUrl` shape must not cost the card its link.
    href: asDromUrl(deal.orderUrl) ?? `${DROM_DEAL_URL}${dealId}`,
    title: asText(first?.title),
    // No fallback to one line: a partial total would read as the order value.
    price: dealTotal(items),
    itemsCount: items.length,
  }
}

/**
 * The card an incoming DROM message carries, if any.
 *
 * A deal wins over the listing: once a purchase exists its header title also
 * matches the listing branch, and the deal is the fact the agent has to see.
 * A listing without a URL is dropped — DROM fills the title from the order
 * header, so there would be nothing to open.
 */
export const getDromContextCard = (
  contentAttributes: unknown,
): DromContextCardData | null => {
  const context = asRecord(asRecord(contentAttributes)?.dromContext)
  if (!context) {
    return null
  }

  const deal = asRecord(context.deal)
  if (deal) {
    const card = dealCard(deal)
    if (card) {
      return card
    }
  }

  const listing = asRecord(context.listing)
  if (!listing) {
    return null
  }
  const href = asDromUrl(listing.url)
  if (!href) {
    return null
  }
  return {
    kind: "listing",
    href,
    title: asText(listing.title),
    price: asAmount(listing.price),
  }
}

/** The fields the map below reads from a thread message. */
export type DromCardMessage = {
  id: string
  createdAt?: string | Date | null
  contentAttributes?: unknown
}

const timeOf = (value: DromCardMessage["createdAt"]): string => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "" : value.toISOString()
  }
  return typeof value === "string" ? value : ""
}

/**
 * One card per ad/order, anchored to the earliest message that carries it — a
 * DROM dialog repeats its context on every incoming message, and a plate per
 * message would bury the conversation. Keyed by message id for `MessageItem`.
 */
export const dromCardsByMessageId = (
  messages: readonly DromCardMessage[],
): Map<string, DromContextCardData> => {
  const anchor = new Map<string, { id: string; at: string }>()
  for (const message of messages) {
    const card = getDromContextCard(message.contentAttributes)
    if (!card) {
      continue
    }
    const signature = `${card.kind}:${card.href}`
    const at = timeOf(message.createdAt)
    const seen = anchor.get(signature)
    // Ascending order in the store cannot be assumed: the thread prepends older
    // pages, so compare timestamps and fall back to the id for stability.
    if (!seen || at < seen.at || (at === seen.at && message.id < seen.id)) {
      anchor.set(signature, { at, id: message.id })
    }
  }

  const cards = new Map<string, DromContextCardData>()
  const byId = new Map(messages.map((message) => [message.id, message]))
  for (const { id } of anchor.values()) {
    const card = getDromContextCard(byId.get(id)?.contentAttributes)
    if (card) {
      cards.set(id, card)
    }
  }
  return cards
}
