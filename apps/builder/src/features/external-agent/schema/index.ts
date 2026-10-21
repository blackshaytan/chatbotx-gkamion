import {
  conversationHandoverCategories,
  EXTERNAL_AGENT_MAX_RUN_MINUTES_LIMIT,
  externalAgentCheckStatuses,
  externalAgentProviders,
} from "@chatbotx.io/database/partials"
import { zodBigintAsString } from "@chatbotx.io/utils"
import { z } from "zod"

export const BASE_URL_MAX_LENGTH = 2048
export const PROGRESS_MESSAGE_MAX_LENGTH = 500
export const RESUME_AFTER_HOURS_MIN = 1
export const RESUME_AFTER_HOURS_MAX = 720
export const MAX_RUN_MINUTES_MIN = 1
const REASON_MAX_LENGTH = 500

export const externalAgentOutputSchema = z.object({
  enabled: z
    .boolean()
    .describe("Whether the external agent answers chats in its inboxes."),
  provider: externalAgentProviders.describe(
    "Agent provider. Only `hermes` is supported.",
  ),
  baseUrl: z.string().describe("Base URL of the Hermes agent server."),
  hasApiKey: z
    .boolean()
    .describe(
      "Whether an API key is stored. The key is write-only and is never returned.",
    ),
  inboxIds: z
    .array(z.string())
    .describe(
      "Ids of the inboxes where the agent answers. Get them from `inboxes.list`.",
    ),
  resumeAfterHours: z
    .number()
    .int()
    .nullable()
    .describe(
      "Hours after which a handed-over conversation resumes the bot automatically, or null when it never resumes automatically.",
    ),
  maxRunMinutes: z
    .number()
    .int()
    .describe("Longest a single agent run may take, in minutes."),
  progressMessage: z
    .string()
    .describe("Message sent to the customer while the agent is still working."),
  lastCheckedAt: z
    .date()
    .nullable()
    .describe("When the last connection check ran, or null if never checked."),
  lastCheckStatus: externalAgentCheckStatuses
    .nullable()
    .describe("Result of the last connection check, or null if never checked."),
  lastCheckError: z
    .string()
    .nullable()
    .describe("Error of the last failed connection check, or null."),
})

export const updateExternalAgentInputSchema = z.object({
  enabled: z
    .boolean()
    .optional()
    .describe("Turn the external agent on or off."),
  baseUrl: z
    .string()
    .max(BASE_URL_MAX_LENGTH)
    .optional()
    .describe(
      "http or https base URL of the Hermes agent server, without credentials.",
    ),
  apiKey: z
    .string()
    .optional()
    .describe(
      "API key of the Hermes agent. Write-only: send it to store or replace the key. Leave it out or send a blank value to keep the stored key. Never returned.",
    ),
  inboxIds: z
    .array(zodBigintAsString())
    .optional()
    .describe(
      "Inboxes where the agent answers, replacing the previous list. Send an empty array to stop answering in every inbox. Get inbox ids from `inboxes.list`.",
    ),
  resumeAfterHours: z
    .number()
    .int()
    .min(RESUME_AFTER_HOURS_MIN)
    .max(RESUME_AFTER_HOURS_MAX)
    .nullable()
    .optional()
    .describe(
      `Hours after which a handed-over conversation resumes the bot automatically, from ${RESUME_AFTER_HOURS_MIN} to ${RESUME_AFTER_HOURS_MAX}; null turns automatic resume off.`,
    ),
  maxRunMinutes: z
    .number()
    .int()
    .min(MAX_RUN_MINUTES_MIN)
    .max(EXTERNAL_AGENT_MAX_RUN_MINUTES_LIMIT)
    .optional()
    .describe(
      `Longest a single agent run may take, in minutes, from ${MAX_RUN_MINUTES_MIN} to ${EXTERNAL_AGENT_MAX_RUN_MINUTES_LIMIT}.`,
    ),
  progressMessage: z
    .string()
    .trim()
    .max(PROGRESS_MESSAGE_MAX_LENGTH)
    .optional()
    .describe(
      "Message sent once to the customer when the agent has been silent for 90 seconds during a run. An empty string turns it off.",
    ),
})

export const externalAgentTestOutputSchema = z.object({
  status: externalAgentCheckStatuses.describe(
    "`ok` when the agent passed its health check, `error` otherwise.",
  ),
  error: z
    .string()
    .nullable()
    .describe("Why the health check failed, or null when it passed."),
  checkedAt: z.date().describe("When the health check ran."),
})

export const externalAgentHandoverInputSchema = z.object({
  conversationId: zodBigintAsString().describe(
    "Conversation to hand over. Get it from `conversations.list`, or from the run context the platform sent to the agent.",
  ),
  reason: z
    .string()
    .min(1)
    .max(REASON_MAX_LENGTH)
    .describe(
      "Why the conversation goes to a human manager. Saved as a note in the conversation.",
    ),
  category: conversationHandoverCategories
    .optional()
    .describe(
      "Category of the handover, shown to managers in the conversation list. Pick the one that fits best. Values: `urgent` (urgent, needs a manager now), `return` (the customer wants to return or refund an item), `payment` (a payment problem or question), `orderStatus` (asks where the order is or about its status), `delivery` (a delivery problem or question), `priceAndTerm` (asks about the price, discounts or terms), `other` (anything else). Defaults to `other`.",
    ),
})

export const externalAgentHandoverOutputSchema = z.object({
  conversationId: z.string().describe("Id of the handed-over conversation."),
  botEnabled: z
    .literal(false)
    .describe("Always `false`: the bot is paused for this conversation."),
})
