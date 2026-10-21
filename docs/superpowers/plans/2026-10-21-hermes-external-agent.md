# Hermes External Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ChatbotX отдаёт ответы клиентам внешнему ИИ-агенту Hermes (профиль `assistant`) через его `api_server` (`/v1/runs`), пересылает клиенту промежуточные служебные сообщения, умеет передавать разговор человеку и возвращать его боту.

**Architecture:** Новая настройка рабочего пространства «Внешний ИИ-агент» (таблицы `ExternalAgent`, `ExternalAgentInbox`, `ExternalAgentConversationState`) → сервис `externalAgentService` в `@chatbotx.io/business` → два задания в очереди `aiAgent`: `externalAgentReply` (собирает новые сообщения и запускает run) и `externalAgentWatch` (читает SSE-события run ограниченными порциями по ≤55 с и перезапускает себя). Ответы отправляются существующим `ChatJobAction.sendChatMessage` (senderType `bot`). Передача человеку — существующий `disableBotState` плюс служебная заметка; публичная процедура `externalAgent.handover` — инструмент для Hermes через MCP.

**Tech Stack:** Drizzle + PostgreSQL, BullMQ, oRPC, Next.js 16, next-intl, vitest + msw, Hermes Agent api_server (Python, systemd).

**Spec:** `docs/superpowers/specs/2026-10-21-hermes-external-agent-design.md`

---

## Global Constraints

- Ответы пользователю — на русском. Секреты только в `.secrets/`, `.env`, `.env.prod`; значения не печатать (маскировать).
- `db:migrate` НЕ запускать без явного «да» пользователя. Миграцию генерировать и показывать.
- Hermes: менять только профиль `assistant`; перезапуск его сервиса — только после явного разрешения пользователя. Другие профили, Гека, n8n, старый Dashboard, tmtr-runner — только чтение.
- Telegram-бот `assistant` остаётся подключённым к Hermes напрямую; в ChatbotX его не подключать. Каналы не активировать.
- Тяжёлые проверки (tsc, vitest) — только на GitHub (`gkamion-checks.yml`); локально только `npx ultracite check|fix <paths>`. Не больше 2 вспомогательных агентов одновременно.
- Тесты без реальных внешних API (msw / моки). Логи ошибок — `{ err }`. Никаких динамических `import()` в `packages/*`, `integrations/*`, `apps/worker`.
- Новые i18n-ключи — во все 22 файла `apps/builder/messages/*.json` (русский в `ru.json`, английский в остальных).
- Коммиты: только конкретные файлы (`git add <path>`), не `apps/builder/AGENTS.md`. Формат по `.agents/rules/git.md`.
- Окружение: `export PATH=/GKamion/chatbotX/.tools/node-24/bin:$PATH`.

## Deviations from the spec (decided while planning)

1. **Очередь.** Задания идут в существующую очередь `aiAgent` (она для ИИ-ответов и уже проверяет заблокированное рабочее пространство), а не в `chat`: чтение SSE до 55 с не должно занимать слоты отправки сообщений.
2. **Повторы запуска run.** BullMQ exponential с базой 30 с даёт 30 с / 1 мин / 2 мин (а не 30 с / 2 мин / 5 мин). Смысл тот же — 3 повтора с ростом паузы.
3. **Ключевые слова и встроенный ИИ.** Когда внешний агент включён для входящего и бот в разговоре включён, `automatedResponseService.enqueue` (ключевые слова / встроенный ИИ-агент) для входящего сообщения не вызывается — иначе клиент получит два ответа. Активная «challenge» (ожидание ответа на вопрос Get User Data) по-прежнему имеет приоритет.
4. **Остановка run при передаче человеку** делается не в `disableBotState` (бизнес-слой не ходит в Hermes), а в `externalAgentWatch`: он на каждом событии и в начале каждой порции проверяет `botEnabled`, при `false` вызывает `stop` и ничего клиенту не шлёт. Задержка — до одного события/порции.
5. **Курсор** хранится как `cursorAt` (время последнего обработанного входящего) + `cursorMessageId`, а не только id: сообщения выбираются через `findLastByConversation(..., { sinceTime })`.
6. **Вложения без текста** (фото, файлы) тоже отправляются агенту: для разговоров внешнего агента маршрут срабатывает при `hasActionableInput`, а не только при `hasText`.
7. **Новый публичный scope не нужен:** `get/update/test` — scope `settings`; `handover` — scope `inbox` (его получит токен Hermes вместе с `contacts`).

## File map

