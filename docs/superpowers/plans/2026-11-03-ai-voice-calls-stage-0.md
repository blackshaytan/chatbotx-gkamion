# Звонки робота: этап 0 — флаг и проверка в боте

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Клиент GKamion может запретить звонки робота (из чата, с звонка или тумблером менеджера), и бот не набирает номер, пока запрет стоит.

**Architecture:** Три колонки на `Contact` (`aiCallOptOutAt` + источник + цитата). `voiceAgentService` ставит и снимает флаг на всех контактах с одним номером и пишет неизменяемую заметку. `resolveVoiceCallPolicy` — чистое чтение: нормализует телефон и смотрит все контакты с этим номером. Публичный скоуп `voiceAgent` даёт боту `checkPolicy` (чтение) и `optOut` (запись). Детектор фраз в worker ставит флаг из входящих сообщений. Бот проверяет запрет в `lib/novofon-call-api.js` — единственном модуле, через который идёт любой набор.

**Tech Stack:** Drizzle + PostgreSQL, oRPC, Next.js 16, next-intl (22 локали), vitest, AI-phone-bot (Node, без фреймворка тестов — `node --test`).

**Spec:** `docs/superpowers/specs/2026-11-02-ai-voice-calls-chatbotx-design.md` (§3.1, §3.2, §4, §5, §6, §7, §8.1, §8.2, §9, §10 этап 0, §12).

---

## Global Constraints

- Ответы пользователю — на русском. Секреты не печатать.
- `db:migrate` НЕ запускать без явного «да» владельца. Миграцию генерировать и показывать.
- Тяжёлые проверки (tsc, vitest) — только на GitHub (`gkamion-checks.yml`); локально только `npx ultracite check|fix <paths>`. Новые тесты добавить в списки этого workflow.
- Тесты без реальных внешних API (моки). Логи ошибок — `{ err }`. Никаких динамических `import()` в `packages/*`, `integrations/*`, `apps/worker`.
- Новые i18n-ключи — во все 22 файла `apps/builder/messages/*.json` (русский в `ru.json`, английский в остальных).
- Коммиты: только по явной просьбе пользователя, только конкретные файлы (`git add <path>`). Формат по `.agents/rules/git.md`.
- Окружение: `export PATH=/GKamion/chatbotX/.tools/node-24/bin:$PATH`.
- Бот (`/GKamion/AI-phone-bot`) деплоится владельцем: `lib` подключён симлинком в `/GKamion/chat-bot/lib` и смонтирован в n8n как `/geka-lib`. Токен `voiceAgent` кладёт владелец в `/opt/n8n/.env` и в env `voice-ai`.
- Запрет гасит все автоматические звонки бота, включая `informerCall`.

## Deviations from the spec (decided while planning)

1. **`checkPolicy` — POST-чтение.** `read_only`-токен по умолчанию может только GET/HEAD (`apps/builder/src/middlewares/workspace-token-auth.ts:116`). Путь `/v1/voice-agent/policy/check` добавляется в `READ_ONLY_TOKEN_ALLOWED_POST_PATHS` (`apps/builder/src/lib/workspace/authorize-workspace-access.ts:86`): операция только читает. В `READ_ONLY_POST_PATHS` (гейт триала, инвариант 14) путь не добавляется: на workspace с истёкшим триалом или заблокированным владельцем `assertWorkspaceOwnerAccessForMethod` уже отвечает FORBIDDEN для POST. Это и закрывает вопрос §7 «workspace заблокирован» для публичных эндпоинтов.
2. **Опт-аут с неизвестного номера создаёт контакт напрямую.** `externalCrmService.syncCustomer` требует `externalCustomerId` и падает при неоднозначном совпадении телефона. На этапе 0 у бота id клиента может не быть, поэтому `setAiCallOptOut` вставляет standalone-контакт (`contactModel`) с телефоном, без инбокса и диалога. `syncCustomer` остаётся для этапа 1 (`createCall`).
3. **Заметки пишутся вставкой, а не через `contactNoteService.create`.** Сервис заметок перед вставкой читает контакт через `withCache` и инвалидирует кэш по одному контакту. Здесь нужна одна транзакция на несколько контактов, поэтому заметка вставляется в `contactNoteModel` напрямую, а кэш инвалидируется пакетом.
4. **Детектор живёт в business, хук — в worker.** `detectOptOutRequest` — чистая функция в `packages/business`. Вызов — в `apps/worker/src/integration/handlers/voice-opt-out.ts`, который зовёт `voiceAgentService.setAiCallOptOut`. Точка вызова — `apps/worker/src/integration/worker.ts`, ветка `IntegrationJobAction.incomingMessage` (строка 187), сразу после `if (!message) return` (строка 201). Там уже есть `message.text`, `message.senderType` и `conversation.workspaceId`; `contactId` берётся из `conversation.contactId` (сверить имя поля при реализации — оно есть на объекте разговора).
5. **UI этапа 0 — тумблер в карточке контакта** (`contact-inbox-panel.tsx` рядом с `ContactOrdersSection`) и пункт в меню диалога (`conversation-action.tsx`, рядом с block/unblock). Бейдж в списке контактов откладывается: колонки списка не рендерят даже `blocked`, а фильтр (§8.2) требование закрывает.
6. **Снятие флага — по номеру.** `clearAiCallOptOut` снимает флаг со всех контактов workspace с тем же E.164, что у переданного контакта. Если телефона нет — только с этого контакта.

## File map

**Create**
- `packages/database/src/partials/voice-agent.ts` — enum источника отказа.
- `packages/business/src/voice-agent/policy.ts` — `resolveVoiceCallPolicy`.
- `packages/business/src/voice-agent/service.ts` — `voiceAgentService`.
- `packages/business/src/voice-agent/opt-out-detection.ts` — `detectOptOutRequest`.
- `packages/business/src/voice-agent/index.ts`.
- `packages/business/__tests__/voice-agent/{policy.test.ts,service.test.ts,opt-out-detection.test.ts}`.
- `apps/builder/src/features/voice-agent/api/public.ts` — `voiceAgentPublicRouter`.
- `apps/builder/src/features/voice-agent/schema/public.ts` — zod входа/выхода.
- `apps/builder/src/features/contacts/actions/set-ai-call-opt-out.action.ts`, `clear-ai-call-opt-out.action.ts`.
- `apps/builder/src/features/contacts/components/contact-ai-calls-section.tsx`.
- `apps/worker/src/integration/handlers/voice-opt-out.ts`.
- `apps/builder/__tests__/voice-agent-api.test.ts`.
- `apps/worker/__tests__/voice-opt-out.test.ts`.
- `/GKamion/AI-phone-bot/lib/chatbotx-voice-api.js`, `/GKamion/AI-phone-bot/test/chatbotx-voice-api.test.js`.

**Modify**
- `packages/database/src/schema/contact.ts` — 3 колонки, enum, частичный индекс.
- `packages/database/src/partials/contact.ts` — `aiCallOptOut` в `contactFilterFields`.
- `packages/database/src/partials/workspace-api-token.ts` — скоуп `voiceAgent`.
- `packages/database/src/queries/contact-filter/index.ts` — `case "aiCallOptOut"`.
- `packages/database/drizzle/<ts>_ai_call_opt_out/migration.sql` — генерируется, не применяется.
- `packages/business/src/index.ts` — экспорт.
- `apps/builder/src/features/workspaces/lib/workspace-token-scopes.ts` — запись реестра, `order: 17`.
- `apps/builder/src/lib/workspace/authorize-workspace-access.ts` — allow-list POST.
- `apps/builder/src/routers/public.ts` — `voiceAgent: voiceAgentPublicRouter`.
- `apps/builder/src/features/contact-filter/schema/definitions.ts`, `schema/static-field-filter.ts`, `components/static-field-filter-config.ts` — поле фильтра.
- `apps/builder/src/features/contacts/contact-inbox-panel.tsx`, `apps/builder/src/features/conversations/conversation-action.tsx`.
- `apps/builder/messages/*.json` (22).
- `apps/worker/src/integration/worker.ts` — вызов детектора.
- `apps/builder/__tests__/workspace-token-scope-registry.test.ts`, `apps/builder/__tests__/api-parity-manifest.json`.
- `.github/workflows/gkamion-checks.yml` — новые тесты.
- `/GKamion/AI-phone-bot/lib/novofon-call-api.js`, `lib/order-voice-notify.js`.

