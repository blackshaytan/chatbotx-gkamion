import type { IncomingContact } from "@chatbotx.io/sdk"
import {
  type MaxAttachment,
  type MaxUpdate,
  type MaxUser,
  maxUpdateSchema,
} from "../schema"

export type MaxInboundMedia = {
  kind: "image" | "video" | "audio" | "file"
  url: string
  filename?: string
}

export type MaxInbound =
  | {
      kind: "message"
      sourceId: string
      contact: IncomingContact
      text?: string
      media: MaxInboundMedia[]
    }
  | {
      kind: "callback"
      sourceId: string
      contact: IncomingContact
      payload: string
    }
  | {
      kind: "started"
      sourceId: string
      contact: IncomingContact
      ref: string | null
    }

const toContact = (user: MaxUser, locale?: string | null): IncomingContact => ({
  sourceId: String(user.user_id),
  firstName: user.first_name ?? user.name,
  ...(user.last_name ? { lastName: user.last_name } : {}),
  ...(locale ? { locale } : {}),
})

const MEDIA_KINDS = new Set(["image", "video", "audio", "file"])

const toMedia = (attachment: MaxAttachment): MaxInboundMedia | null => {
  const url = attachment.payload?.url
  if (!(MEDIA_KINDS.has(attachment.type) && typeof url === "string")) {
    return null
  }
  return {
    kind: attachment.type as MaxInboundMedia["kind"],
    url,
    ...(attachment.filename ? { filename: attachment.filename } : {}),
  }
}

const parseMessage = (update: MaxUpdate): MaxInbound | null => {
  const message = update.message
  const sender = message?.sender
  if (!(message && sender) || sender.is_bot) {
    return null
  }
  if (message.recipient.chat_type && message.recipient.chat_type !== "dialog") {
    return null
  }
  const media = (message.body.attachments ?? [])
    .map(toMedia)
    .filter((item): item is MaxInboundMedia => item !== null)
  return {
    kind: "message",
    sourceId: message.body.mid,
    contact: toContact(sender, update.user_locale),
    ...(message.body.text ? { text: message.body.text } : {}),
    media,
  }
}

/** Normalizes one MAX update; `null` = not a 1:1 user event worth processing. */
export const parseMaxUpdate = (raw: unknown): MaxInbound | null => {
  const parsed = maxUpdateSchema.safeParse(raw)
  if (!parsed.success) {
    return null
  }
  const update = parsed.data
  switch (update.update_type) {
    case "message_created":
      return parseMessage(update)
    case "message_callback": {
      if (!update.callback) {
        return null
      }
      return {
        kind: "callback",
        sourceId: update.callback.callback_id,
        contact: toContact(update.callback.user, update.user_locale),
        payload: update.callback.payload ?? "",
      }
    }
    case "bot_started": {
      if (!update.user) {
        return null
      }
      return {
        kind: "started",
        sourceId: `bot_started:${update.user.user_id}:${update.timestamp}`,
        contact: toContact(update.user, update.user_locale),
        ref: update.payload ?? null,
      }
    }
    default:
      return null
  }
}
