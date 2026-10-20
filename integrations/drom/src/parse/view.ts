import { spanInnersByClass, stripTags } from "./html"
import { type DromImage, parseMessageImages } from "./images"

export type DromDirection = "in" | "out" | "unknown"

export type DromMessage = {
  messageId: string
  direction: DromDirection
  time: string
  text: string
  images: DromImage[]
  /** «Покупатель выбрал …» line DROM inserts when a buyer places an order. */
  isDealSystem: boolean
}

export type DromListing = {
  title: string
  url: string | null
  price: number | null
}

export type DromView = {
  dialogId: string | null
  latestMessageId: string | null
  interlocutor: string
  listing: DromListing | null
  orderUrl: string | null
  messages: DromMessage[]
}

const DIALOG_ID = /data-dialog-id="(\d+)"/
const LATEST_MESSAGE_ID = /data-latest-msg-id="(\d+)"/
const ORDER_LINK =
  /<a href="(https:\/\/baza\.drom\.ru\/deal\/\d+)"[^>]*>\s*Заказ\s*<\/a>/is
const HEADER_LINK =
  /<a href="(https:\/\/baza\.drom\.ru\/[^"]+)"[^>]*>(.*?)<\/a>/s
const SUB_TITLE = /bzr-dialog-header__sub-title[^>]*>(.*?)<\/h3>/is
const DIGITS = /([\d\s]+)/
const NON_DIGITS = /\D/g
const PRICE_IN_TITLE = /([\d\s\u00a0]+)\s*(?:р\.?|₽|руб)/i
const CONTAINER = /<div class="bzr-dialog__msg-container"[^>]*>/g
const MESSAGE_ID = /data-message-id="(\d+)"/
const HASH = /data-hash="([^"]+)"/
const DEAL_BLOCK = /<div class="bzr-dialog__deal">([\s\S]*?)<\/div>/i
const DEAL_TIME = /class="bzr-dialog__deal-dt"[^>]*>(.*?)<\/span>/s
const DEAL_TIME_SPAN = /<span class="bzr-dialog__deal-dt"[^>]*>.*?<\/span>/gis
const MESSAGE_CLASS = /class="bzr-dialog__message ([^"]+)"/g
const ALL_MESSAGE_IDS = /data-message-id="(\d+)"/g
const NUMERIC = /^\d+$/

export const parsePriceFromTitle = (title: string): number | null => {
  const match = PRICE_IN_TITLE.exec(title ?? "")
  const digits = match?.[1]?.replace(NON_DIGITS, "") ?? ""
  return digits ? Number.parseInt(digits, 10) : null
}

const directionOf = (html: string, inMarker: string, outMarker: string) => {
  if (html.includes(inMarker)) {
    return "in"
  }
  return html.includes(outMarker) ? "out" : "unknown"
}

const subTitleBits = (header: string): string[] => {
  const sub = SUB_TITLE.exec(header)?.[1]
  return sub === undefined
    ? []
    : stripTags(sub)
        .split("•")
        .map((bit) => bit.trim())
}

const orderPriceOf = (bits: string[]): number | null => {
  if (bits.length < 3) {
    return null
  }
  const digits = DIGITS.exec(bits[1] ?? "")?.[1]?.replace(NON_DIGITS, "")
  return digits ? Number.parseInt(digits, 10) : null
}

const parseHeader = (
  header: string,
): { listing: DromListing | null; orderUrl: string | null } => {
  let orderUrl = ORDER_LINK.exec(header)?.[1] ?? null
  const link = HEADER_LINK.exec(header)
  if (link?.[1] && !link[1].includes("/deal/")) {
    const title = stripTags(link[2] ?? "")
    return {
      listing: { title, url: link[1], price: parsePriceFromTitle(title) },
      orderUrl,
    }
  }
  if (link?.[1]) {
    orderUrl = orderUrl ?? link[1]
  }
  if (!orderUrl) {
    return { listing: null, orderUrl: null }
  }
  // «Заказ • 3 534 р. • Клапан ТНВД»: the tail is the ordered item.
  const bits = subTitleBits(header)
  const title = bits.at(-1) ?? ""
  return {
    listing: title ? { title, url: null, price: orderPriceOf(bits) } : null,
    orderUrl,
  }
}

const parseChatContainer = (html: string, messageId: string): DromMessage => {
  const times = spanInnersByClass(html, "bzr-dialog__message-dt")
  const texts = spanInnersByClass(html, "bzr-dialog__text")
  return {
    messageId,
    direction: directionOf(
      html,
      "bzr-dialog__message_in",
      "bzr-dialog__message_out",
    ),
    time: times[0] === undefined ? "" : stripTags(times[0]),
    text: texts[0] === undefined ? "" : stripTags(texts[0]),
    images: parseMessageImages(html),
    isDealSystem: false,
  }
}

const parseDealContainer = (html: string, hash: string): DromMessage | null => {
  const deal = DEAL_BLOCK.exec(html)?.[1]
  if (deal === undefined) {
    return null
  }
  const text = stripTags(deal.replace(DEAL_TIME_SPAN, ""))
  if (!text.toLowerCase().includes("выбрал")) {
    return null
  }
  const time = DEAL_TIME.exec(deal)?.[1]
  return {
    messageId: `deal:${hash}`,
    direction: "in",
    time: time === undefined ? "" : stripTags(time),
    text,
    images: [],
    isDealSystem: true,
  }
}

/** Older markup without per-message containers: zip ids, classes and texts. */
const parseFlatMessages = (html: string): DromMessage[] => {
  const classes = [...html.matchAll(MESSAGE_CLASS)].map((m) => m[1] ?? "")
  const texts = spanInnersByClass(html, "bzr-dialog__text")
  const times = spanInnersByClass(html, "bzr-dialog__message-dt")
  return [...html.matchAll(ALL_MESSAGE_IDS)].map((match, index) => {
    const time = times[index]
    const text = texts[index]
    return {
      messageId: match[1] ?? "",
      direction: directionOf(classes[index] ?? "", "message_in", "message_out"),
      time: time === undefined ? "" : stripTags(time),
      text: text === undefined ? "" : stripTags(text),
      images: [],
      isDealSystem: false,
    }
  })
}

const parseMessages = (html: string): DromMessage[] => {
  const starts = [...html.matchAll(CONTAINER)]
  const messages: DromMessage[] = []
  starts.forEach((start, index) => {
    const chunk = html.slice(start.index, starts[index + 1]?.index)
    const messageId = MESSAGE_ID.exec(start[0])?.[1]
    if (messageId) {
      messages.push(parseChatContainer(chunk, messageId))
      return
    }
    const hash = HASH.exec(start[0])?.[1]
    const deal = hash ? parseDealContainer(chunk, hash) : null
    if (deal) {
      messages.push(deal)
    }
  })
  if (messages.some((message) => NUMERIC.test(message.messageId))) {
    return messages
  }
  return [...messages, ...parseFlatMessages(html)]
}

/** Parses the `messaging/view?json=true` payload of one dialog. */
export const parseView = (view: {
  dialog?: string
  header?: string
  interlocutor?: string
}): DromView => {
  const dialog = view.dialog ?? ""
  const { listing, orderUrl } = parseHeader(view.header ?? "")
  return {
    dialogId: DIALOG_ID.exec(dialog)?.[1] ?? null,
    latestMessageId: LATEST_MESSAGE_ID.exec(dialog)?.[1] ?? null,
    interlocutor: view.interlocutor ?? "",
    listing,
    orderUrl,
    messages: parseMessages(dialog),
  }
}
