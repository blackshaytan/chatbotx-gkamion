import {
  chatNotificationTypes,
  type ChatNotificationPayload,
  type NotificationPayload,
  taskNotificationTypes,
} from "@chatbotx.io/database/partials"
import { z } from "zod"

export const notificationPayloadResource = z.object({
  taskTitle: z.string(),
  actorUserId: z.string().nullable(),
  actorLabel: z.string().nullable(),
  excerpt: z.string().nullable(),
  from: z.string().nullable().optional(),
  to: z.string().nullable().optional(),
}) satisfies z.ZodType<NotificationPayload>

export const notificationItemResource = z.object({
  id: z.string(),
  type: taskNotificationTypes,
  taskId: z.string(),
  payload: notificationPayloadResource,
  readAt: z.date().nullable(),
  createdAt: z.date(),
  url: z.string(),
})

export const chatNotificationItemResource = z.object({
  id: z.string(),
  type: chatNotificationTypes,
  threadId: z.string(),
  payload: z.object({
    actorUserId: z.string().nullable(),
    actorLabel: z.string().nullable(),
    excerpt: z.string().nullable(),
    count: z.number().int(),
    lastMessageId: z.string(),
    lastMessageAt: z.string(),
  }) satisfies z.ZodType<ChatNotificationPayload>,
  readAt: z.date().nullable(),
  createdAt: z.date(),
  url: z.string(),
})

export const anyNotificationItemResource = z.union([
  notificationItemResource,
  chatNotificationItemResource,
])

export type NotificationItem = z.infer<typeof anyNotificationItemResource>

export const notificationPreferencesResource = z.object({
  taskAssigned: z.boolean(),
  taskMentioned: z.boolean(),
  taskCommented: z.boolean(),
  taskStatusChanged: z.boolean(),
  taskDueChanged: z.boolean(),
  taskReminder: z.boolean(),
  taskOverdue: z.boolean(),
  chatMessage: z.boolean(),
})

export type NotificationPreferences = z.infer<
  typeof notificationPreferencesResource
>
