# Team Tasks — Stage 2 (task UI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** сотрудники работают с задачами в интерфейсе: страница «Задачи» с вкладками и фильтрами, карточка задачи с лентой комментариев, диалог создания, блок «Задачи» в панели контакта, значок с числом открытых задач в заголовке диалога, счётчик просроченных в боковом меню. Всё, что делает интерфейс, доступно и через публичный API.

**Architecture:** дополнения в `taskRepository`/`taskService` (взять себе, фильтр «мои команды», счётчик, проверка сообщения, имя контакта в связях, ссылка `url`) → публичные `tasks.take` и `tasks.count` → приватный роутер `tasksAPI` (сессия сотрудника, те же схемы и те же методы сервиса) → клиентские компоненты на TanStack Query (`orpc.tasksAPI.*`).

**Tech Stack:** oRPC, zod 4, TanStack Query, nuqs, react-hook-form, shadcn/ui из `@chatbotx.io/ui`, next-intl, vitest.

**Spec:** `docs/superpowers/specs/2026-10-17-team-tasks-design.md` (разделы 4.1, 5, 6; этап 2 из раздела 10). Этап 1: `docs/superpowers/plans/2026-10-23-team-tasks-stage-1.md`.

---

## Global Constraints

- Те же, что на этапе 1 (`.superpowers/sdd/tasks-constraints.md`): локально только `pnpm exec ultracite check <files>` и точечные `vitest run <files>`; `check-types` и полные тесты — в GitHub CI (`gkamion-checks.yml`); без печати секретов; `git add <конкретные пути>`; не трогать `apps/builder/AGENTS.md`; `{ err }` в логах; без динамических `import()` вне builder.
- **Миграций на этом этапе нет.** Если исполнитель решит, что нужна, — остановиться и спросить.
- Цепочка `handler → service → repository → DB` (инвариант 9). Публичная и приватная процедуры одного действия вызывают **один и тот же** метод сервиса; права сессии (`accessScope`, actor) вычисляет только слой приложения.
- i18n: все строки через `useTranslations()`; новый раздел `tasks` в `en.json` (английский) и `ru.json` (русский), в остальных 20 файлах — английская копия. Тест полноты каталогов (`az`, `en`, `ru`, `vi` — тот же набор ключей, что в `en`). Совпадающие с английским строки в `ru` — в `apps/builder/__tests__/fixtures/ru-same-as-english.json`.
- Каждая мутация вызывает `useInvalidateTasks()` (инвариант 21) до `router.push`.
- Правила builder: `const` + тип вместо `function` для новых хелперов и обработчиков, обработчики `handleX`, Tailwind, `aria-label` на иконках-кнопках, ранние `return`.
- Пробный период истёк: GET/DELETE работают, создание и изменение — нет (это уже делает `workspaceAuthorizedMidddleware` для POST/PATCH).
- Новые тестовые файлы добавить в список тестов `.github/workflows/gkamion-checks.yml`.

## Deviations from the spec (decided while planning)

1. **Непрочитанные комментарии, `@упоминания`, вложения и realtime — этап 3.** В строке задачи нет счётчика непрочитанных; в ленте простое текстовое поле. Список обновляется после мутаций (инвалидация), без живых обновлений.
2. **«Создать задачу» из меню сообщения клиента — этап 7** (как в спеке). Но проверка `messageId` (сообщение принадлежит диалогу) делается сейчас — она нужна API уже сегодня.
3. **Вкладки — это фильтры.** «Мои» = `assigneeUserId`, «Поставленные мной» = `createdByUserId`, «Наблюдаю» = `watcherUserId`, «Мои команды» = новый фильтр `teamMemberUserId` (задачи на команды, где состоит сотрудник), «Все» — без фильтра. Приватный API принимает `tab` и подставляет id текущего сотрудника; публичный — те же фильтры явно.
4. **`tasks.take` в публичном API принимает `userId`** — какой сотрудник берёт задачу (у токена нет «себя»). Сотрудник должен состоять в команде-ответственном. В интерфейсе `userId` — текущий сотрудник.
5. **Счётчики — отдельная операция `tasks.count`** (те же фильтры, ответ `{ total }`). Её используют меню (мои просроченные) и заголовок диалога (открытые по диалогу); агенту она тоже доступна.
6. **Связи показывают имя контакта:** в связи типа `contact` новое поле `label` (`Contact.fullName`), `null`, если скрыто. Без доступа к контактам (`buildContactPermissionScope` → `null`) все связи скрыты, а задачи видны.
7. **Карточка — боковая панель по параметру `?task=<id>`** на странице «Задачи» и та же карточка на прямой странице `/space/[workspaceId]/tasks/[taskId]`; `url` в ответе API ведёт на прямую страницу (адрес из `resolveTenantSettings().appUrl`, как у `botSimulator.getLink`).
8. **Пункт меню «Задачи» виден всем сотрудникам** (у задач нет отдельного права), счётчик — «мои открытые просроченные».

