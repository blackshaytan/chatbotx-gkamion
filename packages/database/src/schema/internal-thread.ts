import { sql } from "drizzle-orm"
import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core"
import {
  bigintAsString,
  sharedColumns,
  timestampConfig,
} from "../partials/shared"
import {
  type InternalMessageAttachment,
  type InternalMessageMentions,
  internalMessageKindValues,
  internalThreadTypeValues,
  type TaskSystemEvent,
} from "../partials/task"
import { userModel } from "./auth-user"
import { workspaceModel } from "./workspace"

export const internalThreadType = pgEnum(
  "internalThreadType",
  internalThreadTypeValues,
)

export const internalMessageKind = pgEnum(
  "internalMessageKind",
  internalMessageKindValues,
)

/** Task feed or staff direct/agent chat in one workspace. */
export const internalThreadModel = pgTable(
  "InternalThread",
  {
    ...sharedColumns,
    workspaceId: bigintAsString()
      .notNull()
      .references(() => workspaceModel.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    type: internalThreadType().notNull(),
    title: text(),
    directKey: text(),
    lastMessageAt: timestamp(timestampConfig),
  },
  (table) => [
    index("InternalThread_workspaceId_idx").using(
      "btree",
      table.workspaceId.asc().nullsLast(),
    ),
    uniqueIndex("InternalThread_workspaceId_directKey_key").on(
      table.workspaceId,
      table.directKey,
    ),
    index("InternalThread_workspaceId_type_lastMessageAt_idx").on(
      table.workspaceId,
      table.type,
      table.lastMessageAt.desc(),
    ),
  ],
)

export const internalThreadMemberModel = pgTable(
  "InternalThreadMember",
  {
    ...sharedColumns,
    threadId: bigintAsString()
      .notNull()
      .references(() => internalThreadModel.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    userId: bigintAsString()
      .notNull()
      .references(() => userModel.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    lastReadAt: timestamp(timestampConfig),
  },
  (table) => [
    uniqueIndex("InternalThreadMember_threadId_userId_key").on(
      table.threadId,
      table.userId,
    ),
    index("InternalThreadMember_userId_idx").using(
      "btree",
      table.userId.asc().nullsLast(),
    ),
  ],
)

export const internalMessageModel = pgTable(
  "InternalMessage",
  {
    ...sharedColumns,
    threadId: bigintAsString()
      .notNull()
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
    kind: internalMessageKind().notNull(),
    authorUserId: bigintAsString().references(() => userModel.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    // Token name or flow name when the author is not a person.
    authorLabel: text(),
    dedupeKey: text(),
    text: text(),
    // No database defaults: every insert writes both values explicitly.
    mentions: jsonb().$type<InternalMessageMentions>().notNull(),
    attachments: jsonb().$type<InternalMessageAttachment[]>().notNull(),
    systemEvent: jsonb().$type<TaskSystemEvent>(),
    editedAt: timestamp(timestampConfig),
    deletedAt: timestamp(timestampConfig),
  },
  (table) => [
    uniqueIndex("InternalMessage_threadId_dedupeKey_key")
      .on(table.threadId, table.dedupeKey)
      .where(sql`${table.dedupeKey} IS NOT NULL`),
    index("InternalMessage_threadId_createdAt_idx").using(
      "btree",
      table.threadId.asc().nullsLast(),
      table.createdAt.desc().nullsLast(),
    ),
    index("InternalMessage_workspaceId_idx").using(
      "btree",
      table.workspaceId.asc().nullsLast(),
    ),
  ],
)