---

### Task 1: Колонки флага и скоуп

**Files:**
- Modify: `packages/database/src/schema/contact.ts`
- Modify: `packages/database/src/partials/workspace-api-token.ts`
- Create: `packages/database/src/partials/voice-agent.ts`
- Test: `packages/database/__tests__/voice-agent-partial.test.ts`

**Interfaces:**
- Consumes: `contactModel` (`schema/contact.ts:69` — `blockedAt` как образец), `workspaceApiTokenScopes` (`partials/workspace-api-token.ts:14`)
- Produces: колонки `contactModel.aiCallOptOutAt`, `aiCallOptOutSource`, `aiCallOptOutReason`; `aiCallOptOutSource` pgEnum со значениями `clientCall | clientChat | manager`; скоуп `"voiceAgent"` в `workspaceApiTokenScopes`

- [ ] **Step 1: Падающий тест частиала**

`packages/database/__tests__/voice-agent-partial.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { aiCallOptOutSourceSchema } from "../src/partials/voice-agent"
import { workspaceApiTokenScopes } from "../src/partials/workspace-api-token"

describe("voice agent partials", () => {
  it("источник отказа — только три значения", () => {
    expect(aiCallOptOutSourceSchema.options).toEqual([
      "clientCall",
      "clientChat",
      "manager",
    ])
    expect(aiCallOptOutSourceSchema.safeParse("import").success).toBe(false)
  })

  it("voiceAgent — скоуп токена", () => {
    expect(workspaceApiTokenScopes.safeParse("voiceAgent").success).toBe(true)
  })
})
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `pnpm exec vitest run __tests__/voice-agent-partial.test.ts` в `packages/database`
Expected: FAIL — модуль `../src/partials/voice-agent` не найден

- [ ] **Step 3: Реализация**

`packages/database/src/partials/voice-agent.ts`:

```ts
import { z } from "zod"

export const aiCallOptOutSourceSchema = z.enum([
  "clientCall",
  "clientChat",
  "manager",
])

export type AiCallOptOutSource = z.infer<typeof aiCallOptOutSourceSchema>
```

`packages/database/src/schema/contact.ts` — рядом с `gender` (строка 21) объявить pgEnum и три колонки после `blockedAt` (строка 69):

```ts
export const aiCallOptOutSource = pgEnum("aiCallOptOutSource", [
  "clientCall",
  "clientChat",
  "manager",
])
```

```ts
    aiCallOptOutAt: timestamp(timestampConfig),
    aiCallOptOutSource: aiCallOptOutSource(),
    aiCallOptOutReason: text(),
```

Частичный индекс в массив индексов таблицы:

```ts
    index("Contact_workspace_ai_call_opt_out_idx")
      .on(table.workspaceId, table.aiCallOptOutAt)
      .where(sql`${table.aiCallOptOutAt} is not null`),
```

`packages/database/src/partials/workspace-api-token.ts` — добавить `"voiceAgent"` последним значением `workspaceApiTokenScopes`.

- [ ] **Step 4: Прогнать тест**

Run: `pnpm exec vitest run __tests__/voice-agent-partial.test.ts` в `packages/database`
Expected: PASS (2)

- [ ] **Step 5: Миграция — показать, не применять**

По `.agents/skills/drizzle-database/SKILL.md`: `pnpm db:generate` даёт
`packages/database/drizzle/<ts>_ai_call_opt_out/migration.sql`. Показать SQL
владельцу. Ожидаемое содержимое: `CREATE TYPE "aiCallOptOutSource" AS ENUM
('clientCall', 'clientChat', 'manager')`, три `ALTER TABLE "Contact" ADD COLUMN`,
`CREATE INDEX "Contact_workspace_ai_call_opt_out_idx" ... WHERE "aiCallOptOutAt"
is not null`. `db:migrate` не запускать.

- [ ] **Step 6: Форматирование**

Run: `npx ultracite check packages/database/src/schema/contact.ts packages/database/src/partials/voice-agent.ts packages/database/src/partials/workspace-api-token.ts packages/database/__tests__/voice-agent-partial.test.ts`

---

### Task 2: Политика `resolveVoiceCallPolicy`

**Files:**
- Create: `packages/business/src/voice-agent/policy.ts`
- Test: `packages/business/__tests__/voice-agent/policy.test.ts`

**Interfaces:**
- Consumes: `normalizePhoneToE164` (`packages/business/src/contact/phone.ts:22`), `contactModel` с колонками из Task 1, `db` из `@chatbotx.io/database/client`
- Produces:

```ts
export type VoiceCallPolicyResult =
  | { canCall: true; contactIds: string[] }
  | {
      canCall: false
      reason: "optedOut" | "blocked" | "invalidPhone"
      contactId?: string
      optOutAt?: Date
      optOutSource?: "clientCall" | "clientChat" | "manager"
    }

export async function resolveVoiceCallPolicy(input: {
  workspaceId: string
  phone: string
}): Promise<VoiceCallPolicyResult>
```

- [ ] **Step 1: Падающие тесты**

`packages/business/__tests__/voice-agent/policy.test.ts`. БД мокается через
`vi.mock("@chatbotx.io/database/client", ...)`: мок `db.select().from().where()`
возвращает заранее заданные строки контактов. Образец мока — соседние тесты
`packages/business/__tests__/external-agent`.

Случаи:

```ts
it("невалидный номер", async () => {
  const result = await resolveVoiceCallPolicy({ workspaceId: "1", phone: "abc" })
  expect(result).toEqual({ canCall: false, reason: "invalidPhone" })
})

it("номер не найден — звонить можно", async () => {
  contactsMock.mockResolvedValue([])
  const result = await resolveVoiceCallPolicy({ workspaceId: "1", phone: "+79990000000" })
  expect(result).toEqual({ canCall: true, contactIds: [] })
})

it("флаг на одном из контактов с номером — optedOut с самым ранним запретом", async () => {
  contactsMock.mockResolvedValue([
    { id: "a", aiCallOptOutAt: null, aiCallOptOutSource: null, blockedAt: null },
    { id: "b", aiCallOptOutAt: new Date("2026-11-01"), aiCallOptOutSource: "clientChat", blockedAt: null },
    { id: "c", aiCallOptOutAt: new Date("2026-11-02"), aiCallOptOutSource: "manager", blockedAt: null },
  ])
  const result = await resolveVoiceCallPolicy({ workspaceId: "1", phone: "89990000000" })
  expect(result).toMatchObject({
    canCall: false,
    reason: "optedOut",
    contactId: "b",
    optOutSource: "clientChat",
  })
})

it("blocked без флага — blocked", async () => {
  contactsMock.mockResolvedValue([
    { id: "a", aiCallOptOutAt: null, aiCallOptOutSource: null, blockedAt: new Date() },
  ])
  const result = await resolveVoiceCallPolicy({ workspaceId: "1", phone: "+79990000000" })
  expect(result).toMatchObject({ canCall: false, reason: "blocked", contactId: "a" })
})

