import { z } from "zod"

export const externalAgentProviders = z.enum(["hermes"])
export type ExternalAgentProvider = z.infer<typeof externalAgentProviders>

export const EXTERNAL_AGENT_DEFAULT_MAX_RUN_MINUTES = 30
export const EXTERNAL_AGENT_MAX_RUN_MINUTES_LIMIT = 240
export const EXTERNAL_AGENT_DEFAULT_PROGRESS_MESSAGE =
  "Работаю над вашим запросом, это займёт несколько минут"
export const EXTERNAL_AGENT_ACTIVITY_TYPE = "externalAgent"

export const externalAgentCheckStatuses = z.enum(["ok", "error"])
export const externalAgentActivityEvents = z.enum([
  "handover",
  "unavailable",
  "timeout",
])
export type ExternalAgentActivityEvent = z.infer<
  typeof externalAgentActivityEvents
>

export const externalAgentApiKeySchema = z.object({ apiKey: z.string().min(1) })
