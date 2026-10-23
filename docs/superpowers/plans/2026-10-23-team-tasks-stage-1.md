# Team Tasks — Stage 1 (data, services, public API) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** сотрудники, Hermes и сценарии могут ставить задачи через публичный API: создать, найти, изменить, завершить, удалить задачу, вести наблюдателей и комментарии. Интерфейса пока нет (этап 2).

**Architecture:** шесть новых таблиц (`InternalThread`, `InternalThreadMember`, `InternalMessage`, `Task`, `TaskWatcher`, `TaskTarget`) → два репозитория (`taskRepository`, `internalThreadRepository`, только сырые запросы) → `taskService` и `internalThreadService` в `packages/business` (права, проверки, системные сообщения ленты, перевод задач на владельца) → `features/tasks/api/public.ts` под новой областью токена `tasks` → CLI и MCP получают операции из спецификации.

**Tech Stack:** Drizzle + PostgreSQL, oRPC, zod 4, date-fns-tz, vitest.

**Spec:** `docs/superpowers/specs/2026-10-17-team-tasks-design.md` (разделы 3.1, 3.2, 4.1, 4.2, 6, 8, 9; этап 1 из раздела 10).

---

## Global Constraints

- Те же, что в `.superpowers/sdd/hermes-constraints.md`: локально только `ultracite`/точечные vitest, тяжёлые `check-types` и полные тесты — в GitHub CI (`gkamion-checks.yml`); **без `db:migrate`** — миграцию только сгенерировать и показать пользователю, применять после явного «да»; без печати секретов; `git add <конкретные пути>`; не трогать `apps/builder/AGENTS.md`; `{ err }` в логах; без динамических `import()` вне builder.
- Цепочка `API handler → service → repository → DB` (инвариант 9): в `apps/` нет `db`; репозитории без кэша, событий и проверок.
- `relations/index.ts` — две правки на каждый файл связей (инвариант 2).
- Новая область токена → `Record<WorkspaceApiTokenScope, …>` и ключ `fields.tokenScopes.tasks` во всех 22 `apps/builder/messages/*.json` (`ru.json` — «Задачи», остальные — «Tasks»).
- Каждый DELETE без тела — `successStatus: 204`; создание — `successStatus: 201`; в `description` каждой операции — откуда брать каждый id (инвариант 23).
- Ответы пользователю — по-русски, просто.

## Deviations from the spec (decided while planning)

1. **Ответственный: «не больше одного» в БД, «ровно один» в сервисе.** CHECK `num_nonnulls("assigneeUserId","assigneeTeamId") <= 1`, потому что FK `ON DELETE SET NULL` (удалён пользователь или команда) иначе нарушил бы «ровно один». Сервис требует ответственного при создании, а при удалении сотрудника из пространства или команды переводит задачи на владельца (раздел 8 спеки).
2. **Пагинация `page`/`perPage` + `pageCount`**, как у остальных публичных списков (`publicListRequest`), а не курсор. Сортировка по спеке: срок (пустые в конце), приоритет (срочные первыми), затем новые первыми.
3. **`messageId` в связях — без FK и без проверки по шардам.** `Message` — шардированная гипертаблица без FK (как `ContactInboxPost`). `messageId` принимается только вместе с `conversationId`; диалог проверяется на принадлежность пространству, контакт диалога добавляется в связи автоматически.
4. **Фильтры списка — одиночные значения** (`status` = одно значение или `open` = `todo`+`in_progress`; `priority`; `due` = `overdue|today|week|none`), без JSON-массивов в query. «Сегодня» и «неделя» считаются в часовом поясе пространства (`Workspace.timezone`).
5. **Отложено на следующие этапы:** события уведомлений (`task.assigned` и др.) — этап 4; разбор `@упоминаний`, вложения, правка/удаление комментариев, `markRead`, realtime — этап 3; «Взять себе» (`take`) и приватный API для интерфейса — этап 2; поле `url` в ответе — этап 2, вместе со страницей задачи (поле добавится, контракт не ломается). Колонки `mentions`/`attachments` создаются сейчас и пишутся пустыми.
6. **Метка автора для API** — имя токена: в `RequestApiToken` добавляется `name` (не секрет; хэш по-прежнему не попадает в контекст).

## File map

**Create**
- `packages/database/src/partials/task.ts` — enum'ы, лимиты, типы jsonb.
- `packages/database/src/schema/internal-thread.ts`, `packages/database/src/schema/task.ts`.
- `packages/database/src/relations/internal-thread.ts`, `packages/database/src/relations/task.ts`.
- `packages/database/drizzle/<ts>_team_tasks/` — генерируется.
- `packages/database/src/repositories/internal-thread/{repository.ts,index.ts}`.
- `packages/database/src/repositories/task/{list-where.ts,repository.ts,index.ts}`.
- `packages/business/src/task/{actor.ts,types.ts,permissions.ts,changes.ts,due-window.ts,view.ts,service.ts,index.ts}`.
- `packages/business/src/internal-thread/{message-rows.ts,view.ts,service.ts,index.ts}`.
- `apps/builder/src/features/tasks/{schema/public.ts,lib/assignee.ts,lib/actor.ts,api/public.ts}`.
- `docs/tasks.md`.
- Тесты: `packages/database/__tests__/task-partial.test.ts`, `packages/database/__tests__/task-list-where.test.ts`, `packages/business/__tests__/task/{permissions,changes,due-window,view,message-rows,task-service,task-reassign}.test.ts`, `apps/builder/__tests__/tasks-public-api.test.ts`.

**Modify**
- `packages/database/src/partials/index.ts`, `src/schema/index.ts`, `src/types.ts`, `src/relations/index.ts` (две правки × 2), `src/repositories/index.ts`.
- `packages/database/src/partials/workspace-api-token.ts` (+`tasks`).
- `packages/business/src/index.ts`, `packages/business/src/workspace-member/service.ts` (`delete`), `packages/business/src/enterprise/inbox-team/service.ts` (`delete`).
- `apps/builder/src/middlewares/context.ts`, `apps/builder/src/middlewares/workspace-token-auth.ts` (`name` в проекции токена).
- `apps/builder/src/features/workspaces/lib/workspace-token-scopes.ts`, `apps/builder/__tests__/workspace-token-scope-registry.test.ts`.
- `apps/builder/messages/*.json` (22).
- `apps/builder/src/routers/public.ts`, `apps/builder/__tests__/__snapshots__/public-spec-operations.test.ts.snap`.
- `apps/cli/README.md`, `apps/mcp-server/README.md`, `docs/developer/workspace-api-tokens.md`, `AGENTS.md` (ссылка на `docs/tasks.md`), `.github/workflows/gkamion-checks.yml`.

---

### Task 1: Partials, tables, relations, migration

**Files:**
- Create: `packages/database/src/partials/task.ts`, `packages/database/src/schema/internal-thread.ts`, `packages/database/src/schema/task.ts`, `packages/database/src/relations/internal-thread.ts`, `packages/database/src/relations/task.ts`
- Modify: `packages/database/src/partials/index.ts`, `packages/database/src/schema/index.ts`, `packages/database/src/types.ts`, `packages/database/src/relations/index.ts`
- Test: `packages/database/__tests__/task-partial.test.ts`

**Interfaces:**
- Produces: `taskStatuses`, `taskStatusValues`, `OPEN_TASK_STATUSES`, `taskPriorities`, `taskPriorityValues`, `taskCreatedBySources`, `internalMessageKinds`, `taskDueFilters`, `taskSystemEventTypes`, `TASK_LIMITS`, `EMPTY_INTERNAL_MESSAGE_MENTIONS`; types `TaskStatus`, `TaskPriority`, `TaskCreatedBySource`, `InternalMessageKind`, `TaskDueFilter`, `TaskSystemEvent`, `InternalMessageMentions`, `InternalMessageAttachment`; models `internalThreadModel`, `internalThreadMemberModel`, `internalMessageModel`, `taskModel`, `taskWatcherModel`, `taskTargetModel`; types `InternalThreadModel`, `InternalThreadMemberModel`, `InternalMessageModel`, `TaskModel`, `TaskWatcherModel`, `TaskTargetModel`.

- [ ] **Step 1: Write the failing test**

`packages/database/__tests__/task-partial.test.ts`:

```ts
import { describe, expect, test } from "vitest"
import {
  OPEN_TASK_STATUSES,
  taskPriorityValues,
  taskStatusValues,
} from "../src/partials/task"

describe("task partials", () => {
  test("priority is declared low → urgent so an enum DESC sort puts urgent first", () => {
    expect(taskPriorityValues).toEqual(["low", "normal", "high", "urgent"])
  })

  test("open statuses are todo and in_progress", () => {
    expect(OPEN_TASK_STATUSES).toEqual(["todo", "in_progress"])
    expect(taskStatusValues).toEqual(["todo", "in_progress", "done", "canceled"])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/database && pnpm exec vitest run __tests__/task-partial.test.ts`
Expected: FAIL — cannot resolve `../src/partials/task`.

- [ ] **Step 3: Partials**

`packages/database/src/partials/task.ts`:

```ts
import z from "zod"

export const TASK_LIMITS = {
  maxTitleLength: 255,
  maxDescriptionLength: 10_000,
  maxCommentLength: 10_000,
  maxWatchers: 50,
} as const

export const taskStatusValues = [
  "todo",
  "in_progress",
  "done",
  "canceled",
] as const
export const taskStatuses = z.enum(taskStatusValues)
export type TaskStatus = z.infer<typeof taskStatuses>

export const OPEN_TASK_STATUSES = [
  "todo",
  "in_progress",
] as const satisfies readonly TaskStatus[]

// Declared low → urgent: Postgres orders enum values by declaration, so a
// DESC sort on the column puts urgent first.
export const taskPriorityValues = ["low", "normal", "high", "urgent"] as const
export const taskPriorities = z.enum(taskPriorityValues)
export type TaskPriority = z.infer<typeof taskPriorities>

export const taskCreatedBySourceValues = ["user", "flow", "api"] as const
export const taskCreatedBySources = z.enum(taskCreatedBySourceValues)
export type TaskCreatedBySource = z.infer<typeof taskCreatedBySources>

export const internalThreadTypeValues = ["task"] as const

export const internalMessageKindValues = ["comment", "system"] as const
export const internalMessageKinds = z.enum(internalMessageKindValues)
export type InternalMessageKind = z.infer<typeof internalMessageKinds>

export const taskDueFilters = z.enum(["overdue", "today", "week", "none"])
export type TaskDueFilter = z.infer<typeof taskDueFilters>

export const taskSystemEventTypes = z.enum([
  "created",
  "status",
  "due",
  "assignee",
  "priority",
])

/** `from`/`to` are status/priority values, ISO dates, or `user:<id>` / `team:<id>`. */
export type TaskSystemEvent = {
  type: z.infer<typeof taskSystemEventTypes>
  from: string | null
  to: string | null
  byUserId: string | null
}

export type InternalMessageMentions = { userIds: string[]; teamIds: string[] }

export const EMPTY_INTERNAL_MESSAGE_MENTIONS: InternalMessageMentions = {
  userIds: [],
  teamIds: [],
}

export type InternalMessageAttachment = {
  key: string
  name: string
  size: number
  mimeType: string
}
```

Add to `packages/database/src/partials/index.ts` (alphabetical, after `./system-field`):

```ts
export * from "./task"
```

- [ ] **Step 4: Internal thread tables**

`packages/database/src/schema/internal-thread.ts`:

```ts
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
  type InternalMessageAttachment,
  type InternalMessageMentions,
  internalMessageKindValues,
  internalThreadTypeValues,
  type TaskSystemEvent,
} from "../partials/task"
import {
  bigintAsString,
  sharedColumns,
  timestampConfig,
} from "../partials/shared"
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

/** A staff-only discussion: today the feed of one task, later staff chats. */
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
  },
  (table) => [
    index("InternalThread_workspaceId_idx").using(
      "btree",
      table.workspaceId.asc().nullsLast(),
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
    text: text(),
    // No database defaults: every insert writes both values explicitly.
    mentions: jsonb().$type<InternalMessageMentions>().notNull(),
    attachments: jsonb().$type<InternalMessageAttachment[]>().notNull(),
    systemEvent: jsonb().$type<TaskSystemEvent>(),
    editedAt: timestamp(timestampConfig),
    deletedAt: timestamp(timestampConfig),
  },
  (table) => [
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
```

- [ ] **Step 5: Task tables**

`packages/database/src/schema/task.ts`:

```ts
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
  taskCreatedBySourceValues,
  taskPriorityValues,
  taskStatusValues,
} from "../partials/task"
import {
  bigintAsString,
  sharedColumns,
  timestampConfig,
} from "../partials/shared"
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
    // At most one: a deleted user or team nulls its FK, and the service
    // then hands the task to the workspace owner.
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
    // No FK: Message is a sharded hypertable without foreign keys.
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
```

Add to `packages/database/src/schema/index.ts` (alphabetical: after `./integration-zzap` → `./internal-thread`; after `./tag` → `./task`):

```ts
export * from "./internal-thread"
```

```ts
export * from "./task"
```

- [ ] **Step 6: Relations (two edits each in `relations/index.ts`)**

`packages/database/src/relations/internal-thread.ts`:

```ts
import { defineRelationsPart } from "drizzle-orm"
// biome-ignore lint/performance/noNamespaceImport: drizzle schema
import * as schema from "../schema"

export const internalThreadRelations = defineRelationsPart(schema, (r) => ({
  internalThreadModel: {
    workspace: r.one.workspaceModel({
      from: r.internalThreadModel.workspaceId,
      to: r.workspaceModel.id,
      optional: false,
    }),
    members: r.many.internalThreadMemberModel({
      from: r.internalThreadModel.id,
      to: r.internalThreadMemberModel.threadId,
    }),
    messages: r.many.internalMessageModel({
      from: r.internalThreadModel.id,
      to: r.internalMessageModel.threadId,
    }),
  },
  internalThreadMemberModel: {
    thread: r.one.internalThreadModel({
      from: r.internalThreadMemberModel.threadId,
      to: r.internalThreadModel.id,
      optional: false,
    }),
    user: r.one.userModel({
      from: r.internalThreadMemberModel.userId,
      to: r.userModel.id,
      optional: false,
    }),
  },
  internalMessageModel: {
    thread: r.one.internalThreadModel({
      from: r.internalMessageModel.threadId,
      to: r.internalThreadModel.id,
      optional: false,
    }),
    authorUser: r.one.userModel({
      from: r.internalMessageModel.authorUserId,
      to: r.userModel.id,
    }),
  },
}))
```

`packages/database/src/relations/task.ts`:

```ts
import { defineRelationsPart } from "drizzle-orm"
// biome-ignore lint/performance/noNamespaceImport: drizzle schema
import * as schema from "../schema"

export const taskRelations = defineRelationsPart(schema, (r) => ({
  taskModel: {
    workspace: r.one.workspaceModel({
      from: r.taskModel.workspaceId,
      to: r.workspaceModel.id,
      optional: false,
    }),
    thread: r.one.internalThreadModel({
      from: r.taskModel.threadId,
      to: r.internalThreadModel.id,
      optional: false,
    }),
    assigneeUser: r.one.userModel({
      from: r.taskModel.assigneeUserId,
      to: r.userModel.id,
    }),
    assigneeTeam: r.one.inboxTeamModel({
      from: r.taskModel.assigneeTeamId,
      to: r.inboxTeamModel.id,
    }),
    createdByUser: r.one.userModel({
      from: r.taskModel.createdByUserId,
      to: r.userModel.id,
    }),
    watchers: r.many.taskWatcherModel({
      from: r.taskModel.id,
      to: r.taskWatcherModel.taskId,
    }),
    targets: r.many.taskTargetModel({
      from: r.taskModel.id,
      to: r.taskTargetModel.taskId,
    }),
  },
  taskWatcherModel: {
    task: r.one.taskModel({
      from: r.taskWatcherModel.taskId,
      to: r.taskModel.id,
      optional: false,
    }),
    user: r.one.userModel({
      from: r.taskWatcherModel.userId,
      to: r.userModel.id,
      optional: false,
    }),
  },
  taskTargetModel: {
    task: r.one.taskModel({
      from: r.taskTargetModel.taskId,
      to: r.taskModel.id,
      optional: false,
    }),
    contact: r.one.contactModel({
      from: r.taskTargetModel.contactId,
      to: r.contactModel.id,
    }),
    conversation: r.one.conversationModel({
      from: r.taskTargetModel.conversationId,
      to: r.conversationModel.id,
    }),
  },
}))
```

In `packages/database/src/relations/index.ts` add **both** imports near the other imports:

```ts
import { internalThreadRelations } from "./internal-thread"
import { taskRelations } from "./task"
```

and **both** spreads inside the `relations` object:

```ts
  ...internalThreadRelations,
  ...taskRelations,
```

Read the file back and confirm all four lines exist.

- [ ] **Step 7: Types**

Append to `packages/database/src/types.ts` (next to similar exports):

```ts
export type InternalThreadModel = typeof schema.internalThreadModel.$inferSelect
export type InternalThreadMemberModel =
  typeof schema.internalThreadMemberModel.$inferSelect
export type InternalMessageModel =
  typeof schema.internalMessageModel.$inferSelect
export type TaskModel = typeof schema.taskModel.$inferSelect
export type TaskWatcherModel = typeof schema.taskWatcherModel.$inferSelect
export type TaskTargetModel = typeof schema.taskTargetModel.$inferSelect
```

- [ ] **Step 8: Run the partial test**

