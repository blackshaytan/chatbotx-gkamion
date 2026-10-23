import type { TaskWithRelations } from "@chatbotx.io/database/repositories"
import type { TaskModel } from "@chatbotx.io/database/types"

export type TaskTargetView = {
  type: "contact" | "conversation" | "message"
  id: string | null
  hidden: boolean
  label: string | null
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

type TaskTargetRow = TaskWithRelations["targets"][number]

const targetType = (target: TaskTargetRow): TaskTargetView["type"] => {
  if (target.contactId) {
    return "contact"
  }
  return target.conversationId ? "conversation" : "message"
}

const contactLabel = (target: TaskTargetRow): string | null =>
  target.contactId ? (target.contact?.fullName ?? null) : null

const visibleView = (target: TaskTargetRow): TaskTargetView => ({
  type: targetType(target),
  id: target.contactId ?? target.conversationId ?? target.messageId,
  hidden: false,
  label: contactLabel(target),
})

const toTargetViews = (
  targets: TaskTargetRow[],
  visibility: TaskTargetVisibility,
): TaskTargetView[] => {
  if (!visibility) {
    return targets.map(visibleView)
  }
  // A message is reachable only through its conversation, whose target row
  // disappears when the conversation is deleted.
  const conversationIds = targets.flatMap((target) =>
    target.conversationId ? [target.conversationId] : [],
  )
  const conversationsVisible =
    conversationIds.length > 0 &&
    conversationIds.every((id) => visibility.conversationIds.has(id))
  const isVisible = (target: TaskTargetRow): boolean => {
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
      : { type: targetType(target), id: null, hidden: true, label: null },
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