**Create**
- `packages/database/src/schema/external-agent.ts` — 3 таблицы.
- `packages/database/src/relations/external-agent.ts` — связи.
- `packages/database/src/partials/external-agent.ts` — zod-схемы и константы (провайдер, дефолты, тип служебной заметки).
- `packages/database/src/repositories/external-agent/{repository.ts,index.ts}` — сырые запросы.
- `packages/database/drizzle/<ts>_external_agent/migration.sql` (+ snapshot) — генерируется.
- `packages/business/src/external-agent/{service.ts,hermes-client.ts,sse.ts,progress.ts,input.ts,index.ts}`.
- `packages/business/__tests__/external-agent/{service.test.ts,hermes-client.test.ts,sse.test.ts,progress.test.ts,input.test.ts}`.
- `apps/worker/src/ai-agent/handlers/external-agent-reply.ts`, `apps/worker/src/ai-agent/handlers/external-agent-watch.ts`.
- `apps/worker/__tests__/external-agent-reply.test.ts`, `apps/worker/__tests__/external-agent-watch.test.ts`, `apps/worker/__tests__/external-agent-routing.test.ts`.
- `apps/builder/src/features/external-agent/{api/public.ts,api/index.ts,schema/index.ts,lib/activity.ts,components/external-agent-settings-form.tsx,components/external-agent-activity.tsx}`.
- `apps/builder/src/app/space/[workspaceId]/(settings)/settings/integrations/external-agent/page.tsx`.
- `apps/builder/__tests__/external-agent-api.test.ts`.

**Modify**
- `packages/database/src/schema/index.ts`, `packages/database/src/relations/index.ts` (import + spread), `packages/database/src/repositories/index.ts`.
- `packages/flow-config/src/event/error-log-schema.ts` — провайдер `hermes`.
- `packages/business/src/index.ts` — экспорт сервиса.
- `packages/business/src/conversation/service.ts` — `updateBotEnabled` (срок авто-возврата), `enableBotState` (сброс курсора).
- `packages/worker-config/src/queues/ai-agent/index.ts` — 2 действия + схемы.
- `apps/worker/src/ai-agent/worker.ts` — dispatch.
- `apps/worker/src/integration/worker.ts` + `apps/worker/src/integration/routing.ts` — маршрут `externalAgent`.
- `apps/builder/src/routers/public.ts`, `apps/builder/src/routers/index.ts`, `apps/builder/__tests__/api-parity-manifest.json`.
- `apps/builder/src/features/integrations/settings-registry.ts` — slug `external-agent`.
- `apps/builder/src/features/messages/components/message-item.tsx` — рендер служебной заметки.
- `apps/builder/messages/*.json` (22) — раздел `externalAgent`.
- `.github/workflows/gkamion-checks.yml` — новые тесты.
- Docs: `docs/external-agent.md` (новый), ссылка в `AGENTS.md` «Docs and support links»; CLI/MCP — по skill `cli-mcp-docs`.
- Hermes (VPS, не репозиторий): `/opt/hermes-data/profiles/assistant/config.yaml`, `.../assistant/SOUL.md`.

---

## Task 1: Schema, relations, migration

**Files:** create `schema/external-agent.ts`, `relations/external-agent.ts`, `partials/external-agent.ts`; modify `schema/index.ts`, `relations/index.ts`, `partials/index.ts` (если есть barrel).

Read first: `.agents/skills/drizzle-database/SKILL.md`; образцы `schema/ai-handover-settings.ts`, `schema/inbox-team-member.ts`, `schema/decision-connection.ts` (зашифрованный `jsonb`).

- [ ] **1.1 Partials** `packages/database/src/partials/external-agent.ts`:

```ts
import { z } from "zod"

export const externalAgentProviders = z.enum(["hermes"])
export type ExternalAgentProvider = z.infer<typeof externalAgentProviders>

export const EXTERNAL_AGENT_DEFAULT_MAX_RUN_MINUTES = 30
export const EXTERNAL_AGENT_MAX_RUN_MINUTES_LIMIT = 240
export const EXTERNAL_AGENT_DEFAULT_PROGRESS_MESSAGE =
  "Работаю над вашим запросом, это займёт несколько минут"
export const EXTERNAL_AGENT_ACTIVITY_TYPE = "externalAgent"

export const externalAgentCheckStatuses = z.enum(["ok", "error"])
export const externalAgentActivityEvents = z.enum([
  "handover",
  "unavailable",
  "timeout",
])
export type ExternalAgentActivityEvent = z.infer<
  typeof externalAgentActivityEvents
>

export const externalAgentApiKeySchema = z.object({ apiKey: z.string().min(1) })
```

- [ ] **1.2 Schema** `packages/database/src/schema/external-agent.ts` — три таблицы:
  - `externalAgentModel` = `pgTable("ExternalAgent", { ...sharedColumns, workspaceId (FK cascade, unique), provider: text().$type<ExternalAgentProvider>().notNull().default("hermes"), baseUrl: text().notNull(), apiKey: jsonb().$type<EncryptedData>().notNull(), enabled: boolean().notNull().default(false), resumeAfterHours: integer(), maxRunMinutes: integer().notNull().default(30), progressMessage: text().notNull().default(EXTERNAL_AGENT_DEFAULT_PROGRESS_MESSAGE), lastCheckedAt: timestamp(timestampConfig), lastCheckStatus: text(), lastCheckError: text() })`.
  - `externalAgentInboxModel` = `pgTable("ExternalAgentInbox", { ...sharedColumns, externalAgentId (FK → ExternalAgent cascade), inboxId (FK → Inbox cascade), workspaceId (FK cascade) }, (t) => [uniqueIndex("ExternalAgentInbox_agent_inbox_key").on(t.externalAgentId, t.inboxId), index("ExternalAgentInbox_inboxId_idx").on(t.inboxId)])`.
  - `externalAgentConversationStateModel` = `pgTable("ExternalAgentConversationState", { conversationId: bigintAsString().primaryKey(), workspaceId (FK cascade), cursorAt: timestamp(timestampConfig), cursorMessageId: bigintAsString(), includeHistory: boolean().notNull().default(true), runId: text(), runStartedAt, lastEventAt, lastEventSeq: integer().notNull().default(-1), lastProgressSentAt, lastProgressText: text(), lastClientSendAt, progressFallbackSentAt, failureCount: integer().notNull().default(0), lastError: text(), updatedAt })`. Без FK на `Conversation` (как в `contact-on-smart-delay.ts`), индекс по `workspaceId`.
  - Экспорт типов `ExternalAgentModel`, `ExternalAgentInboxModel`, `ExternalAgentConversationStateModel` (`$inferSelect`).
