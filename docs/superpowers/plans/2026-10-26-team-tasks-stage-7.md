# Team Tasks — Stage 7 (шаг сценария «Создать задачу» и «Создать задачу» из сообщения) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** сценарий сам ставит задачу сотруднику или команде (на конкретного человека, на команду или на того, кто назначен на диалог) со ссылкой на контакт и диалог, результат уходит по веткам «успех» / «ошибка», id задачи можно сохранить в поле; человек в инбоксе создаёт задачу прямо из входящего сообщения клиента — текст подставляется цитатой, связи с контактом, диалогом и сообщением ставятся сами. Задачи из сценария сразу обновляют колокольчик исполнителя.

**Architecture:** новый тип шага `createTask` (схема в `packages/flow-config`, обработчик в `apps/worker/src/integration/handlers/create-task-handler.ts`) — **шаг внутри узла «Действие» (`performAction`)**, как `callApi`; обработчик подставляет переменные, определяет исполнителя, считает срок/напоминание и вызывает `taskService.create` с актором `{ kind: "flow", label: <название сценария> }`. Процесс `integration` регистрирует `registerNotificationRealtime()` (как `schedule`), чтобы `emitNotificationsCreated` из `notifyTask` доходил до браузера. В инбоксе пункт «Создать задачу» появляется в меню действий входящих сообщений клиента (`MessageActions` теперь показывается и для обычных сообщений) и открывает существующий `CreateTaskDialog` в режиме «управляемого» открытия с цитатой и `messageId`.

**Tech Stack:** zod (flow-config), BullMQ integration worker, `taskService`/`notificationService`, React Hook Form + next-intl (builder), vitest.

**Spec:** `docs/superpowers/specs/2026-10-17-team-tasks-design.md` (5 «Контакт и диалог», 7; этап 7 из раздела 10). Этапы 1–4: `docs/superpowers/plans/2026-10-23-team-tasks-stage-{1,2,3,4}.md`. Факты по коду: `.superpowers/sdd/stage7-explore.md` (отчёт описывает отдельный тип узла — см. Deviation 1) и ссылки `файл:строка` ниже, проверенные чтением кода.

---

## Global Constraints

- Те же, что на этапах 1–4 (`.superpowers/sdd/tasks-constraints.md`): **не** запускать `tsc`, `pnpm lint`, `pnpm test`, `pnpm build`, `check-types` (VPS общий с продом; всё это — в GitHub CI). Разрешено только: `export PATH=/GKamion/chatbotX/.tools/node-24/bin:$PATH`, `npx ultracite check|fix <файлы>`, **один** файл vitest: `pnpm exec vitest run <файл> --pool=forks --maxWorkers=1` из каталога пакета.
- **Миграций нет.** Таблиц и колонок не добавляем; `db:migrate` / `make:migration` не трогать.
- **Круг импорта и слои:** обработчик шага в `apps/worker` вызывает только сервисы из `@chatbotx.io/business` (`taskService`, `flowService`, `conversationService`, `inboxTeamService`) — не `db` и не репозитории. Без динамических `import()` в `apps/worker` и `packages/*`; в `apps/builder/src` допустимы (но здесь не нужны).
- Логи — `logger.error({ err }, "...")`, не `{ error }`; никаких `console` в серверном коде.
- **TS проверяется только в CI.** Ловушки (этап 3 + этот этап):
  - `Select.onValueChange` из base-ui — `(value: unknown, eventDetails)`; `Select` без `items`/`options` показывает сырое значение.
  - generic-обёртки над zod `.extend` теряют типы; `z.coerce.number()` даёт `unknown` на входе — формы шага типизировать тройкой `useForm<z.input<typeof schema>, unknown, StepSchema>` (как `external-request/editor.tsx`), без `as any`.
  - `STEP_PRODUCES_MESSAGE: Record<StepType, boolean>` (`flow-utils.ts:91`), `stepExecutionKinds … satisfies Record<StepType, StepExecutionKind>` (`channel-rules/policies/define.ts:126`), `allSteps: Record<StepType, StepDefinition<any> | undefined>` (`steps/index.tsx:104`), `flowStepHandlers: Record<StepType, …>` (`step.ts:404+`) — **исчерпывающие**; новый `StepType` без записи во всех четырёх не компилируется. Не расширять до `Partial`.
  - В сообщениях next-intl `{` и `}` — ICU: нельзя писать `{{contact.name}}` в строках перевода (используй «переменные» словами).
  - `perPage` ≤ `PUBLIC_LIST_MAX_PER_PAGE` (50); `createdByLabel`/`label` актора — строка, не `undefined`.
  - Тройная `d` в `workspaceAuthorizedMidddleware` — здесь не нужна, но не «чинить» опечатку.
- Закоммитить **только свои файлы** (`git add <путь> …`; не `git add -A`, не `apps/builder/AGENTS.md`; в рабочем дереве уже есть чужие правки `apps/builder/messages/ru.json` и `docs/i18n/ru-glossary.md` до этого этапа — не включать их в коммиты, если не правишь эти же строки; при правке `ru.json` добавлять через точечный `git add -p` или работать поверх текущего состояния и сообщить контроллеру). Не пушить. Conventional commits.
- i18n: **все 22 файла** `apps/builder/messages/*.json` (ar, az, da, de, en, es, fi, fr, he, id, it, ja, nl, pt-BR, pt-PT, ro, ru, sv, tr, vi, zh-CN, zh-TW); `ru` — по-русски (глоссарий `docs/i18n/ru-glossary.md`); остальные локали — перевод на язык файла (не копия английского), ключи в том же порядке и той же вложенности, что в `en.json`. `en.d.json.ts` генерируется next-intl — руками не править. Новые ключи кладём в **существующие** пространства `tasks` и `flows.actions` (они уже в батчах `scripts/i18n/ru-batches.ts`), нового верхнего пространства не заводим.

## Deviations from the spec (decided while planning)

