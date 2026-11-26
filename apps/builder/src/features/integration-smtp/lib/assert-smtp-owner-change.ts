import { ChatbotXException } from "@chatbotx.io/business/errors"
import {
  hasWorkspacePermission,
  type PermissionsInput,
} from "@/lib/auth/permission-routes"

/**
 * Only a super admin may set or clear an SMTP mailbox's personal owner. Call
 * it only when the request carries `ownerUserId`: an omitted owner leaves the
 * current one untouched, so non-admins can keep editing credentials.
 */
export const assertSmtpOwnerChangeAllowed = (
  permissions: PermissionsInput,
): void => {
  if (hasWorkspacePermission(permissions, "superAdmin")) {
    return
  }
  throw new ChatbotXException(
    "You need to be a super admin to change the mailbox owner",
    "smtpOwnerSuperAdminRequired",
    403,
  )
}
