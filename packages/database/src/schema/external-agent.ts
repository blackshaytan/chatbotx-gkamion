import type { EncryptedData } from "@chatbotx.io/encryption"
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core"
import {
  EXTERNAL_AGENT_DEFAULT_MAX_RUN_MINUTES,
  EXTERNAL_AGENT_DEFAULT_PROGRESS_MESSAGE,
  type ExternalAgentProvider,
} from "../partials/external-agent"
import {
  bigintAsString,
  sharedColumns,
  timestampConfig,
} from "../partials/shared"
import { conversationModel } from "./conversation"
import { inboxModel } from "./inbox"
import { internalThreadModel } from "./internal-thread"
import { workspaceModel } from "./workspace"
import { workspaceApiTokenModel } from "./workspace-api-token"

/**
 * The external AI agent (Hermes) that answers client chats for a workspace.
 * One agent per workspace; `apiKey` is an AES-GCM envelope and must never be
 * returned in a DTO.
 */
export const externalAgentModel = pgTable(
  "ExternalAgent",
  {
    ...sharedColumns,
    workspaceId: bigintAsString()
      .notNull()
      .references(() => workspaceModel.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    purpose: text().$type<"client" | "staff">().notNull().default("client"),
    apiTokenId: bigintAsString().references(() => workspaceApiTokenModel.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    provider: text().$type<ExternalAgentProvider>().notNull().default("hermes"),
    baseUrl: text().notNull(),
    apiKey: jsonb().$type<EncryptedData>().notNull(),
    enabled: boolean().notNull().default(false),
    resumeAfterHours: integer(),
    maxRunMinutes: integer()
      .notNull()
      .default(EXTERNAL_AGENT_DEFAULT_MAX_RUN_MINUTES),
    progressMessage: text()
      .notNull()
      .default(EXTERNAL_AGENT_DEFAULT_PROGRESS_MESSAGE),
    /** Agent name in the client-facing signature; null sends agent replies unsigned. */
    botName: text(),
    signMessages: boolean().notNull().default(false),
    announceManager: boolean().notNull().default(false),
    lastCheckedAt: timestamp(timestampConfig),
    lastCheckStatus: text(),
    lastCheckError: text(),
  },
  (table) => [
    uniqueIndex("ExternalAgent_workspaceId_purpose_key").on(
      table.workspaceId,
      table.purpose,
    ),
  ],
)

/** Independent cursor and run state for a staff assistant chat. */
export const externalAgentChatStateModel = pgTable(
  "ExternalAgentChatState",
  {
    threadId: bigintAsString()
      .primaryKey()
      .references(() => internalThreadModel.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    workspaceId: bigintAsString()
      .notNull()
      .references(() => workspaceModel.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    cursorAt: timestamp(timestampConfig),
    cursorMessageId: bigintAsString(),
    includeHistory: boolean().notNull().default(true),
    runId: text(),
    runStartedAt: timestamp(timestampConfig),
    lastEventAt: timestamp(timestampConfig),
    lastEventSeq: integer().notNull().default(-1),
    lastProgressSentAt: timestamp(timestampConfig),
    lastProgressText: text(),
    lastClientSendAt: timestamp(timestampConfig),
    failureCount: integer().notNull().default(0),
    lastError: text(),
    updatedAt: sharedColumns.updatedAt,
  },
  (table) => [
    index("ExternalAgentChatState_workspaceId_idx").on(table.workspaceId),
  ],
)

/**
 * The channels (inboxes) in which an external agent answers. No row means the
 * agent answers nowhere, so enabling a channel is an explicit opt-in.
 */
export const externalAgentInboxModel = pgTable(
  "ExternalAgentInbox",
  {
    ...sharedColumns,
    externalAgentId: bigintAsString()
      .notNull()
      .references(() => externalAgentModel.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    inboxId: bigintAsString()
      .notNull()
      .references(() => inboxModel.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    workspaceId: bigintAsString()
      .notNull()
      .references(() => workspaceModel.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
  },
  (table) => [
    uniqueIndex("ExternalAgentInbox_agent_inbox_key").on(
      table.externalAgentId,
      table.inboxId,
    ),
    index("ExternalAgentInbox_inboxId_idx").on(table.inboxId),
  ],
)

/**
 * Per-conversation cursor and run state of the external agent: which client
 * messages were already sent to the agent, the current run, and progress or
 * failure bookkeeping. Keyed by conversation; the row goes with its conversation.
 */
export const externalAgentConversationStateModel = pgTable(
  "ExternalAgentConversationState",
  {
    conversationId: bigintAsString()
      .primaryKey()
      .references(() => conversationModel.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    workspaceId: bigintAsString()
      .notNull()
      .references(() => workspaceModel.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    cursorAt: timestamp(timestampConfig),
    cursorMessageId: bigintAsString(),
    includeHistory: boolean().notNull().default(true),
    runId: text(),
    runStartedAt: timestamp(timestampConfig),
    lastEventAt: timestamp(timestampConfig),
    lastEventSeq: integer().notNull().default(-1),
    lastProgressSentAt: timestamp(timestampConfig),
    lastProgressText: text(),
    lastClientSendAt: timestamp(timestampConfig),
    progressFallbackSentAt: timestamp(timestampConfig),
    failureCount: integer().notNull().default(0),
    lastError: text(),
    updatedAt: sharedColumns.updatedAt,
  },
  (table) => [
    index("ExternalAgentConversationState_workspaceId_idx").on(
      table.workspaceId,
    ),
  ],
)