- [ ] **1.3** `schema/index.ts`: `export * from "./external-agent"`.
- [ ] **1.4 Relations** `relations/external-agent.ts` по образцу `ai-handover-settings.ts`: `externalAgentModel.workspace` (one), `externalAgentModel.inboxes` (many → `externalAgentInboxModel`), `externalAgentInboxModel.externalAgent`/`inbox` (one). `relations/index.ts`: **и** import, **и** spread (инвариант 2).
- [ ] **1.5 Migration:** `pnpm --filter @chatbotx.io/database make:migration external_agent`. Проверить SQL глазами: 3 `CREATE TABLE`, FK `ON DELETE cascade`, unique-индексы, без `DROP`. `db:check-drift` проходит (`pnpm --filter @chatbotx.io/database lint`). **Не применять** — показать SQL пользователю и ждать «да».
- [ ] **1.6** `npx ultracite fix packages/database/src` → commit `feat(database): add external agent tables`.

## Task 2: Repository

**Files:** create `packages/database/src/repositories/external-agent/{repository.ts,index.ts}`; modify `repositories/index.ts`.

Образец: `repositories/connection-poll-state/repository.ts` (объект с методами, `tx: DatabaseClient = db`).

- [ ] **2.1** Методы `externalAgentRepository`:
  - `findByWorkspace(workspaceId, tx?)` → агент + `inboxIds: string[]`.
  - `upsert({ workspaceId, values, inboxIds }, tx?)` — `insert … onConflictDoUpdate(target: workspaceId)`, затем замена набора `ExternalAgentInbox` (delete where not in + insert onConflictDoNothing) — внутри одной транзакции, которую открывает сервис.
  - `updateCheck({ workspaceId, status, error, checkedAt })`.
  - `findActiveForInbox({ workspaceId, inboxId })` → агент, если `enabled = true` и инбокс привязан, иначе `null`.
  - `findResumePolicyForConversations({ workspaceId, conversationIds }, tx?)` → `{ conversationId, resumeAfterHours }[]` — join `Conversation.inboxId` → `ExternalAgentInbox` → `ExternalAgent.enabled = true`.
- [ ] **2.2** `externalAgentStateRepository`: `find({ workspaceId, conversationId })`, `upsert(values)`, `patch({ workspaceId, conversationId, values, expectedRunId? })` (условие `runId = expectedRunId`, чтобы старый watch не перетёр новый run; возвращает количество строк), `resetForResume({ workspaceId, conversationIds, at })` → `cursorAt = at, cursorMessageId = null, includeHistory = true, runId = null, failureCount = 0` (upsert для каждого id).
- [ ] **2.3** Экспорт из `repositories/index.ts`. `ultracite fix` → commit `feat(database): add external agent repositories`.

## Task 3: Hermes client, SSE parser, pure helpers (TDD)

**Files:** create `packages/business/src/external-agent/{sse.ts,hermes-client.ts,progress.ts,input.ts}` + тесты в `packages/business/__tests__/external-agent/`.

- [ ] **3.1 Тест SSE-парсера** `sse.test.ts`: куски `": open\n\n"`, `"id: 3\ndata: {\"event\":\"message.interim\",\"text\":\"Ищу\"}\n\n"`, кадр, разрезанный между двумя chunk'ами, `\r\n`, `": stream closed\n\n"`, кадр `replay.truncated` без `id`. Ожидание: массив `{ id: number | null, data: object }`, комментарии игнорируются, `closed: true` на `stream closed`.
- [ ] **3.2 Реализация** `sse.ts`:

```ts
export type HermesSseEvent = {
  id: number | null
  data: { event?: string; [key: string]: unknown }
}

export const createSseParser = () => {
  let buffer = ""
  let closed = false

  const parseFrame = (frame: string): HermesSseEvent | null => {
    let id: number | null = null
    const dataLines: string[] = []
    for (const line of frame.split("\n")) {
      if (line.startsWith(":")) {
        if (line.includes("stream closed")) {
          closed = true
        }
        continue
      }
      if (line.startsWith("id:")) {
        const parsed = Number.parseInt(line.slice(3).trim(), 10)
        id = Number.isNaN(parsed) ? null : parsed
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart())
      }
    }
    if (dataLines.length === 0) {
      return null
    }
    try {
      return { id, data: JSON.parse(dataLines.join("\n")) }
    } catch {
      return null
    }
  }

  const push = (chunk: string): HermesSseEvent[] => {
    buffer += chunk.replaceAll("\r\n", "\n")
    const frames = buffer.split("\n\n")
    buffer = frames.pop() ?? ""
    return frames.map(parseFrame).filter((e): e is HermesSseEvent => e !== null)
  }

  return { push, isClosed: () => closed }
}
```