## File map

**Create**
- `apps/builder/src/features/tasks/api/private.ts` — `tasksAuthenticatedAPI`.
- `apps/builder/src/features/tasks/lib/session.ts` — `sessionTaskActor`, `sessionTaskAccessScope`, `tabToFilter`.
- `apps/builder/src/features/tasks/hooks/use-invalidate-tasks.ts`.
- `apps/builder/src/features/tasks/lib/reminder-presets.ts`.
- `apps/builder/src/features/tasks/components/` — `task-status-select.tsx`, `task-priority-badge.tsx`, `task-due-label.tsx`, `task-assignee-label.tsx`, `create-task-dialog.tsx`, `tasks-table.tsx`, `tasks-page.tsx`, `task-details.tsx`, `task-feed.tsx`, `task-sheet.tsx`, `contact-tasks-section.tsx`, `conversation-tasks-badge.tsx`.
- `apps/builder/src/app/space/[workspaceId]/tasks/page.tsx`, `.../tasks/[taskId]/page.tsx`.
- Тесты: `packages/business/__tests__/task/task-service-stage2.test.ts`, `packages/database/__tests__/task-list-where.test.ts` (дополнить), `apps/builder/__tests__/tasks-private-api.test.ts`, `apps/builder/__tests__/tasks-session.test.ts`, `apps/builder/__tests__/tasks-reminder-presets.test.ts`.

**Modify**
- `packages/database/src/repositories/task/{list-where.ts,repository.ts}`.
- `packages/business/src/task/{service.ts,view.ts,index.ts}`.
- `apps/builder/src/features/tasks/{schema/public.ts,api/public.ts}`, `apps/builder/__tests__/tasks-public-api.test.ts`, `apps/builder/__tests__/__snapshots__/public-spec-operations.test.ts.snap`.
- `apps/builder/src/routers/index.ts` (`tasksAPI`).
- `apps/builder/src/components/{nav-main.tsx,app-sidebar.tsx}`.
- `apps/builder/src/features/contacts/contact-inbox-panel.tsx`, `apps/builder/src/features/messages/message-head.tsx`.
- `apps/builder/messages/*.json` (22), `apps/builder/__tests__/fixtures/ru-same-as-english.json`.
- `docs/tasks.md`, `apps/cli/README.md`, `apps/mcp-server/README.md`, `.github/workflows/gkamion-checks.yml`.

## Models (cost/quality)

| Работа | Модель |
|---|---|
| Задачи 1–2 (бэкенд по готовому коду) | composer-2.5-fast |
| Задачи 3–6 (интерфейс) | gpt-5.6-terra-medium |
| Задача 7 (документация) | composer-2.5-fast |
| Ревью каждой задачи | gpt-5.6-terra-medium |
| invariant-guard | claude-haiku-5-5-thinking-high |
| Финальное ревью | claude-opus-5-5-medium |

---

### Task 1: Repository and service additions

**Files:**
- Modify: `packages/database/src/repositories/task/list-where.ts`, `packages/database/src/repositories/task/repository.ts`, `packages/business/src/task/service.ts`, `packages/business/src/task/view.ts`, `packages/business/src/task/index.ts`
- Test: `packages/database/__tests__/task-list-where.test.ts`, `packages/business/__tests__/task/task-service-stage2.test.ts` (по образцу моков в `packages/business/__tests__/task/task-service.test.ts`)

**Interfaces:**
- Produces: `TaskListFilter.assigneeTeamIds?: string[]`; `taskRepository.count({ filter })`, `taskRepository.listTeamIdsForUser({ workspaceId, userId })`; `findConversation` returns `createdAt`; `TaskTargetView.label: string | null`; `TaskView.url: string`; `TaskAccessScope = ContactAccessScope & { hideTargets?: boolean }`; `TaskFilterInput` (= `ListTasksInput` без `page`/`perPage`) с `teamMemberUserId?: string`; `taskService.count(input: TaskFilterInput): Promise<{ total: number }>`; `taskService.take({ workspaceId, id, userId, actor })`.

