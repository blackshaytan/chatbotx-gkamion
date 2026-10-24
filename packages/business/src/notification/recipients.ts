import type { TaskNotificationType } from "@chatbotx.io/database/partials"

export type TaskNotificationActionEvent =
  | { kind: "assigned"; userIds: string[] }
  | { kind: "mentioned"; userIds: string[] }
  | { kind: "commented" }
  | { kind: "statusChanged" }
  | { kind: "dueChanged" }
  | { kind: "reminder"; userIds: string[] }
  | { kind: "overdue"; userIds: string[] }

const TYPE_PRIORITY: Record<TaskNotificationType, number> = {
  taskMentioned: 5,
  taskAssigned: 4,
  taskStatusChanged: 3,
  taskDueChanged: 2,
  taskCommented: 1,
  taskReminder: 4,
  taskOverdue: 4,
}

const EVENT_TO_TYPE: Record<
  TaskNotificationActionEvent["kind"],
  TaskNotificationType
> = {
  assigned: "taskAssigned",
  mentioned: "taskMentioned",
  commented: "taskCommented",
  statusChanged: "taskStatusChanged",
  dueChanged: "taskDueChanged",
  reminder: "taskReminder",
  overdue: "taskOverdue",
}

export const pickHighestPriorityType = (
  types: TaskNotificationType[],
): TaskNotificationType => {
  let best = types[0]
  for (const type of types.slice(1)) {
    if (TYPE_PRIORITY[type] > TYPE_PRIORITY[best]) {
      best = type
    }
  }
  return best
}

export const resolveTaskNotificationRecipients = (input: {
  actorUserId: string | null
  events: TaskNotificationActionEvent[]
  watcherUserIds: string[]
  memberUserIds: ReadonlySet<string>
}): Map<string, TaskNotificationType[]> => {
  const { actorUserId, events, watcherUserIds, memberUserIds } = input
  const mentionedUserIds = new Set<string>()
  for (const event of events) {
    if (event.kind === "mentioned") {
      for (const userId of event.userIds) {
        mentionedUserIds.add(userId)
      }
    }
  }

  const recipients = new Map<string, TaskNotificationType[]>()

  const addUsers = (userIds: string[], type: TaskNotificationType) => {
    for (const userId of userIds) {
      if (!memberUserIds.has(userId)) {
        continue
      }
      const existing = recipients.get(userId) ?? []
      if (!existing.includes(type)) {
        recipients.set(userId, [...existing, type])
      }
    }
  }

  for (const event of events) {
    const type = EVENT_TO_TYPE[event.kind]
    if (event.kind === "assigned" || event.kind === "mentioned") {
      addUsers(event.userIds, type)
      continue
    }
    if (event.kind === "reminder" || event.kind === "overdue") {
      addUsers(event.userIds, type)
      continue
    }
    if (event.kind === "commented") {
      const watchers = watcherUserIds.filter((id) => !mentionedUserIds.has(id))
      addUsers(watchers, type)
      continue
    }
    if (event.kind === "statusChanged" || event.kind === "dueChanged") {
      addUsers(watcherUserIds, type)
    }
  }

  if (actorUserId) {
    recipients.delete(actorUserId)
  }

  return recipients
}