it("флаг важнее блокировки", async () => {
  contactsMock.mockResolvedValue([
    { id: "a", aiCallOptOutAt: new Date("2026-11-01"), aiCallOptOutSource: "manager", blockedAt: new Date() },
  ])
  const result = await resolveVoiceCallPolicy({ workspaceId: "1", phone: "+79990000000" })
  expect(result).toMatchObject({ reason: "optedOut" })
})

it("ошибка чтения — пробрасывается (fail closed делает вызывающий)", async () => {
  contactsMock.mockRejectedValue(new Error("db down"))
  await expect(
    resolveVoiceCallPolicy({ workspaceId: "1", phone: "+79990000000" }),
  ).rejects.toThrow("db down")
})
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `pnpm exec vitest run __tests__/voice-agent/policy.test.ts` в `packages/business`
Expected: FAIL — `resolveVoiceCallPolicy` не экспортируется

- [ ] **Step 3: Реализация**

`packages/business/src/voice-agent/policy.ts`:

```ts
import { and, db, eq } from "@chatbotx.io/database/client"
import { contactModel } from "@chatbotx.io/database/schema"
import type { AiCallOptOutSource } from "@chatbotx.io/database/partials"
import { normalizePhoneToE164 } from "../contact/phone"

export type VoiceCallPolicyResult =
  | { canCall: true; contactIds: string[] }
  | {
      canCall: false
      reason: "optedOut" | "blocked" | "invalidPhone"
      contactId?: string
      optOutAt?: Date
      optOutSource?: AiCallOptOutSource
    }

export async function resolveVoiceCallPolicy(input: {
  workspaceId: string
  phone: string
}): Promise<VoiceCallPolicyResult> {
  const phone = normalizePhoneToE164(input.phone)
  if (!phone) {
    return { canCall: false, reason: "invalidPhone" }
  }
  const contacts = await db
    .select({
      id: contactModel.id,
      aiCallOptOutAt: contactModel.aiCallOptOutAt,
      aiCallOptOutSource: contactModel.aiCallOptOutSource,
      blockedAt: contactModel.blockedAt,
    })
    .from(contactModel)
    .where(
      and(
        eq(contactModel.workspaceId, input.workspaceId),
        eq(contactModel.phoneNumber, phone),
      ),
    )
  const optedOut = contacts
    .filter((c) => c.aiCallOptOutAt)
    .sort((a, b) => a.aiCallOptOutAt!.getTime() - b.aiCallOptOutAt!.getTime())
  if (optedOut[0]) {
    return {
      canCall: false,
      reason: "optedOut",
      contactId: optedOut[0].id,
      optOutAt: optedOut[0].aiCallOptOutAt ?? undefined,
      optOutSource: optedOut[0].aiCallOptOutSource ?? undefined,
    }
  }
  const blocked = contacts.find((c) => c.blockedAt)
  if (blocked) {
    return { canCall: false, reason: "blocked", contactId: blocked.id }
  }
  return { canCall: true, contactIds: contacts.map((c) => c.id) }
}
```

Чтение идёт прямым запросом, не через `contactService.findBy`: тот кэширует
результат, и свежий запрет ждал бы истечения TTL.

Проверить сигнатуру `normalizePhoneToE164` при реализации: если она возвращает
`null` для невалидного номера — использовать как выше; если бросает — ловить и
возвращать `invalidPhone`.

- [ ] **Step 4: Прогнать тесты**

Run: `pnpm exec vitest run __tests__/voice-agent/policy.test.ts` в `packages/business`
Expected: PASS (6)

- [ ] **Step 5: Форматирование**

Run: `npx ultracite check packages/business/src/voice-agent/policy.ts packages/business/__tests__/voice-agent/policy.test.ts`

---

### Task 3: `voiceAgentService` — установка и снятие флага

**Files:**
- Create: `packages/business/src/voice-agent/service.ts`
- Create: `packages/business/src/voice-agent/index.ts`
- Modify: `packages/business/src/index.ts` (добавить `export * from "./voice-agent"`)
- Test: `packages/business/__tests__/voice-agent/service.test.ts`

**Interfaces:**
- Consumes: `resolveVoiceCallPolicy` не использует; колонки Task 1, `contactModel`, `contactNoteModel`, `db.transaction`, `createId` (`@chatbotx.io/utils`), `invalidateCacheByTags` (`@chatbotx.io/redis`), `normalizePhoneToE164`
- Produces:

```ts
export const voiceAgentService: {
  setAiCallOptOut(input: {
    workspaceId: string
    contactId?: string
    phone?: string
    source: "clientCall" | "clientChat" | "manager"
    reason?: string
    actorUserId?: string | null
  }): Promise<{ contactIds: string[]; alreadySet: boolean }>
  clearAiCallOptOut(input: {
    workspaceId: string
    contactId: string
    actorUserId: string
  }): Promise<{ contactIds: string[] }>
}
```

- [ ] **Step 1: Падающие тесты**

`packages/business/__tests__/voice-agent/service.test.ts`, та же техника мока
`db`, что в Task 2. Мок должен поддерживать `db.transaction(async (tx) => ...)`
(tx — тот же мок), `tx.update().set().where().returning()` и
`tx.insert().values()`.