1. **Шаг, а не тип узла (отличие от раздела 7 спеки).** Спека требует `nodeTypeSchema.createTask` и регистрации во всех реестрах узлов (инвариант 16). Утверждённый объём: `createTask` — **шаг `stepTypes.createTask` внутри существующего узла «Действие»**, как `callApi` (`steps/external-request.ts:131`). Следствие: `nodeTypeSchema`, `flowVersionSchema`, `allNodesConfig`, `viewerNodeTypes`, `analyticsNodeTypes` **не меняются** (шаг лежит в `data.details.steps` узла `performAction`, чья схема строится из `z.union(actionSteps)` — `nodes/perform-action.ts:19`); регистрация идёт по реестрам **шагов**: `stepTypes`, `actionSteps` (`shared.ts`), `flowStepHandlers`, `STEP_PRODUCES_MESSAGE`, `allSteps`, меню `performAction`, `stepExecutionKinds`. Аналитика узла «Действие» работает как раньше. Отметка об отличии вносится в спеку (Task 4).
2. **Исполнитель задаётся тремя режимами:** `user` (конкретный сотрудник), `team` (команда), `conversation` («назначенный на диалог»: `Conversation.assignedUserId` → иначе `assignedInboxTeamId`; никто не назначен → ветка «ошибка»). Значение по умолчанию — `conversation`.
3. **Ветка «ошибка»** срабатывает: исполнитель не участник пространства (`taskService.assertAssignable` бросает `validationException` — `service.ts:929`), команда не найдена **или пуста** (проверка пустоты — в обработчике: `taskService` пустую команду принимает, `service.ts:946`), на диалоге никого нет, пустое название после подстановки переменных, любой другой сбой сервиса.
4. **Запись id задачи в поле — не критична:** если поле выбрано, но не существует или запись упала, задача уже создана, поэтому шаг всё равно «успех», ошибка пишется в лог (`logger.warn({ err })`). Иначе сценарий по ветке «ошибка» мог бы повторить создание.
5. **Realtime обновление списка задач включено по решению пользователя:** после успешного создания обработчик публикует `taskChanged` с `taskId`. Это обновляет открытые списки задач у участников пространства; `notificationCreated` отдельно обновляет адресное уведомление исполнителя.
6. **Публичный API без изменений (инвариант 23).** Шаг — это *конфигурация сценария*: он доступен агентам через `flows.publish` / `flows.updateDraft`, чьи входные схемы выводятся из `flowVersionSchema` → `actionSteps` (`flows/api/public.ts`, `flow-config/src/publish-schema.ts`), поэтому новая ветка схемы попадает в `public-spec.json`, CLI и MCP автоматически (описание полей — через `.describe()`). Меню «Создать задачу» в инбоксе вызывает **существующую** `tasks.create` (`features/tasks/api/public.ts:253-271`, приватный двойник `api/private.ts:262-296`), которая уже принимает `contactId`, `conversationId`, `messageId` (`schema/public.ts:103-126`) — новой процедуры не нужно.
7. **CLI / MCP: ничего нового.** Операций не прибавилось (список `operationId` в снапшотах `public-spec-*.test.ts` не меняется); навык `cli-mcp-docs` выполняется как проверка «дрейфа» — в Task 4 фиксируется, что ничего менять не нужно.
8. **Импорт/экспорт сценариев:** `outputFieldId` ремапится автоматически (`import-export/reference-fields.ts:25`); `userId` / `teamId` исполнителя **не ремапятся** (как и `assignedIds` у `autoAssignConversation`) — при переносе в другое пространство шаг уходит по ветке «ошибка». Записать в docs.
9. **Нет `skip`-состояния:** только `[success, error]`.

## File map

**Create**
- `packages/flow-config/src/steps/create-task.ts` — схема, дефолты, константы.
- `packages/flow-config/__tests__/create-task.test.ts`.
- `apps/worker/src/integration/handlers/create-task-handler.ts`.
- `apps/worker/__tests__/create-task-step-handler.test.ts`, `apps/worker/__tests__/create-task-step-registration.test.ts`.
- `apps/builder/src/features/flows/react-flow/steps/create-task/{index.ts,editor.tsx,viewer.tsx}`.
- `apps/builder/src/features/flows/react-flow/steps/__tests__/create-task-registration.test.ts`.
- `apps/builder/src/features/tasks/lib/message-quote.ts`.
- `apps/builder/__tests__/tasks-message-quote.test.ts`.

**Modify**
- `packages/flow-config/src/steps/step-action.ts` (литерал `createTask`), `packages/flow-config/src/shared.ts` (`taskSteps` в `actionSteps`), `packages/flow-config/src/index.ts` (экспорт), `packages/flow-config/src/channel-rules/policies/define.ts` (`createTask: "worker"`).
- `apps/worker/src/integration/handlers/step.ts` (обработчик), `apps/worker/src/integration/handlers/flow-utils.ts` (`createTask: false`), `apps/worker/src/integration/handlers/tool-handler.ts` (экспорт двух хелперов полей), `apps/worker/src/integration/worker.ts` (`registerNotificationRealtime()`), `apps/worker/__tests__/integration-worker-boot.test.ts`, `apps/worker/__tests__/integration-worker-incoming-message.test.ts` (мок регистрации).
- `apps/builder/src/features/flows/react-flow/steps/index.tsx`, `apps/builder/src/features/flows/react-flow/nodes/perform-action/menu.tsx`, `apps/builder/src/features/flows/react-flow/nodes/perform-action/__tests__/menu.test.ts`.
- `apps/builder/src/features/tasks/components/create-task-dialog.tsx`, `apps/builder/src/features/messages/components/message-actions.tsx`, `apps/builder/src/features/messages/components/message-item.tsx`, `apps/builder/src/features/messages/message-list.tsx`.
- `apps/builder/messages/*.json` (22 файлов), при необходимости `apps/builder/__tests__/fixtures/ru-same-as-english.json`.
- `docs/tasks.md`, `docs/superpowers/specs/2026-10-17-team-tasks-design.md` (§7: отметка об отличии), `.github/workflows/gkamion-checks.yml`.

## Models (cost/quality)

| Работа | Модель |
|---|---|
| Задача 1 (схема, обработчик, worker) | composer-2.5-fast |
| Задача 2 (редактор/просмотр шага, i18n) | gpt-5.6-terra-medium |
| Задача 3 (меню сообщения, диалог) | gpt-5.6-terra-medium |
| Задача 4 (документация, CI) | composer-2.5-fast |
| Ревью задач | контроллер по диффу; при сомнениях — gpt-5.6-terra-medium |
| invariant-guard | claude-haiku-5-5-thinking-high |
| Финальное ревью (типы, исчерпывающие реестры, адресность уведомлений) | claude-opus-5-5-medium |

---

### Task 1: flow-config schema, worker handler, realtime registration in the integration worker

**Interfaces (produces):**

- `packages/flow-config/src/steps/create-task.ts`:

```ts
import { createId, zodBigintAsString } from "@chatbotx.io/utils"
import { z } from "zod"
import { zodFieldReference } from "../field-reference"
import {
  errorStateDefaultFn,
  errorStateSchema,
  successStateDefaultFn,
  successStateSchema,
} from "../states"
import { stepTypes } from "./step-action"

// Литералы, а не импорт из @chatbotx.io/database: flow-config от database не зависит.
// Шаблон может раскрыться длиннее — обработчик режет результат до TASK_LIMITS (255 / 10 000).
export const CREATE_TASK_LIMITS = {
  maxTitleTemplateLength: 1000,
  maxDescriptionTemplateLength: 10_000,
  maxOffset: 999_999,
} as const

export const createTaskPriorities = z.enum(["low", "normal", "high", "urgent"])
export const createTaskDueUnits = z.enum(["minutes", "hours", "days"])
export type CreateTaskDueUnit = z.infer<typeof createTaskDueUnits>
export const createTaskUnitMinutes = {
  minutes: 1,
  hours: 60,
  days: 1440,
} as const satisfies Record<CreateTaskDueUnit, number>

export const createTaskAssigneeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("user"), userId: zodBigintAsString() }),
  z.object({ type: z.literal("team"), teamId: zodBigintAsString() }),
  z.object({ type: z.literal("conversation") }),
])
export type CreateTaskAssignee = z.infer<typeof createTaskAssigneeSchema>

export const createTaskStepSchema = z
  .object({
    id: zodBigintAsString().describe("Step id (numeric string), unique within the flow."),
    stepType: z.literal(stepTypes.enum.createTask).describe('Step type discriminator: "createTask".'),
    title: z.string().trim().min(1).max(CREATE_TASK_LIMITS.maxTitleTemplateLength)
      .describe("Task title; supports variables such as the contact name. Cut to 255 characters after substitution."),
    description: z.string().max(CREATE_TASK_LIMITS.maxDescriptionTemplateLength)
      .describe("Task description; supports variables. Empty string means no description."),
    assignee: createTaskAssigneeSchema.describe(
      "Who gets the task: a member (`userId` from `workspaceMembers.list`), a team (`teamId` from `inboxTeams.list`) or `conversation` — whoever is assigned to the current conversation (no assignee → the error output).",
    ),
    dueIn: z.object({
      amount: z.coerce.number().int().min(1).max(CREATE_TASK_LIMITS.maxOffset),
      unit: createTaskDueUnits,
    }).nullable().describe("Due date relative to the moment the step runs; null for no due date."),
    remindBeforeMinutes: z.coerce.number().int().min(1).max(CREATE_TASK_LIMITS.maxOffset).nullable()
      .describe("Reminder N minutes before the due date; null for none. Requires `dueIn`."),
    priority: createTaskPriorities,
    outputFieldId: zodFieldReference().or(z.literal(""))
      .describe("Optional field (custom field id or `bot_field:<id>`) that receives the new task id; empty string to skip."),
    states: z.tuple([successStateSchema, errorStateSchema]),
  })
  .superRefine((data, ctx) => {
    if (data.remindBeforeMinutes === null) return
    if (data.dueIn === null) {
      ctx.addIssue({ code: "custom", path: ["remindBeforeMinutes"], message: "Reminder requires a due date" })
      return
    }
    if (data.remindBeforeMinutes > data.dueIn.amount * createTaskUnitMinutes[data.dueIn.unit]) {
      ctx.addIssue({ code: "custom", path: ["remindBeforeMinutes"], message: "Reminder must not be later than the due date" })
    }
  })
export type CreateTaskStepSchema = z.infer<typeof createTaskStepSchema>
export type CreateTaskStepInput = z.input<typeof createTaskStepSchema>

export const createTaskStepDefaultFn = (): CreateTaskStepSchema => ({
  id: createId(),
  stepType: stepTypes.enum.createTask,
  title: "",
  description: "",
  assignee: { type: "conversation" },
  dueIn: null,
  remindBeforeMinutes: null,
  priority: "normal",
  outputFieldId: "",
  states: [successStateDefaultFn(), errorStateDefaultFn()],
})
```

  (форматирование — по `npx ultracite fix`; длинные `.describe()` — как у `external-request.ts`.)

- Реестры flow-config: `step-action.ts` — литерал `"createTask"` (новая группа «Tasks (T_)» рядом с «Inbox Operations»); `shared.ts` — `import { createTaskStepSchema } from "./steps/create-task"`, `const taskSteps = [createTaskStepSchema]`, `...taskSteps` в `actionSteps`; `index.ts` — `export * from "./steps/create-task"` (рядом с остальными `steps/*`, барреля нет); `channel-rules/policies/define.ts` — `createTask: "worker"` (иначе `satisfies Record<StepType, …>` не компилируется; тогда `createDefaultStepSupport` даёт `full` на всех каналах — шаг не отправляет сообщений). `CHANNEL_POLICY_VERSION` **не** менять (значение 2 закреплено тестом `send-view-catalog-step.test.ts:231`).

- `apps/worker/src/integration/handlers/tool-handler.ts`: добавить `export` к уже существующим `referencedFieldExists` (стр. ~46) и `writeReferencedFieldValue` (стр. ~150) — единственное изменение файла; логика не меняется (существующие тесты `external-request-handler.test.ts` и др. не затрагиваются).

- `apps/worker/src/integration/handlers/create-task-handler.ts`:

