import { getIdFromParams } from "@chatbotx.io/utils"
import { notFound } from "next/navigation"
import { getTranslations } from "next-intl/server"
import { Suspense } from "react"

import { CreateWebchatForm } from "@/features/integration-webchat/components/create-webchat-form"
import { requireWorkspacePermission } from "@/lib/auth/require-workspace-permission"
import { resolveChannelCreatable } from "@/lib/workspace/resolve-channel-creatable"

export default async function CreateWebchatPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>
}) {
  const workspaceId = getIdFromParams(await params, "workspaceId")
  if (!workspaceId) {
    return notFound()
  }
  await requireWorkspacePermission(workspaceId, "superAdmin")
  if (!(await resolveChannelCreatable(workspaceId, "webchat"))) {
    return notFound()
  }

  const t = await getTranslations()

  return (
    <Suspense fallback={<div>{t("actions.loading")}</div>}>
      <CreateWebchatForm workspaceId={workspaceId} />
    </Suspense>
  )
}
