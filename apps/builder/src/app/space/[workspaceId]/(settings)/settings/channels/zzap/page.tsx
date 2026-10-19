import { getIdFromParams } from "@chatbotx.io/utils"
import { notFound } from "next/navigation"
import { listZzapChannels } from "@/features/integration-zzap/queries"
import { ZzapManage } from "@/features/integration-zzap/zzap-manage"
import { requireVisibleChannel } from "@/lib/workspace/require-visible-channel"
import { resolveChannelCreatable } from "@/lib/workspace/resolve-channel-creatable"

export default async function SettingChannelZzapPage(props: {
  params: Promise<{ workspaceId: string }>
}) {
  const workspaceId = getIdFromParams(await props.params, "workspaceId")
  if (!workspaceId) {
    return notFound()
  }

  await requireVisibleChannel(workspaceId, "zzap")

  const promises = Promise.all([listZzapChannels({ workspaceId })])
  const canCreate = await resolveChannelCreatable(workspaceId, "zzap")

  return (
    <ZzapManage
      canCreate={canCreate}
      promises={promises}
      workspaceId={workspaceId}
    />
  )
}