- [ ] **3.3 Тест клиента** `hermes-client.test.ts` (msw, базовый URL `http://hermes.test`): `startRun` шлёт `Authorization: Bearer k`, `X-Hermes-Session-Key`, `Idempotency-Key`, тело `{ input, instructions }`, возвращает `{ runId }`; 401 → `HermesAuthError`; 5xx → `HermesUnavailableError`; `getRun` возвращает `{ status, output, error }`; `steer` 409 → `{ accepted: false }`; `stop` 404 → игнорируется; `readEvents` читает поток, прерывается по `AbortSignal` через `windowMs` и отдаёт события по одному в колбэк; `health` (GET `/health`) → ok.
- [ ] **3.4 Реализация** `hermes-client.ts` — фабрика `createHermesClient({ baseUrl, apiKey, fetchImpl = fetch })` с методами `health`, `startRun({ sessionKey, idempotencyKey, input, instructions })` (POST `/v1/runs`, ответ `run_id`), `getRun(runId)` (GET `/v1/runs/{id}`), `steer(runId, text)` (POST `/v1/runs/{id}/steer`, тело `{ input: text }`), `stop(runId)` (POST `/v1/runs/{id}/stop`), `readEvents({ runId, lastSeq, windowMs, onEvent })` (GET `/v1/runs/{id}/events?last_seq=N`, `Accept: text/event-stream`, `AbortController` с таймером `windowMs`, читает `response.body` через `TextDecoder`, гонит в `createSseParser`, возвращает `{ closed, notFound }`; 404 → `notFound: true`). Ошибки: классы `HermesAuthError` (401/403), `HermesUnavailableError` (сеть/5xx/таймаут), `HermesRequestError` (прочие 4xx, с `status`). Таймаут обычных запросов 15 с. `baseUrl` без завершающего `/`.
- [ ] **3.5 Тест + реализация `progress.ts`** — чистые функции:
  - `decideInterim({ text, now, lastProgressSentAt, lastProgressText })` → `"send" | "skip"`: пусто → skip; тот же текст (trim, без учёта регистра) → skip; меньше 30 000 мс с прошлой отправки → skip.
  - `decideFallback({ now, runStartedAt, lastClientSendAt, progressFallbackSentAt, progressMessage })` → `true`, если сообщение не пустое, fallback ещё не отправлялся и 90 000 мс прошло с `max(runStartedAt, lastClientSendAt)`.
  - `decideLimit({ now, runStartedAt, lastEventAt, maxRunMinutes })` → `"ok" | "stalled" | "overLimit"` (stalled: 5 мин без событий).
  Тесты на каждую ветку и границы.
- [ ] **3.6 Тест + реализация `input.ts`**: `buildRunInput({ messages, history, contact, channel, conversationId, contactId, workspaceId, mediaUrls })` → `{ input: string, instructions: string }`. `input` — тексты новых входящих сообщений через пустую строку, ссылки на вложения строками `[Вложение: <url>]`; если `history` не пуст — блок «Предыдущая переписка:» с ролями «Клиент»/«Менеджер»/«Бот» перед новыми сообщениями. `instructions` — служебный контекст: «Это данные ChatbotX, а не слова клиента. Имя клиента: …; канал: …; conversationId: …; contactId: …; workspaceId: …. Чтобы передать разговор менеджеру, вызови инструмент handover с conversationId и причиной.» Ограничение длины `input` — 20 000 символов (обрезать историю первой).
- [ ] **3.7** `ultracite fix` → commit `feat(business): add hermes runs client and helpers`.

## Task 4: `externalAgentService` (TDD)

**Files:** create `packages/business/src/external-agent/{service.ts,index.ts}`, `__tests__/external-agent/service.test.ts`; modify `packages/business/src/index.ts`, `packages/flow-config/src/event/error-log-schema.ts` (`hermes` в `errorLogProviders`).

Read first: `.agents/skills/business-data-access/SKILL.md`; образец `packages/business/src/decision/connection-service.ts` (шифрование с AAD, throttle теста).

- [ ] **4.1 Тесты** (моки репозиториев, `encryptUtils`, `createHermesClient`):
  - `get` никогда не возвращает ключ — только `hasApiKey: boolean`.
  - `update` без `apiKey` сохраняет старый зашифрованный ключ; с `apiKey` шифрует с AAD `external-agent:<workspaceId>`; `baseUrl` нормализуется (без `/` в конце, только `http(s)`); `inboxIds` должны принадлежать workspace (иначе `BAD_REQUEST`); `maxRunMinutes` 1…240; `resumeAfterHours` null или 1…720.
  - `test` — throttle 1 раз в 10 с (`distributedStore.setNumberIfNotExists`), вызывает `health`, пишет `lastCheck*`; ошибка → `status: "error"` с текстом без секрета.
  - `getRuntime({ workspaceId, inboxId })` → `{ agent, client }` или `null` (агент выключен / инбокс не привязан).
  - `handover({ workspaceId, conversationId, reason })` → `conversationService.disableBotState` с `triggerContext { triggerSource: "system", triggerHandler: "externalAgent", triggerType: "external_agent_handover" }` + служебная заметка `event: "handover"` с `reason`; повтор на уже выключенном боте — только заметка не дублируется (sourceId `externalAgent:handover:<conversationId>:<minute>`).
  - `failToHuman({ ..., event: "unavailable" | "timeout", error })` → отправка клиенту «Передал ваш запрос менеджеру» (через переданный колбэк `sendText`), `disableBotState`, заметка, `logProviderError({ provider: "hermes", ... })`.
