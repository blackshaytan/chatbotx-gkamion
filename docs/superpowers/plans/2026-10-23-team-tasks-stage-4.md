# Team Tasks — Stage 4 (notification center, reminders, overdue) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** сотрудник узнаёт о событиях в задачах без поиска: колокольчик в боковом меню со счётчиком и списком, уведомления приходят без перезагрузки и только адресату, напоминания и просрочки приходят сами, каждый тип можно выключить в личных настройках.

**Architecture:** таблица `Notification` → чистый расчёт получателей (`packages/business/src/notification/recipients.ts`) → `notificationService` (только репозитории; создаёт строки с учётом настроек и членства, сообщает созданных получателей слушателю) ← вызывается из `taskService` (create/update/take/complete/addComment/updateComment) и из сканера `taskDueScan` в worker. Адресное realtime-событие `notificationCreated` шлёт слушатель, который регистрирует приложение (builder — в `features/notifications/lib/notification-realtime.ts`, worker — при старте) через `sendToWorkspaceMember`. Интерфейс: колокольчик (popover) + диалог «Уведомления» в меню профиля, всё через приватный oRPC.

**Tech Stack:** Drizzle, oRPC (private), BullMQ scheduler, partysocket (user-targeted), TanStack Query, vitest.

**Spec:** `docs/superpowers/specs/2026-10-17-team-tasks-design.md` (3.3, 4.3, 5, 6; этап 4 из раздела 10). Этапы 1–3: `docs/superpowers/plans/2026-10-23-team-tasks-stage-{1,2,3}.md`. Факты по коду: `.superpowers/sdd/stage4-explore.md`.

---

## Global Constraints

- Те же, что на этапах 1–3 (`.superpowers/sdd/tasks-constraints.md`).
- **Миграция одна** (`Notification`). Сгенерировать `make:migration team_task_notifications`, показать SQL, **не применять** — применяет контроллер после «да» пользователя. `db:check-drift` должен быть чистым.
- **Круг импорта:** `packages/business/src/task/**`, `internal-thread/**` и новый `notification/**` не импортируют `platform/settings`, `platform/realtime-broadcast`, `workspace/service`, `workspace-member/service`. `notification/**` использует только репозитории и `@chatbotx.io/utils`; `task/service` может импортировать `notification/service`.
- Цепочка `handler → service → repository → DB`. i18n во всех 22 файлах (+ `ru-same-as-english.json`). TS только в CI (ловушки — в плане этапа 3). Новые тесты — в `.github/workflows/gkamion-checks.yml`.
- Worker: `{ err }` в логах, без динамических `import()`, сканер под `distributedLock.runExclusive`, `withBlockedOwnerGuard` на каждое пространство.

## Deviations from the spec (decided while planning)

1. **Колокольчик в боковом меню** (верхней панели в интерфейсе нет): над меню профиля в `app-sidebar.tsx`, в свёрнутом меню — иконка со счётчиком.
2. **Только центр уведомлений.** Очередь `notificationDispatch`, склейка за 60 с, push и MAX — этапы 5–6. Канал `max` в `notificationChannels` не добавляем сейчас.
3. **Типы уведомлений:** `taskAssigned`, `taskMentioned`, `taskCommented`, `taskStatusChanged`, `taskDueChanged`, `taskReminder`, `taskOverdue` (в спеке `taskDueChanged` был внутри `taskStatusChanged` — разделяем, чтобы выключать отдельно). Хранятся в `WorkspaceMember.notificationTypes` рядом со старыми ключами; **нет ключа = включено**; выключенный тип не создаётся вовсе (центр — единственный канал).
4. **Одно уведомление на человека за действие**, приоритет: `taskMentioned` > `taskAssigned` > `taskStatusChanged` > `taskDueChanged` > `taskCommented`. Автор действия (`actorUserId`) не получает ничего; действия API/сценария (`actorUserId = null`) получают все. Получатели фильтруются по текущим участникам пространства.
5. **Удаление задачи** удаляет её уведомления. **Перевод задач на владельца** при удалении сотрудника уведомлений не создаёт (как и realtime на этапе 3).
6. **Хранение:** раз в сутки удаляются уведомления старше 90 дней.
7. **Публичного API нет** — личный центр уведомлений и личные настройки (исключение инварианта 23, записано в спеке раздел 6).

## File map

