import type { TaskPriority, TaskStatus } from "@chatbotx.io/database/partials"

export type TaskAssignee =
  | { type: "user"; userId: string }
  | { type: "team"; teamId: string }

export type TaskPatch = {
  title?: string
  description?: string | null
  status?: TaskStatus
  priority?: TaskPriority
  dueAt?: Date | null
  remindAt?: Date | null
  assignee?: TaskAssignee
}
