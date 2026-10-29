import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core"
import { externalOrderEventTypes } from "../partials/external-crm"
import {
  bigintAsString,
  sharedColumns,
  timestampConfig,
} from "../partials/shared"
import { contactModel } from "./contact"
import { workspaceModel } from "./workspace"

export const externalOrderEventType = pgEnum(
  "externalOrderEventType",
  externalOrderEventTypes.options as [string, ...string[]],
)

export const externalCustomerIdentityModel = pgTable(
  "ExternalCustomerIdentity",
  {
    ...sharedColumns,
    workspaceId: bigintAsString()
      .notNull()
      .references(() => workspaceModel.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    provider: text().notNull(),
    externalCustomerId: text().notNull(),
    contactId: bigintAsString()
      .notNull()
      .references(() => contactModel.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
  },
  (table) => [
    uniqueIndex("ExternalCustomerIdentity_workspace_provider_external_key").on(
      table.workspaceId,
      table.provider,
      table.externalCustomerId,
    ),
    index("ExternalCustomerIdentity_contactId_idx").on(table.contactId),
  ],
)

export const externalOrderModel = pgTable(
  "ExternalOrder",
  {
    ...sharedColumns,
    workspaceId: bigintAsString()
      .notNull()
      .references(() => workspaceModel.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    provider: text().notNull(),
    externalOrderId: text().notNull(),
    externalCustomerId: text().notNull(),
    contactId: bigintAsString()
      .notNull()
      .references(() => contactModel.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    status: text().notNull(),
    data: jsonb().$type<Record<string, unknown>>().notNull(),
    lastEventAt: timestamp(timestampConfig).notNull(),
  },
  (table) => [
    uniqueIndex("ExternalOrder_workspace_provider_external_key").on(
      table.workspaceId,
      table.provider,
      table.externalOrderId,
    ),
    index("ExternalOrder_contactId_updatedAt_idx").on(
      table.contactId,
      table.updatedAt,
    ),
  ],
)

export const externalOrderEventModel = pgTable(
  "ExternalOrderEvent",
  {
    ...sharedColumns,
    workspaceId: bigintAsString()
      .notNull()
      .references(() => workspaceModel.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    provider: text().notNull(),
    eventId: text().notNull(),
    externalOrderId: text().notNull(),
    eventType: externalOrderEventType().notNull(),
    status: text().notNull(),
    data: jsonb().$type<Record<string, unknown>>().notNull(),
    occurredAt: timestamp(timestampConfig).notNull(),
  },
  (table) => [
    uniqueIndex("ExternalOrderEvent_workspace_provider_event_key").on(
      table.workspaceId,
      table.provider,
      table.eventId,
    ),
    index("ExternalOrderEvent_workspace_order_occurred_idx").on(
      table.workspaceId,
      table.externalOrderId,
      table.occurredAt,
    ),
  ],
)
