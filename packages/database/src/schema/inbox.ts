import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core"
import type { InboxDisconnectReason } from "../partials/conversation"
import {
  bigintAsString,
  sharedColumns,
  timestampConfig,
} from "../partials/shared"
import { userModel } from "./auth-user"
import { workspaceModel } from "./workspace"

export const inboxModel = pgTable(
  "Inbox",
  {
    ...sharedColumns,
    name: text().notNull(),
    channel: text().notNull(),
    sourceId: text().notNull(),
    workspaceId: bigintAsString()
      .notNull()
      .references(() => workspaceModel.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    status: text().notNull().default("connected"),
    markReadOnOutbound: boolean().notNull().default(false),
    disconnectedAt: timestamp(timestampConfig),
    disconnectReason: text().$type<InboxDisconnectReason>(),
    // Last time conversation-routing traffic (standby, handover, context or a
    // rejected send) was seen on this inbox. The inbox counts as multi-responder
    // while this is within THREAD_CONTROL_INBOX_ACTIVE_MS; it decays on its own.
    threadControlSeenAt: timestamp(timestampConfig),
    ownerUserId: bigintAsString().references(() => userModel.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
  },
  (table) => [
    index("Inbox_workspaceId_idx").using(
      "btree",
      table.workspaceId.asc().nullsLast(),
    ),
    index("Inbox_workspaceId_ownerUserId_idx").using(
      "btree",
      table.workspaceId.asc().nullsLast(),
      table.ownerUserId.asc().nullsLast(),
    ),
    uniqueIndex("Inbox_workspaceId_channel_sourceId_key").using(
      "btree",
      table.workspaceId.asc().nullsLast(),
      table.channel.asc().nullsLast(),
      table.sourceId.asc().nullsLast(),
    ),
  ],
)