Run: `cd packages/database && pnpm exec vitest run __tests__/task-partial.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 9: Generate the migration (do not apply)**

Run: `pnpm --filter @chatbotx.io/database make:migration team_tasks`
Expected: new folder `packages/database/drizzle/<ts>_team_tasks/` with `migration.sql` + `snapshot.json`.

Inspect: `rg -n 'CREATE TYPE|CREATE TABLE|CHECK|CREATE (UNIQUE )?INDEX' packages/database/drizzle/*_team_tasks/migration.sql`
Expected: 5 `CREATE TYPE` (`internalThreadType`, `internalMessageKind`, `taskStatus`, `taskPriority`, `taskCreatedBySource`), 6 `CREATE TABLE`, 3 CHECK constraints, the partial index `WHERE "status" IN ('todo', 'in_progress')`. Nothing that alters existing tables except FK constraints on the new tables.

Run: `pnpm --filter @chatbotx.io/database db:check-drift`
Expected: exit 0 (no drift).

**Do not run `db:migrate`.** The SQL is shown to the user before deploy; it is applied only after their explicit «да».

- [ ] **Step 10: Lint and commit**

Run: `pnpm exec ultracite fix packages/database/src/partials/task.ts packages/database/src/schema/internal-thread.ts packages/database/src/schema/task.ts packages/database/src/relations/internal-thread.ts packages/database/src/relations/task.ts packages/database/__tests__/task-partial.test.ts`

```bash
git add packages/database/src/partials/task.ts packages/database/src/partials/index.ts \
  packages/database/src/schema/internal-thread.ts packages/database/src/schema/task.ts \
  packages/database/src/schema/index.ts packages/database/src/types.ts \
  packages/database/src/relations/internal-thread.ts packages/database/src/relations/task.ts \
  packages/database/src/relations/index.ts packages/database/__tests__/task-partial.test.ts \
  packages/database/drizzle/*_team_tasks
git commit -m "feat(database): add task and internal thread tables"
```

---

### Task 2: Repositories

**Files:**
- Create: `packages/database/src/repositories/internal-thread/{repository.ts,index.ts}`, `packages/database/src/repositories/task/{list-where.ts,repository.ts,index.ts}`
- Modify: `packages/database/src/repositories/index.ts`
- Test: `packages/database/__tests__/task-list-where.test.ts`

**Interfaces:**
- Consumes: models and types from Task 1.
- Produces:
  - `type TaskListFilter = { workspaceId: string; statuses?: TaskStatus[]; priority?: TaskPriority; assigneeUserId?: string; assigneeTeamId?: string; createdByUserId?: string; watcherUserId?: string; contactId?: string; conversationId?: string; dueFrom?: Date; dueBefore?: Date; withoutDue?: boolean }`
  - `buildTaskListWhere(filter: TaskListFilter): Record<string, unknown>`, `TASK_LIST_ORDER_BY`
  - `type TaskWithRelations = TaskModel & { watchers: { userId: string }[]; targets: TaskTargetModel[] }`
  - `taskRepository`: `findWorkspace`, `listMemberUserIds`, `listTeamIds`, `findContact`, `findConversation`, `listVisibleTargetIds`, `insertTask`, `insertWatchers`, `deleteWatcher`, `insertTargets`, `findById`, `list`, `update`, `deleteWithThread`, `listAssignedToUser`, `listAssignedToTeams`, `assignToUser` (signatures in code below)
  - `internalThreadRepository`: `insertThread`, `insertMembers`, `deleteMember`, `insertMessages`, `listMessages`

- [ ] **Step 1: Write the failing where-builder test**

`packages/database/__tests__/task-list-where.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, test } from "vitest"
import {
  buildTaskListWhere,
  TASK_LIST_ORDER_BY,
} from "../src/repositories/task/list-where"

describe("buildTaskListWhere", () => {
  test("always scopes to the workspace", () => {
    expect(buildTaskListWhere({ workspaceId: "ws-1" })).toEqual({
      workspaceId: "ws-1",
    })
  })

  test("maps scalar filters and statuses", () => {
    expect(
      buildTaskListWhere({
        workspaceId: "ws-1",
        statuses: ["todo", "in_progress"],
        priority: "urgent",
        assigneeUserId: "u-1",
        assigneeTeamId: "t-1",
        createdByUserId: "u-2",
      }),
    ).toEqual({
      workspaceId: "ws-1",
      status: { in: ["todo", "in_progress"] },
      priority: "urgent",
      assigneeUserId: "u-1",
      assigneeTeamId: "t-1",
      createdByUserId: "u-2",
    })
  })

  test("filters by watcher and both target kinds through relations", () => {
    expect(
      buildTaskListWhere({
        workspaceId: "ws-1",
        watcherUserId: "u-3",
        contactId: "c-1",
        conversationId: "conv-1",
      }),
    ).toEqual({
      workspaceId: "ws-1",
      watchers: { userId: "u-3" },
      AND: [
        { targets: { contactId: "c-1" } },
        { targets: { conversationId: "conv-1" } },
      ],
    })
  })

  test("builds a due window, or matches tasks without a due date", () => {
    const from = new Date("2026-10-23T00:00:00Z")
    const before = new Date("2026-10-24T00:00:00Z")
    expect(
      buildTaskListWhere({ workspaceId: "ws-1", dueFrom: from, dueBefore: before })
        .dueAt,
    ).toEqual({ gte: from, lt: before })
    expect(
      buildTaskListWhere({ workspaceId: "ws-1", withoutDue: true }).dueAt,
    ).toEqual({ isNull: true })
  })

  test("orders by due date, then priority, then newest", () => {
    expect(TASK_LIST_ORDER_BY).toEqual({
      dueAt: "asc",
      priority: "desc",
      createdAt: "desc",
      id: "desc",
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/database && pnpm exec vitest run __tests__/task-list-where.test.ts`
Expected: FAIL — cannot resolve `list-where`.

- [ ] **Step 3: Where-builder**

`packages/database/src/repositories/task/list-where.ts`:

```ts
import type { TaskPriority, TaskStatus } from "../../partials/task"

export type TaskListFilter = {
  workspaceId: string
  statuses?: TaskStatus[]
  priority?: TaskPriority
  assigneeUserId?: string
  assigneeTeamId?: string
  createdByUserId?: string
  watcherUserId?: string
  contactId?: string
  conversationId?: string
  dueFrom?: Date
  dueBefore?: Date
  withoutDue?: boolean
}

type TaskWhere = Record<string, unknown>

// Postgres sorts NULLs last on ASC, so tasks without a due date come last;
// priority DESC follows the enum declaration order (urgent first).
export const TASK_LIST_ORDER_BY = {
  dueAt: "asc",
  priority: "desc",
  createdAt: "desc",
  id: "desc",
} as const

const buildDueWhere = (filter: TaskListFilter): TaskWhere | undefined => {
  if (filter.withoutDue) {
    return { isNull: true }
  }
  const dueAt: TaskWhere = {}
  if (filter.dueFrom) {
    dueAt.gte = filter.dueFrom
  }
  if (filter.dueBefore) {
    dueAt.lt = filter.dueBefore
  }
  return Object.keys(dueAt).length > 0 ? dueAt : undefined
}

/** Pure where-builder for the task list and its count. No I/O. */
export function buildTaskListWhere(filter: TaskListFilter): TaskWhere {
  const where: TaskWhere = { workspaceId: filter.workspaceId }

  if (filter.statuses?.length) {
    where.status = { in: filter.statuses }
  }
  if (filter.priority) {
    where.priority = filter.priority
  }
  if (filter.assigneeUserId) {
    where.assigneeUserId = filter.assigneeUserId
  }
  if (filter.assigneeTeamId) {
    where.assigneeTeamId = filter.assigneeTeamId
  }
  if (filter.createdByUserId) {
    where.createdByUserId = filter.createdByUserId
  }
  if (filter.watcherUserId) {
    where.watchers = { userId: filter.watcherUserId }
  }

  const targetFilters: TaskWhere[] = []
  if (filter.contactId) {
    targetFilters.push({ targets: { contactId: filter.contactId } })
  }
  if (filter.conversationId) {
    targetFilters.push({ targets: { conversationId: filter.conversationId } })
  }
  if (targetFilters.length === 1) {
    Object.assign(where, targetFilters[0])
  } else if (targetFilters.length > 1) {
    where.AND = targetFilters
  }

  const dueAt = buildDueWhere(filter)
  if (dueAt) {
    where.dueAt = dueAt
  }

  return where
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/database && pnpm exec vitest run __tests__/task-list-where.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Internal thread repository**

`packages/database/src/repositories/internal-thread/repository.ts`:

```ts
import { and, type DatabaseClient, db, eq } from "../../client"
import {
  internalMessageModel,
  internalThreadMemberModel,
  internalThreadModel,
} from "../../schema"
import type { InternalMessageModel, InternalThreadModel } from "../../types"

export type InternalMessageInsert = typeof internalMessageModel.$inferInsert

class InternalThreadRepository {
  async insertThread(props: {
    workspaceId: string
    tx?: DatabaseClient
  }): Promise<InternalThreadModel> {
    const { workspaceId, tx = db } = props
    const [thread] = await tx
      .insert(internalThreadModel)
      .values({ workspaceId, type: "task" })
      .returning()
    return thread
  }

  async insertMembers(props: {
    rows: { threadId: string; userId: string }[]
    tx?: DatabaseClient
  }): Promise<void> {
    const { rows, tx = db } = props
    if (rows.length === 0) {
      return
    }
    await tx.insert(internalThreadMemberModel).values(rows).onConflictDoNothing()
  }

  async deleteMember(props: {
    threadId: string
    userId: string
    tx?: DatabaseClient
  }): Promise<void> {
    const { threadId, userId, tx = db } = props
    await tx
      .delete(internalThreadMemberModel)
      .where(
        and(
          eq(internalThreadMemberModel.threadId, threadId),
          eq(internalThreadMemberModel.userId, userId),
        ),
      )
  }

  async insertMessages(props: {
    rows: InternalMessageInsert[]
    tx?: DatabaseClient
  }): Promise<InternalMessageModel[]> {
    const { rows, tx = db } = props
    if (rows.length === 0) {
      return []
    }
    return await tx.insert(internalMessageModel).values(rows).returning()
  }

  /** Newest first. */
  async listMessages(props: {
    workspaceId: string
    threadId: string
    limit: number
    offset: number
    tx?: DatabaseClient
  }): Promise<{ rows: InternalMessageModel[]; total: number }> {
    const { workspaceId, threadId, limit, offset, tx = db } = props
    const where = { workspaceId, threadId }
    const [rows, total] = await Promise.all([
      tx.query.internalMessageModel.findMany({
        where,
        orderBy: { createdAt: "desc", id: "desc" },
        limit,
        offset,
      }),
      tx.$count(
        internalMessageModel,
        and(
          eq(internalMessageModel.workspaceId, workspaceId),
          eq(internalMessageModel.threadId, threadId),
        ),
      ),
    ])
    return { rows, total }
  }
}

export const internalThreadRepository = new InternalThreadRepository()
```

`packages/database/src/repositories/internal-thread/index.ts`:

```ts
export * from "./repository"
```

- [ ] **Step 6: Task repository**

`packages/database/src/repositories/task/repository.ts`:

```ts
import {
  and,
  countWithRelationsFilter,
  type DatabaseClient,
  db,
  eq,
  inArray,
} from "../../client"
import {
  contactModel,
  conversationModel,
  inboxTeamModel,
  internalThreadModel,
  taskModel,
  taskTargetModel,
  taskWatcherModel,
  workspaceMemberModel,
  workspaceModel,
} from "../../schema"
import type { TaskModel, TaskTargetModel } from "../../types"
import {
  buildTaskListWhere,
  TASK_LIST_ORDER_BY,
  type TaskListFilter,
} from "./list-where"

export type TaskInsert = typeof taskModel.$inferInsert
export type TaskTargetInsert = typeof taskTargetModel.$inferInsert
export type TaskUpdate = Partial<
  Omit<TaskInsert, "id" | "workspaceId" | "threadId" | "createdAt">
>
export type TaskWithRelations = TaskModel & {
  watchers: { userId: string }[]
  targets: TaskTargetModel[]
}
export type TaskAssignmentRow = {
  id: string
  threadId: string
  assigneeUserId: string | null
  assigneeTeamId: string | null
}

const withRelations = {
  watchers: { columns: { userId: true }, orderBy: { id: "asc" } },
  targets: { orderBy: { id: "asc" } },
} as const

const assignmentColumns = {
  id: taskModel.id,
  threadId: taskModel.threadId,
  assigneeUserId: taskModel.assigneeUserId,
  assigneeTeamId: taskModel.assigneeTeamId,
}

class TaskRepository {
  async findWorkspace(props: {
    workspaceId: string
    tx?: DatabaseClient
  }): Promise<{ ownerId: string; timezone: string } | undefined> {
    const { workspaceId, tx = db } = props
    const [row] = await tx
      .select({
        ownerId: workspaceModel.ownerId,
        timezone: workspaceModel.timezone,
      })
      .from(workspaceModel)
      .where(eq(workspaceModel.id, workspaceId))
      .limit(1)
    return row
  }

  /** The ids among `userIds` that are real members of the workspace. */
  async listMemberUserIds(props: {
    workspaceId: string
    userIds: string[]
    tx?: DatabaseClient
  }): Promise<string[]> {
    const { workspaceId, userIds, tx = db } = props
    if (userIds.length === 0) {
      return []
    }
    const rows = await tx
      .select({ userId: workspaceMemberModel.userId })
      .from(workspaceMemberModel)
      .where(
        and(
          eq(workspaceMemberModel.workspaceId, workspaceId),
          inArray(workspaceMemberModel.userId, userIds),
        ),
      )
    return rows.map((row) => row.userId)
  }

  async listTeamIds(props: {
    workspaceId: string
    teamIds: string[]
    tx?: DatabaseClient
  }): Promise<string[]> {
    const { workspaceId, teamIds, tx = db } = props
    if (teamIds.length === 0) {
      return []
    }
    const rows = await tx
      .select({ id: inboxTeamModel.id })
      .from(inboxTeamModel)
      .where(
        and(
          eq(inboxTeamModel.workspaceId, workspaceId),
          inArray(inboxTeamModel.id, teamIds),
        ),
      )
    return rows.map((row) => row.id)
  }

  async findContact(props: {
    workspaceId: string
    contactId: string
    tx?: DatabaseClient
  }): Promise<{ id: string } | undefined> {
    const { workspaceId, contactId, tx = db } = props
    const [row] = await tx
      .select({ id: contactModel.id })
      .from(contactModel)
      .where(
        and(
          eq(contactModel.workspaceId, workspaceId),
          eq(contactModel.id, contactId),
        ),
      )
      .limit(1)
    return row
  }

  async findConversation(props: {
    workspaceId: string
    conversationId: string
    tx?: DatabaseClient
  }): Promise<{ id: string; contactId: string } | undefined> {
    const { workspaceId, conversationId, tx = db } = props
    const [row] = await tx
      .select({
        id: conversationModel.id,
        contactId: conversationModel.contactId,
      })
      .from(conversationModel)
      .where(
        and(
          eq(conversationModel.workspaceId, workspaceId),
          eq(conversationModel.id, conversationId),
        ),
      )
      .limit(1)
    return row
  }

  /**
   * Which of the given contacts and conversations a member restricted to
   * assigned contacts may see: those whose conversation is assigned to them.
   */
  async listVisibleTargetIds(props: {
    workspaceId: string
    assignedUserId: string
    contactIds: string[]
    conversationIds: string[]
    tx?: DatabaseClient
  }): Promise<{ contactIds: string[]; conversationIds: string[] }> {
    const { workspaceId, assignedUserId, contactIds, conversationIds, tx = db } =
      props
    if (contactIds.length === 0 && conversationIds.length === 0) {
      return { contactIds: [], conversationIds: [] }
    }
    const scope = and(
      eq(conversationModel.workspaceId, workspaceId),
      eq(conversationModel.assignedUserId, assignedUserId),
    )
    const [contacts, conversations] = await Promise.all([
      contactIds.length === 0
        ? []
        : tx
            .select({ id: conversationModel.contactId })
            .from(conversationModel)
            .where(and(scope, inArray(conversationModel.contactId, contactIds))),
      conversationIds.length === 0
        ? []
        : tx
            .select({ id: conversationModel.id })
            .from(conversationModel)
            .where(and(scope, inArray(conversationModel.id, conversationIds))),
    ])
    return {
      contactIds: contacts.map((row) => row.id),
      conversationIds: conversations.map((row) => row.id),
    }
  }

  async insertTask(props: {
    values: TaskInsert
    tx?: DatabaseClient
  }): Promise<TaskModel> {
    const { values, tx = db } = props
    const [task] = await tx.insert(taskModel).values(values).returning()
    return task
  }

  async insertWatchers(props: {
    rows: { taskId: string; userId: string }[]
    tx?: DatabaseClient
  }): Promise<void> {
    const { rows, tx = db } = props
    if (rows.length === 0) {
      return
    }
    await tx.insert(taskWatcherModel).values(rows).onConflictDoNothing()
  }

  async deleteWatcher(props: {
    taskId: string
    userId: string
    tx?: DatabaseClient
  }): Promise<void> {
    const { taskId, userId, tx = db } = props
    await tx
      .delete(taskWatcherModel)
      .where(
        and(
          eq(taskWatcherModel.taskId, taskId),
          eq(taskWatcherModel.userId, userId),
        ),
      )
  }

  async insertTargets(props: {
    rows: TaskTargetInsert[]
    tx?: DatabaseClient
  }): Promise<void> {
    const { rows, tx = db } = props
    if (rows.length === 0) {
      return
    }
    await tx.insert(taskTargetModel).values(rows)
  }

  async findById(props: {
    workspaceId: string
    id: string
    tx?: DatabaseClient
  }): Promise<TaskWithRelations | undefined> {
    const { workspaceId, id, tx = db } = props
    return await tx.query.taskModel.findFirst({
      where: { workspaceId, id },
      with: withRelations,
    })
  }

  async list(props: {
    filter: TaskListFilter
    limit: number
    offset: number
    tx?: DatabaseClient
  }): Promise<{ rows: TaskWithRelations[]; total: number }> {
    const { filter, limit, offset, tx = db } = props
    const where = buildTaskListWhere(filter)
    const [rows, total] = await Promise.all([
      tx.query.taskModel.findMany({
        where,
        orderBy: TASK_LIST_ORDER_BY,
        limit,
        offset,
        with: withRelations,
      }),
      countWithRelationsFilter({
        client: tx,
        table: taskModel,
        tsName: "taskModel",
        where,
      }),
    ])
    return { rows, total }
  }

  async update(props: {
    workspaceId: string
    id: string
    set: TaskUpdate
    tx?: DatabaseClient
  }): Promise<void> {
    const { workspaceId, id, set, tx = db } = props
    await tx
      .update(taskModel)
      .set(set)
      .where(and(eq(taskModel.workspaceId, workspaceId), eq(taskModel.id, id)))
  }

  /** Deleting the thread cascades its messages and members. */
  async deleteWithThread(props: {
    workspaceId: string
    id: string
    threadId: string
    tx?: DatabaseClient
  }): Promise<void> {
    const { workspaceId, id, threadId, tx = db } = props
    await tx
      .delete(taskModel)
      .where(and(eq(taskModel.workspaceId, workspaceId), eq(taskModel.id, id)))
    await tx
      .delete(internalThreadModel)
      .where(
        and(
          eq(internalThreadModel.workspaceId, workspaceId),
          eq(internalThreadModel.id, threadId),
        ),
      )
  }

  async listAssignedToUser(props: {
    workspaceId: string
    userId: string
    tx?: DatabaseClient
  }): Promise<TaskAssignmentRow[]> {
    const { workspaceId, userId, tx = db } = props
    return await tx
      .select(assignmentColumns)
      .from(taskModel)
      .where(
        and(
          eq(taskModel.workspaceId, workspaceId),
          eq(taskModel.assigneeUserId, userId),
        ),
      )
  }

  async listAssignedToTeams(props: {
    workspaceId: string
    teamIds: string[]
    tx?: DatabaseClient
  }): Promise<TaskAssignmentRow[]> {
    const { workspaceId, teamIds, tx = db } = props
    if (teamIds.length === 0) {
      return []
    }
    return await tx
      .select(assignmentColumns)
      .from(taskModel)
      .where(
        and(
          eq(taskModel.workspaceId, workspaceId),
          inArray(taskModel.assigneeTeamId, teamIds),
        ),
      )
  }

  async assignToUser(props: {
    workspaceId: string
    taskIds: string[]
    userId: string
    tx?: DatabaseClient
  }): Promise<void> {
    const { workspaceId, taskIds, userId, tx = db } = props
    if (taskIds.length === 0) {
      return
    }
    await tx
      .update(taskModel)
      .set({ assigneeUserId: userId, assigneeTeamId: null })
      .where(
        and(
          eq(taskModel.workspaceId, workspaceId),
          inArray(taskModel.id, taskIds),
        ),
      )
  }
}

export const taskRepository = new TaskRepository()
```

`packages/database/src/repositories/task/index.ts`:

```ts
export * from "./list-where"
export * from "./repository"
```

Add to `packages/database/src/repositories/index.ts` (alphabetical):

```ts
export * from "./internal-thread"
```

```ts
export * from "./task"
```

- [ ] **Step 7: Re-run test, lint, commit**

Run: `cd packages/database && pnpm exec vitest run __tests__/task-list-where.test.ts __tests__/task-partial.test.ts`
Expected: PASS.

Run: `pnpm exec ultracite fix packages/database/src/repositories/task packages/database/src/repositories/internal-thread packages/database/__tests__/task-list-where.test.ts`

```bash
git add packages/database/src/repositories/task packages/database/src/repositories/internal-thread \
  packages/database/src/repositories/index.ts packages/database/__tests__/task-list-where.test.ts
git commit -m "feat(database): add task and internal thread repositories"
```

---

### Task 3: Pure task helpers (actor, permissions, changes, due window, views)

**Files:**
- Create: `packages/business/src/task/{actor.ts,types.ts,permissions.ts,changes.ts,due-window.ts,view.ts}`, `packages/business/src/internal-thread/{message-rows.ts,view.ts}`
- Test: `packages/business/__tests__/task/{permissions,changes,due-window,view,message-rows}.test.ts`

**Interfaces:**
- Consumes: partials and model types from Task 1, `TaskWithRelations` from Task 2.
- Produces:
  - `type TaskActor = { kind: "user"; userId: string; isOwner: boolean } | { kind: "api"; label: string } | { kind: "flow"; label: string }`, `actorUserId(actor): string | null`, `actorLabel(actor): string | null`
  - `type TaskAssignee = { type: "user"; userId: string } | { type: "team"; teamId: string }`, `type TaskPatch = { title?: string; description?: string | null; status?: TaskStatus; priority?: TaskPriority; dueAt?: Date | null; remindAt?: Date | null; assignee?: TaskAssignee }`
  - `canModifyTask({ actor, task, assigneeTeamMemberIds }): boolean`, `canDeleteTask({ actor, task }): boolean`, `taskForbiddenException(): ChatbotXException`
  - `encodeAssignee(...)`, `buildTaskUpdateSet(task, patch, now): TaskUpdate`, `buildTaskChangeEvents(task, patch, byUserId): TaskSystemEvent[]`, `assertRemindBeforeDue(remindAt, dueAt): void`
  - `type TaskDueWindow = { dueFrom?: Date; dueBefore?: Date; withoutDue?: boolean; openOnly?: boolean }`, `resolveTaskDueWindow({ due, now, timezone }): TaskDueWindow`
  - `type TaskTargetView`, `type TaskView`, `type TaskTargetVisibility`, `toTaskView(task, visibility): TaskView`
  - `systemMessageRow(...)`, `commentRow(...)`, `type InternalMessageView`, `toInternalMessageView(message)`

- [ ] **Step 1: Write the failing tests**

`packages/business/__tests__/task/permissions.test.ts`:

```ts
import { describe, expect, test } from "vitest"
import { canDeleteTask, canModifyTask } from "../../src/task/permissions"

const task = { createdByUserId: "author", assigneeUserId: "assignee" }
const member = (userId: string) =>
  ({ kind: "user", userId, isOwner: false }) as const

describe("canModifyTask", () => {
  test("api and flow actors act with workspace authority", () => {
    for (const actor of [
      { kind: "api", label: "Hermes" },
      { kind: "flow", label: "Welcome" },
    ] as const) {
      expect(canModifyTask({ actor, task, assigneeTeamMemberIds: [] })).toBe(true)
    }
  })

  test("author, assignee, assignee team member and owner may modify", () => {
    expect(canModifyTask({ actor: member("author"), task, assigneeTeamMemberIds: [] })).toBe(true)
    expect(canModifyTask({ actor: member("assignee"), task, assigneeTeamMemberIds: [] })).toBe(true)
    expect(canModifyTask({ actor: member("teammate"), task, assigneeTeamMemberIds: ["teammate"] })).toBe(true)
    expect(
      canModifyTask({
        actor: { kind: "user", userId: "boss", isOwner: true },
        task,
        assigneeTeamMemberIds: [],
      }),
    ).toBe(true)
  })

  test("any other member may not", () => {
    expect(canModifyTask({ actor: member("stranger"), task, assigneeTeamMemberIds: [] })).toBe(false)
  })
})

describe("canDeleteTask", () => {
  test("only author, owner or a non-user actor", () => {
    expect(canDeleteTask({ actor: member("author"), task })).toBe(true)
    expect(canDeleteTask({ actor: member("assignee"), task })).toBe(false)
    expect(canDeleteTask({ actor: { kind: "user", userId: "boss", isOwner: true }, task })).toBe(true)
    expect(canDeleteTask({ actor: { kind: "api", label: "Hermes" }, task })).toBe(true)
  })
})
```

`packages/business/__tests__/task/changes.test.ts`:

```ts
import { describe, expect, test } from "vitest"
import {
  assertRemindBeforeDue,
  buildTaskChangeEvents,
  buildTaskUpdateSet,
} from "../../src/task/changes"

const now = new Date("2026-10-23T10:00:00Z")
const base = {
  status: "todo" as const,
  priority: "normal" as const,
  dueAt: new Date("2026-10-24T12:00:00Z"),
  remindAt: null,
  assigneeUserId: "u-1",
  assigneeTeamId: null,
}

describe("buildTaskUpdateSet", () => {
  test("done stamps completedAt, leaving done clears it", () => {
    expect(buildTaskUpdateSet(base, { status: "done" }, now)).toEqual({
      status: "done",
      completedAt: now,
    })
    expect(
      buildTaskUpdateSet({ ...base, status: "done" }, { status: "todo" }, now),
    ).toEqual({ status: "todo", completedAt: null })
  })

  test("moving the due date or reminder resets its notification flag", () => {
    const dueAt = new Date("2026-10-25T12:00:00Z")
    const remindAt = new Date("2026-10-25T11:00:00Z")
    expect(buildTaskUpdateSet(base, { dueAt, remindAt }, now)).toEqual({
      dueAt,
      overdueNotifiedAt: null,
      remindAt,
      remindedAt: null,
    })
  })

  test("an unchanged value writes nothing", () => {
    expect(
      buildTaskUpdateSet(base, { status: "todo", dueAt: new Date(base.dueAt) }, now),
    ).toEqual({})
  })

  test("a team assignee clears the user assignee", () => {
    expect(
      buildTaskUpdateSet(base, { assignee: { type: "team", teamId: "t-1" } }, now),
    ).toEqual({ assigneeUserId: null, assigneeTeamId: "t-1" })
  })
})

describe("buildTaskChangeEvents", () => {
  test("one system event per tracked field that changed", () => {
    expect(
      buildTaskChangeEvents(
        base,
        {
          status: "in_progress",
          priority: "urgent",
          dueAt: null,
          assignee: { type: "team", teamId: "t-1" },
          title: "ignored",
        },
        "u-9",
      ),
    ).toEqual([
      { type: "status", from: "todo", to: "in_progress", byUserId: "u-9" },
      { type: "due", from: "2026-10-24T12:00:00.000Z", to: null, byUserId: "u-9" },
      { type: "assignee", from: "user:u-1", to: "team:t-1", byUserId: "u-9" },
      { type: "priority", from: "normal", to: "urgent", byUserId: "u-9" },
    ])
  })

  test("no events when nothing tracked changed", () => {
    expect(
      buildTaskChangeEvents(base, { assignee: { type: "user", userId: "u-1" } }, null),
    ).toEqual([])
  })
})

describe("assertRemindBeforeDue", () => {
  test("rejects a reminder after the due date", () => {
    expect(() =>
      assertRemindBeforeDue(new Date("2026-10-25T00:00:00Z"), new Date("2026-10-24T00:00:00Z")),
    ).toThrow("Reminder must not be later than the due date")
    expect(() => assertRemindBeforeDue(new Date(), null)).not.toThrow()
  })
})
```

`packages/business/__tests__/task/due-window.test.ts`:

```ts
import { describe, expect, test } from "vitest"
import { resolveTaskDueWindow } from "../../src/task/due-window"

// 23:30 in Moscow on Oct 23 is 20:30 UTC.
const now = new Date("2026-10-23T20:30:00Z")

describe("resolveTaskDueWindow", () => {
  test("overdue = open tasks due before now", () => {
    expect(resolveTaskDueWindow({ due: "overdue", now, timezone: "Europe/Moscow" })).toEqual({
      dueBefore: now,
      openOnly: true,
    })
  })

  test("today is the workspace's calendar day", () => {
    expect(resolveTaskDueWindow({ due: "today", now, timezone: "Europe/Moscow" })).toEqual({
      dueFrom: new Date("2026-10-22T21:00:00Z"),
      dueBefore: new Date("2026-10-23T21:00:00Z"),
    })
  })

  test("week is seven calendar days starting today", () => {
    expect(resolveTaskDueWindow({ due: "week", now, timezone: "UTC" })).toEqual({
      dueFrom: new Date("2026-10-23T00:00:00Z"),
      dueBefore: new Date("2026-10-30T00:00:00Z"),
    })
  })

  test("none = no due date", () => {
    expect(resolveTaskDueWindow({ due: "none", now, timezone: "UTC" })).toEqual({
      withoutDue: true,
    })
  })
})
```

`packages/business/__tests__/task/view.test.ts`:

```ts
import { describe, expect, test } from "vitest"
import { toTaskView } from "../../src/task/view"

const task = {
  id: "t-1",
  workspaceId: "ws-1",
  title: "Check stock",
  description: null,
  status: "todo" as const,
  priority: "normal" as const,
  dueAt: null,
  remindAt: null,
  assigneeUserId: "u-1",
  assigneeTeamId: null,
  createdByUserId: null,
  createdBySource: "api" as const,
  createdByLabel: "Hermes",
  threadId: "th-1",
  completedAt: null,
  remindedAt: null,
  overdueNotifiedAt: null,
  createdAt: new Date("2026-10-23T00:00:00Z"),
  updatedAt: new Date("2026-10-23T00:00:00Z"),
  watchers: [{ userId: "u-1" }],
  targets: [
    { id: "1", taskId: "t-1", contactId: "c-1", conversationId: null, messageId: null, createdAt: new Date(), updatedAt: new Date() },
    { id: "2", taskId: "t-1", contactId: null, conversationId: "conv-1", messageId: null, createdAt: new Date(), updatedAt: new Date() },
    { id: "3", taskId: "t-1", contactId: null, conversationId: null, messageId: "m-1", createdAt: new Date(), updatedAt: new Date() },
  ],
}

describe("toTaskView", () => {
  test("unrestricted callers see every target id and watcher", () => {
    const view = toTaskView(task, null)
    expect(view.watcherUserIds).toEqual(["u-1"])
    expect(view.targets).toEqual([
      { type: "contact", id: "c-1", hidden: false },
      { type: "conversation", id: "conv-1", hidden: false },
      { type: "message", id: "m-1", hidden: false },
    ])
    expect(view).not.toHaveProperty("remindedAt")
    expect(view).not.toHaveProperty("overdueNotifiedAt")
  })

  test("a member limited to assigned contacts gets hidden targets", () => {
    const view = toTaskView(task, {
      contactIds: new Set(),
      conversationIds: new Set(),
    })
    expect(view.targets).toEqual([
      { type: "contact", id: null, hidden: true },
      { type: "conversation", id: null, hidden: true },
      { type: "message", id: null, hidden: true },
    ])
  })
})
```

`packages/business/__tests__/task/message-rows.test.ts`:

```ts
import { describe, expect, test } from "vitest"
import {
  commentRow,
  systemMessageRow,
} from "../../src/internal-thread/message-rows"
import { toInternalMessageView } from "../../src/internal-thread/view"

describe("internal message rows", () => {
  test("a comment by an API token carries its label and empty mentions", () => {
    expect(
      commentRow({
        workspaceId: "ws-1",
        threadId: "th-1",
        text: "Готово",
        actor: { kind: "api", label: "Hermes" },
      }),
    ).toEqual({
      workspaceId: "ws-1",
      threadId: "th-1",
      kind: "comment",
      authorUserId: null,
      authorLabel: "Hermes",
      text: "Готово",
      mentions: { userIds: [], teamIds: [] },
      attachments: [],
      systemEvent: null,
    })
  })

  test("a system row stores the event and no text", () => {
    const event = { type: "created", from: null, to: null, byUserId: "u-1" } as const
    expect(
      systemMessageRow({
        workspaceId: "ws-1",
        threadId: "th-1",
        event,
        authorLabel: null,
      }),
    ).toMatchObject({ kind: "system", text: null, systemEvent: event, authorUserId: "u-1" })
  })

  test("a deleted message hides its text", () => {
    const view = toInternalMessageView({
      id: "m-1",
      threadId: "th-1",
      workspaceId: "ws-1",
      kind: "comment",
      authorUserId: "u-1",
      authorLabel: null,
      text: "secret",
      mentions: { userIds: [], teamIds: [] },
      attachments: [],
      systemEvent: null,
      editedAt: null,
      deletedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    expect(view.text).toBeNull()
    expect(view.deleted).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/business && pnpm exec vitest run __tests__/task`
Expected: FAIL — modules not found.

- [ ] **Step 3: Actor and types**

`packages/business/src/task/actor.ts`:

```ts
/** Who performs a task or feed action. API tokens and flows act with workspace authority. */
export type TaskActor =
  | { kind: "user"; userId: string; isOwner: boolean }
  | { kind: "api"; label: string }
  | { kind: "flow"; label: string }

export const actorUserId = (actor: TaskActor): string | null =>
  actor.kind === "user" ? actor.userId : null

export const actorLabel = (actor: TaskActor): string | null =>
  actor.kind === "user" ? null : actor.label
```

`packages/business/src/task/types.ts`:

```ts
import type { TaskPriority, TaskStatus } from "@chatbotx.io/database/partials"

export type TaskAssignee =
  | { type: "user"; userId: string }
  | { type: "team"; teamId: string }

export type TaskPatch = {
  title?: string
  description?: string | null
  status?: TaskStatus
  priority?: TaskPriority
  dueAt?: Date | null
  remindAt?: Date | null
  assignee?: TaskAssignee
}
```

- [ ] **Step 4: Permissions**

`packages/business/src/task/permissions.ts`:

```ts
import type { TaskModel } from "@chatbotx.io/database/types"
import { ChatbotXException } from "../errors"
import type { TaskActor } from "./actor"

type TaskOwnership = Pick<TaskModel, "createdByUserId" | "assigneeUserId">

export const canModifyTask = (input: {
  actor: TaskActor
  task: TaskOwnership
  assigneeTeamMemberIds: string[]
}): boolean => {
  const { actor, task, assigneeTeamMemberIds } = input
  if (actor.kind !== "user" || actor.isOwner) {
    return true
  }
  return (
    task.createdByUserId === actor.userId ||
    task.assigneeUserId === actor.userId ||
    assigneeTeamMemberIds.includes(actor.userId)
  )
}

export const canDeleteTask = (input: {
  actor: TaskActor
  task: Pick<TaskModel, "createdByUserId">
}): boolean => {
  const { actor, task } = input
  if (actor.kind !== "user" || actor.isOwner) {
    return true
  }
  return task.createdByUserId === actor.userId
}

export const taskForbiddenException = () =>
  new ChatbotXException(
    "You are not allowed to change this task",
    "FORBIDDEN",
    403,
  )
```

- [ ] **Step 5: Changes**

`packages/business/src/task/changes.ts`:

```ts
import type { TaskSystemEvent } from "@chatbotx.io/database/partials"
import type { TaskUpdate } from "@chatbotx.io/database/repositories"
import type { TaskModel } from "@chatbotx.io/database/types"
import { validationException } from "../errors"
import type { TaskAssignee, TaskPatch } from "./types"

type TaskState = Pick<
  TaskModel,
  | "status"
  | "priority"
  | "dueAt"
  | "remindAt"
  | "assigneeUserId"
  | "assigneeTeamId"
>

const sameInstant = (a: Date | null, b: Date | null): boolean =>
  (a?.getTime() ?? null) === (b?.getTime() ?? null)

const toIso = (value: Date | null): string | null =>
  value ? value.toISOString() : null

export const encodeAssignee = (
  assignee:
    | TaskAssignee
    | Pick<TaskModel, "assigneeUserId" | "assigneeTeamId">,
): string | null => {
  if ("type" in assignee) {
    return assignee.type === "user"
      ? `user:${assignee.userId}`
      : `team:${assignee.teamId}`
  }
  if (assignee.assigneeUserId) {
    return `user:${assignee.assigneeUserId}`
  }
  if (assignee.assigneeTeamId) {
    return `team:${assignee.assigneeTeamId}`
  }
  return null
}

export const assertRemindBeforeDue = (
  remindAt: Date | null,
  dueAt: Date | null,
): void => {
  if (remindAt && dueAt && remindAt.getTime() > dueAt.getTime()) {
    throw validationException(
      "remindAt",
      "Reminder must not be later than the due date",
    )
  }
}

/** Only the columns that actually change, plus the flags they reset. */
export const buildTaskUpdateSet = (
  task: TaskState,
  patch: TaskPatch,
  now: Date,
): TaskUpdate => {
  const set: TaskUpdate = {}
  if (patch.title !== undefined) {
    set.title = patch.title
  }
  if (patch.description !== undefined) {
    set.description = patch.description
  }
  if (patch.priority !== undefined && patch.priority !== task.priority) {
    set.priority = patch.priority
  }
  if (patch.status !== undefined && patch.status !== task.status) {
    set.status = patch.status
    set.completedAt = patch.status === "done" ? now : null
  }
  if (patch.dueAt !== undefined && !sameInstant(patch.dueAt, task.dueAt)) {
    set.dueAt = patch.dueAt
    set.overdueNotifiedAt = null
  }
  if (
    patch.remindAt !== undefined &&
    !sameInstant(patch.remindAt, task.remindAt)
  ) {
    set.remindAt = patch.remindAt
    set.remindedAt = null
  }
  if (patch.assignee && encodeAssignee(patch.assignee) !== encodeAssignee(task)) {
    set.assigneeUserId =
      patch.assignee.type === "user" ? patch.assignee.userId : null
    set.assigneeTeamId =
      patch.assignee.type === "team" ? patch.assignee.teamId : null
  }
  return set
}

export const buildTaskChangeEvents = (
  task: TaskState,
  patch: TaskPatch,
  byUserId: string | null,
): TaskSystemEvent[] => {
  const events: TaskSystemEvent[] = []
  if (patch.status !== undefined && patch.status !== task.status) {
    events.push({ type: "status", from: task.status, to: patch.status, byUserId })
  }
  if (patch.dueAt !== undefined && !sameInstant(patch.dueAt, task.dueAt)) {
    events.push({
      type: "due",
      from: toIso(task.dueAt),
      to: toIso(patch.dueAt),
      byUserId,
    })
  }
  if (patch.assignee) {
    const from = encodeAssignee(task)
    const to = encodeAssignee(patch.assignee)
    if (from !== to) {
      events.push({ type: "assignee", from, to, byUserId })
    }
  }
  if (patch.priority !== undefined && patch.priority !== task.priority) {
    events.push({
      type: "priority",
      from: task.priority,
      to: patch.priority,
      byUserId,
    })
  }
  return events
}
```

- [ ] **Step 6: Due window**

`packages/business/src/task/due-window.ts`:

```ts
import type { TaskDueFilter } from "@chatbotx.io/database/partials"
import { addDays, format, parseISO } from "date-fns"
import { formatInTimeZone, fromZonedTime } from "date-fns-tz"

export type TaskDueWindow = {
  dueFrom?: Date
  dueBefore?: Date
  withoutDue?: boolean
  /** Restrict to `todo` / `in_progress`. */
  openOnly?: boolean
}

const DAY_FORMAT = "yyyy-MM-dd"

const dayStartInZone = (day: string, timezone: string): Date =>
  fromZonedTime(`${day}T00:00:00`, timezone)

const shiftDay = (day: string, days: number): string =>
  format(addDays(parseISO(day), days), DAY_FORMAT)

export const resolveTaskDueWindow = (input: {
  due: TaskDueFilter
  now: Date
  timezone: string
}): TaskDueWindow => {
  const { due, now, timezone } = input
  if (due === "none") {
    return { withoutDue: true }
  }
  if (due === "overdue") {
    return { dueBefore: now, openOnly: true }
  }
  const today = formatInTimeZone(now, timezone, DAY_FORMAT)
  const length = due === "today" ? 1 : 7
  return {
    dueFrom: dayStartInZone(today, timezone),
    dueBefore: dayStartInZone(shiftDay(today, length), timezone),
  }
}
```

- [ ] **Step 7: Task view**

`packages/business/src/task/view.ts`:

```ts
import type { TaskWithRelations } from "@chatbotx.io/database/repositories"
import type { TaskModel, TaskTargetModel } from "@chatbotx.io/database/types"

export type TaskTargetView = {
  type: "contact" | "conversation" | "message"
  id: string | null
  hidden: boolean
}

export type TaskView = Omit<TaskModel, "remindedAt" | "overdueNotifiedAt"> & {
  watcherUserIds: string[]
  targets: TaskTargetView[]
}

/** Ids a member restricted to assigned contacts may see; `null` = unrestricted. */
export type TaskTargetVisibility = {
  contactIds: ReadonlySet<string>
  conversationIds: ReadonlySet<string>
} | null

const targetType = (target: TaskTargetModel): TaskTargetView["type"] => {
  if (target.contactId) {
    return "contact"
  }
  return target.conversationId ? "conversation" : "message"
}

const visibleView = (target: TaskTargetModel): TaskTargetView => ({
  type: targetType(target),
  id: target.contactId ?? target.conversationId ?? target.messageId,
  hidden: false,
})

const toTargetViews = (
  targets: TaskTargetModel[],
  visibility: TaskTargetVisibility,
): TaskTargetView[] => {
  if (!visibility) {
    return targets.map(visibleView)
  }
  // A message is reachable only through its conversation.
  const conversationsVisible = targets.every(
    (target) =>
      !target.conversationId ||
      visibility.conversationIds.has(target.conversationId),
  )
  const isVisible = (target: TaskTargetModel): boolean => {
    if (target.contactId) {
      return visibility.contactIds.has(target.contactId)
    }
    if (target.conversationId) {
      return visibility.conversationIds.has(target.conversationId)
    }
    return conversationsVisible
  }
  return targets.map((target) =>
    isVisible(target)
      ? visibleView(target)
      : { type: targetType(target), id: null, hidden: true },
  )
}

export const toTaskView = (
  task: TaskWithRelations,
  visibility: TaskTargetVisibility,
): TaskView => {
  const {
    watchers,
    targets,
    remindedAt: _remindedAt,
    overdueNotifiedAt: _overdueNotifiedAt,
    ...fields
  } = task
  return {
    ...fields,
    watcherUserIds: watchers.map((watcher) => watcher.userId),
    targets: toTargetViews(targets, visibility),
  }
}
```

- [ ] **Step 8: Message rows and view**

`packages/business/src/internal-thread/message-rows.ts`:

```ts
import {
  EMPTY_INTERNAL_MESSAGE_MENTIONS,
  type TaskSystemEvent,
} from "@chatbotx.io/database/partials"
import type { InternalMessageInsert } from "@chatbotx.io/database/repositories"
import { actorLabel, actorUserId, type TaskActor } from "../task/actor"

export const commentRow = (input: {
  workspaceId: string
  threadId: string
  text: string
  actor: TaskActor
}): InternalMessageInsert => ({
  workspaceId: input.workspaceId,
  threadId: input.threadId,
  kind: "comment",
  authorUserId: actorUserId(input.actor),
  authorLabel: actorLabel(input.actor),
  text: input.text,
  mentions: EMPTY_INTERNAL_MESSAGE_MENTIONS,
  attachments: [],
  systemEvent: null,
})

export const systemMessageRow = (input: {
  workspaceId: string
  threadId: string
  event: TaskSystemEvent
  authorLabel: string | null
}): InternalMessageInsert => ({
  workspaceId: input.workspaceId,
  threadId: input.threadId,
  kind: "system",
  authorUserId: input.event.byUserId,
  authorLabel: input.authorLabel,
  text: null,
  mentions: EMPTY_INTERNAL_MESSAGE_MENTIONS,
  attachments: [],
  systemEvent: input.event,
})
```

`packages/business/src/internal-thread/view.ts`:

```ts
import type { InternalMessageModel } from "@chatbotx.io/database/types"

export type InternalMessageView = Pick<
  InternalMessageModel,
  | "id"
  | "kind"
  | "authorUserId"
  | "authorLabel"
  | "systemEvent"
  | "editedAt"
  | "createdAt"
> & { text: string | null; deleted: boolean }

export const toInternalMessageView = (
  message: InternalMessageModel,
): InternalMessageView => ({
  id: message.id,
  kind: message.kind,
  authorUserId: message.authorUserId,
  authorLabel: message.authorLabel,
  text: message.deletedAt ? null : message.text,
  systemEvent: message.systemEvent,
  editedAt: message.editedAt,
  createdAt: message.createdAt,
  deleted: message.deletedAt !== null,
})
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `cd packages/business && pnpm exec vitest run __tests__/task`
Expected: PASS (all five files).

- [ ] **Step 10: Lint and commit**

Run: `pnpm exec ultracite fix packages/business/src/task packages/business/src/internal-thread packages/business/__tests__/task`

```bash
git add packages/business/src/task/actor.ts packages/business/src/task/types.ts \
  packages/business/src/task/permissions.ts packages/business/src/task/changes.ts \
  packages/business/src/task/due-window.ts packages/business/src/task/view.ts \
  packages/business/src/internal-thread/message-rows.ts packages/business/src/internal-thread/view.ts \
  packages/business/__tests__/task
git commit -m "feat(business): add task permission, change and view helpers"
```

---

### Task 4: `internalThreadService` and `taskService`

**Files:**
- Create: `packages/business/src/internal-thread/{service.ts,index.ts}`, `packages/business/src/task/{service.ts,index.ts}`
- Modify: `packages/business/src/index.ts`
- Test: `packages/business/__tests__/task/task-service.test.ts`

**Interfaces:**
- Consumes: Tasks 2–3.
- Produces:
  - `internalThreadService.listMessages({ workspaceId, threadId, page, perPage }): Promise<{ data: InternalMessageView[]; pageCount: number }>`
  - `internalThreadService.postComment({ workspaceId, threadId, text, actor }): Promise<InternalMessageView>`
  - `type CreateTaskInput`, `type ListTasksInput` (below)
  - `taskService.create(input: CreateTaskInput): Promise<TaskView>`
  - `taskService.get({ workspaceId, id, accessScope? }): Promise<TaskView>`
  - `taskService.list(input: ListTasksInput): Promise<{ data: TaskView[]; pageCount: number }>`
  - `taskService.update({ workspaceId, id, actor, patch }): Promise<TaskView>`
  - `taskService.complete({ workspaceId, id, actor }): Promise<TaskView>`
  - `taskService.delete({ workspaceId, id, actor }): Promise<void>`
  - `taskService.addWatcher({ workspaceId, id, userId, actor }): Promise<TaskView>`
  - `taskService.removeWatcher({ workspaceId, id, userId, actor }): Promise<void>`
  - `taskService.listComments({ workspaceId, id, page, perPage })`, `taskService.addComment({ workspaceId, id, text, actor })`
  - (Task 5 adds `reassignFromMember`, `reassignFromTeams`)

- [ ] **Step 1: Write the failing service test**

`packages/business/__tests__/task/task-service.test.ts`:

```ts
import { beforeEach, describe, expect, test, vi } from "vitest"

const repo = vi.hoisted(() => ({
  task: {
    findWorkspace: vi.fn(),
    listMemberUserIds: vi.fn(),
    listTeamIds: vi.fn(),
    findContact: vi.fn(),
    findConversation: vi.fn(),
    listVisibleTargetIds: vi.fn(),
    insertTask: vi.fn(),
    insertWatchers: vi.fn(),
    deleteWatcher: vi.fn(),
    insertTargets: vi.fn(),
    findById: vi.fn(),
    list: vi.fn(),
    update: vi.fn(),
    deleteWithThread: vi.fn(),
    listAssignedToUser: vi.fn(),
    listAssignedToTeams: vi.fn(),
    assignToUser: vi.fn(),
  },
  thread: {
    insertThread: vi.fn(),
    insertMembers: vi.fn(),
    deleteMember: vi.fn(),
    insertMessages: vi.fn(),
    listMessages: vi.fn(),
  },
  teamMembers: { listUserIdsByTeamId: vi.fn() },
}))

vi.mock("@chatbotx.io/database/client", () => ({
  db: { transaction: async (fn: (tx: unknown) => unknown) => await fn("tx") },
}))
vi.mock("@chatbotx.io/database/repositories", () => ({
  taskRepository: repo.task,
  internalThreadRepository: repo.thread,
  inboxTeamMemberRepository: repo.teamMembers,
}))
vi.mock("@chatbotx.io/redis", () => ({ invalidateCacheByTags: vi.fn() }))
vi.mock("../../src/audit/dispatcher", () => ({ dispatchAuditRecord: vi.fn() }))

const { taskService } = await import("../../src/task/service")

const API = { kind: "api", label: "Hermes" } as const
const storedTask = (overrides: Record<string, unknown> = {}) => ({
  id: "t-1",
  workspaceId: "ws-1",
  title: "Check stock",
  description: null,
  status: "todo",
  priority: "normal",
  dueAt: null,
  remindAt: null,
  assigneeUserId: "u-1",
  assigneeTeamId: null,
  createdByUserId: "u-author",
  createdBySource: "user",
  createdByLabel: null,
  threadId: "th-1",
  completedAt: null,
  remindedAt: null,
  overdueNotifiedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  watchers: [{ userId: "u-1" }],
  targets: [],
  ...overrides,
})

beforeEach(() => {
  vi.clearAllMocks()
  repo.thread.insertThread.mockResolvedValue({ id: "th-1" })
  repo.task.insertTask.mockResolvedValue({ id: "t-1" })
  repo.task.findById.mockResolvedValue(storedTask())
  repo.task.listMemberUserIds.mockImplementation(
    async ({ userIds }: { userIds: string[] }) =>
      userIds.filter((id) => id !== "u-stranger"),
  )
  repo.task.listTeamIds.mockImplementation(
    async ({ teamIds }: { teamIds: string[] }) => teamIds,
  )
  repo.teamMembers.listUserIdsByTeamId.mockResolvedValue([])
})

describe("taskService.create", () => {
  test("creates thread, task, watchers, targets and a created event in one transaction", async () => {
    repo.task.findConversation.mockResolvedValue({ id: "conv-1", contactId: "c-1" })

    await taskService.create({
      workspaceId: "ws-1",
      actor: API,
      title: "Check stock",
      assignee: { type: "user", userId: "u-1" },
      watcherUserIds: ["u-2"],
      targets: { conversationId: "conv-1", messageId: "m-1" },
    })

    expect(repo.task.insertTask).toHaveBeenCalledWith({
      values: expect.objectContaining({
        workspaceId: "ws-1",
        threadId: "th-1",
        assigneeUserId: "u-1",
        assigneeTeamId: null,
        createdByUserId: null,
        createdBySource: "api",
        createdByLabel: "Hermes",
      }),
      tx: "tx",
    })
    expect(repo.task.insertWatchers).toHaveBeenCalledWith({
      rows: [
        { taskId: "t-1", userId: "u-2" },
        { taskId: "t-1", userId: "u-1" },
      ],
      tx: "tx",
    })
    expect(repo.thread.insertMembers).toHaveBeenCalledWith({
      rows: [
        { threadId: "th-1", userId: "u-2" },
        { threadId: "th-1", userId: "u-1" },
      ],
      tx: "tx",
    })
    expect(repo.task.insertTargets).toHaveBeenCalledWith({
      rows: [
        { taskId: "t-1", contactId: "c-1" },
        { taskId: "t-1", conversationId: "conv-1" },
        { taskId: "t-1", messageId: "m-1" },
      ],
      tx: "tx",
    })
    expect(repo.thread.insertMessages).toHaveBeenCalledWith({
      rows: [
        expect.objectContaining({
          kind: "system",
          authorLabel: "Hermes",
          systemEvent: { type: "created", from: null, to: null, byUserId: null },
        }),
      ],
      tx: "tx",
    })
  })

  test("a user author becomes a watcher and is recorded as creator", async () => {
    await taskService.create({
      workspaceId: "ws-1",
      actor: { kind: "user", userId: "u-author", isOwner: false },
      title: "Call back",
      assignee: { type: "team", teamId: "team-1" },
    })

    expect(repo.task.insertTask).toHaveBeenCalledWith({
      values: expect.objectContaining({
        createdByUserId: "u-author",
        createdBySource: "user",
        createdByLabel: null,
        assigneeUserId: null,
        assigneeTeamId: "team-1",
      }),
      tx: "tx",
    })
    expect(repo.task.insertWatchers).toHaveBeenCalledWith({
      rows: [{ taskId: "t-1", userId: "u-author" }],
      tx: "tx",
    })
  })

  test("rejects an assignee who is not a member", async () => {
    await expect(
      taskService.create({
        workspaceId: "ws-1",
        actor: API,
        title: "x",
        assignee: { type: "user", userId: "u-stranger" },
      }),
    ).rejects.toThrow("Assignee is not a member of this workspace")
    expect(repo.task.insertTask).not.toHaveBeenCalled()
  })

  test("rejects a message link without its conversation", async () => {
    await expect(
      taskService.create({
        workspaceId: "ws-1",
        actor: API,
        title: "x",
        assignee: { type: "user", userId: "u-1" },
        targets: { messageId: "m-1" },
      }),
    ).rejects.toThrow("messageId requires conversationId")
  })

  test("rejects a conversation of another contact", async () => {
    repo.task.findConversation.mockResolvedValue({ id: "conv-1", contactId: "c-2" })
    await expect(
      taskService.create({
        workspaceId: "ws-1",
        actor: API,
        title: "x",
        assignee: { type: "user", userId: "u-1" },
        targets: { contactId: "c-1", conversationId: "conv-1" },
      }),
    ).rejects.toThrow("Conversation belongs to another contact")
  })
})

describe("taskService.update", () => {
  test("writes the changed columns and one system message per change", async () => {
    await taskService.update({
      workspaceId: "ws-1",
      id: "t-1",
      actor: { kind: "user", userId: "u-1", isOwner: false },
      patch: { status: "done", priority: "high" },
    })

    expect(repo.task.update).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      id: "t-1",
      set: expect.objectContaining({
        status: "done",
        priority: "high",
        completedAt: expect.any(Date),
      }),
      tx: "tx",
    })
    expect(repo.thread.insertMessages).toHaveBeenCalledWith({
      rows: [
        expect.objectContaining({
          systemEvent: { type: "status", from: "todo", to: "done", byUserId: "u-1" },
        }),
        expect.objectContaining({
          systemEvent: { type: "priority", from: "normal", to: "high", byUserId: "u-1" },
        }),
      ],
      tx: "tx",
    })
  })

  test("forbids a member who is neither author, assignee nor owner", async () => {
    await expect(
      taskService.update({
        workspaceId: "ws-1",
        id: "t-1",
        actor: { kind: "user", userId: "u-stranger", isOwner: false },
        patch: { status: "done" },
      }),
    ).rejects.toThrow("You are not allowed to change this task")
    expect(repo.task.update).not.toHaveBeenCalled()
  })

  test("lets a member of the assignee team change it", async () => {
    repo.task.findById.mockResolvedValue(
      storedTask({ assigneeUserId: null, assigneeTeamId: "team-1" }),
    )
    repo.teamMembers.listUserIdsByTeamId.mockResolvedValue(["u-mate"])
    await taskService.update({
      workspaceId: "ws-1",
      id: "t-1",
      actor: { kind: "user", userId: "u-mate", isOwner: false },
      patch: { status: "in_progress" },
    })
    expect(repo.task.update).toHaveBeenCalled()
  })

  test("a new user assignee becomes a watcher", async () => {
    await taskService.update({
      workspaceId: "ws-1",
      id: "t-1",
      actor: API,
      patch: { assignee: { type: "user", userId: "u-2" } },
    })
    expect(repo.task.insertWatchers).toHaveBeenCalledWith({
      rows: [{ taskId: "t-1", userId: "u-2" }],
      tx: "tx",
    })
  })

  test("404 for a task of another workspace", async () => {
    repo.task.findById.mockResolvedValue(undefined)
    await expect(
      taskService.update({ workspaceId: "ws-2", id: "t-1", actor: API, patch: {} }),
    ).rejects.toThrow("Task not found")
  })
})

