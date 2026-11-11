import { sql } from "drizzle-orm"
import {
  check,
  foreignKey,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core"
import {
  bigintAsString,
  sharedColumns,
  timestampConfig,
} from "../partials/shared"
import { conversationModel } from "./conversation"
import { workspaceModel } from "./workspace"

/**
 * Source-of-truth row that tracks the current revision of the conversation
 * source used to build dialog memory. One row per (workspace, conversation).
 * The row is created lazily by registration and never reset.
 */
export const dialogMemorySourceModel = pgTable(
  "DialogMemorySource",
  {
    workspaceId: bigintAsString()
      .notNull()
      .references(() => workspaceModel.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    conversationId: bigintAsString().notNull(),
    sourceRevision: bigintAsString().notNull().default("0"),
    createdAt: sharedColumns.createdAt,
    updatedAt: sharedColumns.updatedAt,
  },
  (table) => [
    primaryKey({
      columns: [table.workspaceId, table.conversationId],
      name: "DialogMemorySource_pkey",
    }),
    foreignKey({
      columns: [table.workspaceId, table.conversationId],
      foreignColumns: [conversationModel.workspaceId, conversationModel.id],
      name: "DialogMemorySource_workspaceId_conversationId_fkey",
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
    check(
      "DialogMemorySource_sourceRevision_check",
      sql`${table.sourceRevision} >= 0`,
    ),
  ],
)

/**
 * Published memory snapshot for a conversation. Freshness is computed by
 * comparing coveredSourceRevision with DialogMemorySource.sourceRevision and
 * topologyEpoch with the global DialogMemoryTopology epoch; no stored state
 * enum exists.
 */
export const dialogMemoryModel = pgTable(
  "DialogMemory",
  {
    workspaceId: bigintAsString()
      .notNull()
      .references(() => workspaceModel.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    conversationId: bigintAsString().notNull(),
    summary: jsonb().$type<Record<string, unknown>>(),
    schemaVersion: integer().notNull(),
    promptVersion: text().notNull(),
    model: text().notNull(),
    provider: text().notNull(),
    memoryVersion: bigintAsString().notNull().default("1"),
    coveredSourceRevision: bigintAsString().notNull(),
    topologyEpoch: bigintAsString().notNull().default("0"),
    coverageMessageId: bigintAsString(),
    coverageCreatedAt: timestamp(timestampConfig),
    lastError: text(),
    lastAttemptAt: timestamp(timestampConfig),
    createdAt: sharedColumns.createdAt,
    updatedAt: sharedColumns.updatedAt,
  },
  (table) => [
    primaryKey({
      columns: [table.workspaceId, table.conversationId],
      name: "DialogMemory_pkey",
    }),
    foreignKey({
      columns: [table.workspaceId, table.conversationId],
      foreignColumns: [conversationModel.workspaceId, conversationModel.id],
      name: "DialogMemory_workspaceId_conversationId_fkey",
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
    check(
      "DialogMemory_schemaVersion_check",
      sql`${table.schemaVersion} >= 1`,
    ),
    check(
      "DialogMemory_memoryVersion_check",
      sql`${table.memoryVersion} >= 1`,
    ),
    check(
      "DialogMemory_coveredSourceRevision_check",
      sql`${table.coveredSourceRevision} >= 0`,
    ),
    check(
      "DialogMemory_topologyEpoch_check",
      sql`${table.topologyEpoch} >= 0`,
    ),
    check(
      "DialogMemory_coveragePair_check",
      sql`(${table.coverageMessageId} IS NULL) = (${table.coverageCreatedAt} IS NULL)`,
    ),
  ],
)

/**
 * Global singleton that holds the current topology epoch. The epoch is
 * bumped inside the transaction that mutates topology; committed epochs are
 * never rolled back.
 */
export const dialogMemoryTopologyModel = pgTable(
  "DialogMemoryTopology",
  {
    id: text().primaryKey().default("global"),
    topologyEpoch: bigintAsString().notNull().default("0"),
    updatedAt: sharedColumns.updatedAt,
  },
  (table) => [
    check("DialogMemoryTopology_id_check", sql`${table.id} = 'global'`),
    check(
      "DialogMemoryTopology_topologyEpoch_check",
      sql`${table.topologyEpoch} >= 0`,
    ),
  ],
)
