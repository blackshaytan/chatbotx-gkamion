import {
  chatNotificationTypes,
  type ChatNotificationType,
  type TaskNotificationType,
  taskNotificationTypes,
  type WorkspaceMemberNotificationTypes,
} from "@chatbotx.io/database/partials"

export type TaskNotificationPreferences = Record<TaskNotificationType, boolean>
export type ChatNotificationPreferences = Record<ChatNotificationType, boolean>
export type NotificationPreferences = TaskNotificationPreferences &
  ChatNotificationPreferences

export const isTaskNotificationEnabled = (
  notificationTypes: Partial<WorkspaceMemberNotificationTypes>,
  type: TaskNotificationType,
): boolean => {
  const value = notificationTypes[type]
  return value === undefined ? true : value
}

export const readTaskNotificationPreferences = (
  notificationTypes: Partial<WorkspaceMemberNotificationTypes>,
): TaskNotificationPreferences => {
  const prefs = {} as TaskNotificationPreferences
  for (const type of taskNotificationTypes.options) {
    prefs[type] = isTaskNotificationEnabled(notificationTypes, type)
  }
  return prefs
}

export const readChatNotificationPreferences = (
  notificationTypes: Partial<WorkspaceMemberNotificationTypes>,
): ChatNotificationPreferences => {
  const prefs = {} as ChatNotificationPreferences
  for (const type of chatNotificationTypes.options) {
    const value = notificationTypes[type]
    prefs[type] = value === undefined ? true : value
  }
  return prefs
}
