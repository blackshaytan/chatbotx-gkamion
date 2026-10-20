import type { PollCursor, PollResult } from "@chatbotx.io/sdk"
import { fetchDeal } from "../apis/deal"
import { viewDialog } from "../apis/dialog"
import { listBriefs } from "../apis/inbox"
import { DromSessionExpiredException } from "../exception"
import { makeDromMessageId } from "../lib/ids"
import { logger } from "../lib/logger"
import type { DromBrief, DromDeal, DromMessage, DromView } from "../parse"
import type { DromAuthValue } from "../schema"
import type { DromInboundEvent } from "./event"

const RETENTION_MS = 60 * 24 * 60 * 60 * 1000
const PHOTO_PLACEHOLDER = "📷 Фото"
const NUMERIC = /^\d+$/

export type DromDialogCursor = {
  /** Newest buyer chat message already turned into an event. */
  lastInboundId: string
  /** `lastMessageDate` of the dialog brief (unix seconds) at that time. */
  lastMessageDate: number
  seenDealIds: string[]
  fetchedDealUrls: string[]
  /** Epoch ms of the last time this dialog was read. */
  updatedAt: number
}

export type DromCursor = { dialogs: Record<string, DromDialogCursor> }

const readCursor = (cursor: PollCursor | null): DromCursor => ({
  dialogs: {
    ...((cursor?.dialogs as DromCursor["dialogs"] | undefined) ?? {}),
  },
})

/** Numeric ids compare by value; DROM ids have no leading zeros. */
const isNewer = (id: string, watermark: string): boolean => {
  if (NUMERIC.test(id) && NUMERIC.test(watermark)) {
    return (
      id.length > watermark.length ||
      (id.length === watermark.length && id > watermark)
    )
  }
  return id !== watermark
}

const needsReply = (brief: DromBrief) => brief.isUnread || brief.highlighted

const isTarget = (brief: DromBrief, entry: DromDialogCursor | undefined) =>
  needsReply(brief) ||
  (entry !== undefined &&
    brief.lastMessageDate > 0 &&
    brief.lastMessageDate > entry.lastMessageDate)

const byPriority = (a: DromBrief, b: DromBrief) =>
  Number(b.isUnread) - Number(a.isUnread) ||
  b.lastMessageDate - a.lastMessageDate

/** Prefers a login over a numeric user id when the list and the view disagree. */
const resolveInterlocutor = (brief: DromBrief, view: DromView): string => {
  const fromBrief = brief.interlocutor.trim()
  const fromView = view.interlocutor.trim()
  if (fromBrief && fromView) {
    if (NUMERIC.test(fromBrief) && !NUMERIC.test(fromView)) {
      return fromView
    }
    if (NUMERIC.test(fromView) && !NUMERIC.test(fromBrief)) {
      return fromBrief
    }
  }
  return fromView || fromBrief
}

const newMessages = (
  brief: DromBrief,
  view: DromView,
  entry: DromDialogCursor | undefined,
): { messages: DromMessage[]; lastInboundId: string } => {
  const inbound = view.messages.filter((m) => m.direction === "in")
  const seenDeals = new Set(entry?.seenDealIds ?? [])
  const deals = inbound.filter(
    (m) => m.isDealSystem && !seenDeals.has(m.messageId),
  )
  const chat = inbound.filter((m) => !m.isDealSystem && m.messageId)
  const watermark = entry?.lastInboundId ?? ""

  let freshChat: DromMessage[]
  if (watermark) {
    freshChat = chat.filter((m) => isNewer(m.messageId, watermark))
  } else {
    // First sight: answer the latest buyer line, not the whole history.
    const latest = chat.at(-1)
    freshChat = needsReply(brief) && latest ? [latest] : []
  }
  const lastInboundId = chat.reduce(
    (max, m) => (!max || isNewer(m.messageId, max) ? m.messageId : max),
    watermark,
  )
  return { messages: [...deals, ...freshChat], lastInboundId }
}

const loadDeal = async (
  auth: DromAuthValue,
  orderUrl: string,
): Promise<DromDeal | null> => {
  try {
    return await fetchDeal(auth, orderUrl)
  } catch (err) {
    if (err instanceof DromSessionExpiredException) {
      throw err
    }
    logger.warn(
      { err, sellerLogin: auth.sellerLogin, orderUrl },
      "drom poll: deal fetch failed",
    )
    return null
  }
}

