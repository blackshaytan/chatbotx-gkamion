import type { CreateTaskAssignee } from "@chatbotx.io/flow-config"

export const assigneeToValue = (assignee: CreateTaskAssignee): string => {
  if (assignee.type === "user") {
    return `u_${assignee.userId}`
  }

  if (assignee.type === "team") {
    return `t_${assignee.teamId}`
  }

  return "conversation"
}

export const valueToAssignee = (value: string): CreateTaskAssignee => {
  if (value.startsWith("u_") && value.length > 2) {
    return { type: "user", userId: value.slice(2) }
  }

  if (value.startsWith("t_") && value.length > 2) {
    return { type: "team", teamId: value.slice(2) }
  }

  return { type: "conversation" }
}