```ts
it("ставит флаг на все контакты с номером и пишет заметку каждому", async () => {
  // контакт a (id передан) имеет phone +79990000000; с тем же номером есть b
  const result = await voiceAgentService.setAiCallOptOut({
    workspaceId: "1",
    contactId: "a",
    source: "clientChat",
    reason: "не звоните мне больше",
  })
  expect(result.contactIds.sort()).toEqual(["a", "b"])
  expect(result.alreadySet).toBe(false)
  // UPDATE содержит WHERE aiCallOptOutAt IS NULL
  expect(updateSetMock).toHaveBeenCalledWith(
    expect.objectContaining({ aiCallOptOutSource: "clientChat" }),
  )
  // вставлено 2 заметки; текст содержит цитату
  expect(insertedNotes()).toHaveLength(2)
  expect(insertedNotes()[0].text).toContain("не звоните мне больше")
})

it("повторный вызов не перезаписывает источник и не дублирует заметку", async () => {
  // UPDATE ... WHERE aiCallOptOutAt IS NULL возвращает 0 строк
  const result = await voiceAgentService.setAiCallOptOut({
    workspaceId: "1",
    contactId: "a",
    source: "manager",
  })
  expect(result.alreadySet).toBe(true)
  expect(insertedNotes()).toHaveLength(0)
})

it("контакт без телефона: флаг ставится, заметка предупреждает", async () => {
  const result = await voiceAgentService.setAiCallOptOut({
    workspaceId: "1",
    contactId: "tg",
    source: "clientChat",
    reason: "хватит звонить",
  })
  expect(result.contactIds).toEqual(["tg"])
  expect(insertedNotes()[0].text).toContain("нет телефона")
})

it("неизвестный номер создаёт standalone-контакт и ставит флаг ему", async () => {
  const result = await voiceAgentService.setAiCallOptOut({
    workspaceId: "1",
    phone: "+79990000000",
    source: "clientCall",
    reason: "не звоните мне",
  })
  expect(result.contactIds).toHaveLength(1)
  expect(insertedContacts()[0]).toMatchObject({ phoneNumber: "+79990000000" })
  expect(insertedContacts()[0].inboxId).toBeUndefined()
})

it("нет ни contactId, ни phone — ошибка", async () => {
  await expect(
    voiceAgentService.setAiCallOptOut({ workspaceId: "1", source: "manager" }),
  ).rejects.toThrow()
})

it("clear снимает флаг со всех контактов с номером и пишет заметку", async () => {
  const result = await voiceAgentService.clearAiCallOptOut({
    workspaceId: "1",
    contactId: "a",
    actorUserId: "user-1",
  })
  expect(result.contactIds.sort()).toEqual(["a", "b"])
  expect(insertedNotes()).toHaveLength(2)
})
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `pnpm exec vitest run __tests__/voice-agent/service.test.ts` в `packages/business`
Expected: FAIL — модуль не найден

- [ ] **Step 3: Реализация**

`packages/business/src/voice-agent/service.ts`.

Тексты заметок (русский для всех workspace, как в `external-agent`):

```ts
const setNote = (reason: string | undefined, noPhone: boolean) => {
  const quote = reason ? `: «${reason.slice(0, 500)}»` : ""
  const tail = noPhone
    ? ". У контакта нет телефона — звонки не заблокированы, пока номер не появится"
    : ""
  return `Клиент попросил не звонить${quote}${tail}`
}
```

Алгоритм `setAiCallOptOut` в одной `db.transaction`:

1. Нет `contactId` и нет `phone` → `badRequestException`.
2. Есть `contactId`: прочитать контакт (`id`, `phoneNumber`) в workspace.
   Нет строки → `notFoundException`.
3. Номер = `normalizePhoneToE164(phone)` аргумента, иначе `phoneNumber`
   контакта. Найти все контакты workspace с этим `phoneNumber`.
4. Номер есть, контактов нет: вставить `contactModel`
   (`id: createId()`, `workspaceId`, `phoneNumber`), без инбокса.
5. Номера нет (контакт без телефона): работать с одним контактом.
6. `UPDATE Contact SET aiCallOptOutAt = now(), aiCallOptOutSource = source, aiCallOptOutReason = reason?.slice(0, 500) WHERE id IN (...) AND aiCallOptOutAt IS NULL RETURNING id`.
7. Для каждого обновлённого id вставить `contactNoteModel`
   (`id: createId()`, `text: setNote(reason, !номер)`, `createdById: actorUserId ?? null`).
8. После транзакции `invalidateCacheByTags` по `contacts:{id}` и
   `contacts:{id}:contact-notes` для каждого затронутого контакта.
9. Вернуть `{ contactIds, alreadySet: updatedIds.length === 0 }`.

`clearAiCallOptOut`: найти контакт, собрать все контакты с его номером (или
его одного, если телефона нет), `UPDATE ... SET aiCallOptOutAt = NULL, aiCallOptOutSource = NULL, aiCallOptOutReason = NULL WHERE id IN (...) AND aiCallOptOutAt IS NOT NULL RETURNING id`, заметка
`Менеджер снял запрет на звонки робота` с `createdById: actorUserId` каждому
обновлённому, инвалидация кэша.

`packages/business/src/voice-agent/index.ts`:

```ts
export { resolveVoiceCallPolicy } from "./policy"
export type { VoiceCallPolicyResult } from "./policy"
export { voiceAgentService } from "./service"
export { detectOptOutRequest } from "./opt-out-detection"
```

`packages/business/src/index.ts`: добавить `export * from "./voice-agent"`
рядом с экспортом `external-agent` (строка 58). `detectOptOutRequest` появится
в Task 4 — до неё строку экспорта детектра не добавлять, иначе сборка падает.
Порядок задач это учитывает: Task 4 идёт сразу за Task 3, и баррель
дополняется там.

- [ ] **Step 4: Прогнать тесты**

Run: `pnpm exec vitest run __tests__/voice-agent/service.test.ts` в `packages/business`
Expected: PASS (6)

- [ ] **Step 5: Форматирование**

Run: `npx ultracite check packages/business/src/voice-agent packages/business/src/index.ts packages/business/__tests__/voice-agent/service.test.ts`

---

### Task 4: Детектор фразы

**Files:**
- Create: `packages/business/src/voice-agent/opt-out-detection.ts`
- Modify: `packages/business/src/voice-agent/index.ts` (раскомментировать/добавить экспорт)
- Test: `packages/business/__tests__/voice-agent/opt-out-detection.test.ts`

**Interfaces:**
- Consumes: ничего
- Produces:

```ts
export function detectOptOutRequest(
  text: string,
): { matched: true; phrase: string } | { matched: false }
```

- [ ] **Step 1: Падающие тесты**

```ts
describe("detectOptOutRequest", () => {
  it.each([
    "Больше не звоните мне",
    "не звоните мне больше",
    "Не звоните мне, пожалуйста",
    "хватит мне звонить",
    "уберите мой номер из обзвона",
    "Не хочу чтобы мне звонили",
  ])("ловит %s", (text) => {
    expect(detectOptOutRequest(text).matched).toBe(true)
  })

  it.each([
    "курьер не звонит",
    "мне никто не звонил",
    "не звоните, я сам приеду",
    "перезвоните мне",
    "почему вы не звоните мне",
    "не звоните",
    "",
    "спасибо, всё получил",
  ])("пропускает %s", (text) => {
    expect(detectOptOutRequest(text)).toEqual({ matched: false })
  })

  it("нормализует ё и пунктуацию", () => {
    expect(detectOptOutRequest("Хватит  звонить!!!").matched).toBe(true)
  })
})
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `pnpm exec vitest run __tests__/voice-agent/opt-out-detection.test.ts` в `packages/business`
Expected: FAIL — модуль не найден

- [ ] **Step 3: Реализация**

`packages/business/src/voice-agent/opt-out-detection.ts`:

```ts
const PATTERNS = [
  /(?<!\p{L})больше не звоните?(?!\p{L})/u,
  /(?<!\p{L})не звоните? мне больше(?!\p{L})/u,
  /(?<!\p{L})не звоните? мне(?!\p{L})/u,
  /(?<!\p{L})хватит( мне)? звонить(?!\p{L})/u,
  /(?<!\p{L})(уберите|удалите|исключите)( мой)? номер( из)?( базы| обзвона| списка| рассылки)?(?!\p{L})/u,
  /(?<!\p{L})не хочу чтобы( мне)? звонили?(?!\p{L})/u,
]

const NEGATIVE = [
  /перезвон/u,
  /позвоните/u,
  /жду звонка/u,
  /наберите/u,
  /сам приеду/u,
  /сам заберу/u,
  /сам позвоню/u,
  /сам наберу/u,
  /почему/u,
  /когда/u,
]

export function detectOptOutRequest(text: string) {
  const normalized = text
    .toLowerCase()
    .replaceAll("ё", "е")
    .replaceAll(/[^\p{L}\p{N}\s]/gu, " ")
    .replaceAll(/\s+/g, " ")
    .trim()
  if (!normalized || NEGATIVE.some((p) => p.test(normalized))) {
    return { matched: false } as const
  }
  for (const pattern of PATTERNS) {
    const found = pattern.exec(normalized)
    if (found) {
      return { matched: true, phrase: found[0] } as const
    }
  }
  return { matched: false } as const
}
```

Отрицательный фильтр проверяется по всему сообщению до шаблонов: «не звоните
мне, но перезвоните завтра» не ставит флаг.

- [ ] **Step 4: Прогнать тесты**

Run: `pnpm exec vitest run __tests__/voice-agent/opt-out-detection.test.ts` в `packages/business`
Expected: PASS

- [ ] **Step 5: Форматирование**

Run: `npx ultracite check packages/business/src/voice-agent/opt-out-detection.ts packages/business/src/voice-agent/index.ts packages/business/__tests__/voice-agent/opt-out-detection.test.ts`

---

### Task 5: Публичный API `voiceAgent`