- [ ] **Step 1: Failing tests.**
  - `buildTaskListWhere({ workspaceId: "1", assigneeTeamIds: ["5","6"] })` → `{ workspaceId: "1", assigneeTeamId: { in: ["5","6"] } }`; если заданы и `assigneeTeamId`, и `assigneeTeamIds` — побеждает `assigneeTeamId`.
  - `taskService.list({ teamMemberUserId: "7" })`: репозиторий `listTeamIdsForUser` вернул `[]` → `{ data: [], pageCount: 0 }` без вызова `list`; вернул `["5"]` → `list` получил `assigneeTeamIds: ["5"]`.
  - `taskService.count` строит тот же фильтр, что `list` (включая `due` и `openOnly`), и возвращает `{ total }` из `taskRepository.count`.
  - `take`: задача без `assigneeTeamId` → `validationException("assigneeTeamId", "Task is not assigned to a team")`; `userId` не в команде → `validationException("userId", "Member is not in the assignee team")`; actor-сотрудник берёт за другого (`actor.userId !== userId`, не владелец) → `taskForbiddenException`; успех → `update` с `patch: { assignee: { type: "user", userId } }`.
  - `create` с `messageId`: `createMessageRepository().findTriggerMessage` вернул `null` → `notFoundException("Message not found")`; вызывается с `{ id: messageId, conversationId, workspaceId, sinceTime: getSafeSinceTime(conversation.createdAt) ?? conversation.createdAt, requireCompleteResults: true }` (образец — `findForContact` в `packages/business/src/message/list-for-conversation.ts:182-205`).
  - Вид: связь-контакт с `contact.fullName = "Иван"` → `label: "Иван"`; скрытая → `label: null`; `accessScope.hideTargets` → все связи `hidden: true`; `url` = `${appUrl}/space/${workspaceId}/tasks/${id}` (`resolveTenantSettings` замокан).

- [ ] **Step 2: Run, see them fail.** `pnpm --filter @chatbotx.io/business exec vitest run __tests__/task/task-service-stage2.test.ts` и `pnpm --filter @chatbotx.io/database exec vitest run __tests__/task-list-where.test.ts`.

- [ ] **Step 3: Implement.**
  - `list-where.ts`: поле `assigneeTeamIds?: string[]`; в `buildTaskListWhere` после `assigneeTeamId`:

    ```ts
    if (filter.assigneeTeamId) {
      where.assigneeTeamId = filter.assigneeTeamId
    } else if (filter.assigneeTeamIds) {
      where.assigneeTeamId = { in: filter.assigneeTeamIds }
    }
    ```
  - `repository.ts`:
    - `withRelations.targets` → `{ orderBy: { id: "asc" }, with: { contact: { columns: { fullName: true } } } }`.
    - `findConversation` выбирает ещё `createdAt: conversationModel.createdAt`.
    - `count({ filter, tx })` — `countWithRelationsFilter` с `buildTaskListWhere(filter)` (как во втором запросе `list`).
    - `listTeamIdsForUser({ workspaceId, userId, tx })` — `select inboxTeamModel.id from inboxTeamMember inner join inboxTeam` с `eq(inboxTeamModel.workspaceId, workspaceId)` и `eq(inboxTeamMemberModel.userId, userId)` (образец соединения — `inbox-team-member/repository.ts`).
  - `service.ts`:
    - Вынести построение фильтра из `list` в `private async resolveFilter(input: TaskFilterInput): Promise<TaskListFilter | null>` (`null` = заведомо пусто: `openOnly` без открытых статусов или пустой список команд). `list` и `count` используют его; `list` при `null` → `{ data: [], pageCount: 0 }`, `count` → `{ total: 0 }`.
    - `teamMemberUserId` → `assigneeTeamIds = await taskRepository.listTeamIdsForUser(...)`.
    - `take`: проверки из Step 1, затем `return await this.update({ workspaceId, id, actor, patch: { assignee: { type: "user", userId } } })`. Проверку членства в команде делать через `inboxTeamMemberRepository.listUserIdsByTeamId`. `actor.kind === "user"` и `actor.userId !== userId` и `!actor.isOwner` → `taskForbiddenException()`.
    - В разборе связей (`messageId`) после проверки диалога — `findTriggerMessage`, при `null` → `notFoundException("Message not found")`.
    - `accessScope` в `get`/`list`/`toViews` — тип `TaskAccessScope`. В `toViews`: `hideTargets` → видимость с пустыми множествами (все связи скрыты, без запроса); `appUrl` — один вызов `resolveTenantSettings({ workspaceId })` на весь список.
  - `view.ts`: `TaskTargetView.label: string | null` (`target.contact?.fullName ?? null` для видимой связи-контакта, иначе `null`); `toTaskView(task, visibility, appUrl)` добавляет `url`.
  - `index.ts`: экспорт `TaskAccessScope`, `TaskFilterInput`.

