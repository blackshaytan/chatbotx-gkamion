import {
  type TaskNotificationType,
  taskNotificationTypes,
  type WorkspaceMemberNotificationTypes,
} from "@chatbotx.io/database/partials"

export type TaskNotificationPreferences = Record<TaskNotificationType, boolean>

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