```ts
export const resolveCreateTaskSchedule = (input: {
  now: Date
  dueIn: CreateTaskStepSchema["dueIn"]
  remindBeforeMinutes: CreateTaskStepSchema["remindBeforeMinutes"]
}): { dueAt: Date | null; remindAt: Date | null }
// dueAt = now + amount * createTaskUnitMinutes[unit] * 60_000; remindAt = dueAt − remindBeforeMinutes * 60_000 (если задан); нет dueIn → оба null

export const handleCreateTask = async (
  props: ExecuteStepProps<CreateTaskStepSchema>,
): Promise<ExecuteStepResult>
```

  Алгоритм `handleCreateTask` (всё внутри одного `try/catch`; ожидаемые отказы — `return { status: "error", errorMessage, result: null }`):
  1. `const { conversation, contactInbox, flowVersion, step } = props`; `workspaceId = conversation.workspaceId`.
  2. `const resolved = await resolveContactVariablesDeep(conversation.contactId, { title: step.title, description: step.description }, { contactInbox, conversation })` (подпись как в `tool-handler.ts:462`). `title = resolved.title.trim().slice(0, 255)`; пусто → `error: "Task title is empty after resolving variables"`. `description = resolved.description.slice(0, 10_000)`; пусто → `null`. Константы лимитов — локальные (`TASK_TITLE_MAX = 255`, `TASK_DESCRIPTION_MAX = 10_000`; handler не импортирует `TASK_LIMITS` из database-partials, если это тянет лишнее в тест — допустимо импортировать `TASK_LIMITS` из `@chatbotx.io/database/partials`, он уже используется в worker/business).
  3. Исполнитель — вспомогательная `resolveAssignee(step.assignee, conversation)` → `{ ok: true; assignee: TaskAssignee } | { ok: false; errorMessage: string }`:
     - `user` → `{ type: "user", userId }` (членство проверяет `taskService.create`; ошибка уйдёт в `catch` → ветка «ошибка»).
     - `team` → `inboxTeamService.listUserIdsByTeamId({ workspaceId, inboxTeamId: teamId })` (`enterprise/inbox-team/service.ts:60`); пусто → `error: "Team has no members"`; иначе `{ type: "team", teamId }`.
     - `conversation` → **свежая** запись: `conversationService.findByUncached({ where: { id: conversation.id, workspaceId } })` (`conversation/service.ts:184`; `conversation` в props — снимок на старт задания, предыдущий шаг `autoAssignConversation`/`assignConversation` его не обновляет). Нет записи или нет назначенных → `error: "Conversation has no assignee"`; `assignedUserId` → `user`; иначе `assignedInboxTeamId` → как `team` (с проверкой пустоты).
  4. `const { dueAt, remindAt } = resolveCreateTaskSchedule({ now: new Date(), dueIn: step.dueIn, remindBeforeMinutes: step.remindBeforeMinutes })`.
  5. Название сценария: `const flow = await flowService.findActiveById({ id: flowVersion.flowId, workspaceId })` (`flow/service.ts:717`; как `handover-response.ts:40`); `label = flow?.name ?? "Flow"`.
  6. `const task = await taskService.create({ workspaceId, actor: { kind: "flow", label }, title, description, priority: step.priority, dueAt, remindAt, assignee, targets: { contactId: conversation.contactId, conversationId: conversation.id } })` (`task/service.ts:118`; `messageId` не передаём, `watcherUserIds` не передаём — исполнитель добавляется наблюдателем сервисом).
  7. Если `step.outputFieldId !== ""`: `if (await referencedFieldExists({ fieldId, workspaceId }))` → `await writeReferencedFieldValue({ fieldId, workspaceId, contactId: conversation.contactId, value: task.id })`; нет поля или сбой записи → `logger.warn({ err, … }, "[handleCreateTask] failed to save task id; continuing")`, шаг остаётся «успех» (Deviation 4). Отдельный вложенный `try/catch` на запись.
  8. `return { status: "success", result: { taskId: task.id } }`.
  9. Внешний `catch (err)`: `logger.error({ err, conversationId: conversation.id, stepId: step.id }, "[handleCreateTask] failed")`; `return { status: "error", errorMessage: err instanceof Error ? err.message : "Failed to create task", result: null }`.

- Регистрация в worker: `step.ts` — `import { handleCreateTask } from "./create-task-handler"` и `[stepTypes.enum.createTask]: handleCreateTask` (по алфавиту рядом с `callApi`); `flow-utils.ts` — `createTask: false` в `STEP_PRODUCES_MESSAGE` (после `callApi`, `:180`).

- **Realtime уведомлений в процессе `integration`:** `apps/worker/src/integration/worker.ts` — `import { registerNotificationRealtime } from "../lib/notification-realtime"` и **первой строкой** `startIntegrationWorker()` (стр. ~166, до `ensureBootstrapped()`) вызвать `registerNotificationRealtime()` — как в `schedule/worker.ts:69`. Функция идемпотентна (флаг `registered`, `lib/notification-realtime.ts:7-13`). Шаги сценария выполняются только в этом процессе (`flowStepHandlers` используется лишь `integration/handlers/flow.ts:674`), поэтому других процессов регистрировать не нужно.

**Тесты (vitest):**

- `packages/flow-config/__tests__/create-task.test.ts` (по образцу `external-request.test.ts`): дефолт — `stepType: "createTask"`, состояния `["success","error"]` с непустыми id, `assignee: { type: "conversation" }`, пустое название **не** проходит схему, с названием — проходит; `actionSteps.some(schema => schema.safeParse(value).success)`; исполнитель: `user` без `userId` — ошибка, `team` с `teamId` — ок, `conversation` — ок; `dueIn` `{ amount: 2, unit: "hours" }` ок, `amount: 0` — ошибка; напоминание без срока — ошибка; напоминание позже срока (`dueIn` 30 минут, `remindBeforeMinutes: 31`) — ошибка, равное — ок, `null`/`null` — ок; `outputFieldId: ""` ок, `"123"` ок, `"bot_field:abc"` — ошибка, `"bot_field:5"` ок; `CHANNEL_FLOW_POLICIES[channel].steps.createTask === "full"` для каждого канала из `Object.keys(CHANNEL_FLOW_POLICIES)`.
- `apps/worker/__tests__/create-task-step-handler.test.ts` (по образцу `external-request-handler.test.ts`; `vi.mock("@chatbotx.io/business", …)` с `taskService.create`, `flowService.findActiveById`, `conversationService.findByUncached`, `inboxTeamService.listUserIdsByTeamId`; `vi.mock("@chatbotx.io/variables", …)` с `resolveContactVariablesDeep`, который подставляет `{{contact.name}}` в строки объекта; `vi.mock("../src/integration/handlers/tool-handler", () => ({ referencedFieldExists, writeReferencedFieldValue }))`; `vi.mock("../src/lib/logger", …)`; `vi.useFakeTimers()` + `vi.setSystemTime` для срока). Кейсы:
  1. **успех, сотрудник:** `taskService.create` вызван с `workspaceId`, `assignee: { type: "user", userId }`, `targets: { contactId, conversationId }`, без `messageId`; результат `{ status: "success", result: { taskId } }`.
  2. **метка = название сценария:** `findActiveById` вернул `{ name: "Welcome flow" }` → `actor` равен `{ kind: "flow", label: "Welcome flow" }`; сценарий не найден → `label: "Flow"`; в вызов `findActiveById` ушли `{ id: flowVersion.flowId, workspaceId }`.
  3. **переменные в названии и описании:** шаблон `"Call {{contact.name}}"` → в `create` ушло `"Call Ivan"`; длинное название режется до 255; пустое после подстановки → `error`, `create` не вызывался.
  4. **исполнитель «на диалоге»:** `findByUncached` вернул `assignedUserId` → `user`; вернул только `assignedInboxTeamId` (команда с участниками) → `team`; **никого нет → `status: "error"`, `create` не вызывался**.
  5. **пустая команда:** `step.assignee = team`, `listUserIdsByTeamId` → `[]` → `error`, `create` не вызывался; то же для команды с диалога.
  6. **сбой сервиса:** `taskService.create` бросил (например «Assignee is not a member of this workspace») → `error` с этим сообщением; `logger.error` вызван с объектом, у которого есть ключ `err` (и нет ключа `error`).
  7. **поле вывода:** `outputFieldId: "field-1"`, поле существует → `writeReferencedFieldValue` вызван с `{ fieldId: "field-1", workspaceId, contactId, value: taskId }`; `outputFieldId: ""` → не вызывался; поле не существует → не вызывался, статус `success`; запись бросила → статус `success`, `logger.warn` вызван.
  8. **срок и напоминание:** фиксированное «сейчас» → `dueIn { amount: 2, unit: "hours" }` даёт `dueAt = now + 2h`, `remindBeforeMinutes: 30` — `remindAt = dueAt − 30 мин`; `dueIn: null` → `dueAt: null, remindAt: null`; отдельные юнит-тесты `resolveCreateTaskSchedule` для `minutes` / `days`.
  9. приоритет и описание передаются как есть (`priority: "high"`; пустое описание → `description: null`).
