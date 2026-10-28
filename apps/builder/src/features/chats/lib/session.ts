import type { ChatActor, ChatScope } from "@chatbotx.io/business"

export const sessionChatActor = (context: {
  user: { id: string }
}): ChatActor => ({
  kind: "user",
  userId: context.user.id,
})

export const sessionChatScope = (context: {
  isSupportSession?: boolean
  user: { id: string }
}): ChatScope =>
  context.isSupportSession
    ? { kind: "workspace" }
    : { kind: "member", userId: context.user.id }