- [ ] **Step 4: Tests pass; старые тесты задач тоже** (`__tests__/task/*.test.ts`, `task-list-where.test.ts`). `pnpm exec ultracite check <changed files>`.
- [ ] **Step 5: Commit** `feat(tasks): take, team filter, count and message check in task service`.

---

### Task 2: Public `tasks.take` / `tasks.count` and private `tasksAPI`

**Files:**
- Modify: `apps/builder/src/features/tasks/schema/public.ts`, `apps/builder/src/features/tasks/api/public.ts`, `apps/builder/src/routers/index.ts`, `apps/builder/__tests__/tasks-public-api.test.ts`, `apps/builder/__tests__/__snapshots__/public-spec-operations.test.ts.snap`
- Create: `apps/builder/src/features/tasks/lib/session.ts`, `apps/builder/src/features/tasks/api/private.ts`
- Test: `apps/builder/__tests__/tasks-session.test.ts`, `apps/builder/__tests__/tasks-private-api.test.ts` (по образцу `tasks-public-api.test.ts`)

**Interfaces:**
- Consumes: Task 1.
- Produces: схемы `taskFilterFields`, `countTasksPublicRequest`, `countTasksResponse`, `takeTaskPublicRequest`, `taskTabs` (`mine|createdByMe|watching|myTeams|all`); `taskPublicResource` + `url`, связь + `label`; `orpc.tasksAPI.{list,count,get,create,update,complete,take,delete,addWatcher,removeWatcher,comments.list,comments.create}`.

- [ ] **Step 1: Failing tests.**
  - `tasks-session.test.ts`: `tabToFilter("mine", "7")` → `{ assigneeUserId: "7" }`; `createdByMe` → `createdByUserId`; `watching` → `watcherUserId`; `myTeams` → `teamMemberUserId`; `all` → `{}`. `sessionTaskActor({ user: { id: "7" }, workspace: { ownerId: "7" } })` → `{ kind: "user", userId: "7", isOwner: true }`. `sessionTaskAccessScope` без доступа к контактам → `{ hideTargets: true }`; с `onlyAssignedContacts` → `{ restrictToAssignedUserId: "7" }`.
  - Публичный API: `take` вызывает `taskService.take` с `userId` из запроса и `apiTokenActor`; `count` — `taskService.count` с фильтрами; `list` пропускает `teamMemberUserId`.
  - Приватный API: `list` с `tab: "mine"` вызывает `taskService.list` с `assigneeUserId: context.user.id` и `accessScope` сессии; `create` — actor сессии; `take` — `userId: context.user.id`.

