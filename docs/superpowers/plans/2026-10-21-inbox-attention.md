# Inbox Attention Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** менеджер сразу видит диалоги, которые ждут человека (счётчик непрочитанных, категория передачи, плашка в шапке), получает push только по ним, а сообщения бота не поднимают диалог вверх списка.

**Architecture:** три новые колонки `Conversation` (`inboxActivityAt`, `handoverCategory`, `handedOverAt`) → бизнес-слой пишет их (входящее/ответ менеджера, передача агента, возврат боту) → запрос списка сортирует по `inboxActivityAt` и отдаёт `unreadCount` → worker не шлёт push, пока диалог ведёт агент, и шлёт отдельный push о передаче → UI: счётчик, метка категории, плашки в шапке, фильтр.

**Tech Stack:** Drizzle + PostgreSQL, BullMQ, oRPC, Next.js 16, next-intl, zustand, vitest.

**Spec:** `docs/superpowers/specs/2026-10-21-inbox-attention-design.md`

---

## Global Constraints

Те же, что в `.superpowers/sdd/hermes-constraints.md`: только `ultracite` локально, без `db:migrate`, без печати секретов, `git add <path>`, не трогать `apps/builder/AGENTS.md`, `{ err }` в логах, без динамических `import()` вне builder, i18n во все 22 файла `apps/builder/messages/*.json` (русский в `ru.json`, английский в остальных). Ответы пользователю — по-русски.

## Deviations from the spec (decided while planning)

1. **Миграция одна, индекс без `CONCURRENTLY`.** В проде одна строка `Conversation`; колонки, заполнение `inboxActivityAt = lastActivityAt` и индекс — в одной миграции.
2. **Эхо исходящих из родного приложения канала** (менеджер ответил с телефона в WhatsApp/Telegram) `inboxActivityAt` не меняет — как сейчас не меняет `contactRepliedAt`. Поднимают диалог: сообщение клиента (везде, где пишется `contactRepliedAt`) и ответ менеджера из ChatbotX (`markAgentReplied`).
3. **«Ждёт менеджера»** в UI = бот не активен (`!isConversationActive`) и `handedOverAt` задан; «Бот на паузе до ЧЧ:ММ» = бот не активен, `botResumeAt` в будущем. Цвет счётчика: красный при `!isConversationActive`, серый при активном боте.

## File map

**Modify (основное)**
- `packages/database/src/schema/conversation.ts`, `packages/database/src/partials/conversation.ts` (enum категорий), миграция `packages/database/drizzle/<ts>_inbox_attention/`.
- `packages/database/src/queries/conversation-unread.ts` — предикат по `inboxActivityAt`.
- `packages/business/src/conversation/service.ts` — `updateFlowStepState`, `markAgentReplied`, `updateBotEnabled`/`disableBotState` (без автовозврата), `enableBotState` (очистка категории).
- `packages/business/src/external-agent/service.ts` — `handover({ category })`.
- `packages/worker-config/src/queues/notification/index.ts` — `notifyAgentHandover`.
- `apps/worker/src/integration/handlers/received-message.ts` — гейт push.
- `apps/worker/src/notification/` — обработчик `notifyAgentHandover`.
- `apps/builder/src/features/conversations/queries/{list-conversations.query.ts,build-conversation-where.ts}`, `schema/*` (ресурс + фильтр), `api/public.ts`.
- `apps/builder/src/features/contact-filter/…` — поле `unread` через общий предикат.
- `apps/builder/src/features/external-agent/{schema/index.ts,api/public.ts,lib/activity.ts,components/external-agent-activity.tsx}` — категория.
- `apps/builder/src/features/conversations/{conversation-item.tsx,lib/is-conversation-unread.ts,components/conversation-filter.tsx}`, `apps/builder/src/features/chat/{chat-panes.tsx,store/chat-store.ts,chat-realtime.tsx}`.
- `apps/builder/messages/*.json` (22), `apps/mcp-server/README.md`/`apps/cli/README.md` при необходимости, `docs/external-agent.md`, `.github/workflows/gkamion-checks.yml`.

---

## Task 1: Database — columns, category enum, migration