- `apps/worker/__tests__/create-task-step-registration.test.ts` (по образцу `external-request-step-registration.test.ts`): `step.ts` импортирует `handleCreateTask` из `./create-task-handler` и содержит `[stepTypes.enum.createTask]: handleCreateTask`; `flow-utils.ts` содержит `createTask: false`.
- `apps/worker/__tests__/integration-worker-boot.test.ts` и `…-incoming-message.test.ts`: оба тестируют реальный `src/integration/worker.ts` с жёстко замоканным `@chatbotx.io/business` — обращение к отсутствующему экспорту (`onNotificationsCreated`) бросит. Добавить в оба `vi.mock("../src/lib/notification-realtime", () => ({ registerNotificationRealtime: <hoisted vi.fn> }))`; в `boot`-тесте — утверждение, что после старта функция вызвана ровно один раз (до `ensureBootstrapped`).

- [x] **Step 1:** failing tests (flow-config, handler, registration) → схема + реестры flow-config → pass (`packages/flow-config`: `pnpm exec vitest run __tests__/create-task.test.ts --pool=forks --maxWorkers=1`).
- [x] **Step 2:** обработчик, экспорт хелперов из `tool-handler.ts`, `step.ts`, `flow-utils.ts` → тесты worker по одному файлу (`create-task-step-handler`, `create-task-step-registration`, `external-request-handler`, `external-request-step-registration`, `notification-realtime`).
- [x] **Step 3:** `registerNotificationRealtime()` в `integration/worker.ts` + моки в двух тестах старта → `integration-worker-boot.test.ts`, `integration-worker-incoming-message.test.ts` по одному.
- [x] **Step 4:** адресная проверка файлов и CI-гейты. **Commit** `feat(tasks): createTask flow step and worker handler`.

---

### Task 2: Builder — step editor, viewer, registration and i18n

**Interfaces (produces):**

- `apps/builder/src/features/flows/react-flow/steps/create-task/index.ts`:

```ts
import {
  type CreateTaskStepSchema,
  createTaskStepDefaultFn,
  createTaskStepSchema,
} from "@chatbotx.io/flow-config"
import type { StepDefinition } from "../definition"
import CreateTaskStepEditor from "./editor"
import CreateTaskStepViewer from "./viewer"

export const createTaskStep: StepDefinition<CreateTaskStepSchema> = {
  editor: CreateTaskStepEditor,
  viewer: CreateTaskStepViewer,
  validator: createTaskStepSchema,
  defaultFn: createTaskStepDefaultFn,
}
```

- `viewer.tsx` — **точная копия структуры** `auto-assign-conversation/viewer.tsx`: `Card` → `BaseStepViewer icon={ListChecksIcon} title={t("flows.actions.createTask")}` → `data.states.map((state) => <BaseStateViewer data={state} key={state.id} />)` (навык `flow-step-development`: только `states.map(BaseStateViewer)`, никакого `.find()` и сырых `Handle`); `data: CreateTaskStepSchema`.
- `editor.tsx` — `BaseStepEditor icon={ListChecksIcon} title={t("flows.actions.createTask")}` с кнопкой «Изменить» и диалогом по образцу `external-request/editor.tsx` (стр. 61-93, 160-186): локальная форма `useForm<CreateTaskStepInput, unknown, CreateTaskStepSchema>({ resolver: zodResolver(createTaskStepSchema), defaultValues: { ...getValues(parentName) }, mode: "onChange" })`, на сохранение `useParentStepCommit<CreateTaskStepSchema>(parentName)` с патчем `{ title, description, assignee, dueIn, remindBeforeMinutes, priority, outputFieldId }` (`id`, `stepType`, `states` остаются нетронутыми — иначе ломаются рёбра), `form.reset(getValues(parentName))` при открытии. Поля диалога:
  - `InputField name="title"` (required) и `TextareaField name="description"` — подпись `tasks.fields.title` / `tasks.fields.description`, подсказка `tasks.flowStep.variablesHint` («можно использовать переменные контакта»); без литеральных фигурных скобок в строках перевода.
  - Исполнитель — **одно** поле `ComboboxField` (как в `create-task-dialog.tsx`), но значение хранится в схеме объектом, поэтому форму ведёт служебное строковое поле `assigneeValue` вне схемы **или** (проще) адаптер: опции `[{ label: t("tasks.flowStep.assigneeConversation"), value: "conversation" }, ...useContactAssigneeOptions()]` (`features/users/provider/user-hook.ts:59-130`, значения `u_<id>` / `t_<id>`), а значение поля берётся/пишется через чистые функции `assigneeToValue(assignee)` / `valueToAssignee(value)` из нового `steps/create-task/assignee-value.ts` (`conversation` ↔ `{ type: "conversation" }`, `u_5` ↔ `{ type: "user", userId: "5" }`, `t_7` ↔ `{ type: "team", teamId: "7" }`; неизвестное → `{ type: "conversation" }`), подключённые через `Controller` / `form.watch` + `form.setValue("assignee", …, { shouldValidate: true })`. Рядом `tasks.flowStep.assigneeHint` («если на диалоге никого нет — выход «ошибка»»).
  - Срок: `SelectField` режима «нет срока / через N» + `InputNumberField name="dueIn.amount"` и `SelectField name="dueIn.unit"` (опции из `createTaskDueUnits.options` с подписями `tasks.flowStep.units.minutes|hours|days`), показываются при включённом сроке; переключение «нет срока» пишет `dueIn: null` и обнуляет `remindBeforeMinutes`; включение — `{ amount: 1, unit: "hours" }`.
  - Напоминание: `InputNumberField name="remindBeforeMinutes"` («за N минут до срока») + кнопка «Очистить» (`null`); доступно только при заданном сроке; сообщения валидации — `tasks.flowStep.validation.remindNeedsDue` / `remindAfterDue` через замену `result.errors.remindBeforeMinutes` в кастомном резолвере по образцу `generate-code/editor.tsx:49-70` (иначе пользователь увидит английское сообщение схемы).
  - Приоритет: `SelectField name="priority"` с `tasks.priority.low|normal|high|urgent` (существующие ключи).
  - Поле вывода: `CustomFieldSelect allowCreate includeBotFields name="outputFieldId" label={t("tasks.flowStep.outputField")}` (как `generate-code/editor.tsx:157-164`, но **не** `required`); очистка должна давать `""` (не `undefined`/`null`) — при сабмите `outputFieldId: data.outputFieldId ?? ""`; подсказка `tasks.flowStep.outputFieldHint`.
  - Подсказка про выходы: `tasks.flowStep.errorsHint` («Выход «ошибка»: исполнитель не в пространстве, в команде нет участников, на диалоге никого нет или задачу не удалось создать»).
