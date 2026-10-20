import { index, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core"
import { bigintAsString, sharedColumns } from "../partials/shared"
import { inboxModel } from "./inbox"
import { workspaceModel } from "./workspace"

export const integrationDromModel = pgTable(
  "IntegrationDrom",
  {
    ...sharedColumns,
    /** Sealed (encrypted) auth envelope — see business `sealed-auth.ts`. */
    auth: jsonb().$type<{ [x: string]: unknown }>().notNull(),
    /** DROM seller login, the channel identity (DROM exposes no seller id). */
    sellerLogin: text().notNull(),
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
    index("IntegrationDrom_workspaceId_idx").using(
      "btree",
      table.workspaceId.asc().nullsLast(),
    ),
    uniqueIndex("IntegrationDrom_inboxId_key").using(
      "btree",
      table.inboxId.asc().nullsLast(),
    ),
    uniqueIndex("IntegrationDrom_sellerLogin_key").using(
      "btree",
      table.sellerLogin.asc().nullsLast(),
    ),
  ],
)
