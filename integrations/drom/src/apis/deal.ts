import { DROM_BASE_URL } from "../constants"
import { DromAPIException } from "../exception"
import { createDromClient } from "../lib/http-client"
import { type DromDeal, normalizeOrderUrl, parseDeal } from "../parse"
import type { DromAuthValue } from "../schema"

const MIN_ORDER_HTML_LENGTH = 200

export const fetchDeal = async (
  auth: DromAuthValue,
  orderUrl: string,
): Promise<DromDeal> => {
  const url = normalizeOrderUrl(orderUrl)
  if (!url.startsWith(`${DROM_BASE_URL}/deal/`)) {
    throw new DromAPIException("DROM order URL is invalid", 400, "invalidOrder")
  }
  const html = await createDromClient(auth).getHtml(url, {
    referer: `${DROM_BASE_URL}/personal/messaging-modal`,
  })
  if (html.length < MIN_ORDER_HTML_LENGTH) {
    throw new DromAPIException("empty_order_html", 502, "emptyOrder")
  }
  return parseDeal(html, url)
}
