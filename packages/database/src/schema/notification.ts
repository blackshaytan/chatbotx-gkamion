import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core"
import type {
  NotificationPayload,
  TaskNotificationType,
} from "../partials/notification"
import {
  bigintAsString,
  sharedColumns,
  timestampConfig,
} from "../partials/shared"
import { userModel } from "./auth-user"
import { workspaceModel } from "./workspace"

export const notificationModel = pgTable(
  "Notification",
  {
    ...sharedColumns,
    workspaceId: bigintAsString()
      .notNull()
      .references(() => workspaceModel.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    userId: bigintAsString()
      .notNull()
      .references(() => userModel.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    type: text().$type<TaskNotificationType>().notNull(),
    entityType: text().$type<"task">().notNull(),
    entityId: bigintAsString().notNull(),
    payload: jsonb().$type<NotificationPayload>().notNull(),
    readAt: timestamp(timestampConfig),
  },
  (table) => [
    index("Notification_userId_workspaceId_readAt_createdAt_idx").on(
      table.userId,
      table.workspaceId,
      table.readAt,
      table.createdAt,
    ),
    index("Notification_workspaceId_entityType_entityId_idx").on(
      table.workspaceId,
      table.entityType,
      table.entityId,
    ),
    index("Notification_createdAt_idx").on(table.createdAt),
  ],
)
