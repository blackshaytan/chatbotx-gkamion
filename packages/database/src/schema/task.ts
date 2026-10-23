import { sql } from "drizzle-orm"
import {
  check,
  index,
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
  taskCreatedBySourceValues,
  taskPriorityValues,
  taskStatusValues,
} from "../partials/task"
import { userModel } from "./auth-user"
import { contactModel } from "./contact"
import { conversationModel } from "./conversation"
import { inboxTeamModel } from "./inbox-team"
import { internalThreadModel } from "./internal-thread"
import { workspaceModel } from "./workspace"

export const taskStatus = pgEnum("taskStatus", taskStatusValues)
export const taskPriority = pgEnum("taskPriority", taskPriorityValues)
export const taskCreatedBySource = pgEnum(
  "taskCreatedBySource",
  taskCreatedBySourceValues,
)

export const taskModel = pgTable(
  "Task",
  {
    ...sharedColumns,
    workspaceId: bigintAsString()
      .notNull()
      .references(() => workspaceModel.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    title: text().notNull(),
    description: text(),
    status: taskStatus().notNull().default("todo"),
    priority: taskPriority().notNull().default("normal"),
    dueAt: timestamp(timestampConfig),
    remindAt: timestamp(timestampConfig),
    assigneeUserId: bigintAsString().references(() => userModel.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    assigneeTeamId: bigintAsString().references(() => inboxTeamModel.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    createdByUserId: bigintAsString().references(() => userModel.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    createdBySource: taskCreatedBySource().notNull(),
    createdByLabel: text(),
    threadId: bigintAsString()
      .notNull()
      .references(() => internalThreadModel.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    completedAt: timestamp(timestampConfig),
    remindedAt: timestamp(timestampConfig),
    overdueNotifiedAt: timestamp(timestampConfig),
  },
  (table) => [
    uniqueIndex("Task_threadId_key").on(table.threadId),
    index("Task_workspaceId_assigneeUserId_status_idx").on(
      table.workspaceId,
      table.assigneeUserId,
      table.status,
    ),
    index("Task_workspaceId_assigneeTeamId_status_idx").on(
      table.workspaceId,
      table.assigneeTeamId,
      table.status,
    ),
    index("Task_workspaceId_createdByUserId_idx").on(
      table.workspaceId,
      table.createdByUserId,
    ),
    index("Task_workspaceId_dueAt_open_idx")
      .on(table.workspaceId, table.dueAt)
      .where(sql`"status" IN ('todo', 'in_progress')`),
    // At most one assignee. A deleted User/team nulls its FK; the service
    // reassigns to the owner when a member is removed or a team is deleted.
    check(
      "Task_single_assignee_check",
      sql`num_nonnulls("assigneeUserId", "assigneeTeamId") <= 1`,
    ),
    check(
      "Task_remind_before_due_check",
      sql`"remindAt" IS NULL OR "dueAt" IS NULL OR "remindAt" <= "dueAt"`,
    ),
  ],
)

export const taskWatcherModel = pgTable(
  "TaskWatcher",
  {
    ...sharedColumns,
    taskId: bigintAsString()
      .notNull()
      .references(() => taskModel.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    userId: bigintAsString()
      .notNull()
      .references(() => userModel.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
  },
  (table) => [
    uniqueIndex("TaskWatcher_taskId_userId_key").on(table.taskId, table.userId),
    index("TaskWatcher_userId_idx").using(
      "btree",
      table.userId.asc().nullsLast(),
    ),
  ],
)

export const taskTargetModel = pgTable(
  "TaskTarget",
  {
    ...sharedColumns,
    taskId: bigintAsString()
      .notNull()
      .references(() => taskModel.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    contactId: bigintAsString().references(() => contactModel.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    }),
    conversationId: bigintAsString().references(() => conversationModel.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    }),
    // No FK: Message is a sharded hypertable. Scope message lookups by this
    // task's workspaceId and the target row's linked conversationId.
    messageId: bigintAsString(),
  },
  (table) => [
    index("TaskTarget_taskId_idx").using(
      "btree",
      table.taskId.asc().nullsLast(),
    ),
    index("TaskTarget_contactId_idx").using(
      "btree",
      table.contactId.asc().nullsLast(),
    ),
    index("TaskTarget_conversationId_idx").using(
      "btree",
      table.conversationId.asc().nullsLast(),
    ),
    check(
      "TaskTarget_single_target_check",
      sql`num_nonnulls("contactId", "conversationId", "messageId") = 1`,
    ),
  ],
)
