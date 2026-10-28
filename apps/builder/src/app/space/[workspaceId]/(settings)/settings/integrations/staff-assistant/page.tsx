import { workspaceApiTokenService } from "@chatbotx.io/business"
import { getIdFromParams } from "@chatbotx.io/utils"
import { notFound } from "next/navigation"
import { StaffAssistantSettingsForm } from "@/features/staff-assistant/components/staff-assistant-settings-form"
import { requireWorkspacePermission } from "@/lib/auth/require-workspace-permission"

export default async function StaffAssistantSettingsPage(props: {
  params: Promise<{ workspaceId: string }>
}) {
  const workspaceId = getIdFromParams(await props.params, "workspaceId")
  if (!workspaceId) {
    return notFound()
  }
  await requireWorkspacePermission(workspaceId, "superAdmin")
  const tokens = await workspaceApiTokenService.listTokens({ workspaceId })
  const options = tokens
    .filter((token) => token.scopes?.includes("chats"))
    .map((token) => ({ value: token.id, label: token.name }))
  return <StaffAssistantSettingsForm tokenOptions={options} />
}
