import type { TaskAssignee } from "@chatbotx.io/business"
import { validationException } from "@chatbotx.io/business/errors"

export const parseTaskAssignee = (input: {
  assigneeUserId?: string
  assigneeTeamId?: string
}): TaskAssignee | undefined => {
  if (input.assigneeUserId && input.assigneeTeamId) {
    throw validationException(
      "assigneeTeamId",
      "Set only one of assigneeUserId or assigneeTeamId",
    )
  }
  if (input.assigneeUserId) {
    return { type: "user", userId: input.assigneeUserId }
  }
  if (input.assigneeTeamId) {
    return { type: "team", teamId: input.assigneeTeamId }
  }
  return
}

export const requireTaskAssignee = (input: {
  assigneeUserId?: string
  assigneeTeamId?: string
}): TaskAssignee => {
  const assignee = parseTaskAssignee(input)
  if (!assignee) {
    throw validationException(
      "assigneeUserId",
      "Set assigneeUserId or assigneeTeamId",
    )
  }
  return assignee
}
