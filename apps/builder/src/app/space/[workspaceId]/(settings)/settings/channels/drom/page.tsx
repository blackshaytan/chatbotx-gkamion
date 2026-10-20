import { getIdFromParams } from "@chatbotx.io/utils"
import { notFound } from "next/navigation"
import { DromManage } from "@/features/integration-drom/drom-manage"
import { listDromChannels } from "@/features/integration-drom/queries"
import { requireVisibleChannel } from "@/lib/workspace/require-visible-channel"
import { resolveChannelCreatable } from "@/lib/workspace/resolve-channel-creatable"

export default async function SettingChannelDromPage(props: {
  params: Promise<{ workspaceId: string }>
}) {
  const workspaceId = getIdFromParams(await props.params, "workspaceId")
  if (!workspaceId) {
    return notFound()
  }

  await requireVisibleChannel(workspaceId, "drom")

  const promises = Promise.all([listDromChannels({ workspaceId })])
  const canCreate = await resolveChannelCreatable(workspaceId, "drom")

  return (
    <DromManage
      canCreate={canCreate}
      promises={promises}
      workspaceId={workspaceId}
    />
  )
}