describe("taskService.delete", () => {
  test("only the author or owner may delete", async () => {
    await expect(
      taskService.delete({
        workspaceId: "ws-1",
        id: "t-1",
        actor: { kind: "user", userId: "u-1", isOwner: false },
      }),
    ).rejects.toThrow("You are not allowed to change this task")

    await taskService.delete({ workspaceId: "ws-1", id: "t-1", actor: API })
    expect(repo.task.deleteWithThread).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      id: "t-1",
      threadId: "th-1",
      tx: "tx",
    })
  })
})

describe("taskService.list", () => {
  test("overdue narrows to open statuses and uses the due window", async () => {
    repo.task.findWorkspace.mockResolvedValue({ ownerId: "u-owner", timezone: "UTC" })
    repo.task.list.mockResolvedValue({ rows: [storedTask()], total: 3 })
    const now = new Date("2026-10-23T10:00:00Z")

    const result = await taskService.list({
      workspaceId: "ws-1",
      page: 1,
      perPage: 2,
      due: "overdue",
      now,
    })

    expect(repo.task.list).toHaveBeenCalledWith({
      filter: {
        workspaceId: "ws-1",
        statuses: ["todo", "in_progress"],
        dueBefore: now,
      },
      limit: 2,
      offset: 0,
    })
    expect(result.pageCount).toBe(2)
  })

  test("overdue with a closed status returns nothing without querying", async () => {
    repo.task.findWorkspace.mockResolvedValue({ ownerId: "u-owner", timezone: "UTC" })
    const result = await taskService.list({
      workspaceId: "ws-1",
      page: 1,
      perPage: 20,
      status: "done",
      due: "overdue",
    })
    expect(result).toEqual({ data: [], pageCount: 0 })
    expect(repo.task.list).not.toHaveBeenCalled()
  })

  test("a restricted member gets hidden contact targets", async () => {
    repo.task.list.mockResolvedValue({
      rows: [
        storedTask({
          targets: [{ id: "1", taskId: "t-1", contactId: "c-1", conversationId: null, messageId: null }],
        }),
      ],
      total: 1,
    })
    repo.task.listVisibleTargetIds.mockResolvedValue({ contactIds: [], conversationIds: [] })

    const result = await taskService.list({
      workspaceId: "ws-1",
      page: 1,
      perPage: 20,
      accessScope: { restrictToAssignedUserId: "u-1" },
    })

    expect(result.data[0]?.targets).toEqual([{ type: "contact", id: null, hidden: true }])
  })
})