- [x] **1.1** `partials/conversation.ts`: `conversationHandoverCategories = ["urgent","return","payment","orderStatus","delivery","priceAndTerm","other"] as const`, `conversationHandoverCategorySchema = z.enum(...)`, тип `ConversationHandoverCategory`. Экспорт через `@chatbotx.io/database/partials`.
- [x] **1.2** `schema/conversation.ts`: `inboxActivityAt: timestamp(timestampConfig)`, `handoverCategory: text().$type<ConversationHandoverCategory>()`, `handedOverAt: timestamp(timestampConfig)`; индекс `Conversation_workspaceId_inboxActivityAt_id_idx` на `(workspaceId, inboxActivityAt DESC NULLS LAST, id DESC)` по образцу существующего `Conversation_workspaceId_lastActivityAt_id_idx`.
- [ ] **1.3** `pnpm --filter @chatbotx.io/database make:migration inbox_attention`; в конец `migration.sql` дописать `UPDATE "Conversation" SET "inboxActivityAt" = "lastActivityAt" WHERE "inboxActivityAt" IS NULL;`. `db:check-drift` — чисто.
- [ ] **1.4** `pnpm --filter @chatbotx.io/database db:check-drift`, `ultracite check`, коммит `feat(database): add inbox attention columns to conversation`.

## Task 2: Business — writes, handover category, no auto-resume

- [ ] **2.1** `updateFlowStepState`: когда передан `contactRepliedAt`, так же advance-only писать `inboxActivityAt = GREATEST(inboxActivityAt, contactRepliedAt)`. `markAgentReplied`: + `inboxActivityAt: input.at`. Найти прочие места, где `contactRepliedAt` пишется напрямую (например `create-webchat-message.action.ts` через сервис, `whatsapp-call-finalize.ts`), и убедиться, что они идут через `updateFlowStepState` или пишут `inboxActivityAt` рядом.
- [ ] **2.2** `disableBotState`/`updateBotEnabled`: необязательный параметр `noAutoResume?: boolean` → `botResumeAt = null` вне зависимости от политики входящих.
- [ ] **2.3** `enableBotState`: + `handoverCategory = null`, `handedOverAt = null` для включаемых диалогов.
- [ ] **2.4** `externalAgentService.handover({ ..., category? })` (по умолчанию `other`): при `wasBotEnabled` — `disableBotState({ noAutoResume: true })`, запись `handoverCategory`/`handedOverAt = now` (через сервис/репозиторий разговоров, не напрямую из app), подтверждение клиенту (уже есть), `notificationQueue.add(notifyAgentHandover, { workspaceId, conversationId, category, reason })` с `.catch` + `logger.error({ err })`. Повторный вызов на выключенном боте — без записи категории и без push. Заметка (`writeActivity`) хранит `category` в `contentAttributes`.
- [ ] **2.5** `worker-config` notification: действие `notifyAgentHandover` + zod-схема данных.
- [ ] **2.6** Тесты `packages/business/__tests__/external-agent/service.test.ts` (+ при необходимости `__tests__/conversation`): `botResumeAt` null, категория/время, push один раз, повтор без push; `enableBotState` очищает; `updateFlowStepState` с `contactRepliedAt` пишет `inboxActivityAt`.
- [ ] **2.7** `ultracite`, коммит `feat(business): handover category and manager attention timestamps`.

## Task 3: Builder queries + public API

- [ ] **3.1** `conversation-unread.ts`: предикат `inboxActivityAt IS NOT NULL AND (agentLastReadAt IS NULL OR inboxActivityAt > agentLastReadAt)`. Все потребители (`build-conversation-where.ts`, contact-filter `unread`) идут через него.
- [ ] **3.2** `list-conversations.query.ts`: сортировка и курсор по `inboxActivityAt` вместо `lastActivityAt` (NULLS LAST, затем `id DESC`). `last-message-window.ts` и прочие места, где курсор строится из `lastActivityAt` списка, — согласовать.
- [ ] **3.3** `unreadCount` в элементе списка: коррелированный подзапрос `SELECT count(*) FROM (SELECT 1 FROM "Message" m WHERE m."conversationId" = c.id AND m."workspaceId" = c."workspaceId" AND m."messageType" = 'incoming' AND m.type = 'message' AND m."deletedAt" IS NULL AND (c."agentLastReadAt" IS NULL OR m."createdAt" > c."agentLastReadAt") LIMIT 100) x`. Через репозиторий/сервис по правилам `data-access.md`.
- [ ] **3.4** Фильтр `handoverCategory` (массив категорий) в схеме запроса списка и в `build-conversation-where.ts`.
- [ ] **3.5** Ресурс элемента списка и `conversations.get`: + `unreadCount`, `inboxActivityAt`, `handoverCategory`, `handedOverAt`. Публичный `conversations.list`: + фильтр `handoverCategory`; описания полей.
- [ ] **3.6** Тесты builder (`apps/builder/__tests__/`): сортировка/курсор, `unreadCount`, фильтр категории, предикат непрочитанности.
- [ ] **3.7** `ultracite`, коммит `feat(conversations): sort by inbox activity and expose unread count`.

