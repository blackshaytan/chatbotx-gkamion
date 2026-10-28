import { getIdFromParams, isNumericId } from "@chatbotx.io/utils"
import { notFound } from "next/navigation"
import { ChatsPage } from "@/features/chats/components/chats-page"
import { getCurrentUserAndTargetWorkspace } from "@/lib/auth/utils"
import { getWorkspaceBlockStateForRender } from "@/lib/workspace-quota"

export default async function ChatThreadRoutePage(props: {
  params: Promise<{ threadId: string; workspaceId: string }>
}) {
  const params = await props.params
  const workspaceId = getIdFromParams(params, "workspaceId")
  const threadId = getIdFromParams(params, "threadId")
  if (!(workspaceId && threadId && isNumericId(threadId))) return notFound()
  const access = await getCurrentUserAndTargetWorkspace(workspaceId)
  if (!access) return notFound()
  const { blocked } = await getWorkspaceBlockStateForRender(
    access.targetWorkspace.ownerId,
  )
  return <ChatsPage currentUserId={access.user.id} isBlocked={blocked} isSupportSession={access.isSupportSession} selectedChatId={threadId} workspaceId={workspaceId} />
}