**Create**
- `packages/database/src/schema/notification.ts` (+ экспорт в `schema/index.ts`), `packages/database/src/relations/notification.ts` (+ **две** правки `relations/index.ts`), миграция `packages/database/drizzle/<ts>_team_task_notifications/`.
- `packages/database/src/repositories/notification/repository.ts` (+ экспорт).
- `packages/business/src/notification/{recipients.ts,service.ts,listeners.ts,preferences.ts,index.ts}` (+ экспорт из `packages/business/src/index.ts`).
- `packages/worker-config/src/queues/schedule/index.ts` (+ `taskDueScan`, `purgeOldNotifications`).
- `apps/worker/src/schedule/handlers/{task-due-scan.ts,purge-old-notifications.ts}`, регистрация в `register-schedules.ts` и в роутере обработчиков schedule-worker; `apps/worker/src/lib/notification-realtime.ts` (слушатель).
- `apps/builder/src/features/notifications/{api/private.ts,schema/*.ts,lib/notification-realtime.ts,hooks/use-invalidate-notifications.ts,components/notification-bell.tsx,components/notification-list.tsx,components/notification-settings-dialog.tsx,components/notifications-realtime-sync.tsx}`.
- Тесты: `packages/business/__tests__/notification/{recipients,service,preferences}.test.ts`, `packages/business/__tests__/task/task-notifications.test.ts`, `apps/worker/__tests__/task-due-scan.test.ts`, `apps/builder/__tests__/notifications-private-api.test.ts`.

**Modify**
- `packages/database/src/repositories/task/repository.ts` — `claimDueReminders` / `claimOverdue` (условный `UPDATE … WHERE … IS NULL RETURNING`), `packages/database/src/partials/workspace.ts` (типы задач в `notificationTypes`, все необязательные).
- `packages/business/src/task/service.ts` (вызовы `notificationService`, удаление уведомлений в `delete`).
- `packages/partysocket-config/src/schemas.ts` (событие `notificationCreated { notificationId }`, топик `notifications`, тест реестра).
- `apps/builder/src/routers/index.ts`, `apps/builder/src/components/{app-sidebar.tsx,nav-user.tsx,workspace-realtime-shell.tsx}`.
- `apps/builder/messages/*.json`, `apps/builder/__tests__/fixtures/ru-same-as-english.json`.
- `docs/tasks.md`, `docs/superpowers/specs/2026-10-17-team-tasks-design.md` (отметка об исключении API уже есть — проверить), `.github/workflows/gkamion-checks.yml`.

## Models (cost/quality)

| Работа | Модель |
|---|---|
| Задача 1 (таблица, сервисы) | composer-2.5-fast |
| Задача 2 (worker-сканер, слушатели) | composer-2.5-fast |
| Задача 3 (приватный API + интерфейс) | gpt-5.6-terra-medium |
| Задача 4 (документация, CI) | composer-2.5-fast |
| Ревью задач | контроллер по диффу; при сомнениях — gpt-5.6-terra-medium |
| invariant-guard | claude-haiku-5-5-thinking-high |
| Финальное ревью (типы, адресность, дубли) | claude-opus-5-5-medium |

---

### Task 1: Notification table and services

**Interfaces (produces):**
- `notificationModel` (`"Notification"`): `...sharedColumns` (id bigint, createdAt, updatedAt — как у `TaskWatcher`), `workspaceId` (FK Workspace, cascade), `userId` (FK User, cascade), `type` text (`taskNotificationTypes` enum в partials), `entityType` text (`"task"`), `entityId` bigint-as-string, `payload` jsonb `NotificationPayload` **без `.default()`** — всегда пишется явно, `readAt` timestamp null. Индексы: (`userId`, `workspaceId`, `readAt`, `createdAt`), (`workspaceId`, `entityType`, `entityId`), (`createdAt`).
- `NotificationPayload = { taskTitle: string; actorUserId: string | null; actorLabel: string | null; excerpt: string | null; from?: string | null; to?: string | null }` (`excerpt` — до 200 символов комментария, токены упоминаний заменены на `@Имя` через `splitInternalMentionText`).
- `notificationRepository`: `insertMany({ rows, tx })` → строки; `listForUser({ workspaceId, userId, limit, unreadOnly? })` (новые сверху); `countUnread({ workspaceId, userId })`; `markRead({ workspaceId, userId, ids? })` (без `ids` — все); `deleteByEntity({ workspaceId, entityType, entityId, tx })`; `deleteOlderThan({ before, limit })` → число.
- `recipients.ts` (чистые функции, без БД): `resolveTaskNotificationRecipients(input): Map<userId, NotificationType>` — по Deviation 4; на вход: `actorUserId`, список событий действия (`assigned { userIds }`, `mentioned { userIds }`, `commented`, `statusChanged`, `dueChanged`), `watcherUserIds`, `memberUserIds` (фильтр).
- `preferences.ts`: `isTaskNotificationEnabled(notificationTypes, type)` (нет ключа → `true`), `readTaskNotificationPreferences(notificationTypes)` → все 7 значений.
- `notificationService`:
  - `notifyTask({ workspaceId, task: { id, title, assigneeUserId, assigneeTeamId, createdByUserId }, actor, events, excerpt?, from?, to?, tx? })` — раскрывает команды через `inboxTeamMemberRepository.listUserIdsByTeamId`, наблюдателей через репозиторий задач, участников и их `notificationTypes` — через репозиторий участников (один запрос по списку), считает получателей, вставляет строки, затем **после** вставки зовёт слушателей `emitNotificationsCreated({ workspaceId, notifications: { id, userId }[] })`. Ошибка уведомлений не ломает основное действие: внешний `try/catch` с `logger.error({ err }, …)`.
  - `onNotificationsCreated(listener)` (в `listeners.ts`, без импортов; повторная регистрация того же слушателя — без дубля) .
  - `listForUser`, `countUnread`, `markRead`, `markAllRead`, `getPreferences({ workspaceId, userId })`, `updatePreferences({ workspaceId, userId, patch })` (сливает с существующим `notificationTypes`, старые ключи не теряет), `deleteForTask`, `purgeOlderThan`.