describe("taskService comments", () => {
  test("a comment goes to the task's thread", async () => {
    repo.thread.insertMessages.mockResolvedValue([
      {
        id: "m-1",
        kind: "comment",
        authorUserId: null,
        authorLabel: "Hermes",
        text: "Нет на складе",
        systemEvent: null,
        editedAt: null,
        deletedAt: null,
        createdAt: new Date(),
      },
    ])
    const comment = await taskService.addComment({
      workspaceId: "ws-1",
      id: "t-1",
      text: "Нет на складе",
      actor: API,
    })
    expect(repo.thread.insertMessages).toHaveBeenCalledWith({
      rows: [expect.objectContaining({ threadId: "th-1", kind: "comment", text: "Нет на складе" })],
    })
    expect(comment).toMatchObject({ id: "m-1", authorLabel: "Hermes", deleted: false })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/business && pnpm exec vitest run __tests__/task/task-service.test.ts`
Expected: FAIL — `../../src/task/service` not found.

- [ ] **Step 3: Internal thread service**

`packages/business/src/internal-thread/service.ts`:

```ts
import type { DatabaseClient } from "@chatbotx.io/database/client"
import { internalThreadRepository } from "@chatbotx.io/database/repositories"
import { BaseService } from "../base.service"
import type { TaskActor } from "../task/actor"
import { commentRow } from "./message-rows"
import { type InternalMessageView, toInternalMessageView } from "./view"

class InternalThreadService extends BaseService {
  async listMessages(input: {
    workspaceId: string
    threadId: string
    page: number
    perPage: number
  }): Promise<{ data: InternalMessageView[]; pageCount: number }> {
    const { rows, total } = await internalThreadRepository.listMessages({
      workspaceId: input.workspaceId,
      threadId: input.threadId,
      limit: input.perPage,
      offset: (input.page - 1) * input.perPage,
    })
    return {
      data: rows.map(toInternalMessageView),
      pageCount: Math.ceil(total / input.perPage),
    }
  }

  async postComment(input: {
    workspaceId: string
    threadId: string
    text: string
    actor: TaskActor
    tx?: DatabaseClient
  }): Promise<InternalMessageView> {
    const { tx, ...row } = input
    const [message] = await internalThreadRepository.insertMessages({
      rows: [commentRow(row)],
      tx,
    })
    return toInternalMessageView(message)
  }
}

export const internalThreadService = new InternalThreadService()
```

`packages/business/src/internal-thread/index.ts`:

```ts
export * from "./message-rows"
export * from "./service"
export * from "./view"
```

- [ ] **Step 4: Task service**

`packages/business/src/task/service.ts`:

```ts
import { type DatabaseClient, db } from "@chatbotx.io/database/client"
import {
  OPEN_TASK_STATUSES,
  TASK_LIMITS,
  type TaskDueFilter,
  type TaskPriority,
  type TaskStatus,
  type TaskSystemEvent,
} from "@chatbotx.io/database/partials"
import {
  inboxTeamMemberRepository,
  internalThreadRepository,
  type TaskListFilter,
  type TaskTargetInsert,
  taskRepository,
  type TaskWithRelations,
} from "@chatbotx.io/database/repositories"
import { BaseService } from "../base.service"
import type { ContactAccessScope } from "../contact/service"
import { notFoundException, validationException } from "../errors"
import { internalThreadService } from "../internal-thread/service"
import { systemMessageRow } from "../internal-thread/message-rows"
import type { InternalMessageView } from "../internal-thread/view"
import { actorLabel, actorUserId, type TaskActor } from "./actor"
import {
  assertRemindBeforeDue,
  buildTaskChangeEvents,
  buildTaskUpdateSet,
} from "./changes"
import { resolveTaskDueWindow } from "./due-window"
import {
  canDeleteTask,
  canModifyTask,
  taskForbiddenException,
} from "./permissions"
import type { TaskAssignee, TaskPatch } from "./types"
import { type TaskView, toTaskView } from "./view"

export type TaskTargetsInput = {
  contactId?: string
  conversationId?: string
  messageId?: string
}

export type CreateTaskInput = {
  workspaceId: string
  actor: TaskActor
  title: string
  description?: string | null
  priority?: TaskPriority
  dueAt?: Date | null
  remindAt?: Date | null
  assignee: TaskAssignee
  watcherUserIds?: string[]
  targets?: TaskTargetsInput
}

export type ListTasksInput = {
  workspaceId: string
  page: number
  perPage: number
  status?: TaskStatus | "open"
  priority?: TaskPriority
  due?: TaskDueFilter
  assigneeUserId?: string
  assigneeTeamId?: string
  createdByUserId?: string
  watcherUserId?: string
  contactId?: string
  conversationId?: string
  accessScope?: ContactAccessScope
  now?: Date
}

type Paged<T> = { data: T[]; pageCount: number }

const unique = (ids: string[]): string[] => [...new Set(ids)]

const toStatuses = (
  status: ListTasksInput["status"],
): TaskStatus[] | undefined => {
  if (!status) {
    return
  }
  return status === "open" ? [...OPEN_TASK_STATUSES] : [status]
}

const isOpenStatus = (status: TaskStatus): boolean =>
  (OPEN_TASK_STATUSES as readonly TaskStatus[]).includes(status)

class TaskService extends BaseService {
  async create(input: CreateTaskInput): Promise<TaskView> {
    const { workspaceId, actor, assignee } = input
    const dueAt = input.dueAt ?? null
    const remindAt = input.remindAt ?? null
    assertRemindBeforeDue(remindAt, dueAt)
    await this.assertAssignable(workspaceId, assignee)

    const watcherUserIds = await this.resolveWatchers({
      workspaceId,
      explicit: input.watcherUserIds ?? [],
      implicit: [
        ...(actor.kind === "user" ? [actor.userId] : []),
        ...(assignee.type === "user" ? [assignee.userId] : []),
      ],
    })
    const targets = await this.resolveTargets(workspaceId, input.targets)
    const event: TaskSystemEvent = {
      type: "created",
      from: null,
      to: null,
      byUserId: actorUserId(actor),
    }

    const taskId = await db.transaction(async (tx) => {
      const thread = await internalThreadRepository.insertThread({
        workspaceId,
        tx,
      })
      const task = await taskRepository.insertTask({
        values: {
          workspaceId,
          threadId: thread.id,
          title: input.title,
          description: input.description ?? null,
          priority: input.priority ?? "normal",
          dueAt,
          remindAt,
          assigneeUserId: assignee.type === "user" ? assignee.userId : null,
          assigneeTeamId: assignee.type === "team" ? assignee.teamId : null,
          createdByUserId: actorUserId(actor),
          createdBySource: actor.kind,
          createdByLabel: actorLabel(actor),
        },
        tx,
      })
      await this.addWatcherRows({
        taskId: task.id,
        threadId: thread.id,
        userIds: watcherUserIds,
        tx,
      })
      await taskRepository.insertTargets({
        rows: targets.map((target) => ({ taskId: task.id, ...target })),
        tx,
      })
      await internalThreadRepository.insertMessages({
        rows: [
          systemMessageRow({
            workspaceId,
            threadId: thread.id,
            event,
            authorLabel: actorLabel(actor),
          }),
        ],
        tx,
      })
      return task.id
    })

    await this.audit("create", `created a task (#${taskId})`)
    return await this.get({ workspaceId, id: taskId })
  }

  async get(input: {
    workspaceId: string
    id: string
    accessScope?: ContactAccessScope
  }): Promise<TaskView> {
    const task = await this.findOrFail(input)
    const [view] = await this.toViews(input.workspaceId, [task], input.accessScope)
    return view
  }

  async list(input: ListTasksInput): Promise<Paged<TaskView>> {
    const { workspaceId, page, perPage, accessScope, now = new Date() } = input
    let statuses = toStatuses(input.status)
    const filter: TaskListFilter = {
      workspaceId,
      priority: input.priority,
      assigneeUserId: input.assigneeUserId,
      assigneeTeamId: input.assigneeTeamId,
      createdByUserId: input.createdByUserId,
      watcherUserId: input.watcherUserId,
      contactId: input.contactId,
      conversationId: input.conversationId,
    }

    if (input.due) {
      const workspace = await taskRepository.findWorkspace({ workspaceId })
      const { openOnly, ...window } = resolveTaskDueWindow({
        due: input.due,
        now,
        timezone: workspace?.timezone ?? "UTC",
      })
      Object.assign(filter, window)
      if (openOnly) {
        statuses = (statuses ?? [...OPEN_TASK_STATUSES]).filter(isOpenStatus)
        if (statuses.length === 0) {
          return { data: [], pageCount: 0 }
        }
      }
    }

    const { rows, total } = await taskRepository.list({
      filter: { ...filter, statuses },
      limit: perPage,
      offset: (page - 1) * perPage,
    })
    return {
      data: await this.toViews(workspaceId, rows, accessScope),
      pageCount: Math.ceil(total / perPage),
    }
  }

  async update(input: {
    workspaceId: string
    id: string
    actor: TaskActor
    patch: TaskPatch
  }): Promise<TaskView> {
    const { workspaceId, id, actor, patch } = input
    const task = await this.findOrFail({ workspaceId, id })
    await this.assertCanModify(workspaceId, task, actor)
    if (patch.assignee) {
      await this.assertAssignable(workspaceId, patch.assignee)
    }
    assertRemindBeforeDue(
      patch.remindAt === undefined ? task.remindAt : patch.remindAt,
      patch.dueAt === undefined ? task.dueAt : patch.dueAt,
    )

    const set = buildTaskUpdateSet(task, patch, new Date())
    const events = buildTaskChangeEvents(task, patch, actorUserId(actor))
    if (Object.keys(set).length > 0) {
      await db.transaction(async (tx) => {
        await taskRepository.update({ workspaceId, id, set, tx })
        if (set.assigneeUserId) {
          await this.addWatcherRows({
            taskId: id,
            threadId: task.threadId,
            userIds: [set.assigneeUserId],
            tx,
          })
        }
        await internalThreadRepository.insertMessages({
          rows: events.map((event) =>
            systemMessageRow({
              workspaceId,
              threadId: task.threadId,
              event,
              authorLabel: actorLabel(actor),
            }),
          ),
          tx,
        })
      })
      await this.audit("update", `updated a task (#${id})`)
    }
    return await this.get({ workspaceId, id })
  }

  async complete(input: {
    workspaceId: string
    id: string
    actor: TaskActor
  }): Promise<TaskView> {
    return await this.update({ ...input, patch: { status: "done" } })
  }

  async delete(input: {
    workspaceId: string
    id: string
    actor: TaskActor
  }): Promise<void> {
    const { workspaceId, id, actor } = input
    const task = await this.findOrFail({ workspaceId, id })
    if (!canDeleteTask({ actor, task })) {
      throw taskForbiddenException()
    }
    await db.transaction(async (tx) => {
      await taskRepository.deleteWithThread({
        workspaceId,
        id,
        threadId: task.threadId,
        tx,
      })
    })
    await this.audit("delete", `deleted a task (#${id})`)
  }

  async addWatcher(input: {
    workspaceId: string
    id: string
    userId: string
    actor: TaskActor
  }): Promise<TaskView> {
    const { workspaceId, id, userId, actor } = input
    const task = await this.findOrFail({ workspaceId, id })
    if (actorUserId(actor) !== userId) {
      await this.assertCanModify(workspaceId, task, actor)
    }
    const [member] = await this.resolveWatchers({
      workspaceId,
      explicit: [userId],
      implicit: [],
    })
    await db.transaction(async (tx) => {
      await this.addWatcherRows({
        taskId: id,
        threadId: task.threadId,
        userIds: [member],
        tx,
      })
    })
    return await this.get({ workspaceId, id })
  }

  async removeWatcher(input: {
    workspaceId: string
    id: string
    userId: string
    actor: TaskActor
  }): Promise<void> {
    const { workspaceId, id, userId, actor } = input
    const task = await this.findOrFail({ workspaceId, id })
    if (actorUserId(actor) !== userId) {
      await this.assertCanModify(workspaceId, task, actor)
    }
    await db.transaction(async (tx) => {
      await taskRepository.deleteWatcher({ taskId: id, userId, tx })
      await internalThreadRepository.deleteMember({
        threadId: task.threadId,
        userId,
        tx,
      })
    })
  }

  async listComments(input: {
    workspaceId: string
    id: string
    page: number
    perPage: number
  }): Promise<Paged<InternalMessageView>> {
    const task = await this.findOrFail(input)
    return await internalThreadService.listMessages({
      workspaceId: input.workspaceId,
      threadId: task.threadId,
      page: input.page,
      perPage: input.perPage,
    })
  }

  async addComment(input: {
    workspaceId: string
    id: string
    text: string
    actor: TaskActor
  }): Promise<InternalMessageView> {
    const task = await this.findOrFail(input)
    return await internalThreadService.postComment({
      workspaceId: input.workspaceId,
      threadId: task.threadId,
      text: input.text,
      actor: input.actor,
    })
  }

  private async findOrFail(input: {
    workspaceId: string
    id: string
  }): Promise<TaskWithRelations> {
    const task = await taskRepository.findById({
      workspaceId: input.workspaceId,
      id: input.id,
    })
    if (!task) {
      throw notFoundException("Task not found")
    }
    return task
  }

  private async toViews(
    workspaceId: string,
    tasks: TaskWithRelations[],
    accessScope?: ContactAccessScope,
  ): Promise<TaskView[]> {
    const assignedUserId = accessScope?.restrictToAssignedUserId
    if (!assignedUserId) {
      return tasks.map((task) => toTaskView(task, null))
    }
    const targets = tasks.flatMap((task) => task.targets)
    const visible = await taskRepository.listVisibleTargetIds({
      workspaceId,
      assignedUserId,
      contactIds: unique(targets.flatMap((t) => (t.contactId ? [t.contactId] : []))),
      conversationIds: unique(
        targets.flatMap((t) => (t.conversationId ? [t.conversationId] : [])),
      ),
    })
    const visibility = {
      contactIds: new Set(visible.contactIds),
      conversationIds: new Set(visible.conversationIds),
    }
    return tasks.map((task) => toTaskView(task, visibility))
  }

  private async assertCanModify(
    workspaceId: string,
    task: TaskWithRelations,
    actor: TaskActor,
  ): Promise<void> {
    const assigneeTeamMemberIds =
      actor.kind === "user" && task.assigneeTeamId
        ? await inboxTeamMemberRepository.listUserIdsByTeamId({
            workspaceId,
            inboxTeamId: task.assigneeTeamId,
          })
        : []
    if (!canModifyTask({ actor, task, assigneeTeamMemberIds })) {
      throw taskForbiddenException()
    }
  }

  private async assertAssignable(
    workspaceId: string,
    assignee: TaskAssignee,
  ): Promise<void> {
    if (assignee.type === "user") {
      const [member] = await taskRepository.listMemberUserIds({
        workspaceId,
        userIds: [assignee.userId],
      })
      if (!member) {
        throw validationException(
          "assigneeUserId",
          "Assignee is not a member of this workspace",
        )
      }
      return
    }
    const [team] = await taskRepository.listTeamIds({
      workspaceId,
      teamIds: [assignee.teamId],
    })
    if (!team) {
      throw validationException("assigneeTeamId", "Team not found")
    }
  }

  /**
   * Explicit watchers must be members; implicit ones (the author, the
   * assignee) are dropped silently when they are not — e.g. a support session.
   */
  private async resolveWatchers(input: {
    workspaceId: string
    explicit: string[]
    implicit: string[]
  }): Promise<string[]> {
    const requested = unique([...input.explicit, ...input.implicit])
    if (requested.length > TASK_LIMITS.maxWatchers) {
      throw validationException(
        "watcherUserIds",
        `A task can have at most ${TASK_LIMITS.maxWatchers} watchers`,
      )
    }
    const members = new Set(
      await taskRepository.listMemberUserIds({
        workspaceId: input.workspaceId,
        userIds: requested,
      }),
    )
    const missing = input.explicit.filter((id) => !members.has(id))
    if (missing.length > 0) {
      throw validationException(
        "watcherUserIds",
        `Not members of this workspace: ${missing.join(", ")}`,
      )
    }
    return requested.filter((id) => members.has(id))
  }

  private async resolveTargets(
    workspaceId: string,
    targets?: TaskTargetsInput,
  ): Promise<Omit<TaskTargetInsert, "taskId">[]> {
    if (!targets) {
      return []
    }
    const { contactId, conversationId, messageId } = targets
    if (messageId && !conversationId) {
      throw validationException("messageId", "messageId requires conversationId")
    }
    let linkedContactId = contactId
    if (conversationId) {
      const conversation = await taskRepository.findConversation({
        workspaceId,
        conversationId,
      })
      if (!conversation) {
        throw notFoundException("Conversation not found")
      }
      if (contactId && conversation.contactId !== contactId) {
        throw validationException(
          "conversationId",
          "Conversation belongs to another contact",
        )
      }
      linkedContactId = conversation.contactId
    } else if (contactId) {
      const contact = await taskRepository.findContact({ workspaceId, contactId })
      if (!contact) {
        throw notFoundException("Contact not found")
      }
    }
    return [
      ...(linkedContactId ? [{ contactId: linkedContactId }] : []),
      ...(conversationId ? [{ conversationId }] : []),
      ...(messageId ? [{ messageId }] : []),
    ]
  }

  private async addWatcherRows(input: {
    taskId: string
    threadId: string
    userIds: string[]
    tx: DatabaseClient
  }): Promise<void> {
    const { taskId, threadId, userIds, tx } = input
    await taskRepository.insertWatchers({
      rows: userIds.map((userId) => ({ taskId, userId })),
      tx,
    })
    await internalThreadRepository.insertMembers({
      rows: userIds.map((userId) => ({ threadId, userId })),
      tx,
    })
  }
}

export const taskService = new TaskService()
```

(`toHaveBeenCalledWith` ignores keys whose value is `undefined`, so the tests' `{ rows }` / `filter` expectations match calls that also carry `tx: undefined` or unset filters.)

`packages/business/src/task/index.ts`:

```ts
export * from "./actor"
export * from "./service"
export * from "./types"
export * from "./view"
```

Add to `packages/business/src/index.ts` (alphabetical):

```ts
export * from "./internal-thread"
```

```ts
export * from "./task"
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/business && pnpm exec vitest run __tests__/task`
Expected: PASS.

- [ ] **Step 6: Circular-import check, lint, commit**

Run: `pnpm check:circular`
Expected: no new cycle mentioning `task/` or `internal-thread/`. (`../contact/service` is imported for its type only.)

Run: `pnpm exec ultracite fix packages/business/src/task packages/business/src/internal-thread packages/business/src/index.ts packages/business/__tests__/task`

```bash
git add packages/business/src/task/service.ts packages/business/src/task/index.ts \
  packages/business/src/internal-thread/service.ts packages/business/src/internal-thread/index.ts \
  packages/business/src/index.ts packages/business/__tests__/task/task-service.test.ts
git commit -m "feat(business): add task and internal thread services"
```

---

### Task 5: Hand tasks to the owner when an assignee leaves

**Files:**
- Modify: `packages/business/src/task/service.ts`, `packages/business/src/workspace-member/service.ts`, `packages/business/src/enterprise/inbox-team/service.ts`
- Test: `packages/business/__tests__/task/task-reassign.test.ts`

**Interfaces:**
- Consumes: `taskRepository.findWorkspace/listAssignedToUser/listAssignedToTeams/assignToUser`, `systemMessageRow`, `encodeAssignee`.
- Produces: `taskService.reassignFromMember({ workspaceId, userId, tx? }): Promise<void>`, `taskService.reassignFromTeams({ workspaceId, teamIds, tx? }): Promise<void>`.

- [ ] **Step 1: Write the failing test**

`packages/business/__tests__/task/task-reassign.test.ts`:

```ts
import { beforeEach, describe, expect, test, vi } from "vitest"

const repo = vi.hoisted(() => ({
  task: {
    findWorkspace: vi.fn(),
    listAssignedToUser: vi.fn(),
    listAssignedToTeams: vi.fn(),
    assignToUser: vi.fn(),
    insertWatchers: vi.fn(),
  },
  thread: { insertMembers: vi.fn(), insertMessages: vi.fn() },
}))

vi.mock("@chatbotx.io/database/client", () => ({ db: {} }))
vi.mock("@chatbotx.io/database/repositories", () => ({
  taskRepository: repo.task,
  internalThreadRepository: repo.thread,
  inboxTeamMemberRepository: {},
}))
vi.mock("@chatbotx.io/redis", () => ({ invalidateCacheByTags: vi.fn() }))
vi.mock("../../src/audit/dispatcher", () => ({ dispatchAuditRecord: vi.fn() }))

const { taskService } = await import("../../src/task/service")

beforeEach(() => {
  vi.clearAllMocks()
  repo.task.findWorkspace.mockResolvedValue({ ownerId: "u-owner", timezone: "UTC" })
})

describe("taskService.reassignFromMember", () => {
  test("moves the member's tasks to the owner with a system message", async () => {
    repo.task.listAssignedToUser.mockResolvedValue([
      { id: "t-1", threadId: "th-1", assigneeUserId: "u-1", assigneeTeamId: null },
    ])

    await taskService.reassignFromMember({ workspaceId: "ws-1", userId: "u-1", tx: "tx" as never })

    expect(repo.task.assignToUser).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      taskIds: ["t-1"],
      userId: "u-owner",
      tx: "tx",
    })
    expect(repo.task.insertWatchers).toHaveBeenCalledWith({
      rows: [{ taskId: "t-1", userId: "u-owner" }],
      tx: "tx",
    })
    expect(repo.thread.insertMessages).toHaveBeenCalledWith({
      rows: [
        expect.objectContaining({
          threadId: "th-1",
          systemEvent: { type: "assignee", from: "user:u-1", to: "user:u-owner", byUserId: null },
        }),
      ],
      tx: "tx",
    })
  })

  test("does nothing for the owner or a member without tasks", async () => {
    await taskService.reassignFromMember({ workspaceId: "ws-1", userId: "u-owner" })
    expect(repo.task.listAssignedToUser).not.toHaveBeenCalled()

    repo.task.listAssignedToUser.mockResolvedValue([])
    await taskService.reassignFromMember({ workspaceId: "ws-1", userId: "u-2" })
    expect(repo.task.assignToUser).not.toHaveBeenCalled()
  })
})

describe("taskService.reassignFromTeams", () => {
  test("moves team tasks to the owner, naming the old team", async () => {
    repo.task.listAssignedToTeams.mockResolvedValue([
      { id: "t-2", threadId: "th-2", assigneeUserId: null, assigneeTeamId: "team-1" },
    ])
    await taskService.reassignFromTeams({ workspaceId: "ws-1", teamIds: ["team-1"] })
    expect(repo.thread.insertMessages).toHaveBeenCalledWith({
      rows: [
        expect.objectContaining({
          systemEvent: { type: "assignee", from: "team:team-1", to: "user:u-owner", byUserId: null },
        }),
      ],
      tx: {},
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/business && pnpm exec vitest run __tests__/task/task-reassign.test.ts`
Expected: FAIL — `taskService.reassignFromMember is not a function`.

- [ ] **Step 3: Implement in `TaskService`**

Add imports to `packages/business/src/task/service.ts`: `type TaskAssignmentRow` from `@chatbotx.io/database/repositories`, `encodeAssignee` from `./changes`. Add these public methods to `TaskService` (before `private async findOrFail`):

```ts
  /** A removed member's tasks go to the workspace owner (spec section 8). */
  async reassignFromMember(input: {
    workspaceId: string
    userId: string
    tx?: DatabaseClient
  }): Promise<void> {
    const { workspaceId, userId, tx = db } = input
    const workspace = await taskRepository.findWorkspace({ workspaceId, tx })
    if (!workspace || workspace.ownerId === userId) {
      return
    }
    const tasks = await taskRepository.listAssignedToUser({
      workspaceId,
      userId,
      tx,
    })
    await this.assignToOwner({ workspaceId, ownerId: workspace.ownerId, tasks, tx })
  }

  /** Call before deleting teams: their tasks go to the workspace owner. */
  async reassignFromTeams(input: {
    workspaceId: string
    teamIds: string[]
    tx?: DatabaseClient
  }): Promise<void> {
    const { workspaceId, teamIds, tx = db } = input
    const workspace = await taskRepository.findWorkspace({ workspaceId, tx })
    if (!workspace) {
      return
    }
    const tasks = await taskRepository.listAssignedToTeams({
      workspaceId,
      teamIds,
      tx,
    })
    await this.assignToOwner({ workspaceId, ownerId: workspace.ownerId, tasks, tx })
  }

  private async assignToOwner(input: {
    workspaceId: string
    ownerId: string
    tasks: TaskAssignmentRow[]
    tx: DatabaseClient
  }): Promise<void> {
    const { workspaceId, ownerId, tasks, tx } = input
    if (tasks.length === 0) {
      return
    }
    await taskRepository.assignToUser({
      workspaceId,
      taskIds: tasks.map((task) => task.id),
      userId: ownerId,
      tx,
    })
    await taskRepository.insertWatchers({
      rows: tasks.map((task) => ({ taskId: task.id, userId: ownerId })),
      tx,
    })
    await internalThreadRepository.insertMembers({
      rows: tasks.map((task) => ({ threadId: task.threadId, userId: ownerId })),
      tx,
    })
    await internalThreadRepository.insertMessages({
      rows: tasks.map((task) =>
        systemMessageRow({
          workspaceId,
          threadId: task.threadId,
          event: {
            type: "assignee",
            from: encodeAssignee(task),
            to: `user:${ownerId}`,
            byUserId: null,
          },
          authorLabel: null,
        }),
      ),
      tx,
    })
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/business && pnpm exec vitest run __tests__/task`
Expected: PASS.

- [ ] **Step 5: Hook into member removal**

In `packages/business/src/workspace-member/service.ts` add `import { taskService } from "../task/service"` and, in `delete`, right after the `await tx.delete(workspaceMemberModel)…` statement:

```ts
    if (member) {
      await taskService.reassignFromMember({
        workspaceId,
        userId: member.userId,
        tx,
      })
    }
```

- [ ] **Step 6: Hook into team deletion**

In `packages/business/src/enterprise/inbox-team/service.ts` add `import { taskService } from "../../task/service"` and replace the bare delete in `delete` with a transaction that reassigns first:

```ts
    await db.transaction(async (tx) => {
      await taskService.reassignFromTeams({
        workspaceId,
        teamIds: teams.map((team) => team.id),
        tx,
      })
      await tx
        .delete(inboxTeamModel)
        .where(
          and(
            eq(inboxTeamModel.workspaceId, workspaceId),
            inArray(inboxTeamModel.id, ids),
          ),
        )
    })
```

- [ ] **Step 7: Run the affected existing tests**

Run: `cd packages/business && rg -l "workspaceMemberService|inboxTeamService" __tests__ src --glob '*.test.ts'`
Then run each listed file: `pnpm exec vitest run <files>`.
Expected: PASS. If a test mocks `db` without `transaction` or does not mock `../task/service`, add `vi.mock("../src/task/service", () => ({ taskService: { reassignFromMember: vi.fn(), reassignFromTeams: vi.fn() } }))` (path relative to the test) and/or `transaction: async (fn) => await fn(db)` to its `db` mock — do not change production behavior to fit a mock.

Run: `pnpm check:circular`
Expected: no new cycle (`task/service` must not import `workspace-member` or `enterprise/inbox-team`).

- [ ] **Step 8: Lint and commit**

Run: `pnpm exec ultracite fix packages/business/src/task/service.ts packages/business/src/workspace-member/service.ts packages/business/src/enterprise/inbox-team/service.ts packages/business/__tests__/task/task-reassign.test.ts`

```bash
git add packages/business/src/task/service.ts packages/business/src/workspace-member/service.ts \
  packages/business/src/enterprise/inbox-team/service.ts packages/business/__tests__/task/task-reassign.test.ts
# plus any test files adjusted in step 7, by path
git commit -m "feat(business): hand tasks to the owner when an assignee leaves"
```

---

### Task 6: `tasks` token scope and token name in the request context

**Files:**
- Modify: `packages/database/src/partials/workspace-api-token.ts`, `apps/builder/src/features/workspaces/lib/workspace-token-scopes.ts`, `apps/builder/__tests__/workspace-token-scope-registry.test.ts`, `apps/builder/messages/*.json` (22), `apps/builder/src/middlewares/context.ts`, `apps/builder/src/middlewares/workspace-token-auth.ts`
- Test: `apps/builder/__tests__/workspace-token-scope-registry.test.ts`

**Interfaces:**
- Produces: scope `"tasks"`; `RequestApiToken` gains `name: string`.

- [ ] **Step 1: Update the failing registry test**

In `apps/builder/__tests__/workspace-token-scope-registry.test.ts`: append `"tasks"` to `NEW_SCOPES`, change both `toHaveLength(15)` to `toHaveLength(16)`, and the title `"has 15 entries…"` to `"has 16 entries…"`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/builder && pnpm exec vitest run __tests__/workspace-token-scope-registry.test.ts`
Expected: FAIL — `tasks` missing, length 15.

- [ ] **Step 3: Add the scope**

`packages/database/src/partials/workspace-api-token.ts` — append to `workspaceApiTokenScopes` after `"leaderboards"`:

```ts
  "tasks",
```

`apps/builder/src/features/workspaces/lib/workspace-token-scopes.ts` — append to the registry:

```ts
  tasks: { labelKey: "fields.tokenScopes.tasks", order: 15 },
```

In every `apps/builder/messages/*.json`, inside `fields.tokenScopes`, after `"leaderboards": …` add `"tasks": "Tasks"` — and in `ru.json` `"tasks": "Задачи"`. Do it with a small node script (no `sed`), then delete the script:

```bash
node -e '
const fs = require("node:fs");
const dir = "apps/builder/messages";
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
  const path = `${dir}/${file}`;
  const json = JSON.parse(fs.readFileSync(path, "utf8"));
  json.fields.tokenScopes.tasks = file === "ru.json" ? "Задачи" : "Tasks";
  fs.writeFileSync(path, `${JSON.stringify(json, null, 2)}\n`);
}'
```

Then `git diff --stat apps/builder/messages` must show exactly 22 files × 1 insertion. If any file shows more changed lines (formatting drift), revert it and add the key by hand.

- [ ] **Step 4: Token name in the context**

`apps/builder/src/middlewares/context.ts`:

```ts
export type RequestApiToken = Pick<
  WorkspaceApiTokenModel,
  "id" | "workspaceId" | "name" | "permission" | "scopes" | "isDefault"
>
```

Update the comment above it: handlers need `.name` (an author label for tasks and comments) besides `.permission`/`.scopes`.

`apps/builder/src/middlewares/workspace-token-auth.ts` — in `requestApiToken`:

```ts
    const requestApiToken: RequestApiToken = {
      id: apiToken.id,
      workspaceId: apiToken.workspaceId,
      name: apiToken.name,
      permission: apiToken.permission,
      scopes: apiToken.scopes,
      isDefault: apiToken.isDefault,
    }
```

Run: `rg -n "RequestApiToken = \{|: RequestApiToken = " apps/builder/src apps/builder/__tests__` and add `name` to every other literal of this type (test fixtures included).

- [ ] **Step 5: Run tests**

Run: `cd apps/builder && pnpm exec vitest run __tests__/workspace-token-scope-registry.test.ts __tests__/i18n-messages.test.ts`
Expected: PASS.

Run: `rg -ln "apiToken" apps/builder/__tests__ | rg -i "token|auth"` and run those files with `pnpm exec vitest run`.
Expected: PASS.

- [ ] **Step 6: Lint and commit**

Run: `pnpm exec ultracite fix packages/database/src/partials/workspace-api-token.ts apps/builder/src/features/workspaces/lib/workspace-token-scopes.ts apps/builder/src/middlewares apps/builder/__tests__/workspace-token-scope-registry.test.ts`

```bash
git add packages/database/src/partials/workspace-api-token.ts \
  apps/builder/src/features/workspaces/lib/workspace-token-scopes.ts \
  apps/builder/__tests__/workspace-token-scope-registry.test.ts \
  apps/builder/src/middlewares/context.ts apps/builder/src/middlewares/workspace-token-auth.ts \
  apps/builder/messages/*.json
git commit -m "feat(api): add tasks token scope and expose token name to handlers"
```

---

### Task 7: Public API `tasks.*`

**Files:**
- Create: `apps/builder/src/features/tasks/schema/public.ts`, `apps/builder/src/features/tasks/lib/assignee.ts`, `apps/builder/src/features/tasks/lib/actor.ts`, `apps/builder/src/features/tasks/api/public.ts`
- Modify: `apps/builder/src/routers/public.ts`, `apps/builder/__tests__/__snapshots__/public-spec-operations.test.ts.snap`
- Test: `apps/builder/__tests__/tasks-public-api.test.ts`

**Interfaces:**
- Consumes: `taskService` (Task 4), `TaskAssignee` (Task 3), `RequestApiToken.name` (Task 6).
- Produces: operations `tasks.list`, `tasks.get`, `tasks.create`, `tasks.update`, `tasks.complete`, `tasks.delete`, `tasks.addWatcher`, `tasks.removeWatcher`, `tasks.comments.list`, `tasks.comments.create`.

- [ ] **Step 1: Write the failing test**

`apps/builder/__tests__/tasks-public-api.test.ts`:

```ts
import { beforeEach, describe, expect, test, vi } from "vitest"

type RouteConfig = {
  method: string
  path: string
  successStatus?: number
  spec?: unknown
}
type CapturedProcedure = {
  route: RouteConfig
  handler?: (...args: never[]) => unknown
}

const { workspaceTokenAuthAPIForScope, capturedProcedures } = vi.hoisted(() => {
  const capturedProcedures: CapturedProcedure[] = []
  const makeProcedure = (route: RouteConfig) => {
    const record: CapturedProcedure = { route }
    capturedProcedures.push(record)
    const chain = {
      input: vi.fn(() => chain),
      output: vi.fn(() => chain),
      errors: vi.fn(() => chain),
      handler: vi.fn((fn: CapturedProcedure["handler"]) => {
        record.handler = fn
        return { handler: fn }
      }),
    }
    return chain
  }
  const api = { route: vi.fn((config: RouteConfig) => makeProcedure(config)) }
  return {
    workspaceTokenAuthAPIForScope: vi.fn((_scope: string) => api),
    capturedProcedures,
  }
})

vi.mock("@/orpc", () => ({ workspaceTokenAuthAPIForScope }))

const taskService = {
  list: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  complete: vi.fn(),
  delete: vi.fn(),
  addWatcher: vi.fn(),
  removeWatcher: vi.fn(),
  listComments: vi.fn(),
  addComment: vi.fn(),
}
vi.mock("@chatbotx.io/business", () => ({ taskService }))

await import("@/features/tasks/api/public")

const scopeAtImport = workspaceTokenAuthAPIForScope.mock.calls[0]?.[0]

const procedureFor = (method: string, path: string) => {
  const found = capturedProcedures.find(
    (procedure) =>
      procedure.route.method === method && procedure.route.path === path,
  )
  if (!found?.handler) {
    throw new Error(`No procedure registered for ${method} ${path}`)
  }
  return found
}

const call = (method: string, path: string, input: object) =>
  (
    procedureFor(method, path).handler as unknown as (args: {
      context: { workspace: { id: string }; apiToken: { name: string } }
      input: object
    }) => Promise<unknown>
  )({
    context: { workspace: { id: "ws-1" }, apiToken: { name: "Hermes" } },
    input,
  })

beforeEach(() => {
  vi.clearAllMocks()
})

test("every procedure sits under the tasks scope", () => {
  expect(scopeAtImport).toBe("tasks")
})

describe("registered operations", () => {
  test.each([
    ["GET", "/v1/tasks"],
    ["POST", "/v1/tasks"],
    ["GET", "/v1/tasks/{id}"],
    ["PATCH", "/v1/tasks/{id}"],
    ["POST", "/v1/tasks/{id}/complete"],
    ["DELETE", "/v1/tasks/{id}"],
    ["POST", "/v1/tasks/{id}/watchers"],
    ["DELETE", "/v1/tasks/{id}/watchers/{userId}"],
    ["GET", "/v1/tasks/{id}/comments"],
    ["POST", "/v1/tasks/{id}/comments"],
  ])("%s %s", (method, path) => {
    expect(procedureFor(method, path)).toBeDefined()
  })

  test("creates answer 201, deletes 204, list and create are default MCP tools", () => {
    expect(procedureFor("POST", "/v1/tasks").route.successStatus).toBe(201)
    expect(procedureFor("POST", "/v1/tasks/{id}/comments").route.successStatus).toBe(201)
    expect(procedureFor("DELETE", "/v1/tasks/{id}").route.successStatus).toBe(204)
    expect(
      procedureFor("DELETE", "/v1/tasks/{id}/watchers/{userId}").route.successStatus,
    ).toBe(204)
    expect(procedureFor("GET", "/v1/tasks").route.spec).toBeTypeOf("function")
    expect(procedureFor("POST", "/v1/tasks").route.spec).toBeTypeOf("function")
  })
})

describe("handlers", () => {
  test("create acts as the token and maps assignee and links", async () => {
    taskService.create.mockResolvedValue({ id: "t-1" })
    await call("POST", "/v1/tasks", {
      title: "Проверить наличие",
      assigneeTeamId: "team-1",
      conversationId: "conv-1",
      messageId: "m-1",
    })
    expect(taskService.create).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      actor: { kind: "api", label: "Hermes" },
      title: "Проверить наличие",
      description: undefined,
      priority: undefined,
      dueAt: undefined,
      remindAt: undefined,
      assignee: { type: "team", teamId: "team-1" },
      watcherUserIds: undefined,
      targets: { contactId: undefined, conversationId: "conv-1", messageId: "m-1" },
    })
  })

  test("create without an assignee is a validation error", async () => {
    await expect(call("POST", "/v1/tasks", { title: "x" })).rejects.toThrow(
      "Set assigneeUserId or assigneeTeamId",
    )
    await expect(
      call("POST", "/v1/tasks", { title: "x", assigneeUserId: "u-1", assigneeTeamId: "t-1" }),
    ).rejects.toThrow("Set only one of assigneeUserId or assigneeTeamId")
  })

  test("list is scoped to the token's workspace and never member-scoped", async () => {
    taskService.list.mockResolvedValue({ data: [], pageCount: 0 })
    await call("GET", "/v1/tasks", { page: 1, perPage: 50, status: "open" })
    expect(taskService.list).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      page: 1,
      perPage: 50,
      status: "open",
    })
  })

  test("update passes only the given fields", async () => {
    taskService.update.mockResolvedValue({ id: "t-1" })
    await call("PATCH", "/v1/tasks/{id}", { id: "t-1", status: "in_progress", dueAt: null })
    expect(taskService.update).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      id: "t-1",
      actor: { kind: "api", label: "Hermes" },
      patch: { status: "in_progress", dueAt: null },
    })
  })

  test("comments are written as the token", async () => {
    taskService.addComment.mockResolvedValue({ id: "m-1" })
    await call("POST", "/v1/tasks/{id}/comments", { id: "t-1", text: "Нет на складе" })
    expect(taskService.addComment).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      id: "t-1",
      text: "Нет на складе",
      actor: { kind: "api", label: "Hermes" },
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/builder && pnpm exec vitest run __tests__/tasks-public-api.test.ts`
Expected: FAIL — `@/features/tasks/api/public` not found.

- [ ] **Step 3: Schemas**

`apps/builder/src/features/tasks/schema/public.ts`:

```ts
import {
  internalMessageKinds,
  TASK_LIMITS,
  taskCreatedBySources,
  taskDueFilters,
  taskPriorities,
  taskStatuses,
  taskStatusValues,
  taskSystemEventTypes,
} from "@chatbotx.io/database/partials"
import { zodBigintAsString } from "@chatbotx.io/utils"
import z from "zod"
import { publicListResponse, withPublicPaging } from "@/lib/public-api/list"

const taskId = zodBigintAsString().describe(
  "Task id. Get it from `tasks.list` or `tasks.create`.",
)
const userId = (what: string) =>
  zodBigintAsString().describe(
    `${what} Get user ids from \`workspaceMembers.list\` (\`userId\`).`,
  )
const teamId = zodBigintAsString().describe(
  "Team id. Get it from `inboxTeams.list`.",
)

export const taskIdPathParam = z.object({ id: taskId })

const taskTargetResource = z.object({
  type: z.enum(["contact", "conversation", "message"]),
  id: z
    .string()
    .nullable()
    .describe("Linked contact, conversation or message id; null when hidden."),
  hidden: z
    .boolean()
    .describe("True when the caller may not see this contact or conversation."),
})

export const taskPublicResource = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  status: taskStatuses,
  priority: taskPriorities,
  dueAt: z.date().nullable(),
  remindAt: z.date().nullable(),
  assigneeUserId: z.string().nullable(),
  assigneeTeamId: z.string().nullable(),
  createdByUserId: z.string().nullable(),
  createdBySource: taskCreatedBySources,
  createdByLabel: z
    .string()
    .nullable()
    .describe("API token or flow name when no person created the task."),
  watcherUserIds: z.array(z.string()),
  targets: z.array(taskTargetResource),
  completedAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
})

const assigneeFields = {
  assigneeUserId: userId(
    "Responsible member. Set exactly one of `assigneeUserId` / `assigneeTeamId`.",
  ).optional(),
  assigneeTeamId: teamId
    .describe(
      "Responsible team. Get it from `inboxTeams.list`. Set exactly one of `assigneeUserId` / `assigneeTeamId`.",
    )
    .optional(),
}

const editableFields = {
  title: z.string().trim().min(1).max(TASK_LIMITS.maxTitleLength),
  description: z.string().max(TASK_LIMITS.maxDescriptionLength).nullish(),
  priority: taskPriorities.optional().describe("Defaults to `normal`."),
  dueAt: z.coerce
    .date()
    .nullish()
    .describe("Due date-time, ISO 8601. Null clears it."),
  remindAt: z.coerce
    .date()
    .nullish()
    .describe("Reminder date-time, ISO 8601, not later than `dueAt`."),
}

export const createTaskPublicRequest = z.object({
  ...editableFields,
  ...assigneeFields,
  watcherUserIds: z
    .array(userId("Watcher."))
    .max(TASK_LIMITS.maxWatchers)
    .optional()
    .describe(
      "Extra watchers. The assignee is added automatically. Get user ids from `workspaceMembers.list`.",
    ),
  contactId: zodBigintAsString()
    .optional()
    .describe("Link a contact. Get it from `contacts.list`."),
  conversationId: zodBigintAsString()
    .optional()
    .describe(
      "Link a conversation (its contact is linked too). Get it from `conversations.list`.",
    ),
  messageId: zodBigintAsString()
    .optional()
    .describe(
      "Link a client message; requires `conversationId`. Get it from `messages.list`.",
    ),
})

export const updateTaskPublicRequest = taskIdPathParam.extend({
  title: editableFields.title.optional(),
  description: editableFields.description,
  status: taskStatuses.optional(),
  priority: taskPriorities.optional(),
  dueAt: editableFields.dueAt,
  remindAt: editableFields.remindAt,
  ...assigneeFields,
})

export const listTasksPublicRequest = withPublicPaging(
  z.object({
    status: z
      .enum([...taskStatusValues, "open"])
      .optional()
      .describe("One status, or `open` for `todo` + `in_progress`."),
    priority: taskPriorities.optional(),
    due: taskDueFilters
      .optional()
      .describe(
        "`overdue` (open and past due), `today`, `week` (7 days from today, workspace time zone) or `none` (no due date).",
      ),
    assigneeUserId: userId("Only tasks assigned to this member.").optional(),
    assigneeTeamId: teamId.optional(),
    createdByUserId: userId("Only tasks this member created.").optional(),
    watcherUserId: userId("Only tasks this member watches.").optional(),
    contactId: zodBigintAsString()
      .optional()
      .describe("Only tasks linked to this contact. Get it from `contacts.list`."),
    conversationId: zodBigintAsString()
      .optional()
      .describe(
        "Only tasks linked to this conversation. Get it from `conversations.list`.",
      ),
  }),
)

export const listTasksPublicResponse = publicListResponse(taskPublicResource)

export const taskWatcherPublicRequest = taskIdPathParam.extend({
  userId: userId("Member to add or remove."),
})

const taskSystemEventResource = z.object({
  type: taskSystemEventTypes,
  from: z.string().nullable(),
  to: z
    .string()
    .nullable()
    .describe("Status/priority value, ISO date, or `user:<id>` / `team:<id>`."),
  byUserId: z.string().nullable(),
})

export const taskCommentPublicResource = z.object({
  id: z.string(),
  kind: internalMessageKinds.describe(
    "`comment` from a person or token, `system` for a change event.",
  ),
  authorUserId: z.string().nullable(),
  authorLabel: z.string().nullable(),
  text: z.string().nullable(),
  systemEvent: taskSystemEventResource.nullable(),
  deleted: z.boolean(),
  editedAt: z.date().nullable(),
  createdAt: z.date(),
})

export const listTaskCommentsPublicRequest = withPublicPaging(taskIdPathParam)

export const listTaskCommentsPublicResponse = publicListResponse(
  taskCommentPublicResource,
)

export const createTaskCommentPublicRequest = taskIdPathParam.extend({
  text: z.string().trim().min(1).max(TASK_LIMITS.maxCommentLength),
})
```

- [ ] **Step 4: Helpers**

`apps/builder/src/features/tasks/lib/assignee.ts`:

```ts
import type { TaskAssignee } from "@chatbotx.io/business"
import { validationException } from "@chatbotx.io/business/errors"

export const parseTaskAssignee = (input: {
  assigneeUserId?: string
  assigneeTeamId?: string
}): TaskAssignee | undefined => {
  if (input.assigneeUserId && input.assigneeTeamId) {
    throw validationException(
      "assigneeTeamId",
      "Set only one of assigneeUserId or assigneeTeamId",
    )
  }
  if (input.assigneeUserId) {
    return { type: "user", userId: input.assigneeUserId }
  }
  if (input.assigneeTeamId) {
    return { type: "team", teamId: input.assigneeTeamId }
  }
  return
}

export const requireTaskAssignee = (input: {
  assigneeUserId?: string
  assigneeTeamId?: string
}): TaskAssignee => {
  const assignee = parseTaskAssignee(input)
  if (!assignee) {
    throw validationException(
      "assigneeUserId",
      "Set assigneeUserId or assigneeTeamId",
    )
  }
  return assignee
}
```

`apps/builder/src/features/tasks/lib/actor.ts`:

```ts
import type { TaskActor } from "@chatbotx.io/business"
import type { RequestApiToken } from "@/middlewares/context"

export const apiTokenActor = (
  apiToken: Pick<RequestApiToken, "name"> | undefined,
): TaskActor => ({ kind: "api", label: apiToken?.name ?? "API" })
```

Note: the test mocks `@chatbotx.io/business` with only `taskService`; `TaskAssignee`/`TaskActor` are type-only imports, so the mock is enough. `@chatbotx.io/business/errors` is not mocked and loads the real `validationException`.

- [ ] **Step 5: Router**

`apps/builder/src/features/tasks/api/public.ts`:

```ts
import { taskService } from "@chatbotx.io/business"
import { mcpSpec } from "@/lib/orpc/mcp-annotations"
import {
  possibleErrorsOnDeletingResource,
  possibleErrorsOnFindingResource,
  possibleErrorsOnListingResource,
  possibleErrorsOnMutatingResource,
} from "@/lib/orpc/orpc-error-helper"
import { workspaceTokenAuthAPIForScope } from "@/orpc"
import { apiTokenActor } from "../lib/actor"
import { parseTaskAssignee, requireTaskAssignee } from "../lib/assignee"
import {
  createTaskCommentPublicRequest,
  createTaskPublicRequest,
  listTaskCommentsPublicRequest,
  listTaskCommentsPublicResponse,
  listTasksPublicRequest,
  listTasksPublicResponse,
  taskCommentPublicResource,
  taskIdPathParam,
  taskPublicResource,
  taskWatcherPublicRequest,
  updateTaskPublicRequest,
} from "../schema/public"

const workspaceTokenAuthAPI = workspaceTokenAuthAPIForScope("tasks")
const defaultTool = mcpSpec({ visibility: "default" })
const tags = ["Tasks"]

const taskCommentsPublicRouter = {
  list: workspaceTokenAuthAPI
    .route({
      method: "GET",
      path: "/v1/tasks/{id}/comments",
      summary: "List task comments",
      description:
        "Returns the task's feed, newest first: comments and `system` change events (created, status, due date, assignee, priority). Returns `{ data, pageCount }`; page with `page`/`perPage`.",
      tags,
    })
    .input(listTaskCommentsPublicRequest)
    .output(listTaskCommentsPublicResponse)
    .errors(possibleErrorsOnFindingResource)
    .handler(async ({ context, input }) =>
      await taskService.listComments({
        workspaceId: context.workspace.id,
        id: input.id,
        page: input.page,
        perPage: input.perPage,
      }),
    ),

  create: workspaceTokenAuthAPI
    .route({
      method: "POST",
      path: "/v1/tasks/{id}/comments",
      summary: "Comment on task",
      description:
        "Adds a comment to the task's feed on behalf of the API token (its name is shown as the author). Get the task id from `tasks.list`.",
      successStatus: 201,
      tags,
    })
    .input(createTaskCommentPublicRequest)
    .output(taskCommentPublicResource)
    .errors(possibleErrorsOnMutatingResource)
    .handler(async ({ context, input }) =>
      await taskService.addComment({
        workspaceId: context.workspace.id,
        id: input.id,
        text: input.text,
        actor: apiTokenActor(context.apiToken),
      }),
    ),
}

export const tasksPublicRouter = {
  list: workspaceTokenAuthAPI
    .route({
      method: "GET",
      path: "/v1/tasks",
      summary: "List tasks",
      description:
        "Finds staff tasks by status, priority, due date, assignee, creator, watcher, contact or conversation. Sorted by due date (tasks without one last), then priority (urgent first), then newest. Returns `{ data, pageCount }`; page with `page`/`perPage`.",
      spec: defaultTool,
      tags,
    })
    .input(listTasksPublicRequest)
    .output(listTasksPublicResponse)
    .errors(possibleErrorsOnListingResource)
    .handler(async ({ context, input }) =>
      await taskService.list({ ...input, workspaceId: context.workspace.id }),
    ),

  get: workspaceTokenAuthAPI
    .route({
      method: "GET",
      path: "/v1/tasks/{id}",
      summary: "Get task",
      description:
        "Returns one task with its watchers and linked contact, conversation and message. Get the id from `tasks.list`.",
      tags,
    })
    .input(taskIdPathParam)
    .output(taskPublicResource)
    .errors(possibleErrorsOnFindingResource)
    .handler(async ({ context, input }) =>
      await taskService.get({ workspaceId: context.workspace.id, id: input.id }),
    ),

  create: workspaceTokenAuthAPI
    .route({
      method: "POST",
      path: "/v1/tasks",
      summary: "Create task",
      description:
        "Assigns a task to a workspace member (`assigneeUserId`, from `workspaceMembers.list`) or a team (`assigneeTeamId`, from `inboxTeams.list`), e.g. \"check the part is in stock and answer the client by 15:00\". Optionally links a contact (`contacts.list`), a conversation (`conversations.list`) and a client message (`messages.list`). The API token's name is recorded as the creator.",
      successStatus: 201,
      spec: defaultTool,
      tags,
    })
    .input(createTaskPublicRequest)
    .output(taskPublicResource)
    .errors(possibleErrorsOnMutatingResource)
    .handler(async ({ context, input }) =>
      await taskService.create({
        workspaceId: context.workspace.id,
        actor: apiTokenActor(context.apiToken),
        title: input.title,
        description: input.description,
        priority: input.priority,
        dueAt: input.dueAt,
        remindAt: input.remindAt,
        assignee: requireTaskAssignee(input),
        watcherUserIds: input.watcherUserIds,
        targets: {
          contactId: input.contactId,
          conversationId: input.conversationId,
          messageId: input.messageId,
        },
      }),
    ),

  update: workspaceTokenAuthAPI
    .route({
      method: "PATCH",
      path: "/v1/tasks/{id}",
      summary: "Update task",
      description:
        "Changes only the given fields. Each change of status, due date, assignee or priority is written to the task feed (`tasks.comments.list`). Moving the due date or reminder re-arms its notification. Get the id from `tasks.list`.",
      tags,
    })
    .input(updateTaskPublicRequest)
    .output(taskPublicResource)
    .errors(possibleErrorsOnMutatingResource)
    .handler(async ({ context, input }) => {
      const { id, assigneeUserId, assigneeTeamId, ...fields } = input
      return await taskService.update({
        workspaceId: context.workspace.id,
        id,
        actor: apiTokenActor(context.apiToken),
        patch: {
          ...fields,
          assignee: parseTaskAssignee({ assigneeUserId, assigneeTeamId }),
        },
      })
    }),

  complete: workspaceTokenAuthAPI
    .route({
      method: "POST",
      path: "/v1/tasks/{id}/complete",
      summary: "Complete task",
      description:
        "Marks the task `done`. Same as `tasks.update` with `status: \"done\"`. Get the id from `tasks.list`.",
      tags,
    })
    .input(taskIdPathParam)
    .output(taskPublicResource)
    .errors(possibleErrorsOnMutatingResource)
    .handler(async ({ context, input }) =>
      await taskService.complete({
        workspaceId: context.workspace.id,
        id: input.id,
        actor: apiTokenActor(context.apiToken),
      }),
    ),

  delete: workspaceTokenAuthAPI
    .route({
      method: "DELETE",
      path: "/v1/tasks/{id}",
      summary: "Delete task",
      description:
        "Permanently deletes the task with its feed, watchers and links. Prefer `tasks.update` with `status: \"canceled\"` to keep history.",
      successStatus: 204,
      tags,
    })
    .input(taskIdPathParam)
    .errors(possibleErrorsOnDeletingResource)
    .handler(async ({ context, input }) => {
      await taskService.delete({
        workspaceId: context.workspace.id,
        id: input.id,
        actor: apiTokenActor(context.apiToken),
      })
    }),

  addWatcher: workspaceTokenAuthAPI
    .route({
      method: "POST",
      path: "/v1/tasks/{id}/watchers",
      summary: "Add task watcher",
      description:
        "Adds a workspace member (`userId` from `workspaceMembers.list`) to the task's watchers.",
      tags,
    })
    .input(taskWatcherPublicRequest)
    .output(taskPublicResource)
    .errors(possibleErrorsOnMutatingResource)
    .handler(async ({ context, input }) =>
      await taskService.addWatcher({
        workspaceId: context.workspace.id,
        id: input.id,
        userId: input.userId,
        actor: apiTokenActor(context.apiToken),
      }),
    ),

  removeWatcher: workspaceTokenAuthAPI
    .route({
      method: "DELETE",
      path: "/v1/tasks/{id}/watchers/{userId}",
      summary: "Remove task watcher",
      description:
        "Removes a member from the task's watchers. Get watcher ids from `tasks.get` (`watcherUserIds`).",
      successStatus: 204,
      tags,
    })
    .input(taskWatcherPublicRequest)
    .errors(possibleErrorsOnDeletingResource)
    .handler(async ({ context, input }) => {
      await taskService.removeWatcher({
        workspaceId: context.workspace.id,
        id: input.id,
        userId: input.userId,
        actor: apiTokenActor(context.apiToken),
      })
    }),

  comments: taskCommentsPublicRouter,
}
```

Note: in `patch`, `undefined` means "leave as is" and `null` clears (e.g. `dueAt: null`); the service only writes fields that are not `undefined`.

- [ ] **Step 6: Register**

`apps/builder/src/routers/public.ts` — add the import (alphabetical, after `tagsPublicRouter`):

```ts
import { tasksPublicRouter } from "@/features/tasks/api/public"
```

and the key (after `tags: tagsPublicRouter,`):

```ts
  tasks: tasksPublicRouter,
```

- [ ] **Step 7: Run tests and update the spec snapshot**

Run: `cd apps/builder && pnpm exec vitest run __tests__/tasks-public-api.test.ts`
Expected: PASS.

Run: `cd apps/builder && pnpm exec vitest run __tests__/public-spec-operations.test.ts -u`
Then: `git diff apps/builder/__tests__/__snapshots__/public-spec-operations.test.ts.snap`
Expected: only 10 added entries, `tasks.addWatcher` … `tasks.update` plus `tasks.comments.create`/`tasks.comments.list`. Nothing else changed.

Run: `cd apps/builder && pnpm exec vitest run __tests__/public-spec-operations.test.ts __tests__/public-spec-options.test.ts`
Expected: PASS (204/201, PATCH-all-optional and declared-errors guards). `public-spec-mcp.test.ts` fails until Task 8 updates the MCP README — expected at this point.

If local memory is too tight for the spec tests (the VPS shares memory with prod), push and rely on the `gkamion-checks.yml` run instead; never run the full builder suite or `check-types` locally.

- [ ] **Step 8: Lint and commit**

Run: `pnpm exec ultracite fix apps/builder/src/features/tasks apps/builder/src/routers/public.ts apps/builder/__tests__/tasks-public-api.test.ts`

```bash
git add apps/builder/src/features/tasks apps/builder/src/routers/public.ts \
  apps/builder/__tests__/tasks-public-api.test.ts \
  apps/builder/__tests__/__snapshots__/public-spec-operations.test.ts.snap
git commit -m "feat(tasks): add public tasks API"
```

---

### Task 8: CLI/MCP docs, project docs, CI

**Files:**
- Create: `docs/tasks.md`
- Modify: `apps/mcp-server/README.md`, `apps/cli/README.md`, `docs/developer/workspace-api-tokens.md`, `AGENTS.md`, `.github/workflows/gkamion-checks.yml`
- Test: `apps/builder/__tests__/public-spec-mcp.test.ts`, `apps/cli/__tests__/openapi-loader-command-names.test.ts`

- [ ] **Step 1: MCP README**

In `apps/mcp-server/README.md`: change "The current default set has 46 tools" to 48, and add a section between "Sequences" and "## Prerequisites" (keep categories alphabetical):

```markdown
### Tasks

| Tool | Description |
|---|---|
| `tasks_list` | List tasks |
| `tasks_create` | Create task |
```

Run: `cd apps/builder && pnpm exec vitest run __tests__/public-spec-mcp.test.ts`
Expected: PASS. If it reports another count, use the number it reports (the default set may have grown on this branch).

- [ ] **Step 2: CLI command names**

Print the derived names:

```bash
cd apps/cli && node --experimental-strip-types -e '
import("./src/openapi-loader.ts").then(({ pathAndMethodToCommandName: name }) => {
  for (const [m, p] of [
    ["GET", "/v1/tasks"], ["POST", "/v1/tasks"], ["GET", "/v1/tasks/{id}"],
    ["PATCH", "/v1/tasks/{id}"], ["POST", "/v1/tasks/{id}/complete"],
    ["DELETE", "/v1/tasks/{id}"], ["POST", "/v1/tasks/{id}/watchers"],
    ["DELETE", "/v1/tasks/{id}/watchers/{userId}"],
    ["GET", "/v1/tasks/{id}/comments"], ["POST", "/v1/tasks/{id}/comments"],
  ]) console.log(m, p, "→", name(p, m))
})'
```

Expected: ten distinct names. If two coincide, add an entry to `COMMAND_NAME_OVERRIDES` in `apps/cli/src/openapi-loader.ts` for the second one and pin it in `apps/cli/__tests__/openapi-loader-command-names.test.ts`.

Run: `pnpm --filter chatbotx test`
Expected: PASS.

Add a "Tasks" block to `apps/cli/README.md` in the command reference (next to the other resource groups), using exactly the printed names, e.g.:

```markdown
# Tasks (scope: tasks)
chatbotx tasks list                                  # [--status open --due overdue --assigneeUserId ...]
chatbotx tasks create --title "..." --assigneeUserId <userId>   # or --assigneeTeamId; [--conversationId --messageId]
chatbotx tasks get <id>
chatbotx tasks update <id> --status in_progress
chatbotx tasks complete <id>
chatbotx tasks delete <id>
chatbotx tasks watchers add <id> --userId <userId>
chatbotx tasks watchers delete <id> <userId>
chatbotx tasks comments list <id>
chatbotx tasks comments create <id> --text "..."
```

(Replace each line's command with the name the script printed; keep the comments.)

- [ ] **Step 3: Token docs**

In `docs/developer/workspace-api-tokens.md`, add a subsection before "## Adding a new scope value":

```markdown
### Tasks scope

`tasks` covers `/v1/tasks/*` (`apps/builder/src/features/tasks/api/public.ts`): list, get, create, update, complete, delete, watchers and the task feed (`tasks.comments.*`). A token acts with workspace authority: it may change or delete any task. Its `name` is recorded as `createdByLabel` on tasks and `authorLabel` on comments. Linking a contact or conversation needs only `tasks`, not `contacts`/`inbox`. Scope wiring is pinned in `apps/builder/__tests__/tasks-public-api.test.ts`.
```

- [ ] **Step 4: Feature doc**

`docs/tasks.md`:

```markdown
# Staff tasks

Workspace members, API tokens (for example the Hermes agent) and, later, flows assign tasks to members or teams. Design: `docs/superpowers/specs/2026-10-17-team-tasks-design.md`.

## Data

- `Task` — title, description, status (`todo`, `in_progress`, `done`, `canceled`), priority (`low` … `urgent`), due date, reminder, one assignee (member **or** team), creator (`createdBySource` = `user` | `flow` | `api`, `createdByLabel` for tokens and flows).
- `TaskWatcher` — members who follow the task. The author and a member assignee are added automatically.
- `TaskTarget` — links to a contact, a conversation, a client message (one per row). `messageId` has no foreign key (`Message` is sharded); it is accepted only with its `conversationId`.
- `InternalThread` / `InternalThreadMember` / `InternalMessage` — the task feed: comments and `system` events for every change of status, due date, assignee and priority. The same tables will carry staff chats later.

## Rules

- Everyone in the workspace sees every task. A member restricted to assigned contacts sees links to other contacts as `{ hidden: true }`.
- Author, assignee (or any member of the assignee team) and the owner may change a task; only author and owner may delete it. API tokens and flows act with workspace authority.
- Removing a member from the workspace, or deleting a team, hands their tasks to the workspace owner with a `system` feed entry.
- Due filters `today` / `week` use the workspace time zone.

## API

Public operations under the `tasks` token scope: `tasks.list`, `tasks.get`, `tasks.create`, `tasks.update`, `tasks.complete`, `tasks.delete`, `tasks.addWatcher`, `tasks.removeWatcher`, `tasks.comments.list`, `tasks.comments.create`. `tasks.list` and `tasks.create` are in the default MCP tool set.

## Not yet

UI (stage 2), mentions/attachments/realtime (stage 3), notifications and reminders (stage 4), web push (stage 5), staff MAX bot (stage 6), the `createTask` flow step (stage 7).
```

In `AGENTS.md`, "Docs and support links" list, add after the External AI agent line:

```markdown
- Staff tasks (assign tasks to members/teams, task feed, owner hand-over, public `tasks.*` API): `docs/tasks.md`
```

(Outside the generated invariants block — no `sync:agent-instructions` needed.)

- [ ] **Step 5: CI**

In `.github/workflows/gkamion-checks.yml`, append to the `apps/builder` first vitest step:

```yaml
          __tests__/tasks-public-api.test.ts
          __tests__/workspace-token-scope-registry.test.ts
```

append to the `packages/database` step:

```yaml
          __tests__/task-partial.test.ts
          __tests__/task-list-where.test.ts
```

and append to the `packages/business` step:

```yaml
          __tests__/task
```

- [ ] **Step 6: Final checks and commit**

Run: `pnpm lint`
Expected: exit 0 (includes `db:check-drift` and agent-instruction checks).

Dispatch the `invariant-guard` subagent on the branch diff; fix every reported violation.

```bash
git add apps/mcp-server/README.md apps/cli/README.md docs/developer/workspace-api-tokens.md \
  docs/tasks.md AGENTS.md .github/workflows/gkamion-checks.yml
# plus apps/cli/src/openapi-loader.ts and its test if step 2 needed an override
git commit -m "docs(tasks): document tasks API for CLI, MCP and tokens"
```

Push and watch CI:

```bash
git push gkamion HEAD
gh run watch -R blackshaytan/chatbotx-gkamion $(gh run list -R blackshaytan/chatbotx-gkamion --workflow gkamion-checks.yml --limit 1 --json databaseId -q '.[0].databaseId')
```

Expected: both jobs green (tests and `check-types`).

- [ ] **Step 7: Hand-off to the user (no deploy without «да»)**

Show the user, in Russian and simply: what was built, the migration SQL (6 tables, 5 enum types), and that applying it plus deploying builder+worker needs their «да». After «да»: `pnpm --filter @chatbotx.io/database db:migrate` → `gh workflow run gkamion-images.yml -R blackshaytan/chatbotx-gkamion --ref feature/ru-channels-max-zzap-drom -f services=builder,worker` → `gh run watch` → `bash deploy/gkamion/up.sh builder worker`. Check the token Hermes uses: if its scopes are restricted (not null), the user must add `tasks` to it in Settings → API tokens.

---

## Self-review

- **Spec coverage (stage 1):** tables 3.1/3.2 → Task 1; `taskService` create/update/complete/delete/list, rights, visibility (4.1) → Tasks 3–4; feed comments (4.2, minimal) → Tasks 3–4; owner hand-over (8) → Task 5; public API table (6) incl. watchers and comments → Task 7; CLI/MCP docs → Task 8; trial-expired read/delete only (8) — enforced by the existing token middleware (`assertWorkspaceOwnerAccessForMethod`), no task code needed. `take` — stage 2 (UI-only action for a signed-in member). Tests from section 9 that belong to stage 1: creation/watchers/system message, status transitions and `completedAt`, rights, `onlyAssignedContacts` visibility, owner hand-over, public API create/read, workspace isolation (404), `api` label.
- **Placeholders:** none; the CLI README lines are taken from the script output in Task 8 step 2, by design.
- **Type consistency:** `TaskActor`, `TaskAssignee`, `TaskPatch`, `TaskView`, `TaskWithRelations`, `TaskUpdate`, `TaskAssignmentRow`, `InternalMessageInsert`, `InternalMessageView` are defined once and used with the same names in later tasks.
