import type { TaskWithRelations } from "@chatbotx.io/database/repositories"
import type { TaskModel, TaskTargetModel } from "@chatbotx.io/database/types"

export type TaskTargetView = {
  type: "contact" | "conversation" | "message"
  id: string | null
  hidden: boolean
}

export type TaskView = Omit<TaskModel, "remindedAt" | "overdueNotifiedAt"> & {
  watcherUserIds: string[]
  targets: TaskTargetView[]
}

/** Ids a member restricted to assigned contacts may see; `null` = unrestricted. */
export type TaskTargetVisibility = {
  contactIds: ReadonlySet<string>
  conversationIds: ReadonlySet<string>
} | null

const targetType = (target: TaskTargetModel): TaskTargetView["type"] => {
  if (target.contactId) {
    return "contact"
  }
  return target.conversationId ? "conversation" : "message"
}

const visibleView = (target: TaskTargetModel): TaskTargetView => ({
  type: targetType(target),
  id: target.contactId ?? target.conversationId ?? target.messageId,
  hidden: false,
})

const toTargetViews = (
  targets: TaskTargetModel[],
  visibility: TaskTargetVisibility,
): TaskTargetView[] => {
  if (!visibility) {
    return targets.map(visibleView)
  }
  // A message is reachable only through its conversation.
  const conversationsVisible = targets.every(
    (target) =>
      !target.conversationId ||
      visibility.conversationIds.has(target.conversationId),
  )
  const isVisible = (target: TaskTargetModel): boolean => {
    if (target.contactId) {
      return visibility.contactIds.has(target.contactId)
    }
    if (target.conversationId) {
      return visibility.conversationIds.has(target.conversationId)
    }
    return conversationsVisible
  }
  return targets.map((target) =>
    isVisible(target)
      ? visibleView(target)
      : { type: targetType(target), id: null, hidden: true },
  )
}

export const toTaskView = (
  task: TaskWithRelations,
  visibility: TaskTargetVisibility,
): TaskView => {
  const {
    watchers,
    targets,
    remindedAt: _remindedAt,
    overdueNotifiedAt: _overdueNotifiedAt,
    ...fields
  } = task
  return {
    ...fields,
    watcherUserIds: watchers.map((watcher) => watcher.userId),
    targets: toTargetViews(targets, visibility),
  }
}
