import { integer, jsonb, pgTable, timestamp } from "drizzle-orm/pg-core"
import { bigintAsString, timestampConfig } from "../partials/shared"
import { connectionModel } from "./connection"
import { workspaceModel } from "./workspace"

/**
 * Progress of a polling channel (`ConnectionProvider.poll`), one row per
 * connection. `cursor` is opaque to everything but the provider.
 */
export const connectionPollStateModel = pgTable("ConnectionPollState", {
  connectionId: bigintAsString()
    .primaryKey()
    .references(() => connectionModel.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    }),
  workspaceId: bigintAsString()
    .notNull()
    .references(() => workspaceModel.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    }),
  cursor: jsonb().$type<Record<string, unknown>>(),
  intervalSeconds: integer().notNull(),
  lastPolledAt: timestamp(timestampConfig),
  lastSucceededAt: timestamp(timestampConfig),
})