- [ ] **Step 2: Implement.**
  - `schema/public.ts`:
    - Вынести поля фильтра из `listTasksPublicRequest` в `const taskFilterFields = { ... }`, добавить `teamMemberUserId: userId("Only tasks assigned to a team this member belongs to.").optional()`. `listTasksPublicRequest = withPublicPaging(z.object(taskFilterFields))`, `countTasksPublicRequest = z.object(taskFilterFields)`, `countTasksResponse = z.object({ total: z.number().int() })`.
    - `taskTargetResource` + `label: z.string().nullable().describe("Contact name for a visible contact link; otherwise null.")`; `taskPublicResource` + `url: z.string().describe("Link to the task page in the web app.")`.
    - `takeTaskPublicRequest = taskIdPathParam.extend({ userId: userId("Member of the assignee team who takes the task.") })`.
    - `taskTabs = z.enum(["mine", "createdByMe", "watching", "myTeams", "all"])`.
  - `api/public.ts`:
    - `count`: `GET /v1/tasks/count`, summary "Count tasks", описание с происхождением id (как у `list`), `spec: defaultTool`. **Объявить до `get`**, чтобы `/v1/tasks/count` не попал в `/v1/tasks/{id}` (проверить порядок в спецификации).
    - `take`: `POST /v1/tasks/{id}/take`, summary "Take team task", описание: "Moves a task assigned to a team to one member of that team. `userId` from `workspaceMembers.list` (must be in the team; team members from `inboxTeams.list`). ${taskIdFrom}". Ошибки `possibleErrorsOnMutatingResource`.
  - `lib/session.ts`:

    ```ts
    import type { TaskActor, TaskAccessScope } from "@chatbotx.io/business"
    import type { WorkspaceMemberPermissions } from "@chatbotx.io/database/partials"
    import { buildContactPermissionScope } from "@/features/contacts/permissions"

    export type TaskTab = "mine" | "createdByMe" | "watching" | "myTeams" | "all"

    export const sessionTaskActor = (context: {
      user: { id: string }
      workspace: { ownerId: string }
    }): TaskActor => ({
      kind: "user",
      userId: context.user.id,
      isOwner: context.workspace.ownerId === context.user.id,
    })

    export const sessionTaskAccessScope = (input: {
      permissions: WorkspaceMemberPermissions
      userId: string
    }): TaskAccessScope => {
      const scope = buildContactPermissionScope(input)
      if (!scope) {
        return { hideTargets: true }
      }
      return { restrictToAssignedUserId: scope.restrictToAssignedUserId }
    }

    export const tabToFilter = (tab: TaskTab, userId: string) => {
      if (tab === "mine") return { assigneeUserId: userId }
      if (tab === "createdByMe") return { createdByUserId: userId }
      if (tab === "watching") return { watcherUserId: userId }
      if (tab === "myTeams") return { teamMemberUserId: userId }
      return {}
    }
    ```
    (форматирование — по Biome, `pnpm fix` для файла.)
  - `api/private.ts` — `tasksAuthenticatedAPI`, цепочка как в `features/contact-notes/api/private.ts`: `authorizedAPI.route({ method, path: "/workspaces/{workspaceId}/tasks…", summary, tags: ["Tasks"] }).input(<public schema>.extend({ workspaceId: zodBigintAsString() })).use(workspaceAuthorizedMidddleware, (input) => input.workspaceId).output(<public output>).handler(...)`. Для `list`/`count` вход дополнительно `tab: taskTabs.default("all")`; фильтр = `{ ...rest, ...tabToFilter(tab, context.user.id) }`. Тела — те же вызовы сервиса, что в публичных процедурах, но `actor: sessionTaskActor(context)`, `accessScope: sessionTaskAccessScope(...)` в `get`/`list`, а в `take` — `userId: context.user.id`. Ответ create — 201, delete/removeWatcher — 204.
  - `routers/index.ts`: `tasksAPI: lazy(() => import("@/features/tasks/api/private").then((m) => ({ default: m.tasksAuthenticatedAPI })))`, рядом с `contactNotesAPI`.
  - Снимок `public-spec-operations`: `pnpm --filter builder exec vitest run __tests__/public-spec-operations.test.ts -u`, проверить, что добавились только `tasks.count` и `tasks.take`.

- [ ] **Step 3: Tests pass** (`tasks-public-api`, `tasks-private-api`, `tasks-session`, `public-spec-operations`). ultracite.
- [ ] **Step 4: Commit** `feat(tasks): public take/count and private tasks API`.

---

### Task 3: i18n, cache hook and shared task components

**Files:**
- Create: `apps/builder/src/features/tasks/hooks/use-invalidate-tasks.ts`, `apps/builder/src/features/tasks/lib/reminder-presets.ts`, `apps/builder/src/features/tasks/components/{task-status-select,task-priority-badge,task-due-label,task-assignee-label,create-task-dialog}.tsx`
- Modify: `apps/builder/messages/*.json` (22), `apps/builder/__tests__/fixtures/ru-same-as-english.json` при необходимости
- Test: `apps/builder/__tests__/tasks-reminder-presets.test.ts`, существующие i18n-тесты (`apps/builder/__tests__/*i18n*`, `*messages*`)

**Interfaces:**
- Consumes: `orpc.tasksAPI.*` (Task 2).
- Produces: `useInvalidateTasks()`; `REMINDER_PRESETS` и `remindAtFromPreset(dueAt, preset)`; `<TaskStatusSelect task workspaceId />` (меняет статус через `tasksAPI.update`), `<TaskPriorityBadge priority />`, `<TaskDueLabel dueAt status />` (красный, если открыта и просрочена), `<TaskAssigneeLabel assigneeUserId assigneeTeamId />` (имена из `useWorkspaceMembers` / `useInboxTeams`), `<CreateTaskDialog workspaceId defaultTargets? trigger? onCreated? />`.

