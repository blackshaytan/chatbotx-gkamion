# Staff Chat — Stage 1 (схема и сервисы) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** фундамент личных чатов сотрудников без единого пользовательского входа: миграция, типы, репозитории и `chatService` (open / list / get / listMessages / send / edit / delete / markRead / непрочитанные), общие вложения, склейка уведомлений `chatMessage`, правка `deleteMembersForUser`. Ни приватного, ни публичного API, ни интерфейса, ни realtime на этом этапе — они на этапах 2–4. Всё проверяется юнит-тестами и `db:check-drift`.

**Architecture:** `InternalThread` (`direct` | `agent`, `directKey`, `lastMessageAt`) + `InternalThreadMember` + `InternalMessage (kind = comment)` → `chatRepository` (сырой SQL: get-or-create, курсорные страницы, указатели чтения, агрегаты) → `chatService` (`packages/business/src/chat/`: проверки, права, транзакции, вложения, вызов `internalThreadService` и `notificationService`). Склейка уведомлений: частичный уникальный индекс + `INSERT … ON CONFLICT DO UPDATE` в `notificationRepository.upsertChatMessages`, прочтение — `markChatReadUpToPointer`.

**Tech Stack:** Drizzle 1.0.0-beta.22, PostgreSQL 18, vitest. Новых зависимостей нет.

**Spec:** `docs/superpowers/specs/2026-10-27-staff-chat-design.md` (3, 4.1–4.4, 4.7, 8, 9; этап 1 из раздела 10). Факты по коду: `.superpowers/sdd/chat-explore.md`. Образец оформления: `docs/superpowers/plans/2026-10-23-team-tasks-stage-4.md`.

---

## Global Constraints

- Ограничения этапов задач (`.superpowers/sdd/tasks-constraints.md`) действуют целиком. **Общий VPS с продом:** запрещены `tsc`, `pnpm lint`, полные прогоны тестов и сборки. Разрешены только:
  - `export PATH=/GKamion/chatbotX/.tools/node-24/bin:$PATH`
  - `npx ultracite fix <файлы>` (только изменённые файлы);
  - один тестовый файл за раз: `pnpm exec vitest run <файл> --pool=forks --maxWorkers=1` из каталога пакета;
  - в задаче 1 дополнительно `pnpm --filter @chatbotx.io/database make:migration staff_chat` и `pnpm --filter @chatbotx.io/database db:check-drift` (оба лёгкие, без БД).