const toEvent = (
  dialogId: string,
  interlocutor: string,
  view: DromView,
  deal: DromDeal | null,
  message: DromMessage,
): DromInboundEvent | null => {
  const text =
    message.text || (message.images.length > 0 ? PHOTO_PLACEHOLDER : "")
  if (!text) {
    return null
  }
  return {
    kind: "message",
    sourceId: makeDromMessageId(dialogId, message.messageId),
    dialogId,
    messageId: message.messageId,
    interlocutor,
    text,
    images: message.images,
    isDealSystem: message.isDealSystem,
    listing: view.listing,
    deal,
  }
}

const pollDialog = async (
  auth: DromAuthValue,
  brief: DromBrief,
  entry: DromDialogCursor | undefined,
  now: Date,
): Promise<{ events: DromInboundEvent[]; entry: DromDialogCursor }> => {
  const view = await viewDialog(auth, brief.dialogId)
  const interlocutor = resolveInterlocutor(brief, view)
  const { messages, lastInboundId } = newMessages(brief, view, entry)
  const fetchedDealUrls = entry?.fetchedDealUrls ?? []

  let deal: DromDeal | null = null
  let dealUrls = fetchedDealUrls
  if (
    messages.length > 0 &&
    view.orderUrl &&
    !fetchedDealUrls.includes(view.orderUrl)
  ) {
    deal = await loadDeal(auth, view.orderUrl)
    if (deal) {
      dealUrls = [...fetchedDealUrls, view.orderUrl]
    }
  }

  const events = messages
    .map((message) =>
      toEvent(brief.dialogId, interlocutor, view, deal, message),
    )
    .filter((event): event is DromInboundEvent => event !== null)
  const newDealIds = messages
    .filter((m) => m.isDealSystem)
    .map((m) => m.messageId)

  return {
    events,
    entry: {
      lastInboundId,
      lastMessageDate: brief.lastMessageDate || (entry?.lastMessageDate ?? 0),
      seenDealIds: [...new Set([...(entry?.seenDealIds ?? []), ...newDealIds])],
      fetchedDealUrls: dealUrls,
      updatedAt: now.getTime(),
    },
  }
}

const prune = (cursor: DromCursor, now: Date): void => {
  for (const [dialogId, entry] of Object.entries(cursor.dialogs)) {
    if (now.getTime() - entry.updatedAt > RETENTION_MS) {
      delete cursor.dialogs[dialogId]
    }
  }
}

/**
 * One DROM poll. Dialogs that are unread, highlighted or whose last message
 * moved past the stored date are viewed — at most `maxDialogsPerPoll`, unread
 * and newest first. New buyer lines and «Покупатель выбрал» deal lines become
 * events; the order page is fetched once per deal to enrich them. Expired
 * cookies fail the whole poll; any other error of one dialog leaves its cursor
 * untouched so it is retried next time.
 */
export const pollDrom = async (input: {
  auth: DromAuthValue
  cursor: PollCursor | null
  now?: Date
}): Promise<PollResult> => {
  const now = input.now ?? new Date()
  const cursor = readCursor(input.cursor)
  const targets = (await listBriefs(input.auth))
    .filter((brief) => isTarget(brief, cursor.dialogs[brief.dialogId]))
    .sort(byPriority)
    .slice(0, Math.max(1, input.auth.maxDialogsPerPoll))

  const events: DromInboundEvent[] = []
  for (const brief of targets) {
    try {
      const result = await pollDialog(
        input.auth,
        brief,
        cursor.dialogs[brief.dialogId],
        now,
      )
      events.push(...result.events)
      cursor.dialogs[brief.dialogId] = result.entry
    } catch (err) {
      if (err instanceof DromSessionExpiredException) {
        throw err
      }
      logger.warn(
        { err, sellerLogin: input.auth.sellerLogin, dialogId: brief.dialogId },
        "drom poll: dialog failed, retrying next poll",
      )
    }
  }
  prune(cursor, now)

  return {
    events: events.map((payload) => ({ payload })),
    cursor: { dialogs: cursor.dialogs },
  }
}