**Files:**
- Create: `apps/builder/src/features/voice-agent/schema/public.ts`
- Create: `apps/builder/src/features/voice-agent/api/public.ts`
- Modify: `apps/builder/src/routers/public.ts` (импорт + `voiceAgent: voiceAgentPublicRouter` рядом с `externalAgent`, строка 133)
- Modify: `apps/builder/src/features/workspaces/lib/workspace-token-scopes.ts` (запись `voiceAgent: { labelKey: "fields.tokenScopes.voiceAgent", order: 17 }`)
- Modify: `apps/builder/src/lib/workspace/authorize-workspace-access.ts` (путь в `READ_ONLY_TOKEN_ALLOWED_POST_PATHS`)
- Modify: `apps/builder/messages/*.json` (22 файла, ключ `fields.tokenScopes.voiceAgent`)
- Test: `apps/builder/__tests__/voice-agent-api.test.ts`

**Interfaces:**
- Consumes: `resolveVoiceCallPolicy`, `voiceAgentService` из `@chatbotx.io/business`; `workspaceTokenAuthAPIForScope` (`apps/builder/src/orpc`); образец роутера — `apps/builder/src/features/external-agent/api/public.ts`
- Produces: процедуры `voiceAgent.checkPolicy` (`POST /v1/voice-agent/policy/check`) и `voiceAgent.optOut` (`POST /v1/voice-agent/opt-out`)

- [ ] **Step 1: Падающий тест скоупа и эндпоинтов**

Образец — `apps/builder/__tests__/external-agent-api.test.ts` и
`apps/builder/__tests__/workspace-token-scope-enforcement.test.ts`. Три случая:

```ts
it("токен без скоупа voiceAgent получает 403", async () => {
  const res = await call("/v1/voice-agent/policy/check", {
    tokenScopes: ["contacts"],
    body: { phone: "+79990000000" },
  })
  expect(res.status).toBe(403)
})

it("read_only токен со скоупом voiceAgent читает политику", async () => {
  const res = await call("/v1/voice-agent/policy/check", {
    tokenScopes: ["voiceAgent"],
    permission: "read_only",
    body: { phone: "+79990000000" },
  })
  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({ canCall: true, contactIds: [] })
})

it("read_only токен не может поставить запрет", async () => {
  const res = await call("/v1/voice-agent/opt-out", {
    tokenScopes: ["voiceAgent"],
    permission: "read_only",
    body: { phone: "+79990000000", reason: "не звоните мне" },
  })
  expect(res.status).toBe(403)
})
```

Хелпер `call` берётся из образца: он поднимает oRPC-обработчик с мокнутым
токеном. Политику и сервис замокать: `vi.mock("@chatbotx.io/business", ...)`
с `resolveVoiceCallPolicy` и `voiceAgentService`.

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `pnpm exec vitest run __tests__/voice-agent-api.test.ts` в `apps/builder`
Expected: FAIL — роут не смонтирован (404)

- [ ] **Step 3: Реализация**

`apps/builder/src/features/voice-agent/schema/public.ts`:

```ts
import { aiCallOptOutSourceSchema } from "@chatbotx.io/database/partials"
import { z } from "zod"

export const voiceAgentCheckPolicyInputSchema = z.object({
  phone: z.string().min(1).max(32),
})

export const voiceAgentCheckPolicyOutputSchema = z.object({
  canCall: z.boolean(),
  reason: z.enum(["optedOut", "blocked", "invalidPhone"]).optional(),
  contactId: z.string().optional(),
  contactIds: z.array(z.string()).optional(),
  optOutAt: z.date().optional(),
  optOutSource: aiCallOptOutSourceSchema.optional(),
})

export const voiceAgentOptOutInputSchema = z.object({
  phone: z.string().min(1).max(32).optional(),
  contactId: z.string().optional(),
  reason: z.string().max(500).optional(),
  externalSessionId: z.string().max(200).optional(),
})

export const voiceAgentOptOutOutputSchema = z.object({
  contactIds: z.array(z.string()),
  alreadySet: z.boolean(),
})
```

`apps/builder/src/features/voice-agent/api/public.ts`:

```ts
import { resolveVoiceCallPolicy, voiceAgentService } from "@chatbotx.io/business"
import { workspaceTokenAuthAPIForScope } from "@/orpc"
import {
  voiceAgentCheckPolicyInputSchema,
  voiceAgentCheckPolicyOutputSchema,
  voiceAgentOptOutInputSchema,
  voiceAgentOptOutOutputSchema,
} from "../schema/public"

const api = workspaceTokenAuthAPIForScope("voiceAgent")

export const POLICY_CHECK_PATH = "/v1/voice-agent/policy/check"

export const voiceAgentPublicRouter = {
  checkPolicy: api
    .route({
      method: "POST",
      path: POLICY_CHECK_PATH,
      summary: "Проверить, можно ли звонить на номер",
      description:
        "Read-only check: returns whether an automated call to this phone is allowed. Never creates contacts.",
      tags: ["Voice agent"],
    })
    .input(voiceAgentCheckPolicyInputSchema)
    .output(voiceAgentCheckPolicyOutputSchema)
    .handler(async ({ input, context }) =>
      resolveVoiceCallPolicy({ workspaceId: context.workspace.id, phone: input.phone }),
    ),
  optOut: api
    .route({
      method: "POST",
      path: "/v1/voice-agent/opt-out",
      summary: "Поставить запрет на звонки робота",
      tags: ["Voice agent"],
    })
    .input(voiceAgentOptOutInputSchema)
    .output(voiceAgentOptOutOutputSchema)
    .handler(async ({ input, context }) =>
      voiceAgentService.setAiCallOptOut({
        workspaceId: context.workspace.id,
        phone: input.phone,
        contactId: input.contactId,
        source: "clientCall",
        reason: input.reason,
      }),
    ),
}
```

`apps/builder/src/lib/workspace/authorize-workspace-access.ts`: добавить
`POLICY_CHECK_PATH` в `READ_ONLY_TOKEN_ALLOWED_POST_PATHS` и комментарий, почему
путь — чтение (по образцу `ADS_CAMPAIGNS_INSIGHTS_PATH`). В `READ_ONLY_POST_PATHS`
не добавлять.

`apps/builder/src/features/workspaces/lib/workspace-token-scopes.ts`:

```ts
  voiceAgent: { labelKey: "fields.tokenScopes.voiceAgent", order: 17 },
```

Ключ `fields.tokenScopes.voiceAgent`: `"Voice agent"` в 21 файле локалей,
`"Голосовой робот"` в `ru.json`. Record-тип реестра сам потребует ключ во всех
локалях — пропущенный упадёт при проверке типов в CI.

`apps/builder/__tests__/workspace-token-scope-registry.test.ts`: добавить
`"voiceAgent"` в ожидаемый список скоупов (строка 19, после `"chats"`).

- [ ] **Step 4: Прогнать тесты**

Run: `pnpm exec vitest run __tests__/voice-agent-api.test.ts __tests__/workspace-token-scope-registry.test.ts` в `apps/builder`
Expected: PASS

- [ ] **Step 5: Паритет CLI/MCP**

По `.agents/skills/cli-mcp-docs/SKILL.md`: `pnpm sync:agent-instructions`
перегенерирует инструкции CLI и MCP из публичного роутера. Проверить diff:
появились `voiceAgent.checkPolicy` и `voiceAgent.optOut`. Затем
`pnpm check:agent-instructions` должен пройти. Обновить
`apps/builder/__tests__/api-parity-manifest.json`, если тест паритета
сравнивает со снимком.

- [ ] **Step 6: Форматирование**

Run: `npx ultracite check apps/builder/src/features/voice-agent apps/builder/src/routers/public.ts apps/builder/src/lib/workspace/authorize-workspace-access.ts apps/builder/src/features/workspaces/lib/workspace-token-scopes.ts apps/builder/__tests__/voice-agent-api.test.ts`

