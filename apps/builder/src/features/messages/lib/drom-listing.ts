export type DromListingLink = {
  title: string
  url: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

/** Bulletin and order pages live on drom.ru. Anything else must not become a link. */
export const safeDromProductUrl = (value: unknown): string | null => {
  if (typeof value !== "string" || value.trim() === "") {
    return null
  }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    return null
  }
  const host = url.hostname.toLowerCase()
  if (host !== "drom.ru" && !host.endsWith(".drom.ru")) {
    return null
  }
  return url.toString()
}

const readTitle = (value: unknown): string =>
  typeof value === "string" ? value.trim() : ""

const readListing = (
  value: unknown,
): { title: string; url: string | null } | null => {
  if (!isRecord(value)) {
    return null
  }
  const title = readTitle(value.title)
  const url = safeDromProductUrl(value.url)
  if (!(title || url)) {
    return null
  }
  return { title, url }
}

/**
 * The Drom dialog header (price and part name, linking to the bulletin) is
 * stored on the inbound message and never written into the message text.
 */
export const readDromListingLink = (
  contentAttributes: unknown,
): DromListingLink | null => {
  if (!isRecord(contentAttributes)) {
    return null
  }
  const context = contentAttributes.dromContext
  if (!isRecord(context)) {
    return null
  }
  const listing = readListing(context.listing)
  if (listing?.url) {
    return { title: listing.title, url: listing.url }
  }
  const deal = context.deal
  if (isRecord(deal) && Array.isArray(deal.items)) {
    for (const item of deal.items) {
      if (!isRecord(item)) {
        continue
      }
      const url = safeDromProductUrl(item.url)
      if (!url) {
        continue
      }
      return { title: readTitle(item.title) || listing?.title || "", url }
    }
  }
  return null
}

/** Oldest loaded message wins: the card belongs before the first client line. */
export const firstDromListingLink = (
  messages: { contentAttributes: unknown; deletedAt?: unknown }[],
): DromListingLink | null => {
  for (const message of messages) {
    if (message.deletedAt) {
      continue
    }
    const link = readDromListingLink(message.contentAttributes)
    if (link) {
      return link
    }
  }
  return null
}
