import { getIdFromParams } from "@chatbotx.io/utils"
import { notFound } from "next/navigation"
import { ExternalAgentSettingsForm } from "@/features/external-agent/components/external-agent-settings-form"
import { requireWorkspacePermission } from "@/lib/auth/require-workspace-permission"

export default async function SettingsExternalAgentPage(props: {
  params: Promise<{ workspaceId: string }>
}) {
  const workspaceId = getIdFromParams(await props.params, "workspaceId")
  if (!workspaceId) {
    return notFound()
  }

  await requireWorkspacePermission(workspaceId, "superAdmin")

  return <ExternalAgentSettingsForm />
}