- [ ] **Step 1: i18n.** Раздел `tasks` в `en.json`/`ru.json`: `title` («Задачи»), `tabs.{mine,createdByMe,watching,myTeams,all}`, `status.{todo,in_progress,done,canceled}` («К выполнению», «В работе», «Готово», «Отменена»), `priority.{low,normal,high,urgent}`, `due.{overdue,today,week,none}`, `fields.{title,description,assignee,watchers,dueAt,remindAt,priority,contact,conversation,createdBy}`, `reminder.{min15,hour1,day1}`, `actions.{create,take,delete,complete,save,comment,openConversation}`, `empty`, `deleteConfirm`, `feed.{placeholder,empty,system.<type>}` для каждого `taskSystemEventTypes`, `toasts.{created,updated,deleted,taken,commented}`, `hidden` («Скрыто»), `createdByApi`, `openCount` («Открытых задач: {count}»). Перед новыми ключами проверить `fields.*` в `en.json` (инвариант 7). Остальные 20 файлов — копия английского раздела (скриптом через `node -e`, не руками). Прогнать i18n-тесты.
- [ ] **Step 2: `useInvalidateTasks`** — по образцу существующих `useInvalidate*` (найти `useInvalidateTags`): `queryClient.invalidateQueries({ queryKey: orpc.tasksAPI.key() })`.
- [ ] **Step 3: `reminder-presets.ts` + тест.** `REMINDER_PRESETS = ["min15", "hour1", "day1"] as const`; `remindAtFromPreset(dueAt: Date, preset)` → `subMinutes(dueAt, 15)` / `subHours(dueAt, 1)` / `subDays(dueAt, 1)` (date-fns).
- [ ] **Step 4: Компоненты.**
  - `TaskStatusSelect` — `Select` из `@chatbotx.io/ui/components/ui/select`, `useMutation(orpc.tasksAPI.update.mutationOptions({ onSuccess: invalidate }))`, тост ошибки как в `external-agent-settings-form.tsx`.
  - `CreateTaskDialog` — `Dialog` + react-hook-form + zod (клиентская схема: `title` обязателен; `assignee` обязателен, значение `u_<id>`/`t_<id>` из `useContactAssigneeOptions`, разбор в `assigneeUserId`/`assigneeTeamId`). Поля: `InputField`, `TextareaField`, `ComboboxField` (ответственный, как в `assign-conversation-dialog.tsx`), `MultiSelectField` (наблюдатели, `useContactAssigneeMultiSelectOptions` — только сотрудники), `DateTimePickerField` (срок и напоминание, `saveFormat` — дата), кнопки быстрых напоминаний (видны, когда задан срок), `SelectField` (приоритет, по умолчанию `normal`). `defaultTargets` (`contactId`/`conversationId`) уходят в запрос без полей формы и показываются строкой «Контакт: <имя>» если передан `contactLabel`. После успеха: тост, `invalidate`, `onCreated?.(task)`, закрыть и сбросить форму.
- [ ] **Step 5:** ultracite, тест пресетов, i18n-тесты. **Commit** `feat(tasks): i18n, task form and shared task components`.

---

### Task 4: Tasks page and sidebar item

**Files:**
- Create: `apps/builder/src/app/space/[workspaceId]/tasks/page.tsx`, `apps/builder/src/features/tasks/components/{tasks-page,tasks-table}.tsx`
- Modify: `apps/builder/src/components/nav-main.tsx`, `apps/builder/src/components/app-sidebar.tsx`

**Interfaces:**
- Consumes: Task 3.
- Produces: страница `/space/[workspaceId]/tasks` с URL-параметрами `tab`, `status`, `priority`, `due`, `contactId`, `conversationId`, `page`, `task`.

