import { sql } from "drizzle-orm"
import { index, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core"
import { bigintAsString, sharedColumns } from "../partials/shared"
import { conversationModel } from "./conversation"
import { flowModel } from "./flow"
import { flowVersionModel } from "./flow-version"
import { workspaceModel } from "./workspace"

export const flowRunModel = pgTable(
  "FlowRun",
  {
    ...sharedColumns,
    workspaceId: bigintAsString()
      .notNull()
      .references(() => workspaceModel.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    flowId: bigintAsString()
      .notNull()
      .references(() => flowModel.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    flowVersionId: bigintAsString()
      .notNull()
      .references(() => flowVersionModel.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    conversationId: bigintAsString().references(() => conversationModel.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    }),
    /**
     * Set only for runs started by an external order event. Together with
     * `flowId` it keeps one run per published flow for one event id.
     */
    notificationEventId: text(),
    /** Attempt log for an order-notification run. Cleared after 30 days. */
    result: jsonb().$type<Record<string, unknown> | null>(),
  },
  (table) => [
    index("FlowRun_conversationId_idx").using(
      "btree",
      table.conversationId.asc().nullsLast(),
    ),
    uniqueIndex("FlowRun_notification_event_flow_key")
      .on(table.workspaceId, table.notificationEventId, table.flowId)
      .where(sql`${table.notificationEventId} IS NOT NULL`),
  ],
)
