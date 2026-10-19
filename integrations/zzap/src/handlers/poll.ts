import type { PollCursor, PollResult } from "@chatbotx.io/sdk"
import { getBuyer, getOrderBuyer } from "../apis/buyers"
import { listMessages } from "../apis/messages"
import { listThreads } from "../apis/threads"
import { ZzapRateLimitException } from "../exception"
import { makeZzapMessageId } from "../lib/ids"
import { logger } from "../lib/logger"
import { formatMoscowDate } from "../lib/moscow-time"
import { extractOrderCodes } from "../lib/orders"
import type {
  ZzapAuthValue,
  ZzapBuyer,
  ZzapMessage,
  ZzapThread,
} from "../schema"
import type { ZzapInboundEvent } from "./event"

/** Covers clock skew between this server and ZZAP's Moscow timestamps. */
const SKEW_MARGIN_MS = 5 * 60 * 1000
const BUYER_REFRESH_MS = 24 * 60 * 60 * 1000
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000

type ThreadEntry = { lastDate: string; lastPreview: string }

/**
 * `since` is the lower bound for threads without an entry: the start of the
 * previous successful poll (minus the skew margin). `threads` remembers, per
 * buyer, the newest message date already turned into events.
 */
export type ZzapCursor = {
  since: string
  threads: Record<string, ThreadEntry>
  buyers: Record<string, string>
}

const readCursor = (
  cursor: PollCursor | null,
  fallbackSince: string,
): ZzapCursor => ({
  since: typeof cursor?.since === "string" ? cursor.since : fallbackSince,
  threads: { ...((cursor?.threads as ZzapCursor["threads"]) ?? {}) },
  buyers: { ...((cursor?.buyers as ZzapCursor["buyers"]) ?? {}) },
})

const isCandidate = (
  thread: ZzapThread,
  entry: ThreadEntry | undefined,
  since: string,
): boolean => {
  const unread = thread.unread_count ?? 0
  if (entry) {
    return (
      unread > 0 ||
      entry.lastDate !== (thread.message_last_date ?? "") ||
      entry.lastPreview !== (thread.message_last ?? "")
    )
  }
  return unread > 0 || (thread.message_last_date ?? "") >= since
}

const toEvents = (
  thread: ZzapThread,
  messages: ZzapMessage[],
  lowerBound: string,
): ZzapInboundEvent[] =>
  messages
    .filter(
      (message) =>
        message.user_key === thread.user_key &&
        Boolean(message.message?.trim()) &&
        message.message_date >= lowerBound,
    )
    .map((message) => ({
      kind: "message",
      sourceId: makeZzapMessageId({
        userKey: thread.user_key,
        messageDate: message.message_date,
        senderKey: message.user_key,
        message: message.message,
      }),
      userKey: thread.user_key,
      userName: thread.user_name ?? message.user_name ?? "",
      messageDate: message.message_date,
      text: message.message,
      buyer: null,
    }))

const enrichBuyer = async (
  auth: ZzapAuthValue,
  userKey: string,
  texts: string[],
): Promise<ZzapBuyer> => {
  const buyer = await getBuyer(auth, userKey)
  if (buyer.phone || buyer.email) {
    return buyer
  }
  const [orderCode] = texts.flatMap(extractOrderCodes)
  if (!orderCode) {
    return buyer
  }
  const fromOrder = await getOrderBuyer(auth, orderCode)
  return {
    name: buyer.name ?? fromOrder.name,
    phone: fromOrder.phone,
    email: fromOrder.email,
  }
}

const attachBuyers = async (
  auth: ZzapAuthValue,
  cursor: ZzapCursor,
  events: ZzapInboundEvent[],
  now: Date,
): Promise<void> => {
  for (const userKey of new Set(events.map((event) => event.userKey))) {
    const stamp = cursor.buyers[userKey]
    if (stamp && now.getTime() - Date.parse(stamp) < BUYER_REFRESH_MS) {
      continue
    }
    const own = events.filter((event) => event.userKey === userKey)
    try {
      const buyer = await enrichBuyer(
        auth,
        userKey,
        own.map((event) => event.text),
      )
      cursor.buyers[userKey] = now.toISOString()
      for (const event of own) {
        event.buyer = buyer
      }
    } catch (err) {
      logger.warn(
        { err, codeObject: auth.codeObject },
        "zzap poll: buyer enrichment failed",
      )
      if (err instanceof ZzapRateLimitException) {
        return
      }
    }
  }
}

