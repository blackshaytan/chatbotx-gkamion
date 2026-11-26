import { smtpOwnershipService } from "@chatbotx.io/business"
import type { WorkspaceMemberPermissions } from "@chatbotx.io/database/partials"

/**
 * Inbox ids a workspace member must not see conversations or messages from
 * (other members' personal SMTP mailboxes). Empty for superAdmins and for
 * workspace-level callers that are not member-scoped.
 */
export const resolveMemberHiddenInboxIds = (input: {
  workspaceId: string
  userId: string
  permissions: WorkspaceMemberPermissions
}): Promise<string[]> =>
  smtpOwnershipService.listHiddenInboxIdsForMember({
    workspaceId: input.workspaceId,
    viewer: input,
  })
