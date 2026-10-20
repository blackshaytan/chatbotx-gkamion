import { DROM_BASE_URL } from "../constants"
import { stripTags } from "./html"

export type DromDealItem = {
  title: string
  price: number | null
  qty: number
  url: string
  annotation: string
}

export type DromDeal = {
  dealId: string | null
  orderUrl: string
  buyerName: string
  phone: string
  email: string
  city: string
  deliveryMethod: string
  pickupAddress: string
  items: DromDealItem[]
}

const DEAL_ID_IN_URL = /\/deal\/(\d+)/
const DATA_ID = /data-id="(\d+)"/
const RECIPIENT =
  /deal-delivery-details__label[^>]*>\s*получатель\s*<\/span>\s*(?:<span>([^<]*)<\/span>\s*)?(?:<span>([^<]*)<\/span>\s*)?/is
const HAS_DIGIT = /\d/
const PHONE = /<div class="phone"[^>]*>(.*?)<\/div>/is
const EMAIL = /<div class="contact email"[^>]*>(.*?)<\/div>/is
const CITY = /<div class="city"[^>]*>(.*?)<\/div>/is
const DELIVERY =
  /deal-delivery-details__label[^>]*>\s*(?:способ получения|пункт выдачи)\s*<\/span>\s*<strong>(.*?)<\/strong>(?:\s*<span>(.*?)<\/span>)?/is
const LINE_BREAKS = /\s*\n\s*/g
const EDGE_COMMAS = /^[\s,]+|[\s,]+$/g
const DELIVERY_FALLBACK = /Доставка\s+ТК\s+(?:&laquo;|«)?([^<&»"]+)/i
const PICKUP_BUTTON =
  /delivery-pick-up-address-button[\s\S]*?<span>([^<]+)<\/span>/i
const ITEM_BLOCK =
  /<div\s+class="bulletin-of-deal[^"]*"[^>]*>(.*?)<div class="clear"><\/div>\s*<\/div>/gis
const SUBJECT_HREF = /class="bulletin-subject"[^>]*href="([^"]+)"/i
const HREF_SUBJECT = /href="([^"]+)"[^>]*class="bulletin-subject"/i
const SUBJECT_TITLE = /class="bulletin-subject"[^>]*>(.*?)<\/a>/is
const PRICE_QTY =
  /class="bulletin-price"[^>]*data-price="(\d+)"[^>]*data-quantity="(\d+)"/i
const PRICE = /data-price="(\d+)"/
const QTY = /class="subject-quantity"[^>]*data-quantity="(\d+)"/i
const ANNOTATION = /class="bulletin-annotation"[^>]*>(.*?)<\/div>/is
const DIGITS_ONLY = /^\d+$/
const DEAL_URL = /(https?:\/\/baza\.drom\.ru\/deal\/\d+)/
const LONG_NUMBER = /(?:deal\/)?(\d{6,})/

const textOf = (pattern: RegExp, html: string): string => {
  const inner = pattern.exec(html)?.[1]
  return inner === undefined ? "" : stripTags(inner)
}

const absolute = (href: string): string =>
  href.startsWith("/") ? `${DROM_BASE_URL}${href}` : href

const parseItem = (html: string): DromDealItem => {
  const href = (SUBJECT_HREF.exec(html) ?? HREF_SUBJECT.exec(html))?.[1] ?? ""
  let price: number | null = null
  let qty = 1
  const priceQty = PRICE_QTY.exec(html)
  if (priceQty) {
    price = Number(priceQty[1])
    qty = Number(priceQty[2]) || 1
  } else {
    const onlyPrice = PRICE.exec(html)?.[1]
    price = onlyPrice ? Number(onlyPrice) : null
    qty = Number(QTY.exec(html)?.[1]) || 1
  }
  return {
    title: textOf(SUBJECT_TITLE, html),
    price,
    qty,
    url: href ? absolute(href) : "",
    annotation: textOf(ANNOTATION, html),
  }
}

const parseDelivery = (
  html: string,
): { deliveryMethod: string; pickupAddress: string } => {
  const delivery = DELIVERY.exec(html)
  let deliveryMethod = delivery ? stripTags(delivery[1] ?? "") : ""
  let pickupAddress = delivery
    ? stripTags(delivery[2] ?? "")
        .replace(LINE_BREAKS, ", ")
        .replace(EDGE_COMMAS, "")
    : ""
  if (!deliveryMethod) {
    const company = DELIVERY_FALLBACK.exec(html)?.[1]
    if (company) {
      deliveryMethod = `TK «${stripTags(company)}»`
    }
  }
  pickupAddress = pickupAddress || textOf(PICKUP_BUTTON, html)
  return { deliveryMethod, pickupAddress }
}

/** Parses the seller's order page `baza.drom.ru/deal/<id>`. */
export const parseDeal = (html: string, orderUrl: string): DromDeal => {
  const body = html ?? ""
  const dealId =
    DEAL_ID_IN_URL.exec(orderUrl)?.[1] ?? DATA_ID.exec(body)?.[1] ?? null
  const recipient = RECIPIENT.exec(body)
  const recipientPhone = stripTags(recipient?.[2] ?? "")
  const phone = HAS_DIGIT.test(recipientPhone)
    ? recipientPhone
    : textOf(PHONE, body)
  return {
    dealId,
    orderUrl: orderUrl || (dealId ? `${DROM_BASE_URL}/deal/${dealId}` : ""),
    buyerName: stripTags(recipient?.[1] ?? ""),
    phone,
    email: textOf(EMAIL, body),
    city: textOf(CITY, body),
    ...parseDelivery(body),
    items: [...body.matchAll(ITEM_BLOCK)].map((block) => parseItem(block[0])),
  }
}

/** Order id, `/deal/<id>` or any text with a deal link → canonical deal URL. */
export const normalizeOrderUrl = (value: string): string => {
  const raw = (value ?? "").trim()
  if (!raw) {
    return ""
  }
  if (DIGITS_ONLY.test(raw)) {
    return `${DROM_BASE_URL}/deal/${raw}`
  }
  if (raw.startsWith("/deal/")) {
    return `${DROM_BASE_URL}${raw}`
  }
  if (raw.includes("baza.drom.ru/deal/")) {
    return DEAL_URL.exec(raw)?.[1] ?? raw
  }
  const id = LONG_NUMBER.exec(raw)?.[1]
  return id ? `${DROM_BASE_URL}/deal/${id}` : raw
}