- [ ] **4.2 Реализация** `ExternalAgentService extends BaseService`:
  - `get(workspaceId)` (через `withCache` с тегом `externalAgent:<workspaceId>`), `update(workspaceId, input)` (транзакция, `invalidateCacheTags`), `test(workspaceId)`, `getRuntime`, `handover`, `failToHuman`, `writeActivity({ workspaceId, conversation, event, reason? })` — `createMessageRepository().createOrUpdate({ messageType: "activity", senderType: "system", text, contentAttributes: { type: EXTERNAL_AGENT_ACTIVITY_TYPE, event, reason } })` + `publishToWorkspaceParty(messageCreated)` как в `thread-control/service.ts:1020-1060`.
  - Текст заметки на сервере английский (запасной), UI переводит по `event` (Task 7).
  - Экспорт `externalAgentService` и типов из `packages/business/src/index.ts`.
- [ ] **4.3** `ultracite fix` → commit `feat(business): add external agent service`.

## Task 5: Bot pause/resume integration

**Files:** modify `packages/business/src/conversation/service.ts`; test `packages/business/__tests__/external-agent/bot-resume.test.ts`.

- [ ] **5.1 Тест:** `updateBotEnabled({ botEnabled: false, ids: [a, b] })`, где `a` — в инбоксе агента с `resumeAfterHours: null`, `b` — обычный: `a.botResumeAt = null`, `b.botResumeAt ≈ now + 24h`. С `resumeAfterHours: 6` → `now + 6h`. Явный `props.botResumeAt` имеет приоритет и не трогает политику.
- [ ] **5.2 Реализация** в `updateBotEnabled`: если `!botEnabled && props.botResumeAt === undefined`, вызвать `externalAgentRepository.findResumePolicyForConversations({ workspaceId, conversationIds: ids, tx })`, разбить ids на группы по `botResumeAt` и выполнить update на каждую группу (остальные — прежние 24 ч). Код вычисления — чистая функция `resolveExternalAgentResumeAt(resumeAfterHours, now)` в `external-agent/progress.ts` (без импорта сервиса — нет циклической зависимости).
- [ ] **5.3** В `enableBotState` после обновления: `externalAgentStateRepository.resetForResume({ workspaceId, conversationIds, at: new Date() })` — следующий ход агента увидит только новые сообщения + последние 10 как историю.
- [ ] **5.4** commit `feat(business): apply external agent resume policy`.

## Task 6: Public + private API (agent-first — до UI)

**Files:** create `apps/builder/src/features/external-agent/{schema/index.ts,api/public.ts,api/index.ts}`, `apps/builder/__tests__/external-agent-api.test.ts`; modify `routers/public.ts`, `routers/index.ts`, `__tests__/api-parity-manifest.json`.

Read first: `.agents/skills/orpc-api/SKILL.md`; образцы `workspaces/api/public.ts`, `connections/api/public.ts`.

- [ ] **6.1 Схемы** `schema/index.ts`: `externalAgentOutputSchema` (`enabled, provider, baseUrl, hasApiKey, inboxIds, resumeAfterHours, maxRunMinutes, progressMessage, lastCheckedAt, lastCheckStatus, lastCheckError`), `updateExternalAgentInputSchema` (все поля optional, `apiKey?: string`), `externalAgentTestOutputSchema` (`status, error, checkedAt`), `externalAgentHandoverInputSchema` (`conversationId`, `reason: string.min(1).max(500)`).
- [ ] **6.2 Публичные процедуры** `api/public.ts`:
  - `get` — GET `/v1/external-agent` scope `settings`. Summary: «Get the workspace external AI agent (Hermes) settings. Inbox ids come from `inboxes.list`.»
  - `update` — PATCH `/v1/external-agent` scope `settings`. У токенов рабочего пространства нет ролей, поэтому достаточно scope `settings` (как у `workspace.updateSettings`); проверка владельца/superAdmin — только в приватном API.
  - `test` — POST `/v1/external-agent/test` scope `settings`.
  - `handover` — POST `/v1/conversations/{conversationId}/external-agent-handover` scope `inbox`. Summary: «Hand a conversation over to a human manager with a reason. Pauses the bot. Conversation ids come from `conversations.list` or the run context.»
  Все вызывают методы `externalAgentService`.
