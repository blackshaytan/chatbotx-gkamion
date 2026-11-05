import type { PollCursor, PollResult } from "@chatbotx.io/sdk"
import { type OpenedInbox, openImapInbox } from "../imap"
import { parseRawMail } from "../inbound-mail"
import { logger } from "../lib/logger"
import {
  ownMailboxAddresses,
  type SmtpAuthValue,
  smtpReceiveEnabled,
} from "../schema"
import { bracketMessageId } from "../thread"

const MAX_MESSAGES_PER_POLL = 20
const MAX_SOURCE_BYTES = 8_000_000

export type SmtpPollCursor = { uidValidity: number; lastUid: number }

const readCursor = (cursor: PollCursor | null): SmtpPollCursor | null => {
  if (!cursor) {
    return null
  }
  const { uidValidity, lastUid } = cursor
  if (
    typeof uidValidity !== "number" ||
    typeof lastUid !== "number" ||
    !Number.isFinite(uidValidity) ||
    !Number.isFinite(lastUid)
  ) {
    return null
  }
  return { uidValidity, lastUid }
}

const empty = (cursor: PollCursor): PollResult => ({ events: [], cursor })

/**
 * Pulls new INBOX mail. The first successful poll only records the current
 * UID so mail already in the mailbox is not imported. A UIDVALIDITY change
 * (the mailbox was recreated) does the same instead of replaying history.
 * Receivers dedupe on Message-ID, so a crash after enqueue re-delivers safely.
 */
export const pollSmtpInbox = async (input: {
  auth: SmtpAuthValue
  cursor: PollCursor | null
  openInbox?: (auth: SmtpAuthValue) => Promise<OpenedInbox>
}): Promise<PollResult> => {
  if (!smtpReceiveEnabled(input.auth)) {
    return empty(input.cursor ?? {})
  }
  const openInbox = input.openInbox ?? openImapInbox
  const inbox = await openInbox(input.auth)
  try {
    const fresh: SmtpPollCursor = {
      uidValidity: inbox.uidValidity,
      lastUid: Math.max(inbox.uidNext - 1, 0),
    }
    const stored = readCursor(input.cursor)
    if (!stored || stored.uidValidity !== inbox.uidValidity) {
      return empty(fresh)
    }
    if (fresh.lastUid <= stored.lastUid) {
      return empty(stored)
    }

    const own = ownMailboxAddresses(input.auth)
    const events: PollResult["events"] = []
    let lastUid = stored.lastUid
    let seen = 0
    for await (const message of inbox.fetchSince(stored.lastUid)) {
      if (message.uid <= stored.lastUid) {
        continue
      }
      lastUid = Math.max(lastUid, message.uid)
      seen += 1
      if (!message.source) {
        continue
      }
      if (message.source.byteLength > MAX_SOURCE_BYTES) {
        logger.warn(
          { uid: message.uid, bytes: message.source.byteLength },
          "smtp poll skipped a message larger than 8MB",
        )
        continue
      }
      try {
        const payload = await parseRawMail(
          message.source,
          own,
          bracketMessageId(`imap-${inbox.uidValidity}-${message.uid}@chatbotx`),
        )
        if (payload) {
          events.push({ payload })
        }
      } catch (err) {
        logger.warn(
          { err, uid: message.uid },
          "smtp poll skipped a message that could not be parsed",
        )
      }
      if (seen >= MAX_MESSAGES_PER_POLL) {
        break
      }
    }
    return { events, cursor: { uidValidity: inbox.uidValidity, lastUid } }
  } finally {
    await inbox.close()
  }
}