- [ ] **Step 1: Страница.** `page.tsx` — async Server Component (`params` — Promise), рендерит клиентский `<TasksPage workspaceId />`; заголовок и обёртка — как у соседней простой страницы списка (например `keywords` или `inbound-webhooks`).
- [ ] **Step 2: `TasksPage`.** Состояние фильтров — `nuqs` (`useQueryStates`), по умолчанию `tab=mine`, `status=open`. `Tabs` из `@chatbotx.io/ui/components/ui/tabs` для вкладок; три `Select` для статуса (`open` + 4 статуса), приоритета, срока; чип «По диалогу/контакту ×», когда задан `conversationId`/`contactId`. Кнопка «Создать задачу» → `CreateTaskDialog`. Данные — `useQuery(orpc.tasksAPI.list.queryOptions({ input: { workspaceId, ...filters, page, perPage: 20 } }))`.
- [ ] **Step 3: `TasksTable`** — `DataTable` + `useDataTable` (`@chatbotx.io/ui/components/data-table/data-table`, `@chatbotx.io/ui/hooks/use-data-table`) с `{ data, pageCount }`. Колонки: статус (`TaskStatusSelect`, клик не открывает карточку), название (клик → `setTask(id)`), ответственный (`TaskAssigneeLabel`), срок (`TaskDueLabel`), приоритет (`TaskPriorityBadge`), контакт (`label` связи-контакта, ссылка на диалог `/space/${workspaceId}/inbox?conversationId=<id>`, если есть связь-диалог; «Скрыто» при `hidden`). Пустой список — `tasks.empty`.
- [ ] **Step 4: Меню.** В `NavItem` поле `badge?: number`; в `NavMain` после `SidebarMenuButton` — `{item.badge ? <SidebarMenuBadge>{item.badge}</SidebarMenuBadge> : null}` (экспорт есть в `@chatbotx.io/ui/components/ui/sidebar`). В `app-sidebar.tsx` пункт «Задачи» (`ListChecksIcon`, `t("tasks.title")`, `url: /space/${workspaceId}/tasks`) после «Контакты», с `visible: true` вместо `permission` (`isNavItemVisible` сначала смотрит на `visible`; если тип `SidebarNavItem` требует `permission`, сделать его необязательным). Счётчик: `useQuery(orpc.tasksAPI.count.queryOptions({ input: { workspaceId, tab: "mine", due: "overdue" } }))`, `badge: data?.total`; при `scheduledForDeletion` запрос не делать (`enabled`).
- [ ] **Step 5:** ultracite. **Commit** `feat(tasks): tasks page and sidebar item`.

---

### Task 5: Task card (sheet + direct page) and feed

**Files:**
- Create: `apps/builder/src/features/tasks/components/{task-details,task-feed,task-sheet}.tsx`, `apps/builder/src/app/space/[workspaceId]/tasks/[taskId]/page.tsx`
- Modify: `apps/builder/src/features/tasks/components/tasks-page.tsx` (подключить `TaskSheet`)

**Interfaces:**
- Consumes: Tasks 3–4.
- Produces: `<TaskDetails workspaceId taskId />` (используется в панели и на прямой странице), `<TaskSheet workspaceId />` (открыт, пока в URL есть `task`).

- [ ] **Step 1: `TaskDetails`.** `useQuery(orpc.tasksAPI.get.queryOptions(...))`. Две колонки (`md:grid-cols-[1fr_1fr]`, на мобильном одна): слева поля, справа `TaskFeed`.
  - Название и описание — редактирование по кнопке «Изменить» (маленькая форма, «Сохранить» → `tasksAPI.update`).
  - Статус (`TaskStatusSelect`), приоритет (`Select`), ответственный (`Combobox` с теми же опциями, что в диалоге), срок и напоминание (`DateTimePicker` + быстрые пресеты), наблюдатели (список с «×» → `removeWatcher`, «+» → `addWatcher`). Каждое изменение — сразу `update`, тост, `invalidate`.
  - «Взять себе» — видна, если `assigneeTeamId` задан и текущий сотрудник в этой команде (`useInboxTeams` / члены команды; если данных о членах нет на клиенте — показывать при любом `assigneeTeamId`, сервер вернёт ошибку); → `tasksAPI.take`.
  - Связи: имя контакта и ссылка «Открыть диалог»; скрытые — «Скрыто».
  - Кто создал: сотрудник по `createdByUserId` или `createdByLabel` («через API: <имя>»), дата создания.
  - «Удалить» — `AlertDialog` подтверждения → `tasksAPI.delete`, `invalidate`, закрыть карточку (`onDeleted`).
  - Ошибка 404 — сообщение «Задача не найдена».
- [ ] **Step 2: `TaskFeed`.** `useQuery(orpc.tasksAPI.comments.list.queryOptions({ input: { workspaceId, id, perPage: 100 } }))`, показывать старые сверху (развернуть массив). Комментарий: автор (имя сотрудника или `authorLabel`), время, текст (`whitespace-pre-wrap`, без HTML). Системное событие: строка `t("tasks.feed.system.<type>", { from, to })`, где статус/приоритет переводятся, `user:<id>`/`team:<id>` — имя, даты — `format` из date-fns. Поле `Textarea` + «Отправить» (Ctrl/⌘+Enter) → `tasksAPI.comments.create`, инвалидировать ленту и задачу.
- [ ] **Step 3: `TaskSheet`** — `Sheet` из `@chatbotx.io/ui/components/ui/sheet` (`side="right"`, `sm:max-w-3xl`), `open={Boolean(taskId)}`, закрытие → `setTask(null)`; в заголовке ссылка «Открыть на отдельной странице». Подключить в `TasksPage`.
- [ ] **Step 4: Прямая страница** `tasks/[taskId]/page.tsx` — `<TaskDetails>` с кнопкой «← Все задачи»; после удаления — `router.push` на список (после `invalidate`).
- [ ] **Step 5:** ultracite. **Commit** `feat(tasks): task card with feed`.

