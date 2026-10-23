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

export type NotificationPayload = {
  taskTitle: string
  actorUserId: string | null
  actorLabel: string | null
  excerpt: string | null
  from?: string | null
  to?: string | null
}