- `steps/index.tsx`: `import { createTaskStep } from "./create-task"` и `[stepTypes.enum.createTask]: createTaskStep` (по алфавиту рядом с `callApi`, стр. ~126).
- `nodes/perform-action/menu.tsx`: **верхнеуровневый пункт** (как `appointmentScheduling` / `questionnaires`, стр. ~551-559): `{ label: t("flows.actions.createTask"), icon: ListChecksIcon, stepType: stepTypes.enum.createTask }` — иконка совпадает с пунктом «Задачи» в боковом меню (`app-sidebar.tsx:134`); добавить `ListChecksIcon` в импорт `lucide-react` (по алфавиту).
- `viewerNodeTypes`, `analyticsNodeTypes`, `allNodesConfig`, `nodeTypeSchema` — **не менять** (Deviation 1). В тесте (ниже) зафиксировать это явно.
- **i18n (22 файла, одинаковая вложенность, `en` — источник):**
  - `flows.actions.createTask`: «Create Task» / ru «Создать задачу».
  - `tasks.actions.createFromMessage` — добавляется в Task 3 (не здесь).
  - `tasks.flowStep.*` (новый блок внутри `tasks`): `variablesHint`, `assigneeConversation` («Conversation assignee» / ru «Назначенный на диалог»), `assigneeHint`, `dueMode` («Due date» / «Срок»), `dueNone` («No due date» / «Без срока»), `dueIn` («Due in» / «Через»), `units.minutes|hours|days` («minutes/hours/days» / «минут/часов/дней»), `remindBefore` («Remind before due (minutes)» / «Напомнить до срока (минут)»), `outputField` («Save task id to field» / «Сохранить id задачи в поле»), `outputFieldHint`, `errorsHint`, `validation.remindNeedsDue`, `validation.remindAfterDue`. В английском тексте **не использовать** `{`/`}` и апострофы-экранирование ICU без нужды.
  - Приоритет, заголовок, описание, срок — существующие `tasks.fields.*`, `tasks.priority.*`. Если `ru` случайно совпал с английским (например «ID»), занести ключ в `apps/builder/__tests__/fixtures/ru-same-as-english.json` (тест `Russian catalog completeness` требует).
- **Тесты:**
  - `apps/builder/src/features/flows/react-flow/steps/__tests__/create-task-registration.test.ts` (по образцу `external-request-registration.test.ts`): дефолт с названием валиден и входит в `actionSteps`; `steps/index.tsx` содержит `import { createTaskStep } from "./create-task"` и `[stepTypes.enum.createTask]: createTaskStep`; `menu.tsx` содержит `stepType: stepTypes.enum.createTask`; `viewer.tsx` содержит `BaseStateViewer` и `data.states.map` и **не** содержит `<Handle`; `nodes/node-config.tsx` **не** содержит `createTask` (шаг, не узел).
  - `…/nodes/perform-action/__tests__/menu.test.ts`: `performActionMenus(t)` содержит верхнеуровневый `expect.objectContaining({ label: "flows.actions.createTask", stepType: stepTypes.enum.createTask })`.
  - `steps/create-task/assignee-value.test.ts` (рядом, `src/**/__tests__` допустим для узкого юнита): `assigneeToValue` / `valueToAssignee` — все три режима, мусор → `conversation`.
  - Существующие i18n-тесты (паритет ключей и русский каталог): `__tests__/i18n-messages.test.ts`, `__tests__/i18n-hardcoded-scanner.test.ts`, `__tests__/i18n-source-keys.test.ts` — по одному; `pnpm --filter builder i18n:check` и `i18n:ru status` **не** запускать локально (идут в CI).

- [x] **Step 1:** failing tests → `assignee-value.ts`, `index.ts`, `viewer.tsx`, `editor.tsx`, регистрация в `steps/index.tsx` и `menu.tsx` → pass по одному файлу.
- [x] **Step 2:** i18n во всех 22 файлах, `ru` по глоссарию; i18n-тесты пройдены.
- [x] **Step 3:** адресная проверка изменённых файлов. **Commit** `feat(tasks): create task step editor and viewer`.

---

### Task 3: Inbox — «Создать задачу» в меню входящего сообщения

**Факты (проверено чтением кода):** сегодня `MessageActions` рендерится только для комментариев (`message-item.tsx:387-395`, `isComment`, `isComment = message.type === "comment"` на `:149`); в самом меню `MessageActions` (`message-actions.tsx:302-407`) пункты «открыть сообщение / скрыть / изменить / удалить» рассчитаны на комментарии. `MessageItem` используется ещё в `integration-webchat/webchat-message-list.tsx:77` (гостевое отображение, **вне** `ChatStoreProvider`), а `MessageActions` вызывает `useChatStore`, который бросает без провайдера (`chat-store-provider.tsx:`~60) — поэтому показ меню для обычных сообщений включается **только** явным пропсом из инбокса. `CreateTaskDialog` сегодня неуправляемый (`useState`, `DialogTrigger`) и не принимает описание/`messageId` (`create-task-dialog.tsx:44-53`, сабмит `:201-218`). Сервис проверяет, что сообщение принадлежит диалогу, и требует `conversationId` при `messageId` (`task/service.ts:987-1030`) — клиент передаёт `messageId` + `conversationId` + `contactId`, `createdAt` не нужен.

**Interfaces (produces):**

- `apps/builder/src/features/tasks/lib/message-quote.ts`:

