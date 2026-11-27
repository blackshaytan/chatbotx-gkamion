import { getIdFromParams } from "@chatbotx.io/utils"
import { notFound } from "next/navigation"
import { listIntegrationSmtps } from "@/features/integration-smtp/queries"
import { SmtpManage } from "@/features/integration-smtp/smtp-manage"
import { hasWorkspacePermission } from "@/lib/auth/permission-routes"
import { getCurrentUserAndTargetWorkspace } from "@/lib/auth/utils"
import { requireVisibleChannel } from "@/lib/workspace/require-visible-channel"

export default async function SettingChannelSmtpPage(props: {
  params: Promise<{ workspaceId: string }>
}) {
  const workspaceId = getIdFromParams(await props.params, "workspaceId")
  if (!workspaceId) {
    return notFound()
  }

  await requireVisibleChannel(workspaceId, "smtp")

  const userAndWorkspace = await getCurrentUserAndTargetWorkspace(workspaceId)
  const canManageOwner = userAndWorkspace
    ? hasWorkspacePermission(
        userAndWorkspace.targetWorkspaceMember.permissions,
        "superAdmin",
      )
    : false

  const promises = listIntegrationSmtps({ workspaceId })

  return (
    <SmtpManage
      canManageOwner={canManageOwner}
      promises={promises}
      workspaceId={workspaceId}
    />
  )
}
