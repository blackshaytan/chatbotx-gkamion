import {
  EXTERNAL_AGENT_MAX_RUN_MINUTES_LIMIT,
  externalAgentCheckStatuses,
} from "@chatbotx.io/database/partials"
import { zodBigintAsString } from "@chatbotx.io/utils"
import { z } from "zod"

export const staffAssistantSettingsSchema = z.object({
  enabled: z.boolean(),
  baseUrl: z.string(),
  hasApiKey: z
    .boolean()
    .describe("Whether a key is stored; the key is never returned."),
  botName: z.string().nullable(),
  maxRunMinutes: z.number().int(),
  apiTokenId: z
    .string()
    .nullable()
    .describe("Bound token id; get the calling token id from `token.get`."),
  tokenHasChatsScope: z.boolean(),
  available: z.boolean(),
  lastCheckedAt: z.date().nullable(),
  lastCheckStatus: externalAgentCheckStatuses.nullable(),
  lastCheckError: z.string().nullable(),
})

export const updateStaffAssistantSchema = z
  .object({
    enabled: z
      .boolean()
      .optional()
      .describe("Enable or disable the staff assistant."),
    baseUrl: z
      .string()
      .max(2048)
      .optional()
      .describe("HTTP or HTTPS base URL of the assistant endpoint."),
    apiKey: z
      .string()
      .optional()
      .describe("Write-only; omit or leave blank to keep the stored key."),
    botName: z
      .string()
      .trim()
      .max(40)
      .nullable()
      .optional()
      .describe("Display name for assistant messages; required when enabled."),
    maxRunMinutes: z
      .number()
      .int()
      .min(1)
      .max(EXTERNAL_AGENT_MAX_RUN_MINUTES_LIMIT)
      .optional()
      .describe("Maximum duration of one run, in minutes."),
    apiTokenId: zodBigintAsString()
      .nullable()
      .optional()
      .describe(
        "Token id from `token.get`; its explicit scopes must include `chats`.",
      ),
  })
  .strict()

export const staffAssistantTestSchema = z.object({
  status: externalAgentCheckStatuses,
  error: z.string().nullable(),
  checkedAt: z.date(),
})