```ts
import { TASK_LIMITS } from "@chatbotx.io/database/partials"

/** Markdown-цитата: каждая строка с «> » (пустая — «>»); результат режется до лимита описания. */
export const toMarkdownQuote = (
  text: string,
  maxLength: number = TASK_LIMITS.maxDescriptionLength,
): string

/** Меню «Создать задачу» — только у входящих (клиентских) неудалённых сообщений. */
export const canCreateTaskFromMessage = (message: {
  messageType: string
  deletedAt: Date | string | null
}): boolean
```

  `toMarkdownQuote("a\n\nb")` → `"> a\n>\n> b"`; пустая/пробельная строка → `""`; `\r\n` нормализуется; обрезка не оставляет «висящего» префикса (режем по `maxLength` и `trimEnd`). Импорт `TASK_LIMITS` из `@chatbotx.io/database/partials` допустим в builder (уже используется в `features/tasks/schema/public.ts`).
- `CreateTaskDialog` (`features/tasks/components/create-task-dialog.tsx`): расширить пропсы **обратно совместимо** (существующие вызовы — Tasks page, `contact-tasks-section.tsx:47-55` — не меняются):

```ts
type CreateTaskDialogProps = {
  workspaceId: string
  defaultTargets?: {
    contactId?: string
    contactLabel?: string
    conversationId?: string
    messageId?: string
  }
  /** Предзаполненное описание (цитата сообщения). */
  defaultDescription?: string
  /** Управляемый режим: диалог открывает родитель, `DialogTrigger` не рендерится. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  trigger?: ReactElement
  onCreated?: (task: z.infer<typeof taskPublicResource>) => void
}
```

  Реализация: `const isControlled = openProp !== undefined`; `open = isControlled ? openProp : internalOpen`; единая `setOpen(next)` (обновляет внутреннее состояние, если неуправляемый, и всегда зовёт `onOpenChange`); `<DialogTrigger …>` — только при `!isControlled`. `initialValues = useMemo(() => ({ ...defaultFormValues, description: defaultDescription ?? "" }), [defaultDescription])`; `useForm({ defaultValues: initialValues, … })`; **`useEffect` по `open`**: при переходе в `true` — `form.reset(initialValues)` (в управляемом режиме родитель меняет `open` снаружи, а `handleOpenChange` не вызывается); закрытие и `onSuccess` сбрасывают в `initialValues` (вместо `defaultFormValues`). В `handleSubmit` добавить `messageId: defaultTargets?.messageId` рядом с `contactId` / `conversationId` (приватный `tasksAPI.create` принимает `messageId` — `api/private.ts:289`). Инвалидация уже есть (`useInvalidateTasks`, инвариант 21) — не терять.
- `MessageActions` (`message-actions.tsx`):
  - новые пропсы: `showCreateTask?: boolean`;
  - внутри: `const isComment = message.type === "comment"`; все существующие пункты (`messageLink`, «скрыть», «изменить», «удалить») показывать **только** при `isComment` (для комментариев поведение не меняется);
  - `const activeConversation` уже вычисляется (`:280-284`); добавить `const [isCreateTaskOpen, setIsCreateTaskOpen] = useState(false)`, `workspaceId = useWorkspaceId()` (уже импортирован `@/hooks/routing`); пункт `Button` «Создать задачу» (`ListPlusIcon`/`ListChecksIcon`, `t("tasks.actions.createFromMessage")`, `justify-start`) при `showCreateTask && activeConversation` — по клику `setOpen(false)` (закрыть popover) и `setIsCreateTaskOpen(true)`;
  - **диалог рендерится рядом с `Popover` (фрагмент), а не внутри `PopoverContent`**, иначе закрытие popover размонтирует диалог: 

```tsx
<>
  <Popover …>{/* как сейчас */}</Popover>
  {showCreateTask && activeConversation ? (
    <CreateTaskDialog
      defaultDescription={toMarkdownQuote(message.text ?? "")}
      defaultTargets={{
        contactId: activeConversation.contactId,
        conversationId: activeConversation.id,
        messageId: message.id,
      }}
      onOpenChange={setIsCreateTaskOpen}
      open={isCreateTaskOpen}
      workspaceId={workspaceId}
    />
  ) : null}
</>
```

  - кнопка-триггер ⋮ остаётся как есть (`opacity-0 group-hover:opacity-100`, у иконки должен быть `aria-label` — добавить `aria-label={t("actions.actions")}`: ключ `actions.actions` уже есть в `en.json`; проверить, не требуется ли новый).
- `MessageItem` (`message-item.tsx`): новый необязательный пропс `canCreateTask?: boolean` (по умолчанию `false` ⇒ гостевой webchat и любые другие места не меняются); `const showCreateTask = Boolean(canCreateTask) && canCreateTaskFromMessage(message)`; блок `:387-395` заменить условием `(isComment && !isEditing) || showCreateTask` и передавать `showCreateTask={showCreateTask}`; `onEdit` / `onDelete` / `onChangeHide` — как сейчас (для некомментариев MessageActions их игнорирует через `isComment`). Для входящих **комментариев** пункт тоже появляется (они входящие сообщения клиента).
- `message-list.tsx` (`:305-325`): `<MessageItem canCreateTask … />` — единственная правка списка.
- i18n: `tasks.actions.createFromMessage` — «Create task from message» / ru «Создать задачу из сообщения» во все 22 файла (рядом с `tasks.actions.create`); перевод на язык файла.
- Публичный API: **без изменений** (Deviation 6) — в отчёт этапа и docs записать: инвариант 23 соблюдён через существующую `tasks.create` (`messageId` из `messages.list`, требует `conversationId`).

**Тесты:**
- `apps/builder/__tests__/tasks-message-quote.test.ts`: `toMarkdownQuote` — одна строка, несколько строк с пустой между ними (`"> a\n>\n> b"`), `\r\n`, пустая и пробельная строки → `""`, обрезка по `maxLength` (результат ≤ лимита, без хвостовых пробелов), русский текст не ломается; `canCreateTaskFromMessage` — `incoming` + `deletedAt: null` → `true`; `outgoing`, служебные типы и удалённое → `false`.
- Существующие: `__tests__/message-item-timestamp.test.tsx` (рендер `MessageItem` без нового пропса остаётся прежним) — по одному файлу; i18n-тесты (паритет, русский каталог, hardcoded-scanner) — по одному. Тест `MessageActions` с `useChatStore`/`useWorkspaceId` не добавляем (тяжёлые провайдеры), логика вынесена в проверяемые `lib/message-quote.ts` и регистрационные проверки по исходнику не нужны.

- [x] **Step 1:** `tasks-message-quote` → `lib/message-quote.ts` → pass.
- [x] **Step 2:** `CreateTaskDialog` поддерживает управляемый режим, описание и `messageId`; существующие вызовы Tasks/contact сохранены.
- [x] **Step 3:** `MessageActions` / `MessageItem` / `message-list.tsx`; i18n во всех 22 файлах; целевые тесты пройдены.
- [x] **Step 4:** адресная проверка изменённых файлов. **Commit** `feat(tasks): create task from an incoming message`.