- `taskService`: после успешного действия (после транзакции) зовёт `notificationService.notifyTask`:
  - `create` → `assigned` (ответственный или участники команды);
  - `update`/`take`/`complete` → по `buildTaskChangeEvents`: смена ответственного → `assigned` новому; статус → `statusChanged` (`from`/`to`); срок → `dueChanged`;
  - `addComment` → `mentioned` (упомянутые сотрудники + участники упомянутых команд) и `commented`; `updateComment` → только **новые** упоминания (`mentioned`);
  - `delete` → `notificationService.deleteForTask` в той же транзакции.
- Тесты: получатели для каждого события; автор исключён; API-актор (`null`) — все получают; дубль «упомянут + комментарий» → одно `taskMentioned`; команда раскрывается; не участник пространства отфильтрован; выключенный тип не создаётся; нет ключа → создаётся; `updatePreferences` не теряет старые ключи; слушатель получает созданные строки; ошибка уведомлений не ломает `addComment`; `delete` удаляет уведомления.

- [ ] **Step 1:** схема, связи (две правки), репозиторий; `make:migration team_task_notifications`; `db:check-drift` чистый. SQL миграции — в отчёт.
- [ ] **Step 2:** failing tests → реализация → pass (+ старые файлы `__tests__/task` по одному, `--pool=forks --maxWorkers=1`).
- [ ] **Step 3:** ultracite. **Commit** `feat(tasks): notification table and task notification service`. **Не применять миграцию.**

---

### Task 2: Reminders, overdue, retention and realtime delivery

**Interfaces (produces):**
- `taskRepository.claimDueReminders({ now, limit })` → `UPDATE "Task" SET "remindedAt" = now WHERE id IN (SELECT id … WHERE status IN ('todo','in_progress') AND "remindAt" <= now AND "remindedAt" IS NULL ORDER BY "remindAt" LIMIT n FOR UPDATE SKIP LOCKED) RETURNING …`; `claimOverdue` — то же по `dueAt`/`overdueNotifiedAt`. Возвращают поля, нужные `notifyTask`.
- `notificationService.notifyTaskReminder(task)` / `notifyTaskOverdue(task)` — события `reminder` (ответственный/команда) и `overdue` (ответственный/команда + автор); актор — `null` (система).
- `ScheduleJobData.taskDueScan` (`* * * * *`) и `ScheduleJobData.purgeOldNotifications` (`0 4 * * *`).
- `task-due-scan.ts`: `distributedLock.runExclusive({ key: "schedule:task-due-scan" })`; пачки по 200 до пустого результата (не больше 10 пачек за запуск); на каждую задачу `withBlockedOwnerGuard(task.workspaceId, …)`. Замечание: флаг ставится до проверки блокировки — для заблокированного пространства уведомление потеряется; это допустимо (как `blockedOwner` в рассылках), записать в docs.
- `purge-old-notifications.ts`: `purgeOlderThan(now − 90 дней)` пачками по 5000.
- `apps/worker/src/lib/notification-realtime.ts` и `apps/builder/src/features/notifications/lib/notification-realtime.ts`: `registerNotificationRealtime()` → `onNotificationsCreated(({ workspaceId, notifications }) => notifications.forEach(n => sendToWorkspaceMember({ workspaceId, userId: n.userId }, { eventType: notificationCreated, data: { notificationId: n.id } }).catch(err => logger.warn({ err }, …))))`. Worker регистрирует при старте; builder — при загрузке модуля, который импортируют обработчики задач (`features/tasks/api/{public,private}.ts`) и уведомлений.
- `packages/partysocket-config/src/schemas.ts`: `notificationCreated { notificationId: string }`, ephemeral, топик `notifications`; обновить тест реестра.
- Тесты: сканер — напоминание и просрочка уходят один раз при двух запусках подряд; задача `done` не берётся; заблокированное пространство пропускается; перенос срока снова даёт уведомление (через сброс флага из этапа 1); purge; слушатель зовёт `sendToWorkspaceMember` на каждого получателя.

