import { index, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core"
import { bigintAsString, sharedColumns } from "../partials/shared"
import { inboxModel } from "./inbox"
import { workspaceModel } from "./workspace"

export const integrationZzapModel = pgTable(
  "IntegrationZzap",
  {
    ...sharedColumns,
    /** Sealed (encrypted) auth envelope — see business `sealed-auth.ts`. */
    auth: jsonb().$type<{ [x: string]: unknown }>().notNull(),
    /** ZZAP seller object code (`code_object`), the channel identity. */
    codeObject: text().notNull(),
    name: text().notNull(),
    workspaceId: bigintAsString()
      .notNull()
      .references(() => workspaceModel.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    inboxId: bigintAsString()
      .notNull()
      .references(() => inboxModel.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
  },
  (table) => [
    index("IntegrationZzap_workspaceId_idx").using(
      "btree",
      table.workspaceId.asc().nullsLast(),
    ),
    uniqueIndex("IntegrationZzap_inboxId_key").using(
      "btree",
      table.inboxId.asc().nullsLast(),
    ),
    uniqueIndex("IntegrationZzap_codeObject_key").using(
      "btree",
      table.codeObject.asc().nullsLast(),
    ),
  ],
)
