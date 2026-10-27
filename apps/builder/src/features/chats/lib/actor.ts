import type { ChatActor } from "@chatbotx.io/business"
import type { RequestApiToken } from "@/middlewares/context"

export const apiTokenChatActor = (
  apiToken: Pick<RequestApiToken, "name"> | undefined,
): ChatActor => ({ kind: "api", label: apiToken?.name ?? "API" })
