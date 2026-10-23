export const parseTaskAssigneeValue = (assignee: string) => {
  const id = assignee.slice(2)

  if (assignee.startsWith("u_")) {
    return { assigneeUserId: id }
  }

  return { assigneeTeamId: id }
}

export const taskAssigneeValue = (input: {
  assigneeUserId: string | null
  assigneeTeamId: string | null
}) => {
  if (input.assigneeUserId) {
    return `u_${input.assigneeUserId}`
  }

  if (input.assigneeTeamId) {
    return `t_${input.assigneeTeamId}`
  }

  return ""
}
