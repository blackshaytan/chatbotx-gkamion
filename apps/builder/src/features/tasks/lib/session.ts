import type { TaskAccessScope, TaskActor } from "@chatbotx.io/business"
import type { WorkspaceMemberPermissions } from "@chatbotx.io/database/partials"
import { buildContactPermissionScope } from "@/features/contacts/permissions"
import type { TaskTab } from "../schema/public"

export const sessionTaskActor = (context: {
  user: { id: string }
  workspace: { ownerId: string }
  workspaceMember?: { permissions: { superAdmin?: boolean } }
}): TaskActor => ({
  kind: "user",
  userId: context.user.id,
  isOwner: context.workspace.ownerId === context.user.id,
  isWorkspaceAdmin: context.workspaceMember?.permissions.superAdmin === true,
})

export const sessionTaskAccessScope = (input: {
  permissions: WorkspaceMemberPermissions
  userId: string
}): TaskAccessScope => {
  const scope = buildContactPermissionScope(input)
  if (!scope) {
    return { hideTargets: true }
  }
  return { restrictToAssignedUserId: scope.restrictToAssignedUserId }
}

export const tabToFilter = (tab: TaskTab, userId: string) => {
  if (tab === "mine") {
    return { assigneeUserId: userId }
  }
  if (tab === "createdByMe") {
    return { createdByUserId: userId }
  }
  if (tab === "watching") {
    return { watcherUserId: userId }
  }
  if (tab === "myTeams") {
    return { teamMemberUserId: userId }
  }
  return {}
}