---

### Task 6: Фильтр контактов `aiCallOptOut`

**Files:**
- Modify: `packages/database/src/partials/contact.ts` (`contactFilterFields`, строка 188)
- Modify: `packages/database/src/queries/contact-filter/index.ts` (после `case "blocked":`, строка 563)
- Modify: `apps/builder/src/features/contact-filter/schema/definitions.ts` (после блока `blocked`, строка 139)
- Modify: `apps/builder/src/features/contact-filter/schema/static-field-filter.ts` (строка 111)
- Modify: `apps/builder/src/features/contact-filter/components/static-field-filter-config.ts` (строка 183)
- Modify: `apps/builder/messages/*.json` (22)
- Test: `packages/database/__tests__/contact-filter.test.ts` (дописать кейсы), `apps/builder/__tests__/contact-filter-config.test.ts`

**Interfaces:**
- Consumes: `buildBooleanFromTimestamp` (используется `case "blocked"`), `BOOLEAN_OPERATORS`, `booleanRule`
- Produces: поле фильтра `aiCallOptOut` с операторами boolean в обоих источниках правил

- [ ] **Step 1: Падающие тесты**

В `packages/database/__tests__/contact-filter.test.ts` по образцу кейсов
`blocked` добавить три:

```ts
it.each([
  ["aiCallOptOut", "is", true, `IS NOT NULL`],
  ["aiCallOptOut", "is", false, `IS NULL`],
])("поле %s %s %s", (field, operator, value, sql) => {
  const where = buildConditionWhere({ field, operator, value })
  expect(sqlOf(where)).toContain(sql)
  expect(sqlOf(where)).toContain("aiCallOptOutAt")
})
```

Имя хелпера `sqlOf` взять из существующих кейсов файла. В
`apps/builder/__tests__/contact-filter-config.test.ts` — кейс, что
`aiCallOptOut` присутствует и в `STATIC_OPERATOR_RULES`, и в
`staticFieldRules` (тест уже сверяет эти источники для существующих полей).

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `pnpm exec vitest run __tests__/contact-filter.test.ts` в `packages/database`
Expected: FAIL — поле `aiCallOptOut` не в enum

- [ ] **Step 3: Реализация**

Пять правок по одной строке:

1. `contactFilterFields`: `"aiCallOptOut"` следом за `"blocked"`.
2. `queries/contact-filter/index.ts`:

```ts
    case "aiCallOptOut":
      return buildBooleanFromTimestamp("aiCallOptOutAt", operator, value)
```

3. `definitions.ts` — блок следом за `blocked`:

```ts
  {
    field: contactFilterFields.enum.aiCallOptOut,
    schemaKind: "boolean",
    optionSource: "none",
  },
```

4. `static-field-filter.ts`: `aiCallOptOut: BOOLEAN_OPERATORS,` следом за
   `blocked`.
5. `static-field-filter-config.ts`: `aiCallOptOut: booleanRule,` следом за
   `blocked`.

Ключ перевода поля фильтра — по образцу `blocked`: найти ключ
`contactFilter.fields.blocked` (или фактический неймспейс, которым
пользуется `blocked`) и добавить соседний `aiCallOptOut`: `"No robot calls"`
в 21 локали, `"Без звонков робота"` в `ru.json`.

- [ ] **Step 4: Прогнать тесты**

Run: `pnpm exec vitest run __tests__/contact-filter.test.ts` в `packages/database`;
`pnpm exec vitest run __tests__/contact-filter-config.test.ts` в `apps/builder`
Expected: PASS

- [ ] **Step 5: Форматирование**

Run: `npx ultracite check packages/database/src/partials/contact.ts packages/database/src/queries/contact-filter/index.ts apps/builder/src/features/contact-filter`

---

### Task 7: Хук детектора на входящее сообщение

**Files:**
- Create: `apps/worker/src/integration/handlers/voice-opt-out.ts`
- Modify: `apps/worker/src/integration/worker.ts`
- Test: `apps/worker/__tests__/voice-opt-out.test.ts`

**Interfaces:**
- Consumes: `detectOptOutRequest`, `voiceAgentService.setAiCallOptOut` из `@chatbotx.io/business`
- Produces:

```ts
export async function applyVoiceOptOut(input: {
  workspaceId: string
  contactId: string
  messageType: string
  text: string | null
  senderIsContact: boolean
}): Promise<{ optedOut: boolean }>
```

- [ ] **Step 1: Падающие тесты**

`apps/worker/__tests__/voice-opt-out.test.ts`. Сервис мокается:
`vi.mock("@chatbotx.io/business", () => ({ detectOptOutRequest: actual, voiceAgentService: { setAiCallOptOut: vi.fn() } }))`.

```ts
it("входящее с фразой ставит флаг clientChat", async () => {
  const result = await applyVoiceOptOut({
    workspaceId: "1",
    contactId: "a",
    messageType: "incoming",
    text: "Больше не звоните",
    senderIsContact: true,
  })
  expect(result.optedOut).toBe(true)
  expect(voiceAgentService.setAiCallOptOut).toHaveBeenCalledWith({
    workspaceId: "1",
    contactId: "a",
    source: "clientChat",
    reason: "Больше не звоните",
  })
})

it.each([
  ["outgoing", "не звоните мне", true],
  ["incoming", "спасибо", true],
  ["incoming", "не звоните мне", false],
  ["incoming", null, true],
])("не ставит: %s / %s / contact=%s", async (messageType, text, senderIsContact) => {
  const result = await applyVoiceOptOut({
    workspaceId: "1",
    contactId: "a",
    messageType,
    text,
    senderIsContact,
  })
  expect(result).toEqual({ optedOut: false })
  expect(voiceAgentService.setAiCallOptOut).not.toHaveBeenCalled()
})

it("ошибка сервиса не роняет обработку сообщения", async () => {
  voiceAgentService.setAiCallOptOut.mockRejectedValue(new Error("db down"))
  const result = await applyVoiceOptOut({
    workspaceId: "1",
    contactId: "a",
    messageType: "incoming",
    text: "не звоните мне",
    senderIsContact: true,
  })
  expect(result).toEqual({ optedOut: false })
})
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `pnpm exec vitest run __tests__/voice-opt-out.test.ts` в `apps/worker`
Expected: FAIL — модуль не найден

- [ ] **Step 3: Реализация**

`apps/worker/src/integration/handlers/voice-opt-out.ts`:

```ts
import { detectOptOutRequest, voiceAgentService } from "@chatbotx.io/business"
import { logger } from "@chatbotx.io/logger"

