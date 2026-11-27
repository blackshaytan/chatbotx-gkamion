import { DROM_BASE_URL } from "../constants"
import { DromAPIException } from "../exception"
import { createDromClient } from "../lib/http-client"
import {
  type DromDeal,
  type DromDealItem,
  normalizeOrderUrl,
  parseBulletinFacts,
  parseDeal,
} from "../parse"
import type { DromAuthValue } from "../schema"

const MIN_ORDER_HTML_LENGTH = 200
const MAX_ENRICHED_ITEMS = 3
const MODAL_REFERER = `${DROM_BASE_URL}/personal/messaging-modal`

/**
 * The deal page lists positions with a title, price and qty only. «Номер запчасти»
 * and «Производитель» live on the position card (`/dealview/<deal>/good/<id>`), so
 * each position is read once under the seller session. A failed card keeps the
 * item unchanged: the deal itself must still reach ChatbotX.
 */
const enrichItems = async (
  auth: DromAuthValue,
  items: DromDealItem[],
): Promise<DromDealItem[]> => {
  const client = createDromClient(auth)
  const enriched: DromDealItem[] = []
  for (const [index, item] of items.entries()) {
    if (
      index >= MAX_ENRICHED_ITEMS ||
      !item.url.startsWith(`${DROM_BASE_URL}/`)
    ) {
      enriched.push(item)
      continue
    }
    try {
      const html = await client.getHtml(item.url, { referer: MODAL_REFERER })
      const facts = parseBulletinFacts(html)
      enriched.push({
        ...item,
        article: facts.article || item.article,
        brand: facts.brand || item.brand,
      })
    } catch {
      enriched.push(item)
    }
  }
  return enriched
}

export const fetchDeal = async (
  auth: DromAuthValue,
  orderUrl: string,
): Promise<DromDeal> => {
  const url = normalizeOrderUrl(orderUrl)
  if (!url.startsWith(`${DROM_BASE_URL}/deal/`)) {
    throw new DromAPIException("DROM order URL is invalid", 400, "invalidOrder")
  }
  const html = await createDromClient(auth).getHtml(url, {
    referer: MODAL_REFERER,
  })
  if (html.length < MIN_ORDER_HTML_LENGTH) {
    throw new DromAPIException("empty_order_html", 502, "emptyOrder")
  }
  const deal = parseDeal(html, url)
  return { ...deal, items: await enrichItems(auth, deal.items) }
}