## Task 4: Worker — push rules

- [ ] **4.1** `received-message.ts`: перед `enqueueIncomingNotification` — если `isExternalAgentInbox` (или эквивалент через `externalAgentService`) для входящего и `isConversationActive(conversation)` — push не ставить. Вынести решение в чистую функцию для теста.
- [ ] **4.2** Обработчик `notifyAgentHandover` в `apps/worker/src/notification/` рядом с `notifyIncomingMessage`: получатели как у входящих (назначенный или все участники), заголовок «ИИ-агент передал диалог: <имя клиента> · <категория>», тело — причина до 150 символов. Русский текст — константа рядом с остальными текстами push (как сделаны существующие).
- [ ] **4.3** Тесты worker: push подавлен при агенте + активном боте; есть при выключенном боте; без агента — как раньше; обработчик `notifyAgentHandover` формирует push.
- [ ] **4.4** `ultracite`, коммит `feat(worker): notify managers only when the agent is not handling`.

## Task 5: Builder UI + handover API category

- [ ] **5.1** `external-agent` схема/публичная процедура `handover`: необязательный `category` (enum из 1.1) с описанием списка значений; заметка показывает категорию (`external-agent-activity.tsx`).
- [ ] **5.2** `conversation-item.tsx`: убрать рамку `border-primary`; справа счётчик `unreadCount` (`99+` при ≥100), красный при `!isConversationActive`, серый при активном боте, скрыт при 0; метка категории (эмодзи + подпись) рядом с именем, если `handedOverAt` задан и бот не активен.
- [ ] **5.3** `chat-store.ts`/`chat-realtime.tsx`: `handleNewMessages` поднимает диалог и двигает `inboxActivityAt` только для `incoming` и для исходящих от человека (`senderType` пользователь); входящее `unreadCount += 1`; прочтение (`agentLastReadAt`) — `unreadCount = 0`; `isConversationUnread` — по `inboxActivityAt`.
- [ ] **5.4** `chat-panes.tsx`: плашки «Ждёт менеджера · <категория>» и «Бот на паузе до ЧЧ:ММ» с кнопкой «Вернуть боту» (существующие диалог/действие включения бота; после успеха обновить store: `botEnabled`, `handoverCategory = null`, `handedOverAt = null`).
- [ ] **5.5** `conversation-filter.tsx`: множественный выбор «Категория».
- [ ] **5.6** i18n: подписи категорий, плашек, фильтра — во все 22 локали.
- [ ] **5.7** Тесты builder (компоненты/стор): счётчик и цвет, метка, плашки, подъём только по клиенту/менеджеру.
- [ ] **5.8** `ultracite`, коммит `feat(chat): unread counter, handover category and bot state bars`.

## Task 6: Docs, Hermes rules, CI, deploy

- [ ] **6.1** `docs/external-agent.md`: категория, без автовозврата, push. Навык `cli-mcp-docs` для изменённых публичных процедур.
- [ ] **6.2** `SOUL.md` профиля `assistant` (с резервной копией): правило выбора `category` при передаче.
- [ ] **6.3** `.github/workflows/gkamion-checks.yml`: новые тесты; CI зелёный.
- [ ] **6.4** Показать SQL миграции пользователю; после «да» — `db:migrate`; сборка и выкатка builder + worker; перезапуск `assistant` (MCP перечитает спецификацию).
- [ ] **6.5** Ручная проверка с пользователем: передача с категорией, счётчик, плашка, push, «Вернуть боту».