export async function applyVoiceOptOut(input: {
  workspaceId: string
  contactId: string
  messageType: string
  text: string | null
  senderIsContact: boolean
}) {
  if (input.messageType !== "incoming" || !input.senderIsContact || !input.text) {
    return { optedOut: false }
  }
  const detection = detectOptOutRequest(input.text)
  if (!detection.matched) {
    return { optedOut: false }
  }
  try {
    await voiceAgentService.setAiCallOptOut({
      workspaceId: input.workspaceId,
      contactId: input.contactId,
      source: "clientChat",
      reason: input.text.slice(0, 500),
    })
    return { optedOut: true }
  } catch (err) {
    logger.error("voice opt-out failed", { err, contactId: input.contactId })
    return { optedOut: false }
  }
}
```

`apps/worker/src/integration/worker.ts`, ветка
`case IntegrationJobAction.incomingMessage` (строка 187). Сразу после
`if (!message) { return }` (строка 201), до проверки `suppressAutomation`,
добавить:

```ts
await applyVoiceOptOut({
  workspaceId: conversation.workspaceId,
  contactId: conversation.contactId,
  messageType: "incoming",
  text: message.text ?? null,
  senderIsContact: message.senderType === "contact",
})
```

Вызов стоит после `receiveMessage` (сообщение уже сохранено) и не меняет
дальнейшую маршрутизацию: автоматизация отвечает как раньше. Имя поля
`conversation.contactId` сверить с типом объекта, который возвращает
`receiveMessage`; если контакт лежит глубже — взять фактическое поле.

- [ ] **Step 4: Прогнать тесты**

Run: `pnpm exec vitest run __tests__/voice-opt-out.test.ts` в `apps/worker`
Expected: PASS

- [ ] **Step 5: Форматирование**

Run: `npx ultracite check apps/worker/src/integration/handlers/voice-opt-out.ts apps/worker/src/integration/worker.ts apps/worker/__tests__/voice-opt-out.test.ts`

---

### Task 8: Тумблер в карточке и меню диалога

**Files:**
- Create: `apps/builder/src/features/contacts/actions/set-ai-call-opt-out.action.ts`
- Create: `apps/builder/src/features/contacts/actions/clear-ai-call-opt-out.action.ts`
- Create: `apps/builder/src/features/contacts/components/contact-ai-calls-section.tsx`
- Modify: `apps/builder/src/features/contacts/contact-inbox-panel.tsx` (рядом с `ContactOrdersSection`, строка 261)
- Modify: `apps/builder/src/features/conversations/conversation-action.tsx` (следом за блоком block/unblock, строки 219–232)
- Modify: `apps/builder/messages/*.json` (22)
- Test: `apps/builder/src/features/contacts/components/__tests__/contact-ai-calls-section.test.tsx`

**Interfaces:**
- Consumes: `voiceAgentService` из `@chatbotx.io/business`, `workspaceActionClient` (`@/lib/safe-action`), `requireContactPermissionScope` (`apps/builder/src/features/contacts/permissions`), `zodBigintAsString`; образец — `apps/builder/src/features/contacts/actions/block-contact.action.ts`
- Produces: `setAiCallOptOutAction`, `clearAiCallOptOutAction`, компонент `ContactAiCallsSection`

- [ ] **Step 1: Падающий тест компонента**

По образцу тестов компонентов в `apps/builder` (react-testing-library):

```tsx
it("показывает цитату и выключает тумблер, когда запрет стоит", () => {
  render(
    <ContactAiCallsSection
      contact={{ id: "a", phoneNumber: "+79990000000", aiCallOptOutAt: new Date("2026-11-02T14:32:00Z"), aiCallOptOutSource: "clientChat", aiCallOptOutReason: "не звоните мне" }}
    />,
  )
  expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false")
  expect(screen.getByText(/не звоните мне/)).toBeInTheDocument()
})

it("предупреждает, когда у контакта нет телефона", () => {
  render(
    <ContactAiCallsSection
      contact={{ id: "a", phoneNumber: null, aiCallOptOutAt: new Date(), aiCallOptOutSource: "manager", aiCallOptOutReason: null }}
    />,
  )
  expect(screen.getByText(/нет телефона/)).toBeInTheDocument()
})
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `pnpm exec vitest run src/features/contacts/components/__tests__/contact-ai-calls-section.test.tsx` в `apps/builder`
Expected: FAIL — компонент не найден

- [ ] **Step 3: Реализация**

`set-ai-call-opt-out.action.ts` — копия структуры `block-contact.action.ts`:

```ts
"use server"
import { voiceAgentService } from "@chatbotx.io/business"
import { zodBigintAsString } from "@chatbotx.io/utils"
import { z } from "zod"
import { workspaceActionClient } from "@/lib/safe-action"
import { requireContactPermissionScope } from "../permissions"

export const setAiCallOptOutAction = workspaceActionClient
  .bindArgsSchemas([zodBigintAsString(), zodBigintAsString()])
  .inputSchema(z.object({ reason: z.string().max(500).optional() }))
  .action(async ({ bindArgsParsedInputs: [workspaceId, id], parsedInput, ctx }) => {
    await requireContactPermissionScope(workspaceId)
    return await voiceAgentService.setAiCallOptOut({
      workspaceId,
      contactId: id,
      source: "manager",
      reason: parsedInput.reason,
      actorUserId: ctx.user.id,
    })
  })
```

Имя поля пользователя в `ctx` сверить с `block-contact.action.ts` и соседними
экшенами при реализации. `clear-ai-call-opt-out.action.ts` — аналогично, без
`reason`, вызывает `clearAiCallOptOut`.

`contact-ai-calls-section.tsx`: секция с `Switch` («Робот может звонить»),
под ним строка «кто и когда» и цитата, при `phoneNumber == null` и стоящем
флаге — предупреждение. Выключение вызывает `setAiCallOptOutAction`, включение —
`clearAiCallOptOutAction`. Тексты через `useTranslations("contactAiCalls")`.

Ключи `contactAiCalls` во всех 22 локалях: `title`, `toggleLabel`,
`optedOutAt`, `noPhoneWarning`, `menuDisable`, `menuEnable`. Русский в
`ru.json` («Звонки робота», «Робот может звонить», «У контакта нет телефона —
звонки не заблокированы, пока номер не появится», «Запретить звонки робота»,
«Разрешить звонки робота»), английский в остальных.

`contact-inbox-panel.tsx`: рендер `<ContactAiCallsSection contact={contact} />`
сразу после `ContactOrdersSection`.

`conversation-action.tsx`: пункт меню следом за блоком block/unblock — при
`conversation.contact?.aiCallOptOutAt` пункт «Разрешить звонки робота», иначе
«Запретить звонки робота».

Проверить, что запрос контакта для карточки выбирает три новые колонки: если
список колонок явный — добавить их.

- [ ] **Step 4: Прогнать тест**

Run: `pnpm exec vitest run src/features/contacts/components/__tests__/contact-ai-calls-section.test.tsx` в `apps/builder`
Expected: PASS (2)

- [ ] **Step 5: Форматирование**

Run: `npx ultracite check apps/builder/src/features/contacts/actions/set-ai-call-opt-out.action.ts apps/builder/src/features/contacts/actions/clear-ai-call-opt-out.action.ts apps/builder/src/features/contacts/components/contact-ai-calls-section.tsx apps/builder/src/features/contacts/contact-inbox-panel.tsx apps/builder/src/features/conversations/conversation-action.tsx`

---

### Task 9: Проверка в боте

**Files:**
- Create: `/GKamion/AI-phone-bot/lib/chatbotx-voice-api.js`
- Create: `/GKamion/AI-phone-bot/test/chatbotx-voice-api.test.js`
- Modify: `/GKamion/AI-phone-bot/lib/novofon-call-api.js`
- Modify: `/GKamion/AI-phone-bot/lib/order-voice-notify.js`

**Interfaces:**
- Consumes: эндпоинты Task 5; `enqueueDeferredCall` (`lib/order-voice-notify.js:84`)
- Produces:

```js
// lib/chatbotx-voice-api.js
class VoicePolicyUnavailableError extends Error {}
async function checkPolicy(phone): Promise<{ canCall: boolean, reason?: string }>
async function optOut({ phone, reason, externalSessionId }): Promise<void>
// VOICE_AI_POLICY_CHECK=off → checkPolicy возвращает { canCall: true } без запроса
```

- [ ] **Step 1: Падающие тесты**

`/GKamion/AI-phone-bot/test/chatbotx-voice-api.test.js` на `node:test`. HTTP
мокается подменой `global.fetch`.

```js
const { describe, it, beforeEach, afterEach } = require("node:test")
const assert = require("node:assert")

describe("checkPolicy", () => {
  it("VOICE_AI_POLICY_CHECK=off не делает запрос", async () => {
    process.env.VOICE_AI_POLICY_CHECK = "off"
    let called = false
    global.fetch = async () => { called = true }
    const { checkPolicy } = require("../lib/chatbotx-voice-api")
    assert.deepEqual(await checkPolicy("+79990000000"), { canCall: true })
    assert.equal(called, false)
  })

  it("canCall false пробрасывается", async () => { /* fetch резолвит { canCall: false, reason: "optedOut" } */ })

  it("таймаут бросает VoicePolicyUnavailableError", async () => { /* fetch не резолвится */ })

  it("не настроено (нет URL или токена) — VoicePolicyUnavailableError", async () => {})
})
```

Кэш `require` сбрасывать через `delete require.cache` в `beforeEach`: модуль
читает env при загрузке.

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `node --test test/chatbotx-voice-api.test.js` в `/GKamion/AI-phone-bot`
Expected: FAIL — модуль не найден

- [ ] **Step 3: Реализация клиента**

`lib/chatbotx-voice-api.js`:

```js
const DEFAULT_TIMEOUT_MS = 3000