- [ ] **6.3 Приватные процедуры** `api/index.ts`: те же `get/update/test` через `authorizedAPI … .use(workspaceAuthorizedMidddleware, (i) => i.workspaceId)` + проверка `hasWorkspacePermission(permissions, "superAdmin")` иначе `ORPCError("FORBIDDEN")`; регистрация `externalAgent: lazy(() => import(...))` в `routers/index.ts`.
- [ ] **6.4** `routers/public.ts`: ключ `externalAgent` (по алфавиту). Manifest: записи для приватных процедур `covered:externalAgent.get|update|test`.
- [ ] **6.5 Тест** `external-agent-api.test.ts`: публичный роутер содержит 4 процедуры с ожидаемыми scope; `get` не отдаёт `apiKey`; приватный `update` без superAdmin → FORBIDDEN (сервис замокан).
- [ ] **6.6** `ultracite fix` → commit `feat(builder): add external agent api`.

## Task 7: Worker jobs

**Files:** modify `packages/worker-config/src/queues/ai-agent/index.ts`, `apps/worker/src/ai-agent/worker.ts`, `apps/worker/src/integration/routing.ts`, `apps/worker/src/integration/worker.ts`; create handlers и тесты.

Read first: `.agents/skills/worker-development/SKILL.md`, `.agents/skills/reliability-concurrency/SKILL.md`.

- [ ] **7.1 Очередь:** `AIJobAction.externalAgentReply`, `AIJobAction.externalAgentWatch`; схемы `data: { workspaceId, conversationId, contactInboxId }` (+ `messageId` для reply; `runId` для watch); добавить в `aiJobDataSchema`. Хелперы:

```ts
export const enqueueExternalAgentReply = (data: ExternalAgentReplyData) =>
  aiAgentQueue.add(AIJobAction.externalAgentReply, { type: AIJobAction.externalAgentReply, data }, {
    jobId: `externalAgentReply-${data.conversationId}`,
    delay: 5000,
    deduplication: { id: `externalAgentReply-${data.conversationId}`, ttl: 5000, extend: true, replace: true },
    attempts: 4,
    backoff: { type: "exponential", delay: 30_000 },
    removeOnComplete: true,
    removeOnFail: 100,
  })

export const enqueueExternalAgentWatch = (data: ExternalAgentWatchData, delay = 0) =>
  aiAgentQueue.add(AIJobAction.externalAgentWatch, { type: AIJobAction.externalAgentWatch, data }, {
    jobId: `externalAgentWatch-${data.conversationId}-${data.runId}-${Date.now()}`,
    delay,
    attempts: 3,
    backoff: { type: "exponential", delay: 10_000 },
    removeOnComplete: true,
    removeOnFail: 100,
  })
```

  (`removeOnComplete: true` обязательно для reply — иначе сохранённый jobId проглотит следующий add, см. `coexist-job-ids.ts`; в id нет `:` — BullMQ запрещает.)
- [ ] **7.2 Маршрут.** В `routing.ts` добавить в `IncomingRoutingDecision` вариант `{ type: "externalAgent", conversation }` и параметр `isExternalAgentInbox: boolean`: после проверки активности и challenge — если `isExternalAgentInbox`, вернуть `externalAgent` при `hasActionableInput` (а не только `hasText`). В `integration/worker.ts`: до вызова `resolveIncomingTextRouting` получить `externalAgentService.getRuntime({ workspaceId, inboxId })` (кэш) только для `isFromContact`; ветка `externalAgent` → `enqueueExternalAgentReply(...)`, `automatedResponseService.enqueue` не вызывается. Тест `external-agent-routing.test.ts` на routing-функцию: агент + текст → externalAgent; агент + фото → externalAgent; агент + challenge → challenge; бот выключен → handoffReentry/none; без агента — прежнее поведение.
- [ ] **7.3 Тест reply-хендлера** `external-agent-reply.test.ts` (`vi.hoisted` моки, образец `ads-automatic-event.test.ts`):
  - бот выключен → ничего; агент выключен → ничего;
  - нет новых входящих после курсора → ничего;
  - активный run → `steer` с текстом новых сообщений, курсор сдвинут; `steer` вернул 409 → повторный `enqueueExternalAgentReply` с задержкой 5 с;
  - нет run → `startRun` с `X-Hermes-Session-Key = chatbotx:<ws>:<conv>`, `Idempotency-Key = <conv>:<lastMessageId>`, `includeHistory` → 10 сообщений истории, после — `includeHistory=false`, `runId` сохранён, `enqueueExternalAgentWatch`;
  - `HermesAuthError` → сразу `failToHuman("unavailable")` без повторов (`UnrecoverableError`);
  - `HermesUnavailableError` не на последней попытке → throw (повтор BullMQ); на последней (`isFinalAttempt`) → `failToHuman("unavailable")`.
