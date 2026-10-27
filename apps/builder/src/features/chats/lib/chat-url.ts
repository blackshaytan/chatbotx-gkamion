import { resolveTenantSettings } from "@chatbotx.io/business"

export const withChatUrls = async <T extends { id: string }>(
  workspaceId: string,
  chats: T[],
): Promise<Array<T & { url: string }>> => {
  const { appUrl } = await resolveTenantSettings({ workspaceId })
  return chats.map((chat) => ({
    ...chat,
    url: `${appUrl}/space/${workspaceId}/chats/${chat.id}`,
  }))
}

export const withChatUrl = async <T extends { id: string }>(
  workspaceId: string,
  chat: T,
): Promise<T & { url: string }> => {
  const [withUrl] = await withChatUrls(workspaceId, [chat])
  if (!withUrl) {
    throw new Error("Expected one chat")
  }
  return withUrl
}
