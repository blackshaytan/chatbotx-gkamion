import { inboxService } from "@chatbotx.io/business"
import { notFound } from "next/navigation"
import { getTranslations } from "next-intl/server"
import { Suspense } from "react"

import { UpdateWebchatForm } from "@/features/integration-webchat/components/update-webchat-form"
import { findIntegrationWebchat } from "@/features/integration-webchat/queries"
import { withWorkspaceIdAndIdSchema } from "@/features/workspaces/schema/resource"
import { requireWorkspacePermission } from "@/lib/auth/require-workspace-permission"

export default async function WebchatEditPage({
  params,
}: {
  params: Promise<{ workspaceId: string; id: string }>
}) {
  const { data } = withWorkspaceIdAndIdSchema.safeParse(await params)
  if (!data) {
    return notFound()
  }
  await requireWorkspacePermission(data.workspaceId, "superAdmin")

  const integrationWebchat = await findIntegrationWebchat({
    id: data.id,
    workspaceId: data.workspaceId,
  })
  const inbox = await inboxService.find({
    where: { id: integrationWebchat.inboxId, workspaceId: data.workspaceId },
  })

  const t = await getTranslations()

  return (
    <Suspense fallback={<div>{t("actions.loading")}</div>}>
      <UpdateWebchatForm
        integrationWebchat={integrationWebchat}
        markReadOnOutbound={inbox?.markReadOnOutbound ?? false}
      />
    </Suspense>
  )
}
