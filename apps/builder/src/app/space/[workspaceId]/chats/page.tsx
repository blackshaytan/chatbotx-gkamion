import { getIdFromParams } from "@chatbotx.io/utils"
import { notFound } from "next/navigation"
import { ChatsPage } from "@/features/chats/components/chats-page"
import { getCurrentUserAndTargetWorkspace } from "@/lib/auth/utils"
import { getWorkspaceBlockStateForRender } from "@/lib/workspace-quota"

export default async function ChatsRoutePage(props: {
  params: Promise<{ workspaceId: string }>
}) {
  const workspaceId = getIdFromParams(await props.params, "workspaceId")
  if (!workspaceId) return notFound()
  const access = await getCurrentUserAndTargetWorkspace(workspaceId)
  if (!access) return notFound()
  const { blocked } = await getWorkspaceBlockStateForRender(
    access.targetWorkspace.ownerId,
  )
  return <ChatsPage currentUserId={access.user.id} isBlocked={blocked} isSupportSession={access.isSupportSession} workspaceId={workspaceId} />
}