- [ ] **7.4 Реализация** `external-agent-reply.ts`: `withBlockedOwnerGuard(workspaceId, () => distributedLock.runExclusive({ key: "externalAgent:<conversationId>", timeoutInSeconds: 60, retryTimeoutInSeconds: 10, fn }))`. Внутри: перечитать `conversation` (`conversationService`), `ensureActive`, `getRuntime`, состояние; `findLastByConversation(conversationId, { workspaceId, limit: 30, messageTypes: ["incoming","outgoing"], withAttachments: true, sinceTime })`; новые = входящие от контакта после `cursorAt` (кроме `cursorMessageId`); если курсора нет — входящие после последнего исходящего; медиа — `signMediaToken` + `buildProxyUrl` (24 ч). `buildRunInput` → `startRun` / `steer`. Курсор сдвигается только после успешного POST.
- [ ] **7.5 Тест watch-хендлера** `external-agent-watch.test.ts`:
  - `message.interim` проходит `decideInterim` → `sendChatMessage` и запись `lastProgress*`, `lastClientSendAt`; дубль/слишком рано → пропуск;
  - `tool.*`/delta → только `lastEventAt`/`lastEventSeq`;
  - `run.completed` с `output` → бот ещё включён → `sendChatMessage(output)`, `runId = null`, `failureCount = 0`; если после курсора есть новые входящие → `enqueueExternalAgentReply`;
  - `run.completed`, но бот выключен → ничего клиенту, `runId = null`;
  - `run.failed`/`run.cancelled`/`approval.request` → `stop` (для approval) + `failToHuman("unavailable")`;
  - бот выключился во время run → `stop`, ничего клиенту;
  - порция закончилась без финала → `decideFallback` (отправить `progressMessage` один раз), `decideLimit`: `stalled`/`overLimit` → `stop` + `failToHuman("timeout")`; иначе `enqueueExternalAgentWatch`;
  - `readEvents` → `notFound` или поток закрыт без финального события → `getRun`: `completed` → отправка `output` (без повтора, если `runId` уже очищен); `running` → новая порция;
  - `patch` с `expectedRunId` вернул 0 (run заменён) → тихо выйти.
- [ ] **7.6 Реализация** `external-agent-watch.ts` (окно `windowMs = 55_000`, под тем же lock, но lock держится только на время обработки событий, а не всего чтения: события копятся в массив по `onEvent`, затем обрабатываются под lock). Все отправки клиенту — `chatQueue.add(ChatJobAction.sendChatMessage, { type, data: { conversation, contactInbox, text } })`.
- [ ] **7.7 Dispatch** в `ai-agent/worker.ts`: два `case`, `isFinalAttempt(job)` передаётся в reply.
- [ ] **7.8** Добавить новые тесты в `.github/workflows/gkamion-checks.yml` (job «i18n and notification tests»). `ultracite fix` → commit `feat(worker): run hermes external agent replies`.

## Task 8: Settings UI + i18n

**Files:** create `features/external-agent/components/{external-agent-settings-form.tsx,external-agent-activity.tsx}`, `features/external-agent/lib/activity.ts`, страница `settings/integrations/external-agent/page.tsx`; modify `settings-registry.ts`, `message-item.tsx`, 22 файла сообщений.

Read first: `.agents/skills/builder-ui-i18n/SKILL.md`; образец — страница decision-connections.

- [ ] **8.1 Реестр:** `{ slug: "external-agent", titleKey: "externalAgent.title", icon: BotIcon }`.
- [ ] **8.2 Страница:** async Server Component, `params` — Promise; доступ только owner/superAdmin (иначе `notFound()` как у соседних интеграций); данные через `orpc.externalAgent.get.queryOptions`.
- [ ] **8.3 Форма** (react-hook-form + zod, `useHookFormAction` нет — используем oRPC mutation `orpc.externalAgent.update.mutationOptions` + `invalidateQueries` по ключу `get`, инвариант 21): переключатель «Включён»; «Адрес Hermes» (`baseUrl`); «Ключ API» (password, placeholder «Сохранён» при `hasApiKey`, пустое = не менять); мультивыбор инбоксов (существующий `useInboxOptions`/`MultiSelect`); «Автовозврат к боту»: «Никогда» или число часов; «Максимум на задачу, мин»; «Сообщение о долгой задаче» (textarea, пустое = выключено); кнопка «Проверить подключение» → `test`, показ статуса и времени последней проверки. Все строки — `useTranslations("externalAgent")`, обработчики `handle*`, aria-атрибуты.
- [ ] **8.4 Служебная заметка в чате:** `lib/activity.ts` — `getExternalAgentActivity(contentAttributes)` (zod `safeParse` по `type === EXTERNAL_AGENT_ACTIVITY_TYPE`); `external-agent-activity.tsx` — строка в стиле `ThreadControlDivider`: «ИИ-агент передал разговор менеджеру: {reason}», «ИИ-агент недоступен — разговор передан менеджеру», «ИИ-агент не уложился во время — разговор передан менеджеру». Подключить в `message-item.tsx` рядом с `getThreadControlActivity`.
- [ ] **8.5 i18n:** раздел `externalAgent` (title, description, enabled, baseUrl, baseUrlHint, apiKey, apiKeySaved, inboxes, resumeAfter, resumeNever, resumeHours, maxRunMinutes, progressMessage, progressMessageHint, test, testOk, testError, lastChecked, saved, activity.handover, activity.unavailable, activity.timeout) во все 22 файла; `ru-batches.ts` — добавить раздел. Проверка `pnpm --filter builder i18n:hardcoded` не растёт.
- [ ] **8.6** `ultracite fix` → commit `feat(builder): add external agent settings page`.

## Task 9: CLI/MCP docs + project docs

