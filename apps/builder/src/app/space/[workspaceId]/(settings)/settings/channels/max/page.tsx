import { getIdFromParams } from "@chatbotx.io/utils"
import { notFound } from "next/navigation"
import { MaxManage } from "@/features/integration-max/max-manage"
import { listMaxChannels } from "@/features/integration-max/queries"
import { requireVisibleChannel } from "@/lib/workspace/require-visible-channel"
import { resolveChannelCreatable } from "@/lib/workspace/resolve-channel-creatable"

export default async function SettingChannelMaxPage(props: {
  params: Promise<{ workspaceId: string }>
}) {
  const workspaceId = getIdFromParams(await props.params, "workspaceId")
  if (!workspaceId) {
    return notFound()
  }

  await requireVisibleChannel(workspaceId, "max")

  const promises = Promise.all([listMaxChannels({ workspaceId })])
  const canCreate = await resolveChannelCreatable(workspaceId, "max")

  return (
    <MaxManage
      canCreate={canCreate}
      promises={promises}
      workspaceId={workspaceId}
    />
  )
}
