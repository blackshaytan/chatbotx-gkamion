import type { BaseConfig, SecretTextAuthValue } from "@chatbotx.io/sdk"
import { z } from "zod"

export type MaxAuthValue = SecretTextAuthValue & {
  botId: string
  botName: string
  webhookSecret: string
}

export type MaxConfig = BaseConfig & {
  botId?: string
  webhookSecret?: string
}

// ─── Incoming update schemas ─────────────────────────────────────────────────

export const maxUserSchema = z
  .object({
    user_id: z.number(),
    first_name: z.string().optional(),
    last_name: z.string().nullish(),
    name: z.string().optional(),
    username: z.string().nullish(),
    is_bot: z.boolean().optional(),
  })
  .passthrough()
export type MaxUser = z.infer<typeof maxUserSchema>

export const maxAttachmentSchema = z
  .object({
    type: z.string(),
    payload: z.record(z.string(), z.unknown()).nullish(),
    filename: z.string().optional(),
    size: z.number().optional(),
  })
  .passthrough()
export type MaxAttachment = z.infer<typeof maxAttachmentSchema>

export const maxMessageSchema = z
  .object({
    sender: maxUserSchema.optional(),
    recipient: z
      .object({
        chat_id: z.number().nullish(),
        chat_type: z.string().optional(),
        user_id: z.number().nullish(),
      })
      .passthrough(),
    timestamp: z.number(),
    body: z
      .object({
        mid: z.string(),
        text: z.string().nullish(),
        attachments: z.array(maxAttachmentSchema).nullish(),
      })
      .passthrough(),
  })
  .passthrough()

export const maxUpdateSchema = z
  .object({
    update_type: z.string(),
    timestamp: z.number(),
    message: maxMessageSchema.optional(),
    callback: z
      .object({
        callback_id: z.string(),
        payload: z.string().optional(),
        user: maxUserSchema,
      })
      .passthrough()
      .optional(),
    user: maxUserSchema.optional(),
    payload: z.string().nullish(),
    user_locale: z.string().nullish(),
  })
  .passthrough()
export type MaxUpdate = z.infer<typeof maxUpdateSchema>

// ─── Outgoing message types ──────────────────────────────────────────────────

export type MaxButton =
  | { type: "callback"; text: string; payload: string }
  | { type: "link"; text: string; url: string }

export type MaxAttachmentRequest =
  | { type: "image"; payload: { url: string } | { token: string } }
  | { type: "video" | "audio" | "file"; payload: { token: string } }
  | { type: "inline_keyboard"; payload: { buttons: MaxButton[][] } }

export type MaxNewMessageBody = {
  text?: string
  attachments?: MaxAttachmentRequest[]
}