---

### Task 4: Docs and CI

- [x] `docs/tasks.md`:
  - Раздел **«Flow step: Create task»**: шаг внутри узла «Действие» (меню «Создать задачу»), поля (название и описание с переменными, исполнитель: сотрудник / команда / назначенный на диалог, срок «через N минут/часов/дней» или без, напоминание «за N минут до срока», приоритет, поле для id задачи), автосвязи с текущими контактом и диалогом (без `messageId`), актор `flow` с `createdByLabel` = название сценария (запасное «Flow»), ветки `success` / `error` и условия ошибки (Deviation 3), правило «запись id в поле не ломает успех», `taskChanged` обновляет открытые списки задач, а `notificationCreated` адресно обновляет колокольчик исполнителя; ограничения: `userId`/`teamId` не ремапятся при переносе сценария (Deviation 8).
  - Раздел **Interface** → пункт про инбокс: «У входящего сообщения клиента в меню действий — **Создать задачу**: диалог с описанием-цитатой (markdown, до лимита описания) и связями контакт + диалог + сообщение»; публичного API не добавлялось — это `tasks.create` с `contactId`, `conversationId`, `messageId`.
  - Раздел **API**: одна строка — шаг сценария настраивается через `flows.publish` / `flows.updateDraft` (шаг `createTask` в `performAction`), новых операций и новых токен-скоупов нет.
  - Раздел **Not yet**: удалить пункт «`createTask` flow step and **Create task** from a client message menu (stage 7)».
- [x] `docs/superpowers/specs/2026-10-17-team-tasks-design.md` §7: отличие от спеки зафиксировано; тип узла и реестры узлов не добавлялись.
- [x] **CLI / MCP:** новых процедур нет; проверка не выявила ручных списков типов шагов в CLI/MCP docs.
- [x] `.github/workflows/gkamion-checks.yml` (job `i18n`):
  - шаг builder (`working-directory: apps/builder`, первый список): `__tests__/tasks-message-quote.test.ts`, `src/features/flows/react-flow/steps/__tests__/create-task-registration.test.ts`, `src/features/flows/react-flow/steps/create-task/__tests__/assignee-value.test.ts`, `src/features/flows/react-flow/nodes/perform-action/__tests__/menu.test.ts`; один раз локально прогнать `__tests__/i18n-source-keys.test.ts` — если зелёный, добавить и его;
  - **новый** шаг `working-directory: packages/flow-config`: `pnpm exec vitest run __tests__/create-task.test.ts __tests__/channel-policies.test.ts` (в CI тестов этого пакета сейчас нет);
  - шаг worker (последний список): `__tests__/create-task-step-handler.test.ts`, `__tests__/create-task-step-registration.test.ts`, `__tests__/integration-worker-boot.test.ts`, `__tests__/integration-worker-incoming-message.test.ts`, `__tests__/external-request-handler.test.ts` (затронут экспортом хелперов).
- [x] Адресная проверка исходников прошла; workflow успешно проверен в CI. **Commit** `docs(tasks): stage 7 flow step and message action`.

---

## After all tasks

1. invariant-guard (haiku): инварианты 7 (i18n), 9 (цепочка слоёв — handler без `db`/репозиториев), 16 (проверить, что **не** нужно трогать реестры узлов, а реестры шагов заполнены), 21 (диалог инвалидирует `useInvalidateTasks` и после создания из сообщения), 23 (публичный API: `tasks.create` покрывает inbox-действие; шаг — через flows API). Финальное ревью (opus): исчерпывающие `Record<StepType, …>` (4 карты), типы формы редактора (`z.input` / `z.output`), стабильные id состояний (`successStateDefaultFn`/`errorStateDefaultFn`), пустая команда, свежее назначение диалога, `err` в логах.
2. Push → зелёный `gkamion-checks.yml` (включая новый шаг `flow-config` и `check-types`).
3. **Миграции нет** → ждать «да» пользователя только на деплой. Образы: `gh workflow run gkamion-images.yml -R blackshaytan/chatbotx-gkamion --ref feature/ru-channels-max-zzap-drom -f services=builder,worker` → `gh run watch` → `bash deploy/gkamion/up.sh builder worker`.
4. Проверка на проде: в сценарии добавить в «Действие» шаг «Создать задачу» (исполнитель — назначенный на диалог), запустить на диалоге без назначенного → ветка «ошибка»; назначить сотрудника → задача создана, у сотрудника **без перезагрузки** загорелся колокольчик, у задачи «создано сценарием «…»», связь с контактом и диалогом видна; шаг с командой без участников → «ошибка»; поле вывода получило id; в инбоксе у входящего сообщения меню «Создать задачу» → диалог с цитатой, после создания в карточке задачи видны контакт, диалог и сообщение; у исходящих сообщений и в webchat-превью пункта нет.
5. Навык Hermes: упомянуть, что сценарии умеют создавать задачи (шаг `createTask` через `flows.publish`).

## Self-review

- Спека §7 ✓ (поля, исполнитель-тройка, срок/напоминание, автосвязи, `createdBySource = flow`, `createdByLabel` = название сценария, выходы success/error, id в поле; **отличие**: шаг внутри «Действия», Deviation 1), §5 «Контакт и диалог» ✓ (меню «Создать задачу» у сообщения клиента: цитата + три связи), §6 ✓ (публичный API без изменений — Deviation 6/7). Инвариант 16 ✓ (реестры *шагов* исчерпаны: `stepTypes`, `actionSteps`, `flowStepHandlers`, `STEP_PRODUCES_MESSAGE`, `allSteps`, меню, `stepExecutionKinds`; реестры *узлов* осознанно не затронуты). Инвариант 21 ✓. Инвариант 23 ✓. Инвариант 9 ✓. Инвариант 7 ✓ (22 файла).
- Пробел отчёта разведки закрыт: `integration/worker.ts` не регистрировал слушатель уведомлений (только `schedule/worker.ts:69`) — Task 1.
- Миграций нет; тесты — по одному файлу; тяжёлые проверки — в CI.

## Решения по открытым вопросам

1. **Живая таблица задач:** пользователь согласовал `taskChanged`; обработчик публикует событие после создания задачи.
2. **Перенос сценариев между пространствами:** `userId`/`teamId` не ремапятся, как у `autoAssignConversation`; при несовпадении шага используется выход «ошибка».
3. **Комментарии:** действие доступно и у входящих комментариев клиента, поскольку это входящие сообщения.
4. **Сбой записи id в поле:** задача остаётся успешной, ошибка записи фиксируется предупреждением (`Deviation 4`).