- **Строгий TS проверяет только CI.** Типы сужать/расширять аккуратно: любой `Record<…, …>`/`switch` по расширяемым типам искать `rg` (ловушки — в плане этапа 3 задач). Расширенные в этапе типы `Notification` (`type`, `entityType`, `payload`) **не должны ломать сборку builder** — см. Deviation 6.
- **Миграция одна** (`staff_chat`). **НИКОГДА не выполнять `db:migrate`**, `db:setup` и `test:db`: миграцию применяет контроллер после явного «да» пользователя (AGENTS.md, «Migration safety»). Задача 1 заканчивается **остановкой**: сгенерировать, прочитать SQL, `db:check-drift` чистый, отчитаться, ждать.
- Цепочка `handler → service → repository → DB`. Репозитории — только сырой доступ (where-builders, join'ы, пагинация); кэша, событий, проверок прав и валидации в них нет. В `apps/` и `integrations/` на этом этапе правок нет (одна возможная строка в builder — Deviation 6 — не требуется).
- **Круги импорта:** `packages/business/src/chat/**`, `internal-thread/**`, `task/**`, `notification/**` **не** импортируют `platform/settings`, `platform/realtime-broadcast`, `workspace/service`, `workspace-member/service`. Направление зависимостей: `chat → internal-thread, notification, task/actor`; **обратных** импортов (`notification → chat`, `internal-thread → chat`) нет. Это закрепляется тестом (Задача 4).
- Логи только структурные: `logger.error({ err }, "…")` (ключ `err`, не `error`); `console` нельзя. Динамических `import()` в `packages/*` нет.
- Нет `.default()`-зависимости: все новые колонки допускают `NULL`, вставки пишут значения явно (AGENTS.md: `.default()` ≠ default БД).
- Стейджить **только перечисленные файлы** (`git add <пути>`), никогда `-A`/`.`. Не трогать и не стейджить чужие правки: `apps/builder/messages/ru.json`, `docs/i18n/ru-glossary.md`, `apps/builder/AGENTS.md`.
- i18n на этом этапе не затрагивается (нет пользовательских строк). Тексты исключений — английские (как у `taskForbiddenException`).
- Сообщения коммитов — как указано в задачах (conventional commits, без `Co-Authored-By`).

## Deviations from the spec (decided while planning)

1. **`lastReadAt` при создании чата — `NULL`, а не «момент создания» (3.2).** Так уже работает `countUnreadByThreads` (`coalesce(lastReadAt, '-infinity')`, `internal-thread/repository.ts:213`) и так создаются участники лент задач. Эффект для пользователя тот же (все сообщения чата — после создания, значит непрочитанные); «момент создания» дал бы расхождение, если `createdAt` сообщения (= `now()` начала транзакции) окажется чуть раньше `createdAt` строки участника.
2. **Указатели чтения и `lastMessageAt` считаются в SQL, а не в JS.** Колонки — `timestamp(6)` (микросекунды), `Date` в JS — миллисекунды: сохранённый из JS указатель стал бы «раньше» самого сообщения на доли миллисекунды и оставил бы его непрочитанным навсегда. Поэтому `advanceReadPointer` и `touchLastMessageAt` берут `createdAt` сообщения подзапросом и применяют `GREATEST` (SQL проверен на рендер: см. «Verified SQL» ниже).
3. **Превью последнего сообщения — `DISTINCT ON (threadId)`, а не `LATERAL`** (4.3). Тот же индекс `(threadId, createdAt desc)`, но запрос выражается Drizzle-билдером без сырого SQL.
4. **Ключ `agent`-чата с первого этапа содержит префикс `token:`** — `agent:<userId>:token:<подпись>` (4.1 описывает его так же). Ключ ассистента `agent:<userId>:staff` появится на этапе 6 вместе с его правилом в `chatService.open`; сейчас его нет, чтобы не оставлять неиспользуемого кода.
5. **Прочтение уведомления привязано к `lastMessageId`, а не к `lastMessageAt` (4.4).** `UPDATE … WHERE readAt IS NULL AND EXISTS (сообщение payload.lastMessageId с createdAt ≤ lastReadAt участника)`. Причины: `payload.lastMessageAt` — строка с миллисекундами (ISO), а указатель — микросекунды; сравнение через сообщение в БД точное. Условие перечитывается при гонке с `ON CONFLICT DO UPDATE` (READ COMMITTED), поэтому свежее сообщение оставляет запись непрочитанной.
6. **Колокольчик остаётся «только задачи» до этапа 4.** Пока не готовы отрисовка и URL чата, `notificationService.listForUser / countUnread / markRead / markAllRead` фильтруют `entityType = 'task'` (константа `BELL_ENTITY_TYPES`) и `listForUser` возвращает `TaskNotificationRow[]`. Иначе после этапа 2 (публичный API создаёт уведомления) в колокольчике появились бы строки без `taskTitle`. Этап 4 расширяет константу. Чтобы builder **не менялся**, имя `NotificationPayload` остаётся за payload задачи, а объединение называется `StoredNotificationPayload`.
7. **Имена и аватары собеседников — в слое API (этап 2/3).** `ChatView.members` содержит `userId` и `removed` (нет в `WorkspaceMember`); `name` подставляет обработчик, как и лента задач (`useWorkspaceMembers`). Это не нарушает 4.3: «клиент берёт из справочника».
8. **Метод `chatService.findAttachment` и `uploadAttachment` — этап 2** (нужны вид токена `chatAttachment` и маршрут `/media/chat-attachment`). Этап 1 даёт только обобщённые `uploadChatAttachment` / `resolveChatAttachments` (используются в `send`).
9. **Уведомление встраивается в `send` сразу (4.2, 4.4).** Так сервис законченный; на этапах 2–3 появятся только обёртки API. Ошибка уведомления не ломает отправку (`try/catch` + `logger.error({ err })`).
10. **Реальных конкурентных тестов на БД нет** (правила репозитория: никаких вставок в `test:db`, на машине нет тестовой БД). Конкуренцию покрывают: (а) модель «уникальный индекс» в памяти (`Promise.all × N`) — проверяет, что сервис не делает check-then-insert; (б) тесты формы SQL (`ON CONFLICT … DO NOTHING`, `GREATEST`, `ON CONFLICT … WHERE … DO UPDATE`); (в) необязательный разовый smoke контролёра после применения миграции (раздел «After all tasks»).

### Verified SQL (прогнано в Drizzle 1.0.0-beta.22 на копии схемы, без БД)

Ниже — именно то, что рендерит предложенный код; тесты задач 2–3 фиксируют эти фрагменты.

- `insert into "InternalThread" (…) values (…) on conflict ("workspaceId","directKey") do nothing returning …`
- `insert into "Notification" (…, "readAt", "createdAt", "updatedAt") values (…, null, default, default) on conflict ("workspaceId","userId","entityId") where "entityType" = 'chat' and "readAt" is null do update set "payload" = jsonb_set(excluded."payload", '{count}', to_jsonb(coalesce(("Notification"."payload"->>'count')::int, 1) + 1)), "createdAt" = excluded."createdAt", "updatedAt" = excluded."updatedAt" returning "id", "userId"`
- `update "InternalThread" set "lastMessageAt" = greatest("InternalThread"."lastMessageAt", (select m."createdAt" from "InternalMessage" m where m."id" = $1 and m."threadId" = $2)), "updatedAt" = CURRENT_TIMESTAMP where "InternalThread"."id" = $3`
- `update "InternalThreadMember" set "lastReadAt" = greatest("InternalThreadMember"."lastReadAt", (select …)), … where (…threadId = $ and …userId = $ and exists (select 1 from "InternalThread" t where t."id" = $ and t."workspaceId" = $) and (select …) > coalesce("InternalThreadMember"."lastReadAt", '-infinity'::timestamptz)) returning "id"`
- курсор: `("InternalMessage"."createdAt", "InternalMessage"."id") < (select c."createdAt", c."id" from "InternalMessage" c where c."id" = $ and c."threadId" = $)`
- `select distinct on ("InternalMessage"."threadId") … order by "InternalMessage"."threadId", "InternalMessage"."createdAt" desc, "InternalMessage"."id" desc`
- `… order by "InternalThread"."lastMessageAt" desc nulls last, "InternalThread"."id" desc`
- `update "Notification" set "readAt" = now() where (… and exists (select 1 from "InternalMessage" m inner join "InternalThreadMember" t on … t."userId" = "Notification"."userId" where m."id" = ("Notification"."payload"->>'lastMessageId')::bigint and m."createdAt" <= t."lastReadAt")) returning "id"`

## File map

**Create**
- Миграция `packages/database/drizzle/<ts>_staff_chat/{migration.sql,snapshot.json}` (генерируется).
- `packages/database/src/repositories/chat/{repository.ts,index.ts}`.
- `packages/business/src/chat/{service.ts,direct-key.ts,actor.ts,view.ts,index.ts}`; `packages/business/src/notification/rows.ts`.
- Тесты database: `__tests__/{staff-chat-schema,chat-repository,notification-chat-repository,internal-thread-repository}.test.ts`, `__tests__/integration/staff-chat-schema.test.ts` (**не запускать** до применения миграции).
- Тесты business: `__tests__/chat/{direct-key,attachments,thread-no-mentions,service-open,service-messages,service-read,import-boundaries}.test.ts`, `__tests__/notification/{chat-message,bell-scope}.test.ts`.

**Modify**
- `packages/database/src/partials/task.ts` (типы `direct`/`agent`, `CHAT_LIMITS`, `CHAT_THREAD_TYPES`, `InternalThreadType`), `partials/notification.ts`, `partials/workspace.ts` (`chatMessage?`), `partials/shared.ts` (`compareNumericIds`).
- `packages/database/src/schema/internal-thread.ts`, `schema/notification.ts`.
- `packages/database/src/repositories/index.ts`, `repositories/internal-thread/repository.ts` (`deleteMembersForUser` → `type = 'task'`), `repositories/notification/repository.ts`.
- `packages/business/src/internal-thread/{attachments.ts,service.ts}`; `packages/business/src/notification/{service.ts,preferences.ts,index.ts}`; `packages/business/src/index.ts` (`export * from "./chat"` после `./channel-post`).
- `.github/workflows/gkamion-checks.yml` (только в Задаче 4 — один файл, чтобы параллельные задачи не конфликтовали).

**Не меняются:** `apps/builder/**` (в т. ч. `features/notifications/schema/resource.ts` — Deviation 6), realtime, `partysocket-config`, `routers/*`, токены и scope.

## Spec §9 → задачи

| Тест из спеки (этап 1) | Где |
|---|---|
| `open`: создание/повтор/порядок пары/числовое сравнение/валидации/`agent` | Т4 `service-open`, Т4 `direct-key` |
| `open`: параллельные вызовы → один чат, две строки участников | Т4 `service-open` (модель уникального индекса) + Т2 (форма SQL `ON CONFLICT DO NOTHING`) |
| `send/edit/delete`: права, чужой чат — 404, вложения, `mentions` пусты, `lastMessageAt` монотонен | Т4 `service-messages`, Т3 `attachments` + `thread-no-mentions`, Т2 (SQL `GREATEST`) |
| Непрочитанные / `markRead`: свои и удалённые не считаются, не участник → no-op, не откатывает, сумма, публикация только при сдвиге | Т4 `service-read`, Т2 (SQL указателя и агрегата) |
| Уведомления: первая запись и склейка, конкуренция, прочитанная → новая, гонка, автор, токен, выключенный тип, нет ключа, отказ не ломает отправку, `updatePreferences` не теряет ключи | Т3 `chat-message` (+ модель склейки), Т2 `notification-chat-repository` (форма SQL), Т4 (отказ не ломает `send`) |
| «Список колокольчика строит URL чата» | **этап 4** (в этом этапе колокольчик намеренно task-only: Т3 `bell-scope`) |
| Выход сотрудника: `reassignFromMember` не удаляет участие в `direct`; отправка с удалённым — отказ; чтение у оставшегося | Т2 `internal-thread-repository` (SQL `type = 'task'`), Т4 `service-messages` |
| Миграция: `db:check-drift`; `information_schema` | Т1 (`check-drift`, `staff-chat-schema` — юнит; `test:db`-файл написан, **выполняет контролёр** после применения) |
| Сессия поддержки, триал, публичный/приватный API, маршрут медиа, realtime-реестр, интерфейс | **этапы 2–4** |

## Models (cost/quality) и параллельность

| Задача | Зависит от | Параллельно с | Модель |
|---|---|---|---|
| T1 Схема, типы, миграция (**остановка на одобрение**) | — | — | composer-2.5-fast |
| T2 Репозитории (`chatRepository`, notification, internal-thread) | T1 закоммичена | **T3** (файлы не пересекаются) | composer-2.5-fast |
| T3 Бизнес: вложения, упоминания, уведомления | T1 закоммичена; интерфейсы репозиториев T2 заморожены в этом плане (тесты мокают репозитории) | **T2** | composer-2.5-fast |
| T4 `chatService` + граница импортов + CI | T2 и T3 влиты (типы репозиториев и уведомлений) | — | gpt-5.6-terra-medium (самая сложная логика: права, конкуренция, порядок транзакций) |
| Ревью задач | контроллер по диффу | | при сомнениях — gpt-5.6-terra-medium |
| invariant-guard (после T4) | | | claude-haiku-5-5-thinking-high |
| Финальное ревью (SQL, конкуренция, типы) | | | claude-opus-5-5-medium |

Порядок: **T1 → (T2 ∥ T3) → T4**. Миграцию контролёр применяет после «да» пользователя в любой момент после T1; T2–T4 её не требуют (все тесты — на моках и записи SQL).

---

### Task 1: Схема, типы, миграция `staff_chat` — **остановка на одобрение**

**Files:**
- Modify: `packages/database/src/partials/{task,notification,workspace,shared}.ts`, `packages/database/src/schema/{internal-thread,notification}.ts`.
- Create: `packages/database/drizzle/<ts>_staff_chat/` (генерируется), `packages/database/__tests__/staff-chat-schema.test.ts`, `packages/database/__tests__/integration/staff-chat-schema.test.ts`.

**Interfaces (produces):**
- `partials/task.ts`:
  ```ts
  export const internalThreadTypeValues = ["task", "direct", "agent"] as const
  export type InternalThreadType = (typeof internalThreadTypeValues)[number]
  /** Thread types that are staff chats (everything except task feeds). */
  export const CHAT_THREAD_TYPES = ["direct", "agent"] as const
  export type ChatThreadType = (typeof CHAT_THREAD_TYPES)[number]
  export const CHAT_LIMITS = {
    maxMessageLength: 10_000,
    maxPageSize: 50,
  } as const
  ```
  Размер/число вложений — существующий `TASK_ATTACHMENT_LIMITS` (10 × 25 МБ), он общий.
- `partials/shared.ts`: `export const compareNumericIds = (a: string, b: string): number => { const difference = BigInt(a) - BigInt(b); if (difference === 0n) { return 0 } return difference < 0n ? -1 : 1 }` (без вложенных тернаров — Biome) — одна реализация числового сравнения id (используют `buildDirectKey` и `upsertChatMessages`). Если `BigInt` бросает на нечисловой строке — это нормально (id всегда числовые); тест фиксирует `["10","9"].sort(compareNumericIds) → ["9","10"]`.
- `partials/notification.ts` (`NotificationPayload` и `TaskNotificationType` **не переименовывать** — на них опирается builder):
  ```ts
  export const chatNotificationTypes = z.enum(["chatMessage"])
  export type ChatNotificationType = z.infer<typeof chatNotificationTypes>
  export type NotificationType = TaskNotificationType | ChatNotificationType

  export const NOTIFICATION_ENTITY_TYPES = ["task", "chat"] as const
  export type NotificationEntityType = (typeof NOTIFICATION_ENTITY_TYPES)[number]

  /** `count` — число сообщений с момента создания этой непрочитанной записи. */
  export type ChatNotificationPayload = {
    actorUserId: string | null
    actorLabel: string | null
    excerpt: string
    count: number
    lastMessageId: string
    lastMessageAt: string
  }
  export type StoredNotificationPayload = NotificationPayload | ChatNotificationPayload
  ```
  (`TASK_NOTIFICATION_ENTITY_TYPES` оставить.)
- `partials/workspace.ts`: в `workspaceMemberNotificationTypesSchema` добавить `chatMessage: z.boolean().optional()` (нет ключа = включено).
- `schema/internal-thread.ts` (`internalThreadModel`): `title: text()`, `directKey: text()`, `lastMessageAt: timestamp(timestampConfig)` — **без `.default()` и `.notNull()`**; индексы `uniqueIndex("InternalThread_workspaceId_directKey_key").on(table.workspaceId, table.directKey)` и `index("InternalThread_workspaceId_type_lastMessageAt_idx").using("btree", table.workspaceId.asc().nullsLast(), table.type.asc().nullsLast(), table.lastMessageAt.desc().nullsLast())`. **Без предикатов по `type`** (новое значение enum нельзя использовать в той же миграции). Существующий `InternalThread_workspaceId_idx` оставить.
- `schema/notification.ts`: `type: text().$type<NotificationType>()`, `entityType: text().$type<NotificationEntityType>()`, `payload: jsonb().$type<StoredNotificationPayload>()`; в массив индексов — `uniqueIndex("Notification_chat_unread_key").on(table.workspaceId, table.userId, table.entityId).where(sql`"entityType" = 'chat' AND "readAt" IS NULL`)` (`uniqueIndex` добавить в импорт `drizzle-orm/pg-core`; `sql` уже импортирован). Смена `$type` SQL не меняет.

**Steps:**
- [ ] **Step 1 (grep до правок):** `rg -n "InternalThreadType\b|CHAT_LIMITS|ChatThreadType|compareNumericIds|StoredNotificationPayload|NotificationEntityType" packages apps --glob '!**/node_modules/**'` — убедиться, что имён ещё нет (иначе переименовать новые).
- [ ] **Step 2: failing unit test** `packages/database/__tests__/staff-chat-schema.test.ts` (без БД). Проверить:
  - `internalThreadTypeValues` равен `["task","direct","agent"]`; `CHAT_THREAD_TYPES` = `["direct","agent"]`; `CHAT_LIMITS` = `{ maxMessageLength: 10000, maxPageSize: 50 }`; `chatNotificationTypes.options` = `["chatMessage"]`;
  - `["10","9","100"].sort(compareNumericIds)` = `["9","10","100"]`;
  - `workspaceMemberNotificationTypesSchema.parse({ notifyAdmin: true, newMessageToHuman: true, newOrder: true })` проходит; с `chatMessage: false` значение сохраняется;
  - `getTableColumns(internalThreadModel)`: `title`, `directKey`, `lastMessageAt` — `notNull === false`, `hasDefault === false`;
  - `getTableConfig(internalThreadModel).indexes` (`i.config.name / unique / columns / where`): есть `InternalThread_workspaceId_directKey_key` (unique, колонки `workspaceId`, `directKey`) и `InternalThread_workspaceId_type_lastMessageAt_idx` (не unique, **`where` не задан** — закрепляет правило enum);
  - `getTableConfig(notificationModel).indexes`: есть `Notification_chat_unread_key` (unique, колонки `workspaceId`, `userId`, `entityId`); `new PgDialect().sqlToQuery(index.config.where).sql` содержит `"entityType" = 'chat'` и `"readAt" IS NULL`.
  Запуск: `cd packages/database && pnpm exec vitest run __tests__/staff-chat-schema.test.ts --pool=forks --maxWorkers=1` → красный → правки → зелёный.
- [ ] **Step 3: правки** partials и схем (см. Interfaces).
- [ ] **Step 4: `test:db`-файл** `packages/database/__tests__/integration/staff-chat-schema.test.ts` по образцу `schema-default-parity.test.ts` (шапка, `realDatabaseUrl`, `skipIf` по недоступности БД; **только чтение**): значения `pg_enum` для `internalThreadType` содержат `task`, `direct`, `agent`; `information_schema.columns` — `InternalThread.title|directKey|lastMessageAt` существуют, `is_nullable = 'YES'`, `column_default` пуст; `pg_indexes.indexdef` для `InternalThread_workspaceId_directKey_key` (UNIQUE), `InternalThread_workspaceId_type_lastMessageAt_idx` и `Notification_chat_unread_key` (содержит `WHERE` с `entityType` и `readAt`). **Не запускать** (миграция не применена, на машине нет БД; файл исполнит контролёр после «да»).
- [ ] **Step 5: миграция** (только генерация):
  ```bash
  cd /GKamion/chatbotX && export PATH=/GKamion/chatbotX/.tools/node-24/bin:$PATH
  pnpm --filter @chatbotx.io/database make:migration staff_chat
  pnpm --filter @chatbotx.io/database db:check-drift
  ```
  Прочитать `migration.sql`. Ожидается ровно (порядок и кавычки могут отличаться): два `ALTER TYPE "internalThreadType" ADD VALUE 'direct'|'agent'`; три `ALTER TABLE "InternalThread" ADD COLUMN "title" text | "directKey" text | "lastMessageAt" timestamp(6) with time zone`; `CREATE UNIQUE INDEX "InternalThread_workspaceId_directKey_key" ON "InternalThread" ("workspaceId","directKey")`; `CREATE INDEX "InternalThread_workspaceId_type_lastMessageAt_idx" ON "InternalThread" USING btree ("workspaceId","type","lastMessageAt" DESC NULLS LAST)`; `CREATE UNIQUE INDEX "Notification_chat_unread_key" ON "Notification" ("workspaceId","userId","entityId") WHERE "entityType" = 'chat' AND "readAt" IS NULL`. **Ничего лишнего** (никаких `DROP`, `ALTER COLUMN`, пересоздания индексов других таблиц, пересоздания типа). Если drizzle-kit спросил про переименование/выдал лишнее — остановиться и сообщить, не «чинить».
  `db:check-drift` — «чисто» (ни одного SQL).
- [ ] **Step 6:** `npx ultracite fix` по изменённым ts-файлам; повторить единственный тест из Step 2 (зелёный). Не форматировать `migration.sql`/`snapshot.json`.
- [ ] **Step 7: Commit** (стейджить явно: изменённые `partials/*`, `schema/*`, оба теста, каталог новой миграции):
  `feat(database): staff chat schema and migration` — тело: «migration generated, NOT applied».
- [ ] **ОСТАНОВКА.** Отчёт контролёру: хеш коммита, **полный текст `migration.sql`**, результат `db:check-drift`, заявление «`db:migrate` не запускался». Дальше — ждать решения контролёра/пользователя; **T2/T3 можно запускать сразу после коммита T1** (они миграции не требуют). `test:db` и применение — только по разрешению.

---

### Task 2: Репозитории — `chatRepository`, notification, исправление `deleteMembersForUser`

**Parallel:** с Task 3. Файлы Task 2 и Task 3 не пересекаются; `repositories/index.ts` правит только Task 2.

**Files:**
- Create: `packages/database/src/repositories/chat/{repository.ts,index.ts}`, `packages/database/__tests__/{chat-repository,notification-chat-repository,internal-thread-repository}.test.ts`.
- Modify: `packages/database/src/repositories/index.ts` (`export * from "./chat"` после `./channel-post`, строка 16), `repositories/internal-thread/repository.ts`, `repositories/notification/repository.ts`.

**Interfaces (consumes):** Task 1 (`internalThreadModel.title|directKey|lastMessageAt`, `CHAT_THREAD_TYPES`, `ChatThreadType`, `compareNumericIds`, `ChatNotificationPayload`, `NotificationType`, `NotificationEntityType`, `StoredNotificationPayload`).

**Interfaces (produces) — `chatRepository`** (все методы принимают `tx?: DatabaseClient`, по умолчанию `db`; импорты как в `internal-thread/repository.ts` — `../../client`, `../../schema`):
```ts
type ChatMemberRow = { threadId: string; userId: string; lastReadAt: Date | null }

chatRepository.insertThreadIfAbsent(p: {
  workspaceId: string; type: ChatThreadType; directKey: string; title: string | null; tx?
}): Promise<InternalThreadModel | null>
// insert(... lastMessageAt: null).onConflictDoNothing({ target: [workspaceId, directKey] }).returning(); [row] ?? null.
// null = ключом уже владеет другая транзакция/строка — вызывающий перечитывает findThreadByDirectKey.

chatRepository.findThreadByDirectKey(p: { workspaceId; directKey; tx? }): Promise<InternalThreadModel | null>
chatRepository.findThread(p: { workspaceId; id; tx? }): Promise<InternalThreadModel | null>
// оба: type IN CHAT_THREAD_TYPES (лента задачи никогда не считается чатом), limit 1.

chatRepository.listMembers(p: { workspaceId; threadIds: string[]; tx? }): Promise<ChatMemberRow[]>
// member JOIN thread ON thread.id = member.threadId WHERE thread.workspaceId = :ws AND member.threadId IN (…); пусто → [].

chatRepository.listThreads(p: {
  workspaceId; participantUserId?: string; includeEmpty: boolean; limit: number; offset: number; tx?
}): Promise<{ rows: InternalThreadModel[]; total: number }>
// WHERE workspaceId, type IN CHAT_THREAD_TYPES, (includeEmpty || lastMessageAt IS NOT NULL),
//   participant → id IN (select threadId from InternalThreadMember where userId = :u)
// ORDER BY lastMessageAt DESC NULLS LAST, id DESC; total = tx.$count(internalThreadModel, same where).

chatRepository.listLastMessages(p: { workspaceId; threadIds: string[]; tx? }): Promise<InternalMessageModel[]>
// selectDistinctOn([threadId]) ... kind = 'comment' AND deletedAt IS NULL
// ORDER BY threadId, createdAt DESC, id DESC. Пусто → [].

chatRepository.listMessagesPage(p: {
  workspaceId; threadId; beforeId?: string; afterId?: string; limit: number; tx?
}): Promise<{ rows: InternalMessageModel[]; hasMore: boolean }>
// Курсор по (createdAt, id) через строковое сравнение подзапросом (см. Verified SQL), всегда в границах threadId.
// Без курсора / beforeId: ORDER BY createdAt DESC, id DESC LIMIT limit+1.
// afterId: ORDER BY createdAt ASC, id ASC LIMIT limit+1 → ближайшие limit сообщений ПОСЛЕ курсора;
//   результат разворачивается, чтобы порядок ответа всегда был «новые сверху».
// hasMore = пришло limit+1 строк; лишняя строка отбрасывается (у afterId — самая новая, т. е. дальняя от курсора).
// Удалённые сообщения включены (view показывает «удалено»); kind не фильтруется.

chatRepository.touchLastMessageAt(p: { threadId; messageId; tx? }): Promise<void>
// SET lastMessageAt = greatest(lastMessageAt, (select m."createdAt" … m.id = :messageId AND m.threadId = :threadId))

chatRepository.advanceReadPointer(p: {
  workspaceId; threadId; userId; upToMessageId?: string; tx?
}): Promise<boolean>
// UPDATE InternalThreadMember SET lastReadAt = greatest(lastReadAt, :target)
// WHERE threadId, userId, exists(thread of workspace), :target > coalesce(lastReadAt, '-infinity'::timestamptz)
// RETURNING id → true, если указатель сдвинулся.
// :target = подзапрос по upToMessageId (в границах threadId) ИЛИ, без него,
//   (select max(m."createdAt") from "InternalMessage" m where m."threadId" = :threadId and m."kind" = 'comment')
//   — последнее сообщение любого состояния (удалённые — надгробия: двигать мимо них безопасно).
// Нет сообщения / NULL-цель / указатель уже не меньше → 0 строк → false.

chatRepository.countUnreadTotal(p: { workspaceId; userId; tx? }): Promise<number>
// count(*)::int FROM InternalMessage m JOIN InternalThreadMember mem (mem.threadId = m.threadId AND mem.userId = :u)
// JOIN InternalThread t ON t.id = m.threadId
// WHERE t.workspaceId = :ws AND t.type IN CHAT_THREAD_TYPES AND m.workspaceId = :ws AND m.kind = 'comment'
//   AND m.deletedAt IS NULL AND m.authorUserId IS DISTINCT FROM :u
//   AND m.createdAt > coalesce(mem.lastReadAt, '-infinity'::timestamptz)
```
Сообщения на сторонах: непрочитанные по чатам — существующий `internalThreadRepository.countUnreadByThreads` (используется Task 4 как есть).

**Interfaces (produces) — `notificationRepository`:**
```ts
export type TaskNotificationInsert = {
  workspaceId: string; userId: string; type: TaskNotificationType; entityType: "task"
  entityId: string; payload: NotificationPayload
}
export type ChatNotificationInsert = {
  workspaceId: string; userId: string; type: "chatMessage"; entityType: "chat"
  entityId: string; payload: ChatNotificationPayload
}
export type NotificationInsert = TaskNotificationInsert | ChatNotificationInsert
```
- `insertMany` принимает `NotificationInsert[]` (поведение прежнее).
- `listForUser`, `countUnread`, `markRead` получают необязательный `entityTypes?: readonly NotificationEntityType[]`: `undefined` → без фильтра (прежнее поведение); непустой → `inArray(notificationModel.entityType, [...entityTypes])`. Пустой массив не передаётся (вызывающий не должен); `markRead` с пустым `ids` по-прежнему no-op.
- `deleteByEntity.entityType: NotificationEntityType`.
- `upsertChatMessages(p: { rows: ChatNotificationInsert[]; tx? }): Promise<{ id: string; userId: string }[]>` — пусто → `[]`; **дедуплицирует по `userId`** (иначе Postgres: «ON CONFLICT DO UPDATE command cannot affect row a second time»), сортирует по `compareNumericIds(userId)` (одинаковый порядок блокировок), затем `insert(...values(rows.map(r => ({ ...r, readAt: null })))).onConflictDoUpdate({ target: [workspaceId, userId, entityId], targetWhere: sql\`"entityType" = 'chat' and "readAt" is null\`, set: { payload: sql\`jsonb_set(excluded."payload", '{count}', to_jsonb(coalesce(("Notification"."payload"->>'count')::int, 1) + 1))\`, createdAt: sql\`excluded."createdAt"\`, updatedAt: sql\`excluded."updatedAt"\` } }).returning({ id, userId })`. Возвращает и вставленные, и обновлённые строки.
- `markChatReadUpToPointer(p: { workspaceId; userId; threadId; tx? }): Promise<number>` — SQL из Verified SQL (+ `m."threadId" = "Notification"."entityId"`), `entityType = 'chat'`, `entityId = threadId`, `readAt IS NULL`; возвращает число закрытых записей.

**Interfaces — `internalThreadRepository.deleteMembersForUser`:** подзапрос потоков получает `and(eq(workspaceId), eq(type, "task"))` (импорт `and` уже есть). Остальные методы без правок (`insertThread` остаётся задачным; `insertMembers` переиспользуется чатом).

**Steps:**
- [ ] **Step 1: failing tests** (общий приём — реальный drizzle над поддельным `pg`-клиентом, записывающим текст и параметры; образец — `__tests__/inbound-webhook-repository.test.ts:11-56`, скопировать каркас `recorded`/`nextRows`/`fakeClient`/`tx`). Строки результата — массивы значений в порядке колонок (как в образце).
  - `chat-repository.test.ts`: `insertThreadIfAbsent` — текст содержит `insert into "InternalThread"` и `on conflict ("workspaceId","directKey") do nothing returning`; `null` при пустом результате, строка при непустом; параметры содержат `direct`/ключ и `null` для `title`/`lastMessageAt`. `findThread` — тип-фильтр (параметры `direct`, `agent`). `listMembers` — `inner join "InternalThread"` и workspace-параметр; пустой `threadIds` → `[]` без запроса. `listThreads` — `lastMessageAt" is not null` есть при `includeEmpty: false` и нет при `true`; `"InternalThread"."id" in (select "threadId" from "InternalThreadMember"` при `participantUserId`; `desc nulls last`; `limit/offset`. `listLastMessages` — `distinct on ("InternalMessage"."threadId")`, `deletedAt" is null`, `kind` = `comment`. `listMessagesPage` — для `beforeId`: `("InternalMessage"."createdAt", "InternalMessage"."id") <`, `desc`, `limit` = limit+1, `hasMore`; для `afterId`: `>`, `asc`, **результат развёрнут**, лишняя (дальняя) строка отброшена; без курсора — нет сравнения; ни один запрос не без `workspaceId` и `threadId`. `touchLastMessageAt` — `greatest("InternalThread"."lastMessageAt", (select m."createdAt" from "InternalMessage" m where m."id" = $1 and m."threadId" = $2))`. `advanceReadPointer` — оба варианта цели (`max(m."createdAt")` без `upToMessageId`), `greatest(`, `> coalesce("InternalThreadMember"."lastReadAt", '-infinity'::timestamptz)`, `exists (select 1 from "InternalThread" t where t."id" = … and t."workspaceId" = …)`, `true` при непустом `returning`, `false` при пустом. `countUnreadTotal` — `is distinct from`, `'-infinity'::timestamptz`, `m."kind"`/`deletedAt is null`, `workspaceId` дважды, возвращает число (0 при пустом).
  - `notification-chat-repository.test.ts`: `upsertChatMessages` — один запрос на пачку; текст содержит `on conflict ("workspaceId","userId","entityId") where "entityType" = 'chat' and "readAt" is null do update set "payload" = jsonb_set(excluded."payload", '{count}'`, `"createdAt" = excluded."createdAt"` и `returning "id", "userId"`; порядок параметров `userId` — по возрастанию **числа** (`["9","10"]`, не `["10","9"]`); дубль `userId` схлопывается; `[]` → запрос не выполняется; `markChatReadUpToPointer` — `exists (select 1 from "InternalMessage" m inner join "InternalThreadMember" t`, `("Notification"."payload"->>'lastMessageId')::bigint`, `m."createdAt" <= t."lastReadAt"`, `"readAt" is null`, возвращает число строк; `listForUser`/`countUnread`/`markRead` с `entityTypes: ["task"]` добавляют `"entityType" in ($…)`, без него — нет; `markRead` с пустым `ids` по-прежнему без запроса.
  - `internal-thread-repository.test.ts`: `deleteMembersForUser` — текст содержит `"InternalThread"."type" = $` и в параметрах есть `task` (регрессия «выход сотрудника не удаляет участие в чатах»; комментарий в тесте: сервисный `reassignFromMember` только делегирует, поэтому защита закреплена здесь).
- [ ] **Step 2: реализация** по Interfaces; `repositories/index.ts` — экспорт; `rg -n "\bchatRepository\b" packages --glob '!**/node_modules/**'` до создания — коллизий нет (совпадения `webchatRepository` не в счёт).
- [ ] **Step 3:** каждый из трёх новых тестовых файлов + существующие `__tests__/automation-throttle-repository.test.ts` и `__tests__/task-list-where.test.ts` по одному (`--pool=forks --maxWorkers=1`) — зелёные. `npx ultracite fix` по изменённым файлам.
- [ ] **Step 4: Commit** (явные пути): `feat(database): chat repository, notification collapse and task-only member cleanup`.

---

### Task 3: Бизнес — вложения чата, упоминания выключаемы, уведомления `chatMessage`

**Parallel:** с Task 2 (файлы не пересекаются; тесты мокают `@chatbotx.io/database/repositories` по интерфейсам Task 2).

**Files:**
- Modify: `packages/business/src/internal-thread/{attachments.ts,service.ts}`, `packages/business/src/notification/{service.ts,preferences.ts,index.ts}`.
- Create: `packages/business/src/notification/rows.ts`; тесты `packages/business/__tests__/chat/{attachments,thread-no-mentions}.test.ts`, `packages/business/__tests__/notification/{chat-message,bell-scope}.test.ts`.

**Interfaces (consumes):** Task 1 типы; Task 2: `notificationRepository.upsertChatMessages / markChatReadUpToPointer`, `entityTypes` у `listForUser|countUnread|markRead`, `taskRepository.listMemberUserIds`, `workspaceMemberRepository.listNotificationTypesByUserIds` (существуют).

**Interfaces (produces):**
- `attachments.ts` — обобщение, прежние экспорты и сообщения для задач не меняются:
  ```ts
  export type ThreadAttachmentScope = { kind: "tasks" | "chats"; id: string }
  export const threadAttachmentPrefix = (workspaceId: string, scope: ThreadAttachmentScope): string =>
    `private/space/${workspaceId}/${scope.kind}/${scope.id}/`
  export const taskAttachmentPrefix = (workspaceId: string, taskId: string) =>
    threadAttachmentPrefix(workspaceId, { kind: "tasks", id: taskId })
  export const chatAttachmentPrefix = (workspaceId: string, chatId: string) =>
    threadAttachmentPrefix(workspaceId, { kind: "chats", id: chatId })
  export const uploadThreadAttachment = async (input: { workspaceId: string; scope: ThreadAttachmentScope; file: File }) => …   // тело текущего uploadTaskAttachment
  export const resolveThreadAttachments = async (input: { workspaceId: string; scope: ThreadAttachmentScope; items: { key: string; name: string }[] }) => …  // тело текущего resolveTaskAttachments
  export const uploadTaskAttachment / resolveTaskAttachments  // тонкие обёртки (сигнатуры прежние: taskId)
  export const uploadChatAttachment / resolveChatAttachments  // обёртки с chatId
  ```
  Текст ошибки чужого ключа: «Attachment key does not belong to this task» для `tasks` и «… this chat» для `chats`; предупреждение в лог: «Task attachment was not found in storage» / «Chat attachment …». `TASK_ATTACHMENT_LIMITS` не переименовывать (на него ссылаются тесты и задачи). Существующие `__tests__/task/task-attachments.test.ts` — **не править и они должны остаться зелёными**.
- `internal-thread/service.ts`: `postComment` и `editComment` принимают `recognizeMentions?: boolean` (по умолчанию `true`). При `false` — `mentions = EMPTY_INTERNAL_MESSAGE_MENTIONS` и **нет** вызовов `taskRepository.listMemberUserIds/listTeamIds`. В `postComment` заменить `const { tx, ...row } = input` + `...row` на явные поля для `commentRow` (`workspaceId`, `threadId`, `text`, `actor`, `mentions`, `attachments`), чтобы новый флаг не утёк в строку. Поведение по умолчанию (задачи) не меняется — `internal-thread-stage3.test.ts` остаётся зелёным.
- `notification/rows.ts`:
  ```ts
  export type TaskNotificationRow = Omit<NotificationModel, "type" | "entityType" | "payload"> & {
    type: TaskNotificationType
    entityType: "task"
    payload: NotificationPayload
  }
  export const isTaskNotificationRow = (row: NotificationModel): row is TaskNotificationRow =>
    row.entityType === "task"
  ```
  (импорт `NotificationModel` из `@chatbotx.io/database/types`, остальное из `@chatbotx.io/database/partials`; экспорт из `notification/index.ts`.)
- `notification/preferences.ts`: `isNotificationEnabled(notificationTypes: Partial<WorkspaceMemberNotificationTypes>, type: NotificationType): boolean` (нет ключа → `true`); `isTaskNotificationEnabled` делегирует ему. `readTaskNotificationPreferences` остаётся из 7 задачных ключей (builder-ресурс не меняется).
- `notification/service.ts`:
  ```ts
  /** The bell shows task notifications only until stage 4 adds the chat renderer. */
  const BELL_ENTITY_TYPES = ["task"] as const

  async notifyChatMessage(props: {
    workspaceId: string
    threadId: string
    participantUserIds: string[]          // все участники чата, автор в том числе — сервис исключит сам
    actor: NotificationActor              // user | api (flow/system не пишут в чаты)
    excerpt: string
    messageId: string
    messageAt: Date
    tx?: DatabaseClient
  }): Promise<void>

  async markChatNotificationsRead(props: { workspaceId: string; userId: string; threadId: string; tx?: DatabaseClient }): Promise<number>
  ```
  `notifyChatMessage`: (1) кандидаты = участники без `notificationActorUserId(actor)`, без дублей; пусто → return; (2) `taskRepository.listMemberUserIds({ workspaceId, userIds, tx })` — только текущие сотрудники; (3) `workspaceMemberRepository.listNotificationTypesByUserIds` → оставить тех, у кого `isNotificationEnabled(prefs, "chatMessage")`; пусто → return; (4) строки `ChatNotificationInsert` с `payload = { actorUserId, actorLabel, excerpt, count: 1, lastMessageId: messageId, lastMessageAt: messageAt.toISOString() }` (`actorLabel` — как в `notifyTask`); (5) `notificationRepository.upsertChatMessages({ rows, tx })`; (6) `emitNotificationsCreated({ workspaceId, notifications: result.map(({ id, userId }) => ({ id, userId })) })`. Исключений **не глотает** (это делает вызывающий `chatService.send`). `markChatNotificationsRead` просто вызывает репозиторий.
  Колокольчик: `listForUser(...)` → `notificationRepository.listForUser({ ...input, entityTypes: BELL_ENTITY_TYPES })` и результат `.filter(isTaskNotificationRow)`, тип возврата `Promise<TaskNotificationRow[]>`; `countUnread`, `markRead`, `markAllRead` передают `entityTypes: BELL_ENTITY_TYPES`; `deleteForTask` без изменений. `updatePreferences` не меняется (спред `...existing` уже сохраняет `chatMessage`).

**Steps:**
- [ ] **Step 1: failing tests.**
  - `__tests__/chat/attachments.test.ts` (каркас — шапка `__tests__/task/task-attachments.test.ts`: `vi.hoisted` uploader, мок `@chatbotx.io/filesystem` и `createId`): префиксы `private/space/ws-1/chats/c-1/…` и `…/tasks/t-1/…`; `uploadChatAttachment` кладёт под префикс чата без `ACL`; `resolveChatAttachments` отклоняет ключ **задачи** и ключ **другого чата** (`code: "validation"`), принимает свой, берёт размер/тип из `headObject`, лимиты 10 файлов и 25 МБ.
  - `__tests__/chat/thread-no-mentions.test.ts` (моки как в `__tests__/task/internal-thread-stage3.test.ts`): `postComment`/`editComment` с `recognizeMentions: false` пишут `{ userIds: [], teamIds: [] }` для текста с токеном упоминания и **не** вызывают `listMemberUserIds/listTeamIds`; без флага — по-прежнему вызывают (регрессия задач).
  - `__tests__/notification/chat-message.test.ts` (каркас моков — `__tests__/notification/service.test.ts:1-55`; добавить `upsertChatMessages`, `markChatReadUpToPointer` в `repo.notification`): автор исключён; `api`-актор — уведомлены все участники; не-сотрудник отфильтрован; `chatMessage: false` — не создаётся; нет ключа — создаётся; выключили все → репозиторий не вызван; полезная нагрузка (`count: 1`, `excerpt`, `lastMessageId`, `lastMessageAt` ISO, `actorLabel` для токена, `actorUserId: null` для токена); `tx` пробрасывается; слушатель `onNotificationsCreated` получает ровно возвращённые репозиторием `{ id, userId }` (в т. ч. «обновлённые»); **модель склейки:** подмена `upsertChatMessages` реализацией в памяти (ключ `userId|threadId` пока запись непрочитана; `count` растёт) и `Promise.all` из 5 вызовов → одна запись `count = 5` (проверяет контракт «каждый вызов передаёт count 1 и не создаёт дублей», а не SQL); после «прочтения» (`markChatNotificationsRead` сбрасывает модель) следующий вызов создаёт новую запись с `count = 1`; `markChatNotificationsRead` пробрасывает аргументы и возвращает число; `updatePreferences({ patch: { taskAssigned: false } })` при существующем `{ chatMessage: false, … }` сохраняет `chatMessage: false` (`updateNotificationTypes` вызван с объединением).
  - `__tests__/notification/bell-scope.test.ts`: `listForUser` зовёт репозиторий с `entityTypes: ["task"]` и отбрасывает строки с `entityType: "chat"` из результата; `countUnread`, `markRead` (с ids и без — `markAllRead`) передают `entityTypes: ["task"]`; `isTaskNotificationRow`; `isNotificationEnabled` для `chatMessage` (нет ключа/`false`/`true`) и совместимость `isTaskNotificationEnabled`.
- [ ] **Step 2:** реализация; прогнать по одному: четыре новых файла + `__tests__/task/task-attachments.test.ts`, `__tests__/task/internal-thread-stage3.test.ts`, `__tests__/task/task-notifications.test.ts`, `__tests__/notification/service.test.ts` (все — зелёные без правок). `npx ultracite fix` по изменённым файлам.
- [ ] **Step 3: grep-контроль:** `rg -n "listForUser|countUnread" apps packages --glob '!**/node_modules/**' --glob '!**/__tests__/**'` — потребители колокольчика получают тот же тип (`TaskNotificationRow` совместим с прежним `NotificationModel`-использованием: `payload.taskTitle`, `type` задачного перечисления). Если находится потребитель, которому нужен более широкий тип, — остановиться и сообщить.
- [ ] **Step 4: Commit** (явные пути): `feat(business): chat attachments, mention-free threads and chat notification collapse`.

---

### Task 4: `chatService`, граница импортов, CI

**Зависит от** Task 2 и Task 3 (влиты). Последовательно.

**Files:**
- Create: `packages/business/src/chat/{service.ts,direct-key.ts,actor.ts,view.ts,index.ts}`; тесты `packages/business/__tests__/chat/{direct-key,service-open,service-messages,service-read,import-boundaries}.test.ts`.
- Modify: `packages/business/src/index.ts` (`export * from "./chat"` после `./channel-post`, строка 19), `.github/workflows/gkamion-checks.yml`.

**Interfaces (consumes):** `chatRepository`, `internalThreadRepository.{insertMembers,findMessage,countUnreadByThreads}`, `taskRepository.listMemberUserIds` (проверка «текущий сотрудник»; другого такого метода нет, дубль не заводим), `internalThreadService.{postComment,editComment,deleteComment}`, `notificationService.{notifyChatMessage,markChatNotificationsRead}`, `resolveChatAttachments`, `canEditComment/canDeleteComment`, `formatCommentExcerpt`, `toInternalMessageView`, `db` из `@chatbotx.io/database/client`.

**Interfaces (produces):**
- `actor.ts`:
  ```ts
  /** Flows never write to staff chats. `isOwner` is ignored: ownership gives no chat powers (D5). */
  export type ChatActor = Exclude<TaskActor, { kind: "flow" }>
  /** `member` — личный вид сотрудника; `workspace` — полный вид (токен, сессия поддержки). */
  export type ChatScope = { kind: "member"; userId: string } | { kind: "workspace" }
  export const scopeForActor = (actor: ChatActor): ChatScope =>
    actor.kind === "user" ? { kind: "member", userId: actor.userId } : { kind: "workspace" }
  ```
- `direct-key.ts`:
  ```ts
  export const buildDirectKey = (firstUserId: string, secondUserId: string): string  // `<меньший>:<больший>`, числовое сравнение (compareNumericIds)
  export const buildAgentKey = (input: { userId: string; signature: string }): string // `agent:<userId>:token:<signature.trim()>`; пустая подпись → validationException("actorLabel", …)
  ```
- `view.ts`:
  ```ts
  export type ChatMemberView = { userId: string; removed: boolean }   // name добавляет слой API (Deviation 7)
  export type ChatView = {
    id: string
    type: ChatThreadType
    title: string | null
    members: ChatMemberView[]
    lastMessageAt: Date | null
    lastMessage: InternalMessageView | null
    unreadCount: number | null        // null в scope workspace
    peerLastReadAt: Date | null       // только direct и scope member
  }
  export const toChatView = (input: {
    thread: InternalThreadModel
    members: ChatMemberRow[]               // без `ChatMemberRow` импорта из репозитория — тип описать структурно
    currentMemberUserIds: Set<string>
    lastMessage: InternalMessageModel | null
    viewerUserId: string | null            // null → workspace-вид
    unreadCount: number | null
  }): ChatView
  ```
  `peerLastReadAt` = `lastReadAt` второго участника `direct`-чата (`null` для `agent`, для workspace-вида и если указателя нет). `removed = !currentMemberUserIds.has(userId)`.
- `chatService` (`class ChatService extends BaseService`; `export const chatService = new ChatService()`):
  ```ts
  type ChatMutationResult = { participantUserIds: string[] }           // для realtime на этапе 4

  open(input: { workspaceId: string; userIds: string[]; actorLabel?: string }):
    Promise<{ chat: ChatView; created: boolean }>
  get(input: { workspaceId: string; threadId: string; scope: ChatScope }): Promise<ChatView>
  list(input: { workspaceId: string; scope: ChatScope; participantUserId?: string; includeEmpty?: boolean; page: number; perPage: number }):
    Promise<{ data: ChatView[]; pageCount: number }>
  listMessages(input: { workspaceId: string; threadId: string; scope: ChatScope; beforeId?: string; afterId?: string; limit: number }):
    Promise<{ data: InternalMessageView[]; hasMore: boolean }>
  send(input: { workspaceId: string; threadId: string; text: string; attachments: { key: string; name: string }[]; actor: ChatActor }):
    Promise<{ message: InternalMessageView } & ChatMutationResult>
  edit(input: { workspaceId: string; threadId: string; messageId: string; text: string; actor: ChatActor; now?: Date }):
    Promise<{ message: InternalMessageView } & ChatMutationResult>
  delete(input: { workspaceId: string; threadId: string; messageId: string; actor: ChatActor; now?: Date }):
    Promise<{ message: InternalMessageView } & ChatMutationResult>
  markRead(input: { workspaceId: string; threadId: string; userId: string; upToMessageId?: string }):
    Promise<{ changed: boolean } & ChatMutationResult>
  countUnreadTotal(input: { workspaceId: string; userId: string }): Promise<number>
  ```
  Правила (из спеки 4.1–4.3, 8):
  - **open.** Валидация (все — `validationException`): пусто; > 2 id — «Group chats are not supported»; дубли; все `userIds` — реальные `WorkspaceMember` (`taskRepository.listMemberUserIds`); для одного id обязателен `actorLabel`. Ключ: 2 id → `type: "direct"`, `buildDirectKey`, `title: null`; 1 id → `type: "agent"`, `buildAgentKey({ userId, signature: actorLabel })`, `title = actorLabel.trim()`. Затем в `db.transaction` (**без** `isolationLevel` — нужен READ COMMITTED по умолчанию): `insertThreadIfAbsent` → если вернулась строка — `internalThreadRepository.insertMembers({ rows: userIds.map(...), tx })`, `created: true`; иначе `findThreadByDirectKey` в той же транзакции (повторное чтение видит коммит победителя) — `null` здесь означает, что чат успели удалить: `notFoundException("Chat not found")`. Результат — `ChatView` через общий сборщик (как `get`, `scope: workspace`-вид без `unreadCount`).
  - **Доступ (приватный `requireThread`).** `findThread` (только чат-типы, фильтр по workspace); для `member` — пользователь в `listMembers`, иначе `notFoundException("Chat not found")` (существование не раскрывается); `workspace` — любой чат пространства.
  - **list.** `perPage` ≤ `CHAT_LIMITS.maxPageSize`, иначе `validationException`. `member` → `participantUserId = scope.userId` (фильтр из входа игнорируется); `workspace` → `participantUserId` из входа. Затем `listThreads` → `listMembers` + `listLastMessages` + (только `member`) `internalThreadRepository.countUnreadByThreads` + `listMemberUserIds` по всем участникам → `toChatView`; `pageCount = ceil(total / perPage)`.
  - **listMessages.** `limit` ≤ `maxPageSize`; одновременно `beforeId` и `afterId` — `validationException`; курсор проверяется `internalThreadRepository.findMessage({ workspaceId, threadId, id })` (чужой/несуществующий — `validationException("cursor", …)`); доступ как `requireThread`; результат `toInternalMessageView`.
  - **send.** Порядок: проверка длины текста (`CHAT_LIMITS.maxMessageLength`) и «текст или вложения» → `requireThread` (scope из `scopeForActor`) → `listMembers` + `listMemberUserIds`: если **кто-то** из участников не текущий сотрудник — `validationException("threadId", "Chat participant is no longer in the workspace")` → `resolveChatAttachments` (**до** транзакции — сетевые вызовы не держат её) → `db.transaction`: `internalThreadService.postComment({ …, actor, recognizeMentions: false, tx })` и `chatRepository.touchLastMessageAt({ threadId, messageId: message.id, tx })` → **после коммита** `try { notificationService.notifyChatMessage({ workspaceId, threadId, participantUserIds, actor, excerpt: formatCommentExcerpt(text), messageId: message.id, messageAt: message.createdAt }) } catch (err) { logger.error({ err, threadId }, "Failed to notify about chat message") }` (импорт `logger` из `../logger`). Возвращает `{ message, participantUserIds }`.
  - **edit / delete.** `requireThread`; `internalThreadRepository.findMessage({ workspaceId, threadId, id })` (нет / `kind !== "comment"` / удалено → `notFoundException("Message not found")`); **предпроверка прав**: `canEditComment({ message, actor, now })` / `canDeleteComment({ message, actor, isOwner: false, now })`; не прошла — для `user`-актора чужого сообщения или токена чужой подписи → `chatForbiddenException()` (403, `new ChatbotXException("You are not allowed to change this message", "FORBIDDEN", 403)` — в `chat/service.ts` или отдельном `errors.ts`, не `taskForbiddenException`), для своего, но просроченного — `validationException("message", "Message can no longer be edited|deleted")`. Затем `internalThreadService.editComment({ …, recognizeMentions: false })` / `deleteComment({ …, isOwner: false })`. `lastMessageAt` при удалении **не откатывается**. Длина текста проверяется и при `edit`.
  - **markRead.** Нет чата, чат не того типа, пользователь не участник → `{ changed: false, participantUserIds: [] }` (no-op, без ошибки). Иначе в `db.transaction`: `chatRepository.advanceReadPointer({ workspaceId, threadId, userId, upToMessageId, tx })` → **всегда** `notificationService.markChatNotificationsRead({ workspaceId, userId, threadId, tx })` (закрывает и «застрявшую» запись). `participantUserIds` — только если `changed`, иначе `[]` (realtime публикуется только при сдвиге). Неизвестный `upToMessageId` — репозиторий вернёт `false`: no-op.
  - **countUnreadTotal** → `chatRepository.countUnreadTotal`.
- `index.ts`: `export * from "./actor" "./direct-key" "./service" "./view"`. Перед экспортом: `rg -n "ChatView|ChatScope|ChatActor|ChatMemberView|buildDirectKey|buildAgentKey|scopeForActor|chatService" packages apps --glob '!**/node_modules/**' --glob '!**/__tests__/**'` — коллизий нет (на момент плана их нет).

**Steps:**
- [ ] **Step 1: failing tests.** Моки (общий каркас — `__tests__/task/task-reassign.test.ts:1-40`): `@chatbotx.io/database/client` → `{ db: { transaction: async (fn) => fn(txSentinel) } }` (`txSentinel` — уникальный объект, чтобы проверять, что **тот же** `tx` передан в репозитории/сервисы); `@chatbotx.io/database/repositories` → `{ chatRepository, internalThreadRepository, taskRepository }`; `@chatbotx.io/redis`, `../../src/audit/dispatcher` — как в образце; `../../src/internal-thread/service` → `{ internalThreadService: { postComment, editComment, deleteComment } }`; `../../src/internal-thread/attachments` → `resolveChatAttachments`; `../../src/notification/service` → `{ notificationService: { notifyChatMessage, markChatNotificationsRead } }`, `formatCommentExcerpt: (t) => t`.
  - `direct-key.test.ts`: `buildDirectKey("9","10") === "9:10"` и `("10","9")` то же; не лексикографически; `buildAgentKey({ userId: "5", signature: " Hermes " }) === "agent:5:token:Hermes"`; пустая подпись → `validation`.
  - `service-open.test.ts`: создание `direct` (два участника, `created: true`, `insertMembers` ровно один раз с обеими строками, `tx` — sentinel); повтор с порядком пары наоборот → тот же ключ, `insertMembers` не вызывается, `created: false`; `agent` (один id + подпись): `type: "agent"`, `title`, ключ с `token:`; два разных токена одному сотруднику → разные ключи; не сотрудник / дубль / пусто / три id / чат с самим собой (`[a, a]`) / один id без подписи → `validation`; чат удалили между `ON CONFLICT` и перечиткой → `notFound`; **гонка:** репозиторий в памяти, моделирующий уникальный индекс (`insertThreadIfAbsent`: `await Promise.resolve()`, затем «ключ занят → `null`, иначе запись»; `findThreadByDirectKey` читает карту; `insertMembers` складывает строки), `Promise.all` из 10 вызовов `open` с парами в разном порядке → ровно **один** тред и **две** строки участников, у всех вызовов один `chat.id`, `created: true` ровно у одного.
  - `service-messages.test.ts`: `send` — порядок (вложения разрешены до `db.transaction`; `postComment` с `recognizeMentions: false` и `tx`; `touchLastMessageAt` с тем же `tx` и `messageId`; уведомление после транзакции с `participantUserIds`, `excerpt`, `messageAt`); возвращает `participantUserIds`; чужой чат для `member` → `notFound`; токен (`api`) пишет в любой чат; участник чата удалён из пространства → `validation` и **ничего** не записано; пустой текст без вложений / текст длиннее `10000` → `validation`; отказ `notifyChatMessage` не бросает наружу и пишет `logger.error({ err, … })` (мок `../../src/logger`, проверить ключ `err`); сообщение не из чата (тред-задача) → `notFound`. `edit`/`delete` — матрица прав: автор < 24 ч — можно; автор > 24 ч — `validation`; **владелец пространства** (`isOwner: true`) чужое удалить не может → 403 (D5); чужое сообщение сотрудника → 403; токен правит только сообщение со своей подписью (`authorUserId: null`, тот же `authorLabel`) и удаляет любое; сообщение другого чата → `notFound`; `delete` не вызывает `touchLastMessageAt`; `edit` передаёт `recognizeMentions: false`. `listMessages` — одновременные `beforeId`+`afterId` → `validation`, чужой курсор → `validation`, лимит > 50 → `validation`, возвращает `hasMore`; `get`/`list` — `member` не видит чужой чат, `workspace` видит; `perPage > 50` → `validation`.
  - `service-read.test.ts`: `markRead` — `changed: true` → `participantUserIds` заполнен, `markChatNotificationsRead` вызван с тем же `tx`; `changed: false` → `participantUserIds: []`, уведомления **всё равно** закрываются; не участник/нет чата → `{ changed: false, participantUserIds: [] }` и **ни одного** вызова репозитория записи; `upToMessageId` пробрасывается; `list` (member) — `unreadCount` из `countUnreadByThreads`, `peerLastReadAt` второго участника `direct`, `null` для `agent`; `list` (workspace) — `unreadCount: null`, `peerLastReadAt: null`; `removed: true` у участника, которого нет в `listMemberUserIds`; пустые чаты скрыты по умолчанию (`includeEmpty: false` пробрасывается как есть); `countUnreadTotal` делегирует.
  - `import-boundaries.test.ts` (среда node, `node:fs`): прочитать исходники `src/chat/**`, `src/internal-thread/**`, `src/task/**`, `src/notification/**` и убедиться, что **ни одна** строка `from "…"`/`import("…")` не содержит `platform/settings`, `platform/realtime-broadcast`, `workspace/service`, `workspace-member/service`, и что файлы `src/notification/**`, `src/internal-thread/**` не импортируют `../chat`. (Лёгкий статический тест вместо `madge`, который запрещено запускать локально.)
- [ ] **Step 2:** реализация; каждый новый файл тестов + `__tests__/chat/*` из Task 3 + `__tests__/task/{task-reassign,internal-thread-stage3,task-service}.test.ts` и `__tests__/notification/service.test.ts` — по одному, зелёные. `npx ultracite fix` по изменённым файлам.
- [ ] **Step 3: CI.** В `.github/workflows/gkamion-checks.yml` (шаг `packages/database`, перечень на строках ~99–106) добавить `__tests__/staff-chat-schema.test.ts __tests__/chat-repository.test.ts __tests__/notification-chat-repository.test.ts __tests__/internal-thread-repository.test.ts`; в шаг `packages/business` (строки ~113–125) — `__tests__/chat`. (`__tests__/task` и `__tests__/notification` там уже целыми каталогами.) Файл правит только эта задача.
- [ ] **Step 4: Commit** (явные пути): `feat(business): staff chat service with open, messages and read state`.

---

## After all tasks

- [ ] Контролёр по диффу: нет `console`, нет `db` из `@chatbotx.io/database/client` вне `packages/business`, `err` в логах, нет динамических `import()`, `git status` без чужих файлов (`ru.json`, `ru-glossary.md`, `apps/builder/AGENTS.md` не затронуты), новые тест-файлы в workflow.
- [ ] Диспетчеризация `invariant-guard` (haiku) по диффу этапа; финальное ревью (opus): SQL указателей и склейки, порядок «сообщение → `lastMessageAt` → уведомление после коммита», типы расширенного `Notification` и совместимость с builder.
- [ ] **После явного «да» пользователя** контролёр применяет миграцию (`pnpm --filter @chatbotx.io/database db:migrate`) и запускает `pnpm --filter @chatbotx.io/database test:db` (включая `staff-chat-schema`), затем при желании разовый smoke конкуренции **вне репозитория** (скрипт во временной схеме/БД, не в проде): 20 параллельных `open` по одной паре → 1 строка `InternalThread` и 2 участника; 20 параллельных `upsertChatMessages` для одного получателя → 1 непрочитанная запись `count = 20`; параллельные `touchLastMessageAt` → `lastMessageAt` = максимум.
- [ ] Типы и линт — только в CI (`pnpm lint`, `check-types` по пакетам). Деплой этапа безопасен без UI: ни одной точки входа, миграция аддитивна; откат кода не требует отката миграции.
- [ ] Спеку/доки на этом этапе не трогаем (документ `docs/staff-chat.md` — этап 2).

## Risks / open points

1. **Конкуренция проверена косвенно** (Deviation 10): настоящий `Promise.all` по БД возможен только после применения миграции и только вне репозитория.
2. **`createdAt` сообщения = начало транзакции (`now()`).** Если отправитель A начал транзакцию раньше, но закоммитил позже сообщения B, читатель, увидевший только B, сдвинет указатель за `createdAt` сообщения A, и A останется «прочитанным». Окно — миллисекунды (транзакция `send` короткая), последствие — пропущенный бейдж до следующего сообщения. Полное закрытие — advisory-lock на тред и `clock_timestamp()` в `createdAt` (потребует поля `createdAt` в `commentRow`); в этап 1 не включено. Тот же недостаток уже есть у `markRead` задач.
3. **Расширение `Notification` в TS.** Главная опасность — CI-типы builder. Сделано так, чтобы builder не менялся (Deviation 6); если CI всё же покажет ошибки, правка локальна: `features/notifications/api/private.ts` и `schema/resource.ts`.
4. **`taskRepository.listMemberUserIds` как «справочник сотрудников»** — исторически лежит в репозитории задач; чат использует его, чтобы не плодить дубль. Переезд в `workspaceMemberRepository` — отдельный рефакторинг.

## Self-review

- Все пункты области этапа 1 (миграция, типы, репозиторий, сервис, вложения, `deleteMembersForUser`, `CHAT_LIMITS`, склейка уведомлений, тесты §9) распределены по задачам; не вошедшее (API, UI, realtime, маршрут медиа, `findAttachment`) прямо названо в Deviations и в таблице «Spec §9 → задачи».
- Имена согласованы между задачами: `chatRepository.*` (Task 2) ↔ `chatService` (Task 4); `notificationRepository.upsertChatMessages / markChatReadUpToPointer` (Task 2) ↔ `notificationService.notifyChatMessage / markChatNotificationsRead` (Task 3) ↔ `chatService.send / markRead` (Task 4); `participantUserIds` едины; `recognizeMentions` (Task 3) ↔ Task 4; `compareNumericIds` (Task 1) используют Task 2 и Task 4.
- Плейсхолдеров нет; каждое ограничение пользователя (VPS, `db:migrate` запрещён, точечный стейджинг, чужие файлы, `{ err }`, динамические импорты, циклы) повторено в Global Constraints и в соответствующей задаче.