class VoicePolicyUnavailableError extends Error {
  constructor(message) {
    super(message)
    this.name = "VoicePolicyUnavailableError"
  }
}

function enabled() {
  return process.env.VOICE_AI_POLICY_CHECK !== "off"
}

async function post(path, body) {
  const base = process.env.CHATBOTX_BASE_URL
  const token = process.env.CHATBOTX_VOICE_AGENT_TOKEN
  if (!base || !token) {
    throw new VoicePolicyUnavailableError("voice policy not configured")
  }
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new VoicePolicyUnavailableError(`voice policy http ${response.status}`)
  }
  return response.json()
}

async function checkPolicy(phone) {
  if (!enabled()) return { canCall: true }
  try {
    return await post("/v1/voice-agent/policy/check", { phone })
  } catch (err) {
    if (err instanceof VoicePolicyUnavailableError) throw err
    throw new VoicePolicyUnavailableError(err.message)
  }
}

async function optOut({ phone, reason, externalSessionId }) {
  if (!enabled()) return
  await post("/v1/voice-agent/opt-out", { phone, reason, externalSessionId })
}

module.exports = { checkPolicy, optOut, VoicePolicyUnavailableError }
```

- [ ] **Step 4: Проверка перед набором**

`lib/novofon-call-api.js`: в начале `informerCall`, `employeeCall` и
`scenarioCall`, до `jsonRpcRequest`:

```js
const voiceApi = require("./chatbotx-voice-api")

async function guard(phone) {
  const policy = await voiceApi.checkPolicy(phone)
  if (!policy.canCall) {
    return { skipped: true, reason: policy.reason }
  }
  return null
}
```

```js
async function employeeCall(params) {
  const skipped = await guard(params.phone)
  if (skipped) return skipped
  // ...прежний код
}
```

То же для `informerCall` и `scenarioCall`. Имя параметра с номером сверить с
фактическими сигнатурами (`lib/novofon-call-api.js:115, 162, 216`).

`lib/order-voice-notify.js`: в `notifyByOrder` обернуть вызов набора —

```js
try {
  result = await novofon.informerCall(...)
} catch (err) {
  if (err.name === "VoicePolicyUnavailableError") {
    enqueueDeferredCall({ order_id, status_id, phone, timezone, reason: "policyUnavailable",
      not_before: new Date(Date.now() + 15 * 60 * 1000).toISOString() })
    return { deferred: true, reason: "policyUnavailable" }
  }
  throw err
}
if (result?.skipped) {
  return { skipped: true, reason: result.reason }
}
```

Прямые пути (`order-prepayment-voice.js`, `order-status16-voice.js`,
`order-status22-voice.js`) не оборачивать: они получают `{ skipped: true }` или
ошибку и не звонят. Отложенная очередь проходит через `notifyByOrder`, поэтому
покрыта и проверкой, и переносом.

- [ ] **Step 5: Прогнать тесты бота**

Run: `node --test test/chatbotx-voice-api.test.js` в `/GKamion/AI-phone-bot`
Expected: PASS

- [ ] **Step 6: Агент на звонке**

Найти в `lib/voice-llm-agent.js` место, где агент завершает сценарий по реплике
клиента. Добавить инструкцию в промпт сценариев: при просьбе не звонить вообще
вернуть маркер `opt_out`. Обработчик маркера вызывает
`chatbotxVoiceApi.optOut({ phone, reason: sttText, externalSessionId })` и
пишет комментарий в заказ через `voice-order-comment.js`: «Бот: клиент
попросил не звонить». Разговор при этом завершается штатно, трубку не рвём.
Точное место маркера определить при реализации — у агента уже есть механизм
маркеров завершения сценария.

---

### Task 10: CI и сверка

**Files:**
- Modify: `.github/workflows/gkamion-checks.yml`

- [ ] **Step 1: Добавить тесты в workflow**

В соответствующие блоки `run` (строки файла — см. текущие списки):

- `packages/database`: `__tests__/voice-agent-partial.test.ts`
- `packages/business`: `__tests__/voice-agent`
- `apps/builder`: `__tests__/voice-agent-api.test.ts`, `src/features/contacts/components/__tests__/contact-ai-calls-section.test.tsx`
- `apps/worker`: `__tests__/voice-opt-out.test.ts`

- [ ] **Step 2: Сверка со спекой**

Пройти критерии выхода этапа 0 (§10 спеки) и отметить, чем закрыт каждый:

- запрет из чата — Task 7 (детектор) + Task 3 (флаг);
- запрет с звонка — Task 9 (`optOut`) + Task 5 (эндпоинт);
- запрет тумблером — Task 8;
- бот не звонит из очереди, отложенной очереди и тестового вебхука — Task 9
  (проверка в `novofon-call-api.js` покрывает все три);
- заметка — Task 3;
- при остановленном ChatbotX звонок откладывается — Task 9
  (`VoicePolicyUnavailableError` → `enqueueDeferredCall`);
- откат — `VOICE_AI_POLICY_CHECK=off` (Task 9).

- [ ] **Step 3: Локальная проверка стиля всего набора**

Run: `npx ultracite check packages/database/src/schema/contact.ts packages/database/src/partials/voice-agent.ts packages/business/src/voice-agent apps/builder/src/features/voice-agent apps/builder/src/features/contacts/components/contact-ai-calls-section.tsx apps/worker/src/integration/handlers/voice-opt-out.ts`

Полный прогон тестов и типов — на GitHub, не локально.

## Что остаётся владельцу после реализации

- Просмотреть SQL миграции и дать «да» на `db:migrate`.
- Выпустить токен workspace со скоупом `voiceAgent` и правом `full`, положить
  его в `/opt/n8n/.env` и env `voice-ai` как `CHATBOTX_VOICE_AGENT_TOKEN`,
  `CHATBOTX_BASE_URL=https://chatbotx.gkamion.ru`.
- Задеплоить бота (симлинк `/GKamion/chat-bot/lib`, mount `/geka-lib`).
- Проверить критерий выхода на `VOICE_AI_TEST_PHONES`: запрет из трёх
  источников, бот не звонит, при остановленном ChatbotX звонок уходит в
  отложенную очередь.

## Вне этапа 0 (не делать здесь)

Таблица `VoiceCall`, `createCall`, `reportResult`, карточка звонка в диалоге,
история звонков, лизинг, `nextCall`, `markDialing`, свипер, перенос окна и
планировщика, страница настроек — этапы 1–3 спеки.
