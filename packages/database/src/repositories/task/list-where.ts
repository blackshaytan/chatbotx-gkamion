import type { TaskPriority, TaskStatus } from "../../partials/task"

export type TaskListFilter = {
  workspaceId: string
  statuses?: TaskStatus[]
  priority?: TaskPriority
  assigneeUserId?: string
  assigneeTeamId?: string
  createdByUserId?: string
  watcherUserId?: string
  contactId?: string
  conversationId?: string
  dueFrom?: Date
  dueBefore?: Date
  withoutDue?: boolean
}

type TaskWhere = Record<string, unknown>

// Postgres sorts NULLs last on ASC, so tasks without a due date come last;
// priority DESC follows the enum declaration order (urgent first).
export const TASK_LIST_ORDER_BY = {
  dueAt: "asc",
  priority: "desc",
  createdAt: "desc",
  id: "desc",
} as const

const buildDueWhere = (filter: TaskListFilter): TaskWhere | undefined => {
  if (filter.withoutDue) {
    return { isNull: true }
  }
  const dueAt: TaskWhere = {}
  if (filter.dueFrom) {
    dueAt.gte = filter.dueFrom
  }
  if (filter.dueBefore) {
    dueAt.lt = filter.dueBefore
  }
  return Object.keys(dueAt).length > 0 ? dueAt : undefined
}

/** Pure where-builder for the task list and its count. No I/O. */
export function buildTaskListWhere(filter: TaskListFilter): TaskWhere {
  const where: TaskWhere = { workspaceId: filter.workspaceId }

  if (filter.statuses?.length) {
    where.status = { in: filter.statuses }
  }
  if (filter.priority) {
    where.priority = filter.priority
  }
  if (filter.assigneeUserId) {
    where.assigneeUserId = filter.assigneeUserId
  }
  if (filter.assigneeTeamId) {
    where.assigneeTeamId = filter.assigneeTeamId
  }
  if (filter.createdByUserId) {
    where.createdByUserId = filter.createdByUserId
  }
  if (filter.watcherUserId) {
    where.watchers = { userId: filter.watcherUserId }
  }

  const targetFilters: TaskWhere[] = []
  if (filter.contactId) {
    targetFilters.push({ targets: { contactId: filter.contactId } })
  }
  if (filter.conversationId) {
    targetFilters.push({ targets: { conversationId: filter.conversationId } })
  }
  if (targetFilters.length === 1) {
    Object.assign(where, targetFilters[0])
  } else if (targetFilters.length > 1) {
    where.AND = targetFilters
  }

  const dueAt = buildDueWhere(filter)
  if (dueAt) {
    where.dueAt = dueAt
  }

  return where
}