---

### Task 6: Contact panel block and conversation header badge

**Files:**
- Create: `apps/builder/src/features/tasks/components/{contact-tasks-section,conversation-tasks-badge}.tsx`
- Modify: `apps/builder/src/features/contacts/contact-inbox-panel.tsx`, `apps/builder/src/features/messages/message-head.tsx`

- [ ] **Step 1: `ContactTasksSection({ workspaceId, contactId, conversationId?, contactLabel? })`.** Заголовок «Задачи» + кнопка «Создать» (`CreateTaskDialog` с `defaultTargets: { contactId, conversationId }`, при наличии диалога передавать только `conversationId` — контакт сервис подставит сам). Список открытых задач контакта (`list` с `contactId`, `status: "open"`, `tab: "all"`, `perPage: 10`): статус, название, срок; клик по названию → `/space/${workspaceId}/tasks?tab=all&task=<id>`. Ссылка «Все задачи контакта» → `/space/${workspaceId}/tasks?tab=all&contactId=<id>`.
- [ ] **Step 2: Панель контакта.** Вставить `ContactTasksSection` в `ContactInboxPanel` после `ContactNotesSection`, **вне** условия `SHOW_CONTACT_SIDE_PANEL_MODULES` (модули скрыты намеренно, задачи должны быть видны). Id контакта и диалога взять там же, откуда их берут соседние блоки.
- [ ] **Step 3: `ConversationTasksBadge({ workspaceId, conversationId })`.** `count` с `conversationId`, `status: "open"`, `tab: "all"`; при `total === 0` ничего не рендерить; иначе кнопка-значок (`ListChecksIcon` + число, `aria-label={t("tasks.openCount", { count })}`) → ссылка `/space/${workspaceId}/tasks?tab=all&conversationId=<id>`. Вставить в `MessageHead` рядом с остальными кнопками заголовка; `conversationId` — из `useChatStore` (`activeConversationId`).
- [ ] **Step 4:** Проверить, что `CreateTaskDialog` после создания инвалидирует и блок, и значок (общий ключ `tasksAPI`). ultracite. **Commit** `feat(tasks): tasks in contact panel and conversation header`.

---

### Task 7: Docs, CLI/MCP, CI

- [ ] `docs/tasks.md`: разделы «Интерфейс» (страница, вкладки, карточка, блок контакта, значок), новые операции `tasks.take`, `tasks.count`, фильтр `teamMemberUserId`, поля `url` и `label`; «Не сделано»: непрочитанные, упоминания, вложения, realtime, уведомления, шаг сценария.
- [ ] Навык `cli-mcp-docs` (`.agents/skills/cli-mcp-docs/SKILL.md`): обновить `apps/cli/README.md`, `apps/mcp-server/README.md` и всё, что навык требует для новых операций.
- [ ] `.github/workflows/gkamion-checks.yml`: добавить новые тестовые файлы.
- [ ] `pnpm lint` по затронутым файлам (ultracite), `pnpm sync:agent-instructions` не нужен (инварианты не менялись).
- [ ] **Commit** `docs(tasks): stage 2 UI and take/count operations`.

---

## After all tasks

1. invariant-guard по диффу этапа (haiku), финальное ревью (opus), исправления.
2. Push → дождаться зелёного `gkamion-checks.yml`.
3. Сборка образа `builder` (worker в этом этапе не меняется), `bash deploy/gkamion/up.sh builder`.
4. Проверка на проде: страница открывается, создание из панели контакта, значок в диалоге, «Взять себе», комментарий; Hermes — `tasks.count`.

## Self-review

- Спека, раздел 5: страница ✓ (без непрочитанных — этап 3), карточка ✓ (без упоминаний/вложений — этап 3), создание ✓, блок контакта ✓, значок диалога ✓, «Создать задачу» из сообщения — этап 7. Раздел 6: `url` ✓, все действия интерфейса есть в публичном API (`take`, `count` добавлены).
- Миграций нет; права и видимость — в сервисе, слой приложения передаёт только actor и scope.
