import z from "zod"

export const taskNotificationTypes = z.enum([
  "taskAssigned",
  "taskMentioned",
  "taskCommented",
  "taskStatusChanged",
  "taskDueChanged",
  "taskReminder",
  "taskOverdue",
])
export type TaskNotificationType = z.infer<typeof taskNotificationTypes>

export const TASK_NOTIFICATION_ENTITY_TYPES = ["task"] as const
export type TaskNotificationEntityType =
  (typeof TASK_NOTIFICATION_ENTITY_TYPES)[number]

export const chatNotificationTypes = z.enum(["chatMessage"])
export type ChatNotificationType = z.infer<typeof chatNotificationTypes>

export const NOTIFICATION_ENTITY_TYPES = ["task", "chat"] as const
export type NotificationEntityType = (typeof NOTIFICATION_ENTITY_TYPES)[number]

export type NotificationPayload = {
  taskTitle: string
  actorUserId: string | null
  actorLabel: string | null
  excerpt: string | null
  from?: string | null
  to?: string | null
}

export type ChatNotificationPayload = {
  actorUserId: string | null
  actorLabel: string | null
  excerpt: string | null
  count: number
  lastMessageId: string
  lastMessageAt: string
}

export type AnyNotificationPayload =
  | NotificationPayload
  | ChatNotificationPayload
