import type { TaskModel } from "@chatbotx.io/database/types"
import { ChatbotXException } from "../errors"
import type { TaskActor } from "./actor"

type TaskOwnership = Pick<TaskModel, "createdByUserId" | "assigneeUserId">

export const canModifyTask = (input: {
  actor: TaskActor
  task: TaskOwnership
  assigneeTeamMemberIds: string[]
}): boolean => {
  const { actor, task, assigneeTeamMemberIds } = input
  if (actor.kind !== "user" || actor.isOwner) {
    return true
  }
  return (
    task.createdByUserId === actor.userId ||
    task.assigneeUserId === actor.userId ||
    assigneeTeamMemberIds.includes(actor.userId)
  )
}

export const canDeleteTask = (input: {
  actor: TaskActor
  task: Pick<TaskModel, "createdByUserId">
}): boolean => {
  const { actor, task } = input
  if (actor.kind !== "user" || actor.isOwner) {
    return true
  }
  return task.createdByUserId === actor.userId
}

export const taskForbiddenException = () =>
  new ChatbotXException(
    "You are not allowed to change this task",
    "FORBIDDEN",
    403,
  )