const prune = (cursor: ZzapCursor, now: Date): void => {
  const cutoff = formatMoscowDate(new Date(now.getTime() - RETENTION_MS))
  for (const [key, entry] of Object.entries(cursor.threads)) {
    if (entry.lastDate && entry.lastDate < cutoff) {
      delete cursor.threads[key]
    }
  }
  for (const [key, stamp] of Object.entries(cursor.buyers)) {
    if (now.getTime() - Date.parse(stamp) > RETENTION_MS) {
      delete cursor.buyers[key]
    }
  }
}

/**
 * One ZZAP poll. Threads whose list metadata changed (or that have unread
 * buyer messages) are fetched — at most `maxThreadsPerPoll`, most unread
 * first — and every buyer message not older than the thread's last seen date
 * becomes an event. `>=` re-emits same-second messages on purpose; the inbox
 * dedupes them on `sourceId`. A rate limit stops fetching early without
 * failing the poll; any other API error fails it so the cursor stays put.
 */
export const pollZzap = async (input: {
  auth: ZzapAuthValue
  cursor: PollCursor | null
  now?: Date
}): Promise<PollResult> => {
  const now = input.now ?? new Date()
  const nextSince = formatMoscowDate(new Date(now.getTime() - SKEW_MARGIN_MS))
  const cursor = readCursor(input.cursor, nextSince)
  const previousSince = cursor.since

  const candidates: ZzapThread[] = []
  for (const thread of await listThreads(input.auth)) {
    if (thread.read_only || !thread.user_key) {
      continue
    }
    const entry = cursor.threads[thread.user_key]
    if (isCandidate(thread, entry, previousSince)) {
      candidates.push(thread)
    } else if (!entry) {
      cursor.threads[thread.user_key] = {
        lastDate: thread.message_last_date ?? "",
        lastPreview: thread.message_last ?? "",
      }
    }
  }
  candidates.sort((a, b) => (b.unread_count ?? 0) - (a.unread_count ?? 0))

  const events: ZzapInboundEvent[] = []
  let rateLimited = false
  let fetched = 0
  for (const thread of candidates) {
    const entry = cursor.threads[thread.user_key]
    const deferred = { lastDate: previousSince, lastPreview: "" }
    if (rateLimited || fetched >= input.auth.maxThreadsPerPoll) {
      cursor.threads[thread.user_key] = entry ?? deferred
      continue
    }
    let messages: ZzapMessage[]
    try {
      messages = await listMessages(input.auth, thread.user_key)
    } catch (err) {
      if (!(err instanceof ZzapRateLimitException)) {
        throw err
      }
      logger.warn(
        { err, codeObject: input.auth.codeObject },
        "zzap poll: rate limited, stopping early",
      )
      rateLimited = true
      cursor.threads[thread.user_key] = entry ?? deferred
      continue
    }
    fetched += 1
    events.push(...toEvents(thread, messages, entry?.lastDate ?? previousSince))
    const newest = messages.reduce(
      (latest, message) =>
        message.message_date > latest ? message.message_date : latest,
      entry?.lastDate ?? "",
    )
    cursor.threads[thread.user_key] = {
      lastDate: newest || (thread.message_last_date ?? ""),
      lastPreview: thread.message_last ?? "",
    }
  }

  if (!rateLimited) {
    await attachBuyers(input.auth, cursor, events, now)
  }
  prune(cursor, now)

  return {
    events: events.map((payload) => ({ payload })),
    cursor: {
      since: nextSince,
      threads: cursor.threads,
      buyers: cursor.buyers,
    },
  }
}
