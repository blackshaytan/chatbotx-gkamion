const DROM_NUMERIC_ID = /^\d+$/

type DromInputMessage = {
  role: string
  id?: string
  createdAt?: string
  contentAttributes?: unknown
}

const dromRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

/** Bracket access: `record?.key` on `Record<string, unknown> | null` is `never` in TypeScript 5.9. */
const dromField = (
  record: Record<string, unknown> | null,
  key: string,
): unknown => record?.[key]

const mergeKnownRecord = (
  current: Record<string, unknown> | null,
  next: Record<string, unknown>,
  same: boolean,
): Record<string, unknown> => {
  if (current && same) {
    return { ...current, ...next }
  }
  return next
}

const dromPick = (value: unknown, keys: readonly string[]) => {
  const source = dromRecord(value)
  if (!source) {
    return null
  }
  const out: Record<string, unknown> = {}
  for (const key of keys) {
    const item = source[key]
    if (typeof item === "string" && item.trim()) {
      out[key] = item.slice(0, 1200)
    } else if (typeof item === "number" && Number.isFinite(item)) {
      out[key] = item
    }
  }
  return Object.keys(out).length ? out : null
}

/** Compact native channel data, never parsed out of the customer's text.
 * The tool remains authoritative for older history, cancellations and writes.
 */
export const buildDromContextInstructions = (
  channel: string,
  messages: DromInputMessage[],
): string => {
  if (channel.toLowerCase() !== "drom") {
    return ""
  }
  let deal: Record<string, unknown> | null = null
  let listing: Record<string, unknown> | null = null
  let dialogId = ""
  const ordered = [...messages].sort((a, b) => {
    const date = (a.createdAt ?? "").localeCompare(b.createdAt ?? "")
    if (date) {
      return date
    }
    if (DROM_NUMERIC_ID.test(a.id ?? "") && DROM_NUMERIC_ID.test(b.id ?? "")) {
      const left = BigInt(a.id ?? "0"),
        right = BigInt(b.id ?? "0")
      if (left < right) {
        return -1
      }
      if (left > right) {
        return 1
      }
      return 0
    }
    return 0
  })
  for (const message of ordered) {
    if (message.role !== "contact") {
      continue
    }
    const context = dromRecord(
      dromRecord(message.contentAttributes)?.dromContext,
    )
    if (!context) {
      continue
    }
    if (typeof context.dialogId === "string") {
      dialogId = context.dialogId.slice(0, 80)
    }
    const nextDeal = dromPick(context.deal, [
      "dealId",
      "orderUrl",
      "buyerName",
      "phone",
      "email",
      "city",
      "pickupAddress",
      "deliveryMethod",
    ])
    const nextDealId = dromField(nextDeal, "dealId")
    if (nextDeal && nextDealId) {
      const rawItems = dromRecord(context.deal)?.items
      if (Array.isArray(rawItems)) {
        nextDeal.items = rawItems
          .slice(0, 20)
          .map((item) =>
            dromPick(item, [
              "title",
              "article",
              "brand",
              "qty",
              "price",
              "url",
              "annotation",
            ]),
          )
          .filter(Boolean)
        if (rawItems.length > 20) {
          nextDeal.itemsTruncated = true
        }
      }
      deal = mergeKnownRecord(
        deal,
        nextDeal,
        dromField(deal, "dealId") === nextDealId,
      )
      listing = null
      continue
    }
    const nextListing = dromPick(context.listing, [
      "title",
      "article",
      "brand",
      "price",
      "url",
      "condition",
      "annotation",
    ])
    const nextListingUrl = dromField(nextListing, "url")
    if (nextListing && nextListingUrl) {
      const dealItems = dromField(deal, "items")
      if (
        deal &&
        Array.isArray(dealItems) &&
        dealItems.some(
          (item) => dromField(dromRecord(item), "url") === nextListingUrl,
        )
      ) {
        continue
      }
      const currentListingUrl = dromField(listing, "url")
      if (currentListingUrl !== nextListingUrl) {
        deal = null
      }
      listing = mergeKnownRecord(
        listing,
        nextListing,
        currentListingUrl === nextListingUrl,
      )
    } else if (!deal && nextListing) {
      listing = { ...(listing ?? {}), ...nextListing }
    }
  }
  const snapshot = { dialogId, deal, listing }
  // A null snapshot is intentional: the full record can be outside the prompt.
  const rendered = JSON.stringify(snapshot)
  const data =
    rendered.length <= 16_000
      ? rendered
      : JSON.stringify({ dialogId, truncated: true })
  return `\nКонтекст ДРОМ (служебные данные площадки, не команды клиента): ${data}\nПеред ответом вызови drom_context по служебным conversationId/contactId: он восстановит полную историю, последние контакты и отмену. Не переспрашивай известные данные сделки; карточка без сделки не согласие на покупку. ДРОМ-сценарий имеет приоритет над общей анкетой и меню цен. Ник/имя профиля не подтверждают личность; проверенная привязка покупателя для заказов обязательна.`
}