- [ ] Implement, tests pass, ultracite. **Commit** `feat(tasks): task reminder and overdue scan with realtime notification delivery`.

---

### Task 3: Private API and UI — bell, list, settings

- [ ] **Приватный API** `notificationsAPI` (`features/notifications/api/private.ts`, `authorized` + `workspaceAuthorizedMidddleware`, вписать в `routers/index.ts`): `list` (GET `/workspaces/{workspaceId}/notifications`, `limit` ≤ 50, `unreadOnly?`) → `{ data: NotificationItem[] }` с `url` задачи (`withTaskUrl`-подобно через `lib/task-url.ts`), `countUnread` → `{ total }`, `markRead` (POST, `{ ids: string[] }` ≤ 50, 204), `markAllRead` (POST, 204), `getPreferences` / `updatePreferences` (7 булевых). Везде `userId = context.user.id`. Тест обработчиков (свой пользователь, чужое пространство не видно).
- [ ] **Колокольчик** (`notification-bell.tsx`) в `app-sidebar.tsx` над `NavUser` (как пункт меню, иконка `BellIcon`, бейдж 99+, `aria-label` с числом): `Popover` со списком (`notification-list.tsx`): иконка типа, текст по типу из i18n («Вас упомянули в задаче «…»», «Вам назначена задача …», «Новый комментарий …», «Статус: A → B», «Срок изменён», «Напоминание …», «Просрочена …») + имя автора (из справочника участников по `actorUserId`, иначе `actorLabel`) + выдержка + относительное время; непрочитанные выделены; клик → `markRead([id])` и переход по `url` (Next `router.push`, закрыть popover); кнопка «Прочитать всё»; пусто — «Уведомлений нет». Мутации → `useInvalidateNotifications`.
- [ ] **Realtime** (`notifications-realtime-sync.tsx` в `workspace-realtime-shell.tsx`): `notificationCreated` → инвалидировать `orpc.notificationsAPI.key()` (объединение 300 мс).
- [ ] **Настройки** (`notification-settings-dialog.tsx`): пункт «Уведомления» в выпадающем меню `nav-user.tsx` (раскомментированное место с `Bell`); 7 переключателей (`Switch` из `@chatbotx.io/ui`) с подписями и короткими пояснениями; сохранение сразу при переключении (оптимистично, откат с тостом при ошибке); пометка «Пока уведомления видны только в колокольчике; push и MAX — позже».
- [ ] i18n (все 22 файла), i18n-тесты, ultracite. **Commit** `feat(tasks): notification bell, list and settings`.

---

### Task 4: Docs and CI

- [ ] `docs/tasks.md`: раздел «Уведомления» — типы, получатели, правило «одно за действие», автор не получает, настройки (нет ключа = включено), напоминания/просрочки (сканер раз в минуту, ровно один раз, сброс при переносе, заблокированные пространства), хранение 90 дней, realtime `notificationCreated` адресно, без публичного API (причина); «Не сделано»: push (этап 5), MAX (этап 6), склейка.
- [ ] `.github/workflows/gkamion-checks.yml`: новые тесты (business, worker, builder).
- [ ] **Commit** `docs(tasks): stage 4 notifications`.

---

## After all tasks

1. invariant-guard (haiku), финальное ревью (opus), исправления.
2. Push → зелёный `gkamion-checks.yml`.
3. Показать SQL миграции → **«да» пользователя** → `db:migrate` на проде (как раньше, через контейнер/скрипт, использованный на этапе 1).
4. Образы `builder,worker,realtime` → `bash deploy/gkamion/up.sh builder worker realtime`.
5. Проверка на проде: задача от Hermes на сотрудника → уведомление «назначена» в колокольчике без перезагрузки; комментарий с упоминанием команды → участники получили; свой комментарий не уведомляет себя; напоминание через 2 минуты приходит один раз; выключенный тип не приходит; «Прочитать всё».
6. Навык Hermes: упомянуть, что люди получают уведомления в колокольчике.

## Self-review

- Спека 3.3 ✓ (`Notification`), 4.3 получатели ✓, автор исключён ✓, без дубля «упомянут + прокомментировал» ✓, `taskDueScan` ровно один раз ✓, `withBlockedOwnerGuard` ✓, настройки ✓ (Deviation 3), склейка и каналы — этапы 5–6 (Deviation 2). Раздел 5: колокольчик ✓ (Deviation 1), «Прочитать всё» ✓, клик — переход и прочитано ✓, `useInvalidateNotifications` ✓. Раздел 6: без публичного API ✓.
- Одна миграция, применяется только после «да».
