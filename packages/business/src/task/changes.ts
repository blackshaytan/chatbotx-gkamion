import type { TaskSystemEvent } from "@chatbotx.io/database/partials"
import type { TaskUpdate } from "@chatbotx.io/database/repositories"
import type { TaskModel } from "@chatbotx.io/database/types"
import { validationException } from "../errors"
import type { TaskAssignee, TaskPatch } from "./types"

type TaskState = Pick<
  TaskModel,
  | "status"
  | "priority"
  | "dueAt"
  | "remindAt"
  | "assigneeUserId"
  | "assigneeTeamId"
>

const sameInstant = (a: Date | null, b: Date | null): boolean =>
  (a?.getTime() ?? null) === (b?.getTime() ?? null)

const toIso = (value: Date | null): string | null =>
  value ? value.toISOString() : null

export const encodeAssignee = (
  assignee: TaskAssignee | Pick<TaskModel, "assigneeUserId" | "assigneeTeamId">,
): string | null => {
  if ("type" in assignee) {
    return assignee.type === "user"
      ? `user:${assignee.userId}`
      : `team:${assignee.teamId}`
  }
  if (assignee.assigneeUserId) {
    return `user:${assignee.assigneeUserId}`
  }
  if (assignee.assigneeTeamId) {
    return `team:${assignee.assigneeTeamId}`
  }
  return null
}

export const assertRemindBeforeDue = (
  remindAt: Date | null,
  dueAt: Date | null,
): void => {
  if (remindAt && dueAt && remindAt.getTime() > dueAt.getTime()) {
    throw validationException(
      "remindAt",
      "Reminder must not be later than the due date",
    )
  }
}

/** Only the columns that actually change, plus the flags they reset. */
export const buildTaskUpdateSet = (
  task: TaskState,
  patch: TaskPatch,
  now: Date,
): TaskUpdate => {
  const set: TaskUpdate = {}
  if (patch.title !== undefined) {
    set.title = patch.title
  }
  if (patch.description !== undefined) {
    set.description = patch.description
  }
  if (patch.priority !== undefined && patch.priority !== task.priority) {
    set.priority = patch.priority
  }
  if (patch.status !== undefined && patch.status !== task.status) {
    set.status = patch.status
    set.completedAt = patch.status === "done" ? now : null
  }
  if (patch.dueAt !== undefined && !sameInstant(patch.dueAt, task.dueAt)) {
    set.dueAt = patch.dueAt
    set.overdueNotifiedAt = null
  }
  if (
    patch.remindAt !== undefined &&
    !sameInstant(patch.remindAt, task.remindAt)
  ) {
    set.remindAt = patch.remindAt
    set.remindedAt = null
  }
  if (
    patch.assignee &&
    encodeAssignee(patch.assignee) !== encodeAssignee(task)
  ) {
    set.assigneeUserId =
      patch.assignee.type === "user" ? patch.assignee.userId : null
    set.assigneeTeamId =
      patch.assignee.type === "team" ? patch.assignee.teamId : null
  }
  return set
}

export const buildTaskChangeEvents = (
  task: TaskState,
  patch: TaskPatch,
  byUserId: string | null,
): TaskSystemEvent[] => {
  const events: TaskSystemEvent[] = []
  if (patch.status !== undefined && patch.status !== task.status) {
    events.push({
      type: "status",
      from: task.status,
      to: patch.status,
      byUserId,
    })
  }
  if (patch.dueAt !== undefined && !sameInstant(patch.dueAt, task.dueAt)) {
    events.push({
      type: "due",
      from: toIso(task.dueAt),
      to: toIso(patch.dueAt),
      byUserId,
    })
  }
  if (patch.assignee) {
    const from = encodeAssignee(task)
    const to = encodeAssignee(patch.assignee)
    if (from !== to) {
      events.push({ type: "assignee", from, to, byUserId })
    }
  }
  if (patch.priority !== undefined && patch.priority !== task.priority) {
    events.push({
      type: "priority",
      from: task.priority,
      to: patch.priority,
      byUserId,
    })
  }
  return events
}
