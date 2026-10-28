import {
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

export type NotificationItem = z.infer<typeof notificationItemResource>

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