- [ ] **9.1** Выполнить skill `.agents/skills/cli-mcp-docs/SKILL.md` для 4 новых публичных процедур (обновить документацию CLI/MCP, skill-файлы, если skill этого требует).
- [ ] **9.2** `docs/external-agent.md`: как работает (схема задач, курсор, служебные сообщения 30 с / fallback 90 с / зависание 5 мин / лимит), настройка Hermes, ошибки и что видит менеджер, как отключить. Ссылка в `AGENTS.md` → «Docs and support links», затем `pnpm sync:agent-instructions`, если менялся раздел инвариантов (не менялся — не нужно).
- [ ] **9.3** commit `docs: document hermes external agent`.

## Task 10: CI + invariant check

- [ ] **10.1** `git push gkamion feature/ru-channels-max-zzap-drom`; дождаться `gkamion-checks.yml` (`gh run watch <id> --exit-status`). Красное — чинить по логам jobs API.
- [ ] **10.2** Субагент `invariant-guard` по диффу ветки; исправить нарушения.
- [ ] **10.3** Показать пользователю SQL миграции и спросить разрешение на `db:migrate` в проде.

## Task 11: Hermes `assistant` configuration (только с разрешения)

- [ ] **11.1** Прочитать `/opt/hermes-data/profiles/assistant/config.yaml` с маскировкой секретов; сделать резервную копию `config.yaml.bak-2026-10-21`.
- [ ] **11.2** Создать в ChatbotX токен рабочего пространства для Hermes со scope `inbox`, `contacts` (через UI, пользователем или по его команде); ключ — в `.secrets/hermes/chatbotx-token` (не печатать).
- [ ] **11.3** Сгенерировать ключ `api_server` (`openssl rand -hex 32`) → `.secrets/hermes/api-server-key`.
- [ ] **11.4** Правки `config.yaml` профиля `assistant`: `platforms.api_server: { enabled: true, extra: { host: 127.0.0.1, port: 8647, key: <ключ> } }`; `platform_toolsets.api_server: [gkamion, memory, chatbotx]` (без terminal); `mcp_servers.chatbotx` → MCP-сервер ChatbotX с токеном из 11.2. Проверить, что порт 8647 свободен (`ss -ltn`).
- [ ] **11.5** `SOUL.md`: правила — если задача дольше ~30 с, сначала коротко сообщить клиенту, что делаешь; во время длинной проценки/подбора по VIN — изредка писать, на каком этапе; не повторять одно и то же; при просьбе позвать человека, споре, жалобе, нехватке данных — вызвать `handover` с понятной причиной и вежливо сказать клиенту, что подключится менеджер.
- [ ] **11.6** **Спросить разрешение** на перезапуск сервиса `assistant` (≈1 мин простоя Telegram-бота). После «да»: `systemctl restart <сервис assistant>`, `curl -s http://127.0.0.1:8647/health`.
- [ ] **11.7** Откат: вернуть `config.yaml.bak-…` и перезапустить (тоже с разрешения).

## Task 12: Build, deploy, manual test

- [ ] **12.1** После разрешения на миграцию: `db:migrate` в проде (как в прошлых задачах деплоя).
- [ ] **12.2** `gh workflow run gkamion-images.yml … -f services=builder,worker`; дождаться; `docker compose -p chatbotx-prod -f docker-compose.prod.yml pull builder worker && … up -d --no-build --force-recreate builder worker`.
- [ ] **12.3** В UI: Настройки → Интеграции → «Внешний ИИ-агент»: адрес `http://127.0.0.1:8647`, ключ, инбокс для теста (выбирает пользователь — каналы сам не включаю), «Проверить подключение» = ok.
- [ ] **12.4** Ручной сценарий (пользователь пишет с тестового контакта): короткий вопрос → ответ; список деталей → служебные сообщения не чаще 1/30 с, затем ответ; «позовите менеджера» → заметка с причиной, бот выключен; ответ менеджера → бот на паузе; «Вернуть боту» → агент отвечает с учётом последних 10 сообщений; остановить Hermes (с разрешения) → клиент получает «Передал ваш запрос менеджеру».
- [ ] **12.5** Скриншоты настроек и заметки → `docs/reviews/`; отметить чекбоксы плана.

---

## Self-review

- Покрытие spec: таблицы (T1), шифрование ключа и тест подключения (T4), поведение «всегда при `botEnabled`» (T7.2), передача человеку тремя путями (T4 handover, T5 пауза менеджером — существующий код, «Вернуть боту» — T5.3), авто-возврат никогда/N часов только для инбоксов агента (T5.2), служебные сообщения 30 с + дедуп (T3.5/T7.5), fallback 90 с (T3.5), зависание 5 мин и `maxRunMinutes` (T3.5/T7.6), сбой → сообщение клиенту и заметка (T4.1), публичный API (T6), UI (T8), Hermes без нового профиля (T11), Telegram не трогаем (Global Constraints).
- Типы: `ExternalAgentActivityEvent` используется и в сервисе, и в UI; `enqueueExternalAgentReply/Watch` — единственные точки постановки заданий.
- Риски: срок хранения событий run после завершения не подтверждён → всегда есть запасной путь через `GET /v1/runs/{id}` (T7.5). `approval.request` блокирует run → считаем ошибкой и передаём человеку.
