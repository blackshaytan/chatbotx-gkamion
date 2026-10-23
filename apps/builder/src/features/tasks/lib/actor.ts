import type { TaskActor } from "@chatbotx.io/business"
import type { RequestApiToken } from "@/middlewares/context"

export const apiTokenActor = (
  apiToken: Pick<RequestApiToken, "name"> | undefined,
): TaskActor => ({ kind: "api", label: apiToken?.name ?? "API" })
