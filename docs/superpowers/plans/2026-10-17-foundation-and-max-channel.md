# Фундамент «пауза/возобновление» + канал MAX — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить в ChatbotX общий механизм «канал создан, но выключен до ручного включения» и первый новый канал — MAX (входящие через вебхук, исходящие текст/медиа/кнопки).

**Architecture:** В конечный автомат `Connection` добавляются события `user.pause`/`user.resume` и причина `user_paused`, которую не трогают пробный период и реактивация тенанта. Провайдер с флагом `startsPaused` после подключения сразу уходит в паузу и не подписывает вебхук; включение — `connectionService.resume` (проверка токена → подписка вебхука → `connected`), выключение — `connectionService.pause` (отписка → `paused`). MAX — обычный пакет `integrations/max` на `@chatbotx.io/sdk`, auth хранится зашифрованным через новый общий режим `sealAuth` у channel binding.

**Tech Stack:** TypeScript 5, Drizzle + PostgreSQL, oRPC, Next.js 16 / React 19, next-intl, ky, zod 4, vitest + msw.

**Спецификация:** `docs/superpowers/specs/2026-10-17-ru-channels-max-zzap-drom-design.md` (разделы 3, 4.1, 4.4, 6, 7). Это план 1 из 5; ZZAP, DROM, перенос данных Геки и русификация — следующие планы.

## Global Constraints

- Ни один канал не включается автоматически: любое создание (UI, API, скрипт импорта) заканчивается статусом `paused` с причиной `user_paused`. Включает только пользователь.
- Не трогать Геку, n8n, tmtr-runner, Dashboard и их файлы. Не вызывать MAX API с боевым токеном в тестах (только msw).
- `db:migrate` не запускать. Миграцию только сгенерировать, показать SQL и ждать явного «да» пользователя.
- Цепочка доступа к данным: action | API → service (`packages/business`) → repository → DB. Никакого `db` в `apps/*` и `integrations/*`.
- Никакого динамического `import()` в `packages/*`, `integrations/*`, `apps/worker`.
- Логи только через структурный логгер с ключом `err` (`logger.error({ err }, "...")`).
- Все строки интерфейса через `useTranslations()`; в этом плане ключи добавляются в `apps/builder/messages/en.json` (русский — план 5).
- Каждая мутация TanStack-ресурса вызывает инвалидатор (`useInvalidateInboxes`).
- Имена мидлвар с тремя `d`: `workspaceTokenAuthMidddleware`, `workspaceAuthorizedMidddleware`.
- Коммиты: только конкретные файлы (`git add <path>`), никогда `git add -A`/`git add .`; формат сообщений по `.agents/rules/git.md`.
- Перед завершением: `pnpm lint`, `pnpm --filter <пакет> check-types` для каждого затронутого пакета, `pnpm test` по затронутым пакетам.

---

## Карта файлов

**Фундамент (задачи 1–4)**

| Файл | Что меняется |
|---|---|
| `packages/utils/src/connection.ts` | причина `user_paused`, маппинг в `Inbox.disconnectReason` |
| `packages/business/src/connection/state.ts` | события `user.pause`/`user.resume`, вход `fromReason`, защита `teardown.resume` |
| `packages/business/src/connection/state-service.ts` | передаёт `fromReason: existing.statusReason` |
| `packages/business/src/connection/__tests__/state.test.ts` | тесты автомата |
| `packages/database/src/repositories/connection/repository.ts` | `listPausedByOwner` исключает `user_paused` |
| `packages/sdk/src/lib/connection.ts` | флаг `startsPaused` у провайдера |
| `packages/connections/src/post-connect.ts` (новый) | чистое решение «пауза или подписка» после connect |
| `packages/connections/src/internal.ts` | `connectAndPersist` уважает `startsPaused` |
| `packages/connections/src/pause.ts` (новый) | `pause`/`resume` |
| `packages/connections/src/service.ts` | экспорт `pause`/`resume` |
| `packages/connections/__tests__/post-connect.test.ts`, `pause.test.ts` (новые) | тесты |
| `packages/business/src/errors.ts` | `connectionNotPausableException`, `connectionNotResumableException` |
| `apps/builder/src/lib/orpc/orpc-error-helper.ts` | карты ошибок для новых маршрутов |
| `apps/builder/src/features/connections/api/public.ts` | `POST /v1/connections/{id}/pause`, `/resume` |
| `packages/business/src/connection/sealed-auth.ts` (новый) + тест | шифрование auth целиком |
| `packages/business/src/connection/store-bindings.ts` | опция `sealAuth` у `makeChannelBinding` |
| `packages/utils/src/channel.ts` | возможность `pausable` в `CHANNEL_CAPABILITIES` |
| `packages/channel-registry/src/registry.ts` | `openAuth` при чтении auth, блок отправки для выключенных `pausable`-каналов |

**MAX (задачи 5–12)**

| Файл | Что меняется |
|---|---|
| `packages/utils/src/channel.ts`, `packages/database/src/partials/integration.ts` | значение `max` |
| `packages/database/src/schema/integration-max.ts`, `relations/integration-max.ts` (новые) | таблица `IntegrationMax` |
| `packages/database/src/schema/index.ts`, `relations/index.ts`, `types.ts` | регистрация |
| `integrations/max/**` (новый пакет) | интеграция |
| `packages/business/src/integration-max/**` (новый) | `maxIntegrationService` |
| `packages/business/src/connection/store-bindings-channels.ts` | binding `max` с `sealAuth: true` |
| `packages/connections/src/registry.ts`, `packages/channel-registry/src/registry.ts` (+ `package.json`) | регистрация провайдера |
| `apps/builder/src/app/integrations/[...integration]/webhook.ts` | `handleMaxWebhook` |
| `apps/builder/src/features/integration-max/**` (новый) | подключение, переключатель, отключение |
| `apps/builder/src/app/space/[workspaceId]/(settings)/settings/channels/max/page.tsx` (новый) | страница настроек |
| `apps/builder/src/app/(no-sidebar)/channels/create/page.tsx` | ветка `max` |
| `apps/builder/src/features/inboxes/components/inbox-icon.tsx`, `provider/inbox-hook.ts` | иконка и подпись |
| `packages/flow-config/src/channel-rules/policies/max.ts` (новый) + `index.ts` | политика шагов |
| все `Record<ChannelType, …>` (список в задаче 6) | значение для `max` |

---

## Task 1: Причина `user_paused` и события `user.pause`/`user.resume` в автомате

**Files:**
- Modify: `packages/utils/src/connection.ts`
- Modify: `packages/business/src/connection/state.ts`
- Modify: `packages/business/src/connection/state-service.ts:355-359`
- Modify: `packages/database/src/repositories/connection/repository.ts:227-245`
- Test: `packages/business/src/connection/__tests__/state.test.ts`

- [ ] **Step 1: Написать падающие тесты** — добавить в конец `state.test.ts`:

```ts
describe("transitionConnection — user pause/resume", () => {
  test("user.pause from an active status pauses with user_paused and releases quota", () => {
    for (const from of ["connected", "degraded"] as const) {
      const result = transitionConnection({ from, event: "user.pause" })
      expect(result.to).toBe("paused")
      expect(result.reason).toBe("user_paused")
      expect(result.quotaEdge).toBe("release")
    }
  })

  test("user.pause from an inactive status is a no-op", () => {
    for (const from of ["paused", "needs_reauth", "disconnected"] as const) {
      const result = transitionConnection({ from, event: "user.pause" })
      expect(result.noop).toBe(true)
      expect(result.quotaEdge).toBeNull()
    }
  })

  test("user.resume from a user-paused connection connects and consumes quota", () => {
    const result = transitionConnection({
      from: "paused",
      fromReason: "user_paused",
      event: "user.resume",
    })
    expect(result.to).toBe("connected")
    expect(result.reason).toBeNull()
    expect(result.quotaEdge).toBe("consume")
  })

  test("user.resume from needs_reauth connects", () => {
    const result = transitionConnection({
      from: "needs_reauth",
      fromReason: "token_revoked",
      event: "user.resume",
    })
    expect(result.to).toBe("connected")
  })

  test("user.resume never lifts a system pause (trial/tenant)", () => {
    for (const fromReason of ["trial_expired", "tenant_suspended"] as const) {
      const result = transitionConnection({
        from: "paused",
        fromReason,
        event: "user.resume",
      })
      expect(result.noop).toBe(true)
      expect(result.to).toBe("paused")
    }
  })

  test("teardown.resume never lifts a user pause", () => {
    const result = transitionConnection({
      from: "paused",
      fromReason: "user_paused",
      event: "teardown.resume",
    })
    expect(result.noop).toBe(true)
    expect(result.to).toBe("paused")
  })

  test("teardown.pause keeps a user pause untouched", () => {
    const result = transitionConnection({
      from: "paused",
      fromReason: "user_paused",
      event: "teardown.pause",
    })
    expect(result.noop).toBe(true)
    expect(result.reason).toBeNull()
  })
})
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `pnpm --filter @chatbotx.io/business exec vitest run src/connection/__tests__/state.test.ts`
Expected: FAIL — TypeScript/vitest сообщает о неизвестном событии `user.pause` и поле `fromReason`.

- [ ] **Step 3: Добавить причину** — в `packages/utils/src/connection.ts` в `connectionStatusReasons` после `"orphaned_webhook"` добавить `"user_paused"`; в `CONNECTION_TO_INBOX_DISCONNECT_REASON` добавить строку (у `Inbox.disconnectReason` нет своего значения, поэтому `manual`, как у остальных причин без аналога):

```ts
  user_paused: "manual",
```

- [ ] **Step 4: Расширить автомат** — в `packages/business/src/connection/state.ts`:

В `ConnectionEvent` добавить:

```ts
  | "user.pause"
  | "user.resume"
```

В `ConnectionTransitionInput` добавить поле:

```ts
  /** The stored `statusReason` of `from` — needed to tell a user pause from a system pause. */
  fromReason?: ConnectionStatusReason | null
```

В `transitionConnection` заменить `const { from, event, reason } = input` на `const { from, fromReason, event, reason } = input`, заменить ветку `teardown.resume` и добавить две новые ветки перед `teardown.disconnect`:

```ts
    case "teardown.resume": {
      // A user pause is the operator's decision; trial/tenant reactivation
      // must never switch such a channel back on.
      if (from !== "paused" || fromReason === "user_paused") {
        return result(from, from ?? "paused", null)
      }
      return result(from, "connected", null)
    }
    case "user.pause": {
      if (from === undefined || !isActiveConnectionStatus(from)) {
        return result(from, from ?? "paused", null)
      }
      return result(from, "paused", "user_paused")
    }
    case "user.resume": {
      const isUserPaused = from === "paused" && fromReason === "user_paused"
      if (!(isUserPaused || from === "needs_reauth")) {
        return result(from, from ?? "disconnected", null)
      }
      return result(from, "connected", null)
    }
```

- [ ] **Step 5: Передать причину из сервиса** — в `state-service.ts` (вызов около строки 355):

```ts
      const result = transitionConnection({
        from: existing.status,
        fromReason: existing.statusReason,
        event: input.event,
        reason: input.reason,
      })
```

- [ ] **Step 6: Исключить пользовательскую паузу из реактивации** — в `listPausedByOwner` (`repository.ts`) импортировать `isNull`, `ne`, `or` из `drizzle-orm` (рядом с уже импортированными `and`, `eq`) и заменить условие:

```ts
        and(
          eq(workspaceModel.ownerId, input.ownerId),
          eq(connectionModel.status, "paused"),
          or(
            isNull(connectionModel.statusReason),
            ne(connectionModel.statusReason, "user_paused"),
          ),
        ),
```

- [ ] **Step 7: Прогнать тесты**

Run: `pnpm --filter @chatbotx.io/business exec vitest run src/connection/__tests__/state.test.ts src/connection/__tests__/state-service.test.ts src/enterprise/tenant/__tests__/service.test.ts`
Expected: PASS.

- [ ] **Step 8: Сгенерировать миграцию CHECK-ограничения (не применять)**

Run: `pnpm --filter @chatbotx.io/database make:migration connection_user_paused_reason`
Expected: новый файл в `packages/database/migrations/` с пересозданием `Connection_statusReason_check`, где в списке есть `'user_paused'`. Открыть SQL и проверить, что других изменений нет.

- [ ] **Step 9: Commit**

```bash
git add packages/utils/src/connection.ts packages/business/src/connection/state.ts packages/business/src/connection/state-service.ts packages/business/src/connection/__tests__/state.test.ts packages/database/src/repositories/connection/repository.ts packages/database/migrations
git commit -m "feat(connection): add user pause reason and user.pause/user.resume events"
```

---

## Task 2: Провайдер `startsPaused` — подключение сразу в паузу

**Files:**
- Modify: `packages/sdk/src/lib/connection.ts:40-60` (`ConnectionProviderCommon`)
- Create: `packages/connections/src/post-connect.ts`
- Modify: `packages/connections/src/internal.ts:385-390`
- Test: `packages/connections/__tests__/post-connect.test.ts`

- [ ] **Step 1: Флаг в SDK** — в `ConnectionProviderCommon` рядом с `webhook?` добавить:

```ts
  /**
   * Every connect lands in `paused` (reason `user_paused`) and skips
   * `webhook.subscribe`; the operator switches it on via `resume`. For
   * channels that must not start receiving until explicitly enabled.
   */
  startsPaused?: boolean
```

- [ ] **Step 2: Написать падающий тест** — `packages/connections/__tests__/post-connect.test.ts`:

```ts
import { describe, expect, test } from "vitest"
import { resolvePostConnectStep } from "../src/post-connect"

describe("resolvePostConnectStep", () => {
  test("startsPaused providers pause instead of subscribing", () => {
    expect(resolvePostConnectStep({ startsPaused: true })).toBe("pause")
  })

  test("other providers subscribe their webhook", () => {
    expect(resolvePostConnectStep({})).toBe("subscribe")
    expect(resolvePostConnectStep({ startsPaused: false })).toBe("subscribe")
  })
})
```

- [ ] **Step 3: Убедиться, что тест падает**

Run: `pnpm --filter @chatbotx.io/connections exec vitest run __tests__/post-connect.test.ts`
Expected: FAIL — модуль `../src/post-connect` не найден.

- [ ] **Step 4: Реализация** — `packages/connections/src/post-connect.ts`:

```ts
export type PostConnectStep = "pause" | "subscribe"

export const resolvePostConnectStep = (provider: {
  startsPaused?: boolean
}): PostConnectStep => (provider.startsPaused ? "pause" : "subscribe")
```

- [ ] **Step 5: Применить в `connectAndPersist`** — в `internal.ts` заменить вызов `subscribeWebhookBestEffort` (строки ~385-390) на:

```ts
  const final =
    resolvePostConnectStep(provider) === "pause"
      ? await connectionStateService.transition({
          connectionId: connection.id,
          event: "user.pause",
          ownerId,
        })
      : await subscribeWebhookBestEffort({
          adapter,
          auth,
          connection,
          ownerId,
        })
```

и добавить импорт `import { resolvePostConnectStep } from "./post-connect"`.

- [ ] **Step 6: Прогнать тесты пакета**

Run: `pnpm --filter @chatbotx.io/connections test && pnpm --filter @chatbotx.io/connections check-types && pnpm --filter @chatbotx.io/sdk check-types`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/sdk/src/lib/connection.ts packages/connections/src/post-connect.ts packages/connections/src/internal.ts packages/connections/__tests__/post-connect.test.ts
git commit -m "feat(connections): let providers start paused after connect"
```

---

## Task 3: `connectionService.pause`/`resume` и публичные маршруты

**Files:**
- Modify: `packages/business/src/errors.ts` (рядом с `connectionNotRefreshableException`, ~строка 426)
- Create: `packages/connections/src/pause.ts`
- Modify: `packages/connections/src/service.ts`
- Test: `packages/connections/__tests__/pause.test.ts`
- Modify: `apps/builder/src/lib/orpc/orpc-error-helper.ts` (~строка 700)
- Modify: `apps/builder/src/features/connections/api/public.ts` (после `verify`, ~строка 291)

- [ ] **Step 1: Исключения** — в `packages/business/src/errors.ts`:

```ts
/** `pause`/`resume` only apply to providers declaring `startsPaused`. */
export const connectionNotPausableException = (provider: string) =>
  new ChatbotXException(
    `Connection provider "${provider}" cannot be paused or resumed.`,
    "connectionNotPausable",
    400,
  )

/** `resume` only lifts a user pause or a `needs_reauth`; system pauses (trial, tenant) stay. */
export const connectionNotResumableException = () =>
  new ChatbotXException(
    "This connection was paused by the platform and cannot be resumed manually.",
    "connectionNotResumable",
    409,
  )
```

- [ ] **Step 2: Написать падающие тесты** — `packages/connections/__tests__/pause.test.ts`. Моки — по образцу `lifecycle.test.ts`:

```ts
import { beforeEach, describe, expect, test, vi } from "vitest"
import { pause, resume } from "../src/pause"

const mocks = vi.hoisted(() => ({
  findOrThrow: vi.fn(),
  resolveAdapter: vi.fn(),
  resolveForeignKey: vi.fn(() => "inbox-1"),
  resolveOwnerId: vi.fn(async () => "owner-1"),
  transition: vi.fn(),
  update: vi.fn(),
  loadAuthByForeignKey: vi.fn(),
  verify: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
}))

vi.mock("@chatbotx.io/business/connection", () => ({
  connectionStateService: { transition: mocks.transition },
  resolveForeignKey: mocks.resolveForeignKey,
  resolveOwnerId: mocks.resolveOwnerId,
}))

vi.mock("@chatbotx.io/business/errors", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@chatbotx.io/business/errors")>()
  return {
    connectionCredentialsRejectedException: vi.fn(
      () => new Error("rejected"),
    ),
    connectionNotConfiguredException: vi.fn(() => new Error("not configured")),
    connectionNotPausableException: vi.fn(() => new Error("not pausable")),
    connectionNotResumableException: vi.fn(() => new Error("not resumable")),
    connectionProviderUnavailableException: vi.fn(
      () => new Error("unavailable"),
    ),
    toPublicErrorMessage: actual.toPublicErrorMessage,
  }
})

vi.mock("@chatbotx.io/database/repositories", () => ({
  connectionRepository: { update: mocks.update },
}))

vi.mock("../src/internal", () => ({
  findOrThrow: mocks.findOrThrow,
  resolveAdapter: mocks.resolveAdapter,
}))

vi.mock("../src/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn() },
}))

const auth = { authType: "secretText", secretText: "token" }
const adapter = {
  provider: {
    startsPaused: true,
    verify: mocks.verify,
    webhook: { subscribe: mocks.subscribe, unsubscribe: mocks.unsubscribe },
  },
  store: { loadAuthByForeignKey: mocks.loadAuthByForeignKey },
}
const base = {
  id: "conn-1",
  inboxId: "inbox-1",
  integrationId: null,
  provider: "max",
  workspaceId: "ws-1",
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.resolveAdapter.mockReturnValue(adapter)
  mocks.loadAuthByForeignKey.mockResolvedValue(auth)
  mocks.transition.mockImplementation(async ({ event }) => ({
    ...base,
    status: event === "user.pause" ? "paused" : "connected",
  }))
})

describe("pause", () => {
  test("unsubscribes the webhook, then transitions user.pause", async () => {
    mocks.findOrThrow.mockResolvedValue({ ...base, status: "connected" })
    const result = await pause({ connectionId: "conn-1", workspaceId: "ws-1" })
    expect(mocks.unsubscribe).toHaveBeenCalledWith({ auth })
    expect(mocks.transition).toHaveBeenCalledWith(
      expect.objectContaining({ event: "user.pause", ownerId: "owner-1" }),
    )
    expect(result.status).toBe("paused")
  })

  test("still pauses when unsubscribe fails, recording lastError", async () => {
    mocks.findOrThrow.mockResolvedValue({ ...base, status: "connected" })
    mocks.unsubscribe.mockRejectedValue(new Error("MAX down"))
    await pause({ connectionId: "conn-1", workspaceId: "ws-1" })
    expect(mocks.transition).toHaveBeenCalled()
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        values: { lastError: expect.any(String) },
      }),
    )
  })

  test("rejects providers without startsPaused", async () => {
    mocks.findOrThrow.mockResolvedValue({ ...base, status: "connected" })
    mocks.resolveAdapter.mockReturnValue({
      ...adapter,
      provider: { ...adapter.provider, startsPaused: false },
    })
    await expect(
      pause({ connectionId: "conn-1", workspaceId: "ws-1" }),
    ).rejects.toThrow("not pausable")
  })
})

describe("resume", () => {
  test("verifies, subscribes, then transitions user.resume", async () => {
    mocks.findOrThrow.mockResolvedValue({
      ...base,
      status: "paused",
      statusReason: "user_paused",
    })
    mocks.verify.mockResolvedValue({ ok: true })
    const result = await resume({ connectionId: "conn-1", workspaceId: "ws-1" })
    expect(mocks.verify).toHaveBeenCalledWith({ auth })
    expect(mocks.subscribe).toHaveBeenCalledWith({ auth })
    expect(mocks.transition).toHaveBeenCalledWith(
      expect.objectContaining({ event: "user.resume" }),
    )
    expect(result.status).toBe("connected")
  })

  test("refuses a system pause", async () => {
    mocks.findOrThrow.mockResolvedValue({
      ...base,
      status: "paused",
      statusReason: "trial_expired",
    })
    await expect(
      resume({ connectionId: "conn-1", workspaceId: "ws-1" }),
    ).rejects.toThrow("not resumable")
    expect(mocks.subscribe).not.toHaveBeenCalled()
  })

  test("does not change status when the token is rejected", async () => {
    mocks.findOrThrow.mockResolvedValue({
      ...base,
      status: "paused",
      statusReason: "user_paused",
    })
    mocks.verify.mockResolvedValue({ ok: false, revoked: true })
    await expect(
      resume({ connectionId: "conn-1", workspaceId: "ws-1" }),
    ).rejects.toThrow("rejected")
    expect(mocks.transition).not.toHaveBeenCalled()
  })

  test("does not change status when the webhook subscribe fails", async () => {
    mocks.findOrThrow.mockResolvedValue({
      ...base,
      status: "paused",
      statusReason: "user_paused",
    })
    mocks.verify.mockResolvedValue({ ok: true })
    mocks.subscribe.mockRejectedValue(new Error("MAX down"))
    await expect(
      resume({ connectionId: "conn-1", workspaceId: "ws-1" }),
    ).rejects.toThrow("unavailable")
    expect(mocks.transition).not.toHaveBeenCalled()
  })

  test("an already connected connection is returned unchanged", async () => {
    const connected = { ...base, status: "connected", statusReason: null }
    mocks.findOrThrow.mockResolvedValue(connected)
    await expect(
      resume({ connectionId: "conn-1", workspaceId: "ws-1" }),
    ).resolves.toEqual(connected)
    expect(mocks.subscribe).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Убедиться, что тесты падают**

Run: `pnpm --filter @chatbotx.io/connections exec vitest run __tests__/pause.test.ts`
Expected: FAIL — модуль `../src/pause` не найден.

- [ ] **Step 4: Реализация** — `packages/connections/src/pause.ts`:

```ts
import {
  connectionStateService,
  resolveForeignKey,
  resolveOwnerId,
} from "@chatbotx.io/business/connection"
import {
  connectionCredentialsRejectedException,
  connectionNotConfiguredException,
  connectionNotPausableException,
  connectionNotResumableException,
  connectionProviderUnavailableException,
  toPublicErrorMessage,
} from "@chatbotx.io/business/errors"
import { connectionRepository } from "@chatbotx.io/database/repositories"
import type { ConnectionModel } from "@chatbotx.io/database/types"
import { findOrThrow, resolveAdapter } from "./internal"
import { logger } from "./logger"

type ConnectionRef = { connectionId: string; workspaceId: string }

const loadPausable = async (input: ConnectionRef) => {
  const connection = await findOrThrow(input)
  const adapter = resolveAdapter(connection.provider)
  if (!adapter.provider.startsPaused) {
    throw connectionNotPausableException(connection.provider)
  }
  const foreignKey = resolveForeignKey(connection)
  if (!(adapter.store && foreignKey)) {
    throw connectionNotConfiguredException(connection.provider)
  }
  const auth = await adapter.store.loadAuthByForeignKey(
    foreignKey,
    connection.workspaceId,
  )
  return { connection, adapter, auth }
}

/**
 * Operator switch-off: the provider stops delivering (webhook unsubscribe,
 * best-effort) and the connection moves to `paused`/`user_paused`, which
 * trial and tenant reactivation never lift.
 */
export const pause = async (input: ConnectionRef): Promise<ConnectionModel> => {
  const { connection, adapter, auth } = await loadPausable(input)
  if (adapter.provider.webhook) {
    try {
      await adapter.provider.webhook.unsubscribe({ auth })
    } catch (err) {
      logger.warn(
        { err, connectionId: connection.id, provider: connection.provider },
        "connection pause: webhook unsubscribe failed",
      )
      await connectionRepository.update({
        id: connection.id,
        workspaceId: connection.workspaceId,
        values: {
          lastError: toPublicErrorMessage(err, "Webhook unsubscribe failed"),
        },
      })
    }
  }
  return await connectionStateService.transition({
    connectionId: connection.id,
    event: "user.pause",
    ownerId: await resolveOwnerId(connection),
  })
}

/**
 * Operator switch-on: re-checks the stored credential, subscribes the
 * webhook, and only then moves to `connected`. Any failure leaves the
 * status unchanged so the toggle simply stays off.
 */
export const resume = async (
  input: ConnectionRef,
): Promise<ConnectionModel> => {
  const { connection, adapter, auth } = await loadPausable(input)
  if (connection.status === "connected" || connection.status === "degraded") {
    return connection
  }
  const isUserPaused =
    connection.status === "paused" && connection.statusReason === "user_paused"
  if (!(isUserPaused || connection.status === "needs_reauth")) {
    throw connectionNotResumableException()
  }

  const health = await adapter.provider.verify({ auth })
  if (!health.ok) {
    throw connectionCredentialsRejectedException(
      "The stored credentials were rejected by the provider.",
    )
  }
  if (adapter.provider.webhook) {
    try {
      await adapter.provider.webhook.subscribe({ auth })
    } catch (err) {
      logger.warn(
        { err, connectionId: connection.id, provider: connection.provider },
        "connection resume: webhook subscribe failed",
      )
      throw connectionProviderUnavailableException(502)
    }
  }
  return await connectionStateService.transition({
    connectionId: connection.id,
    event: "user.resume",
    ownerId: await resolveOwnerId(connection),
  })
}
```

Проверить по `packages/business/src/errors.ts` сигнатуры `connectionCredentialsRejectedException(message)` и `connectionProviderUnavailableException(status)` — они уже используются в `credentials.ts` именно так.

- [ ] **Step 5: Экспорт** — в `packages/connections/src/service.ts` добавить `import { pause, resume } from "./pause"` и поля `pause,` `resume,` в объект `connectionService`; в шапочный комментарий добавить строку `- pause.ts — pause/resume (operator on/off switch for startsPaused providers).`

- [ ] **Step 6: Прогнать тесты**

Run: `pnpm --filter @chatbotx.io/connections test && pnpm --filter @chatbotx.io/connections check-types`
Expected: PASS.

- [ ] **Step 7: Карты ошибок** — в `orpc-error-helper.ts` после `connectionNotRefreshable`:

```ts
const connectionNotPausable = {
  message: "This connection provider cannot be paused or resumed",
  status: 400,
}

const connectionNotResumable = {
  message:
    "This connection was paused by the platform and cannot be resumed manually",
  status: 409,
}

const connectionCredentialsRejected = {
  message: "The stored credentials were rejected by the provider",
  status: 400,
}

export const possibleErrorsOnPausingConnection = {
  notFound,
  businessError,
  connectionNotConfigured,
  connectionNotPausable,
  ...possibleIdempotencyErrors,
} satisfies ErrorMap

export const possibleErrorsOnResumingConnection = {
  notFound,
  businessError,
  connectionNotConfigured,
  connectionNotPausable,
  connectionNotResumable,
  connectionCredentialsRejected,
  connectionProviderUnavailable,
  ...possibleIdempotencyErrors,
} satisfies ErrorMap
```

Если в файле уже есть константы `connectionCredentialsRejected` или `connectionProviderUnavailable` (их использует `possibleErrorsOnCreatingConnection`), переиспользовать их и не объявлять заново. Код ошибки должен совпадать с `code` в `ChatbotXException`.

- [ ] **Step 8: Публичные маршруты** — в `connections/api/public.ts` импортировать две новые карты ошибок и после `verify` добавить:

```ts
  pause: workspaceTokenAuthAPI
    .route({
      method: "POST",
      path: "/v1/connections/{id}/pause",
      summary: "Switch a channel off",
      description:
        "Stops a channel that starts paused (MAX, ZZAP, DROM): the provider stops delivering messages and the connection moves to `paused` with `statusReason: user_paused`. Trial and tenant reactivation never switch it back on. Get connection ids from `connections.list`. 400 `connectionNotPausable` for other providers.",
      tags: ["Connections"],
    })
    .input(getConnectionRequest)
    .output(connectionResource)
    .errors(possibleErrorsOnPausingConnection)
    .handler(async ({ context, input }) => {
      await loadScopedConnection(context, input.id)
      const connection = await connectionService.pause({
        connectionId: input.id,
        workspaceId: context.workspace.id,
      })
      return toConnectionResource(connection)
    }),

  resume: workspaceTokenAuthAPI
    .route({
      method: "POST",
      path: "/v1/connections/{id}/resume",
      summary: "Switch a channel on",
      description:
        "Switches on a channel paused by the user (or one in `needs_reauth`): re-checks the stored credential, subscribes the provider webhook, and moves the connection to `connected`. On any failure the status does not change. Only one system may serve a channel at a time — switch the old bot off first. Get connection ids from `connections.list`. 409 `connectionNotResumable` for a platform pause (trial, tenant).",
      tags: ["Connections"],
    })
    .input(getConnectionRequest)
    .output(connectionResource)
    .errors(possibleErrorsOnResumingConnection)
    .handler(async ({ context, input }) => {
      await loadScopedConnection(context, input.id)
      const connection = await connectionService.resume({
        connectionId: input.id,
        workspaceId: context.workspace.id,
      })
      return toConnectionResource(connection)
    }),
```

- [ ] **Step 9: Проверка типов builder**

Run: `pnpm --filter builder check-types`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add packages/business/src/errors.ts packages/connections/src/pause.ts packages/connections/src/service.ts packages/connections/__tests__/pause.test.ts apps/builder/src/lib/orpc/orpc-error-helper.ts apps/builder/src/features/connections/api/public.ts
git commit -m "feat(connections): add pause/resume operations and public routes"
```

---

## Task 4: Зашифрованный auth (`sealAuth`) и защита отправки для выключенных каналов

**Files:**
- Create: `packages/business/src/connection/sealed-auth.ts`
- Test: `packages/business/src/connection/__tests__/sealed-auth.test.ts`
- Modify: `packages/business/src/connection/index.ts` (экспорт)
- Modify: `packages/business/src/connection/store-bindings.ts:161-275`
- Modify: `packages/utils/src/channel.ts` (`ChannelCapability`, `CHANNEL_CAPABILITIES`)
- Modify: `packages/channel-registry/src/registry.ts`

- [ ] **Step 1: Написать падающий тест** — `sealed-auth.test.ts` (ключ `ENCRYPTION_KEY` выставляет `packages/vitest-config/src/setup-env.ts`):

```ts
import { describe, expect, test } from "vitest"
import { isSealedAuth, openAuth, sealAuth } from "../sealed-auth"

const auth = {
  authType: "secretText" as const,
  secretText: "max-token",
  botId: "123",
  webhookSecret: "s3cret",
}

describe("sealed auth", () => {
  test("round-trips and hides the secret", async () => {
    const sealed = await sealAuth(auth)
    expect(isSealedAuth(sealed)).toBe(true)
    expect(JSON.stringify(sealed)).not.toContain("max-token")
    await expect(openAuth(sealed)).resolves.toEqual(auth)
  })

  test("passes plain auth through unchanged", async () => {
    await expect(openAuth(auth)).resolves.toEqual(auth)
    expect(isSealedAuth(auth)).toBe(false)
  })
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `pnpm --filter @chatbotx.io/business exec vitest run src/connection/__tests__/sealed-auth.test.ts`
Expected: FAIL — модуль не найден.

- [ ] **Step 3: Реализация** — `packages/business/src/connection/sealed-auth.ts`:

```ts
import { encryptedDataSchema, encryptUtils } from "@chatbotx.io/encryption"
import { type AuthValue, authValueSchema } from "@chatbotx.io/sdk"
import { z } from "zod"

const SEALED_AAD = "connection-auth"

const sealedAuthSchema = z.object({
  authType: z.literal("custom"),
  sealed: encryptedDataSchema,
})
export type SealedAuth = z.infer<typeof sealedAuthSchema>

export const isSealedAuth = (value: unknown): value is SealedAuth =>
  sealedAuthSchema.safeParse(value).success

/** Stores the whole auth object encrypted; the `custom` envelope still satisfies `authValueSchema`. */
export const sealAuth = async (auth: AuthValue): Promise<SealedAuth> => ({
  authType: "custom",
  sealed: await encryptUtils.encryptObject(auth, SEALED_AAD),
})

/** Opens a sealed envelope; plain auth rows of other channels pass through. */
export const openAuth = async (value: unknown): Promise<AuthValue> => {
  const parsed = sealedAuthSchema.safeParse(value)
  if (!parsed.success) {
    return authValueSchema.parse(value)
  }
  return await encryptUtils.decryptObject(
    parsed.data.sealed,
    authValueSchema,
    SEALED_AAD,
  )
}
```

Проверить, что `@chatbotx.io/encryption` экспортирует `encryptUtils` и `encryptedDataSchema` из `"."` (`packages/encryption/src/index.ts`); если нет — добавить реэкспорт туда. В `packages/business/src/connection/index.ts` добавить `export * from "./sealed-auth"`.

- [ ] **Step 4: Опция в binding** — в `makeChannelBinding` (`store-bindings.ts`) добавить в `opts`:

```ts
  /** Encrypt the whole auth at rest (see `sealed-auth.ts`). */
  sealAuth?: boolean
```

и внутри фабрики хелперы:

```ts
  const toStored = async (auth: AuthValue): Promise<unknown> =>
    opts.sealAuth ? await sealAuth(auth) : auth
```

Изменения в методах:
- `loadAuthByForeignKey`: `return asAuthValue(await openAuth(row.auth))`
- `saveAuthByForeignKey`: `.set({ ...safeConfig, auth: await toStored(auth) } as InferInsertModel<TTable>)`
- `insertRow`: в `values` — `auth: await toStored(input.auth),`

Импорт: `import { openAuth, sealAuth } from "./sealed-auth"`.

- [ ] **Step 5: Тесты binding** — в `__tests__/store-bindings.test.ts` добавить кейс по образцу существующих: binding с `sealAuth: true` → `insertRow` пишет значение, для которого `isSealedAuth` = true, а `loadAuthByForeignKey` возвращает исходный auth. Использовать тот же мок `tx`, что и соседние тесты файла.

Run: `pnpm --filter @chatbotx.io/business exec vitest run src/connection/__tests__/`
Expected: PASS.

- [ ] **Step 6: Возможность `pausable`** — в `packages/utils/src/channel.ts` в `ChannelCapability` добавить:

```ts
  /**
   * Created switched off and only switched on by the operator
   * (`connections.resume`). Outbound sends to a switched-off inbox of such a
   * channel are refused.
   */
  pausable: boolean
```

и `pausable: false` во все существующие записи `CHANNEL_CAPABILITIES`.

- [ ] **Step 7: Реестр каналов** — в `packages/channel-registry/src/registry.ts`:

1. Импорт: `import { openAuth } from "@chatbotx.io/business/connection"` и `import { CHANNEL_CAPABILITIES, channelTypes } from "@chatbotx.io/utils/channel"`.
2. В `identifyInboxAndIntegrationAuthFromIdentifier` после `const integrationRow = row as …` заменить на:

```ts
    const integrationRow = {
      ...(row as IntegrationRow & { workspaceId: string }),
      auth: await openAuth(row.auth),
    }
```

3. В `getIntegrationFromContactInbox` вместо `return row as IntegrationRow`:

```ts
    return { ...(row as IntegrationRow), auth: await openAuth(row.auth) }
```

4. В `resolveIntegrationContextFromContactInbox` сразу после получения `integrationRow`:

```ts
  const channel = channelTypes.safeParse(args.contactInbox.channel)
  if (channel.success && CHANNEL_CAPABILITIES[channel.data].pausable) {
    const inbox = await inboxService.find({
      where: { id: args.contactInbox.inboxId },
    })
    if (inbox?.status !== "connected") {
      throw new ChannelError(
        `Channel ${channel.data} is switched off`,
        ChannelErrorCategory.PERMISSION_DENIED,
        { code: "channel_paused" },
      )
    }
  }
```

`PERMISSION_DENIED` выбран намеренно: пауза не должна выглядеть как отозванный токен (`AUTH_FAILED`) и не входит в `RETRYABLE_CATEGORIES`, поэтому задание не повторяется.

- [ ] **Step 8: Проверка**

Run: `pnpm --filter @chatbotx.io/utils check-types && pnpm --filter @chatbotx.io/business check-types && pnpm --filter @chatbotx.io/channel-registry check-types && pnpm --filter @chatbotx.io/channel-registry test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/business/src/connection/sealed-auth.ts packages/business/src/connection/__tests__/sealed-auth.test.ts packages/business/src/connection/__tests__/store-bindings.test.ts packages/business/src/connection/index.ts packages/business/src/connection/store-bindings.ts packages/utils/src/channel.ts packages/channel-registry/src/registry.ts
git commit -m "feat(connection): encrypt channel auth at rest and block sends to switched-off channels"
```

(Добавить `packages/encryption/src/index.ts`, если в шаге 3 менялся реэкспорт.)

---

## Task 5: Таблица `IntegrationMax` и значение `max` в перечислениях

**Files:**
- Modify: `packages/utils/src/channel.ts:18-30` (`channelTypes`)
- Modify: `packages/database/src/partials/integration.ts` (`integrationTypes`)
- Create: `packages/database/src/schema/integration-max.ts`
- Create: `packages/database/src/relations/integration-max.ts`
- Modify: `packages/database/src/schema/index.ts`, `packages/database/src/relations/index.ts`, `packages/database/src/types.ts`

- [ ] **Step 1: Перечисления** — добавить `"max"` в `channelTypes` (после `"tiktok"`) и в `integrationTypes` (по алфавиту, после `"mailerLite"`/перед `"messenger"` — по месту в списке).

- [ ] **Step 2: Схема** — `packages/database/src/schema/integration-max.ts`:

```ts
import { index, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core"
import { bigintAsString, sharedColumns } from "../partials/shared"
import { inboxModel } from "./inbox"
import { workspaceModel } from "./workspace"

export const integrationMaxModel = pgTable(
  "IntegrationMax",
  {
    ...sharedColumns,
    /** Sealed (encrypted) auth envelope — see business `sealed-auth.ts`. */
    auth: jsonb().$type<{ [x: string]: unknown }>().notNull(),
    botId: text().notNull(),
    name: text().notNull(),
    workspaceId: bigintAsString()
      .notNull()
      .references(() => workspaceModel.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    inboxId: bigintAsString()
      .notNull()
      .references(() => inboxModel.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
  },
  (table) => [
    index("IntegrationMax_workspaceId_idx").using(
      "btree",
      table.workspaceId.asc().nullsLast(),
    ),
    uniqueIndex("IntegrationMax_inboxId_key").using(
      "btree",
      table.inboxId.asc().nullsLast(),
    ),
    uniqueIndex("IntegrationMax_botId_key").using(
      "btree",
      table.botId.asc().nullsLast(),
    ),
  ],
)
```

- [ ] **Step 3: Relations** — скопировать `relations/integration-telegram.ts` в `relations/integration-max.ts`, заменив `integrationTelegramModel` → `integrationMaxModel`, `integrationTelegramRelations` → `integrationMaxRelations`. Если в `relations/integration-telegram.ts` есть обратная связь из `inbox`/`workspace` (например, `integrationTelegrams: many(...)` в `relations/inbox.ts`), добавить аналогичную `integrationMaxes` только если она нужна запросам — для этого плана не нужна, не добавлять.

- [ ] **Step 4: Регистрация (две правки в relations, инвариант 2)**
- `schema/index.ts`: `export * from "./integration-max"` рядом с `./integration-telegram`.
- `relations/index.ts`: `import { integrationMaxRelations } from "./integration-max"` **и** `...integrationMaxRelations,` внутри объекта `relations` рядом с `...integrationTelegramRelations`.
- `types.ts` рядом с `IntegrationTelegramModel`:

```ts
export type IntegrationMaxModel = typeof schema.integrationMaxModel.$inferSelect
```

- [ ] **Step 5: Сгенерировать миграцию (не применять)**

Run: `pnpm --filter @chatbotx.io/database make:migration integration_max`
Expected: SQL с `CREATE TABLE "IntegrationMax"`, тремя индексами и пересозданием CHECK-ограничений, в которые попадает `max` (если они строятся из `channelTypes`/`integrationTypes`). Ничего про другие таблицы.

Run: `pnpm --filter @chatbotx.io/database db:check-drift`
Expected: PASS (дрейфа нет).

- [ ] **Step 6: Commit** (компиляция остальных пакетов пока падает на `Record<ChannelType` — чинится в задаче 6; коммитить вместе с задачей 6, если CI-хуки требуют зелёных типов)

```bash
git add packages/utils/src/channel.ts packages/database/src/partials/integration.ts packages/database/src/schema/integration-max.ts packages/database/src/relations/integration-max.ts packages/database/src/schema/index.ts packages/database/src/relations/index.ts packages/database/src/types.ts packages/database/migrations
git commit -m "feat(database): add IntegrationMax table and max channel type"
```

---

## Task 6: Каскад `ChannelType` — значение `max` во всех записях

**Files (все `Record<ChannelType, …>` вне тестов):**
`packages/utils/src/channel.ts`, `packages/business/src/contact/profile-refresh/rules.ts`, `packages/business/src/product-message/catalog-sources.ts`, `packages/business/src/inbox/connect-channel.ts`, `packages/business/src/inbox/utils.ts`, `packages/business/src/broadcast/service.ts`, `apps/worker/src/integration/handlers/inbox_labels/index.ts`, `apps/builder/src/features/messages/components/message-input.tsx`, `apps/builder/src/features/broadcasts/lib/broadcast-inbox-label.ts`, `apps/builder/src/features/broadcasts/hooks/use-broadcast-page-templates.ts`, `apps/builder/src/features/broadcasts/components/broadcast-target-card.tsx`, `apps/builder/src/features/contacts/contact-detail.tsx`, `apps/builder/src/features/workspaces/lib/workspace-token-scopes.ts`, `apps/builder/src/features/broadcasts/components/broadcast-flow-targets.tsx`, `apps/builder/src/features/inboxes/components/inbox-icon.tsx`, `packages/database/scripts/backfill-connections/channel-fetchers.ts`, `packages/flow-config/src/nodes/quick-reply-carrier.ts`, `packages/flow-config/src/channel-rules/policies/define.ts`

- [ ] **Step 1: `CHANNEL_CAPABILITIES`** — запись для `max`:

```ts
  max: {
    creatable: true,
    manageable: true,
    requiresCredential: false,
    order: 7,
    callable: false,
    pausable: true,
  },
```

(сдвинуть `order` у `zalo`, `webchat`, `smtp`, `api`, `omnichannel` на +1).

- [ ] **Step 2: Остальные записи** — правило выбора значения для `max`: брать значение записи `telegram` (ближайший аналог: бот-канал, текстовые кнопки-колбэки, медиа по URL), кроме:
  - `profile-refresh/rules.ts` — профиль не обновлять (значение «выключено»/`null`, как у `webchat`), MAX не отдаёт профиль отдельно;
  - `product-message/catalog-sources.ts` — как у `telegram` (без каталога);
  - `backfill-connections/channel-fetchers.ts` — как у каналов без исторического бэкфилла (если у `telegram` реальный fetcher по `IntegrationTelegram`, сделать такой же по `integrationMaxModel` с `identityColumn` `botId`);
  - `inbox-icon.tsx` — делается в задаче 11 (временно поставить запись `telegram`, заменить там же).

- [ ] **Step 3: Проверка типов по всем пакетам**

Run: `pnpm turbo run check-types --filter=@chatbotx.io/utils --filter=@chatbotx.io/business --filter=@chatbotx.io/flow-config --filter=@chatbotx.io/database --filter=worker --filter=builder`
Expected: ошибки только «property 'max' is missing» в ещё не зарегистрированных реестрах (`CHANNEL_FLOW_POLICIES`, `CONNECTION_STORE_BINDINGS`, `CONNECTION_REGISTRY`) — они закрываются в задачах 8 и 12. Других ошибок быть не должно.

- [ ] **Step 4: Commit**

```bash
git add <все файлы из списка выше, которые изменились>
git commit -m "feat(channels): register max in every ChannelType record"
```

---

## Task 7: Пакет `integrations/max` — клиент, ошибки, парсер входящих

**Files:**
- Create: `integrations/max/package.json`, `tsconfig.json`, `vitest.config.ts` (скопировать из `integrations/telegram`, поменять имя на `@chatbotx.io/integration-max`, убрать `remeda`, если не используется)
- Create: `integrations/max/src/{index.ts,constants.ts,schema.ts,exception.ts}`
- Create: `integrations/max/src/lib/{logger.ts,http-client.ts,error-mapper.ts,webhook-url.ts}`
- Create: `integrations/max/src/apis/{bot.ts,messages.ts,uploads.ts,subscriptions.ts}`
- Create: `integrations/max/src/handlers/parse-update.ts`
- Test: `integrations/max/__tests__/parse-update.test.ts`, `integrations/max/__tests__/fixtures/*.json`

- [ ] **Step 1: Каркас пакета** — `package.json`:

```json
{
  "name": "@chatbotx.io/integration-max",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "dependencies": {
    "@chatbotx.io/flow-config": "workspace:*",
    "@chatbotx.io/logger": "workspace:*",
    "@chatbotx.io/sdk": "workspace:*",
    "@chatbotx.io/utils": "workspace:*",
    "ky": "^2.0.2",
    "remeda": "^2.34.0",
    "zod": "^4.3.6"
  },
  "devDependencies": {
    "@chatbotx.io/typescript-config": "workspace:*",
    "@chatbotx.io/vitest-config": "workspace:*",
    "@types/node": "^24.10.4",
    "msw": "^2.7.3",
    "typescript": "^5",
    "vitest": "^4.1.0"
  },
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "check-types": "tsc --noEmit",
    "test": "vitest run --passWithNoTests",
    "test:watch": "vitest"
  }
}
```

Run: `CI=true pnpm install --no-frozen-lockfile`
Expected: пакет слинкован (инвариант 5).

- [ ] **Step 2: Константы, логгер, схема**

`src/constants.ts`:

```ts
export const MAX_API_BASE_URL = "https://platform-api2.max.ru/"
export const MAX_TEXT_LIMIT = 4000
export const MAX_BUTTONS_PER_ROW = 3
export const MAX_WEBHOOK_SECRET_HEADER = "X-Max-Bot-Api-Secret"
export const MAX_UPDATE_TYPES = [
  "message_created",
  "message_callback",
  "bot_started",
] as const
```

`src/lib/logger.ts` — скопировать из `integrations/telegram/src/lib/logger.ts`, имя дочернего логгера `integration-max`.

`src/schema.ts`:

```ts
import type { BaseConfig, SecretTextAuthValue } from "@chatbotx.io/sdk"
import { z } from "zod"

export type MaxAuthValue = SecretTextAuthValue & {
  botId: string
  botName: string
  webhookSecret: string
}

export type MaxConfig = BaseConfig & {
  botId?: string
  webhookSecret?: string
}

export const maxUserSchema = z
  .object({
    user_id: z.number(),
    first_name: z.string().optional(),
    last_name: z.string().nullish(),
    name: z.string().optional(),
    username: z.string().nullish(),
    is_bot: z.boolean().optional(),
  })
  .passthrough()
export type MaxUser = z.infer<typeof maxUserSchema>

export const maxAttachmentSchema = z
  .object({
    type: z.string(),
    payload: z.record(z.string(), z.unknown()).nullish(),
    filename: z.string().optional(),
    size: z.number().optional(),
  })
  .passthrough()
export type MaxAttachment = z.infer<typeof maxAttachmentSchema>

export const maxMessageSchema = z
  .object({
    sender: maxUserSchema.optional(),
    recipient: z
      .object({
        chat_id: z.number().nullish(),
        chat_type: z.string().optional(),
        user_id: z.number().nullish(),
      })
      .passthrough(),
    timestamp: z.number(),
    body: z
      .object({
        mid: z.string(),
        text: z.string().nullish(),
        attachments: z.array(maxAttachmentSchema).nullish(),
      })
      .passthrough(),
  })
  .passthrough()

export const maxUpdateSchema = z
  .object({
    update_type: z.string(),
    timestamp: z.number(),
    message: maxMessageSchema.optional(),
    callback: z
      .object({
        callback_id: z.string(),
        payload: z.string().optional(),
        user: maxUserSchema,
      })
      .passthrough()
      .optional(),
    user: maxUserSchema.optional(),
    payload: z.string().nullish(),
    user_locale: z.string().nullish(),
  })
  .passthrough()
export type MaxUpdate = z.infer<typeof maxUpdateSchema>

export type MaxButton =
  | { type: "callback"; text: string; payload: string }
  | { type: "link"; text: string; url: string }

export type MaxAttachmentRequest =
  | { type: "image"; payload: { url: string } | { token: string } }
  | { type: "video" | "audio" | "file"; payload: { token: string } }
  | { type: "inline_keyboard"; payload: { buttons: MaxButton[][] } }

export type MaxNewMessageBody = {
  text?: string
  attachments?: MaxAttachmentRequest[]
}
```

- [ ] **Step 3: Ошибки и HTTP-клиент** — `src/exception.ts` по образцу Telegram: `MaxException extends SdkException`, `MaxAPIException extends MaxException`, `MaxWebhookException`; `parseOriginError` читает тело MAX `{ code?: string; message?: string }`:

```ts
type ErrorBody = { code?: string; message?: string }
```

(`code` → `code`, `message` → `message`). `src/lib/http-client.ts` — копия Telegram-клиента с отличиями:

```ts
    this.client = ky.create({
      baseUrl: MAX_API_BASE_URL,
      headers: { Authorization: token },
      timeout: 30_000,
      retry: {
        limit: 3,
        methods: ["get", "post", "delete"],
        statusCodes: [408, 429, 500, 502, 503, 504],
        backoffLimit: 1000,
      },
      // beforeError hook — как у Telegram
    })
```

и методы `get<T>(endpoint, { searchParams? })`, `post<T>(endpoint, { searchParams?, json? })`, `delete<T>(endpoint, { searchParams? })`. Фабрика `createMaxClient(token: string)`.

`src/lib/error-mapper.ts` — по образцу Telegram: `mapToChannelError(error)` и `isRevokedTokenError(error)`. Правила MAX: HTTP 401 → `AUTH_FAILED` (и `isRevokedTokenError` = true); HTTP 403 или `code` `"chat.denied"`/`"user.blocked"` → `USER_BLOCKED`; 429 → `RATE_LIMITED`; 5xx и сетевые сбои → `NETWORK_ERROR`; 400 → `PAYLOAD_INVALID`; иначе `UNKNOWN` (категории из `ChannelErrorCategory`, `packages/sdk/src/lib/channel-error-codes.ts`; конструктор `ChannelError` — как в Telegram-маппере).

`src/lib/webhook-url.ts`:

```ts
import { MaxException } from "../exception"

/** Public URL MAX posts updates to; same origin rule as the builder's broker callbacks. */
export const resolveMaxWebhookUrl = (botId: string): string => {
  const origin =
    process.env.NEXT_PUBLIC_BROKER_URL ?? process.env.NEXT_PUBLIC_BUILDER_URL
  if (!origin) {
    throw new MaxException("NEXT_PUBLIC_BUILDER_URL is not configured")
  }
  const url = new URL("/integrations/max/webhook", origin)
  url.searchParams.set("botId", botId)
  return url.toString()
}
```

- [ ] **Step 4: API-обёртки**

`src/apis/bot.ts`:

```ts
import { createMaxClient } from "../lib/http-client"

export type MaxBotInfo = {
  user_id: number
  name?: string
  first_name?: string
  username?: string | null
}

export const getMe = async (token: string): Promise<MaxBotInfo> =>
  await createMaxClient(token).get<MaxBotInfo>("me")

export const sendTypingOn = async (token: string, chatId: string) =>
  await createMaxClient(token).post(`chats/${chatId}/actions`, {
    json: { action: "typing_on" },
  })
```

`src/apis/subscriptions.ts`:

```ts
import { MAX_UPDATE_TYPES } from "../constants"
import { createMaxClient } from "../lib/http-client"

export const subscribeWebhook = async (props: {
  token: string
  url: string
  secret: string
}) =>
  await createMaxClient(props.token).post("subscriptions", {
    json: {
      url: props.url,
      update_types: MAX_UPDATE_TYPES,
      secret: props.secret,
    },
  })

export const unsubscribeWebhook = async (props: {
  token: string
  url: string
}) =>
  await createMaxClient(props.token).delete("subscriptions", {
    searchParams: { url: props.url },
  })
```

`src/apis/uploads.ts`:

```ts
import { MaxException } from "../exception"
import { createMaxClient } from "../lib/http-client"
import type { MaxAttachmentRequest } from "../schema"

export type MaxMediaKind = "image" | "video" | "audio" | "file"

type UploadSlot = { url: string; token?: string }

/**
 * Images go by URL; MAX needs an upload for video/audio/file:
 * POST /uploads?type= → multipart `data` to the returned URL → token
 * (video/audio: token from step 1; file: token from the upload response).
 */
export const toMaxMediaAttachment = async (props: {
  token: string
  kind: MaxMediaKind
  url: string
  filename?: string
}): Promise<MaxAttachmentRequest> => {
  if (props.kind === "image") {
    return { type: "image", payload: { url: props.url } }
  }
  const slot = await createMaxClient(props.token).post<UploadSlot>("uploads", {
    searchParams: { type: props.kind },
  })
  const source = await fetch(props.url)
  if (!source.ok) {
    throw new MaxException(`Failed to download media (${source.status})`)
  }
  const form = new FormData()
  form.append(
    "data",
    new Blob([await source.arrayBuffer()]),
    props.filename ?? "file",
  )
  const uploaded = await fetch(slot.url, { method: "POST", body: form })
  if (!uploaded.ok) {
    throw new MaxException(`MAX upload failed (${uploaded.status})`)
  }
  const token =
    props.kind === "file"
      ? ((await uploaded.json()) as { token?: string }).token
      : slot.token
  if (!token) {
    throw new MaxException("MAX upload returned no token")
  }
  return { type: props.kind, payload: { token } }
}
```

`src/apis/messages.ts`:

```ts
import { createMaxClient } from "../lib/http-client"
import { MaxAPIException } from "../exception"
import type { MaxNewMessageBody } from "../schema"

type SendResult = { message: { body: { mid: string } } }

const ATTACHMENT_NOT_READY = "attachment.not.ready"
const NOT_READY_RETRIES = 3
const NOT_READY_DELAY_MS = 1000

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))

/** Sends one message to a user; retries while an uploaded file is still processing. */
export const sendMaxMessage = async (props: {
  token: string
  userId: string
  body: MaxNewMessageBody
}): Promise<string> => {
  for (let attempt = 0; ; attempt++) {
    try {
      const result = await createMaxClient(props.token).post<SendResult>(
        "messages",
        { searchParams: { user_id: props.userId }, json: props.body },
      )
      return result.message.body.mid
    } catch (error) {
      const notReady =
        error instanceof MaxAPIException &&
        error.code === ATTACHMENT_NOT_READY &&
        attempt < NOT_READY_RETRIES
      if (!notReady) {
        throw error
      }
      await sleep(NOT_READY_DELAY_MS)
    }
  }
}
```

- [ ] **Step 5: Фикстуры** — `integrations/max/__tests__/fixtures/`:

`message-text.json`:

```json
{
  "update_type": "message_created",
  "timestamp": 1760700000000,
  "message": {
    "sender": { "user_id": 555, "first_name": "Иван", "last_name": "Петров", "username": "ivan" },
    "recipient": { "chat_id": 9001, "chat_type": "dialog", "user_id": 777 },
    "timestamp": 1760700000000,
    "body": { "mid": "mid.1", "text": "Есть ли поршень на КамАЗ?" }
  },
  "user_locale": "ru"
}
```

`message-image.json` — то же, `body`: `{ "mid": "mid.2", "text": null, "attachments": [{ "type": "image", "payload": { "url": "https://i.max.ru/p/1.jpg", "photo_id": 1 } }] }`.

`message-file.json` — `body`: `{ "mid": "mid.3", "attachments": [{ "type": "file", "filename": "счёт.pdf", "size": 1024, "payload": { "url": "https://f.max.ru/1", "fileId": 5 } }] }`.

`message-from-bot.json` — как `message-text.json`, но `sender.is_bot: true`.

`message-group.json` — как `message-text.json`, но `recipient.chat_type: "chat"`.

`callback.json`:

```json
{
  "update_type": "message_callback",
  "timestamp": 1760700001000,
  "callback": { "callback_id": "cb.1", "payload": "flow:abc:btn1", "user": { "user_id": 555, "first_name": "Иван" } }
}
```

`bot-started.json`:

```json
{
  "update_type": "bot_started",
  "timestamp": 1760700002000,
  "user": { "user_id": 555, "first_name": "Иван" },
  "payload": "ad42"
}
```

- [ ] **Step 6: Написать падающие тесты парсера** — `__tests__/parse-update.test.ts`:

```ts
import { describe, expect, test } from "vitest"
import { parseMaxUpdate } from "../src/handlers/parse-update"
import botStarted from "./fixtures/bot-started.json"
import callback from "./fixtures/callback.json"
import fromBot from "./fixtures/message-from-bot.json"
import file from "./fixtures/message-file.json"
import group from "./fixtures/message-group.json"
import image from "./fixtures/message-image.json"
import text from "./fixtures/message-text.json"

describe("parseMaxUpdate", () => {
  test("text message from a user", () => {
    expect(parseMaxUpdate(text)).toEqual({
      kind: "message",
      sourceId: "mid.1",
      contact: {
        sourceId: "555",
        firstName: "Иван",
        lastName: "Петров",
        locale: "ru",
      },
      text: "Есть ли поршень на КамАЗ?",
      media: [],
    })
  })

  test("image attachment becomes image media by URL", () => {
    const parsed = parseMaxUpdate(image)
    expect(parsed?.kind).toBe("message")
    expect(parsed && "media" in parsed ? parsed.media : []).toEqual([
      { kind: "image", url: "https://i.max.ru/p/1.jpg" },
    ])
  })

  test("file attachment keeps filename", () => {
    const parsed = parseMaxUpdate(file)
    expect(parsed && "media" in parsed ? parsed.media : []).toEqual([
      { kind: "file", url: "https://f.max.ru/1", filename: "счёт.pdf" },
    ])
  })

  test("bot and group traffic is skipped", () => {
    expect(parseMaxUpdate(fromBot)).toBeNull()
    expect(parseMaxUpdate(group)).toBeNull()
  })

  test("callback carries the button payload", () => {
    expect(parseMaxUpdate(callback)).toEqual({
      kind: "callback",
      sourceId: "cb.1",
      contact: { sourceId: "555", firstName: "Иван" },
      payload: "flow:abc:btn1",
    })
  })

  test("bot_started carries the start ref", () => {
    expect(parseMaxUpdate(botStarted)).toEqual({
      kind: "started",
      sourceId: "bot_started:555:1760700002000",
      contact: { sourceId: "555", firstName: "Иван" },
      ref: "ad42",
    })
  })

  test("unknown update types are skipped", () => {
    expect(
      parseMaxUpdate({ update_type: "chat_title_changed", timestamp: 1 }),
    ).toBeNull()
  })
})
```

(В `tsconfig.json` пакета должен быть `"resolveJsonModule": true`; если базовый конфиг его не включает — добавить в `compilerOptions`.)

- [ ] **Step 7: Убедиться, что тесты падают**

Run: `pnpm --filter @chatbotx.io/integration-max test`
Expected: FAIL — модуль `parse-update` не найден.

- [ ] **Step 8: Реализация парсера** — `src/handlers/parse-update.ts` (порт логики `max-parse.js` Геки: пропуск ботов, только диалоги, `bot_started` → `/start`-ref):

```ts
import type { IncomingContact } from "@chatbotx.io/sdk"
import {
  type MaxAttachment,
  type MaxUpdate,
  type MaxUser,
  maxUpdateSchema,
} from "../schema"

export type MaxInboundMedia = {
  kind: "image" | "video" | "audio" | "file"
  url: string
  filename?: string
}

export type MaxInbound =
  | {
      kind: "message"
      sourceId: string
      contact: IncomingContact
      text?: string
      media: MaxInboundMedia[]
    }
  | {
      kind: "callback"
      sourceId: string
      contact: IncomingContact
      payload: string
    }
  | {
      kind: "started"
      sourceId: string
      contact: IncomingContact
      ref: string | null
    }

const toContact = (user: MaxUser, locale?: string | null): IncomingContact => ({
  sourceId: String(user.user_id),
  firstName: user.first_name ?? user.name,
  ...(user.last_name ? { lastName: user.last_name } : {}),
  ...(locale ? { locale } : {}),
})

const MEDIA_KINDS = new Set(["image", "video", "audio", "file"])

const toMedia = (attachment: MaxAttachment): MaxInboundMedia | null => {
  const url = attachment.payload?.url
  if (!(MEDIA_KINDS.has(attachment.type) && typeof url === "string")) {
    return null
  }
  return {
    kind: attachment.type as MaxInboundMedia["kind"],
    url,
    ...(attachment.filename ? { filename: attachment.filename } : {}),
  }
}

const parseMessage = (update: MaxUpdate): MaxInbound | null => {
  const message = update.message
  const sender = message?.sender
  if (!(message && sender) || sender.is_bot) {
    return null
  }
  if (message.recipient.chat_type && message.recipient.chat_type !== "dialog") {
    return null
  }
  const media = (message.body.attachments ?? [])
    .map(toMedia)
    .filter((item): item is MaxInboundMedia => item !== null)
  return {
    kind: "message",
    sourceId: message.body.mid,
    contact: toContact(sender, update.user_locale),
    ...(message.body.text ? { text: message.body.text } : {}),
    media,
  }
}

/** Normalizes one MAX update; `null` = not a 1:1 user event worth processing. */
export const parseMaxUpdate = (raw: unknown): MaxInbound | null => {
  const parsed = maxUpdateSchema.safeParse(raw)
  if (!parsed.success) {
    return null
  }
  const update = parsed.data
  switch (update.update_type) {
    case "message_created":
      return parseMessage(update)
    case "message_callback": {
      if (!update.callback) {
        return null
      }
      return {
        kind: "callback",
        sourceId: update.callback.callback_id,
        contact: toContact(update.callback.user, update.user_locale),
        payload: update.callback.payload ?? "",
      }
    }
    case "bot_started": {
      if (!update.user) {
        return null
      }
      return {
        kind: "started",
        sourceId: `bot_started:${update.user.user_id}:${update.timestamp}`,
        contact: toContact(update.user, update.user_locale),
        ref: update.payload ?? null,
      }
    }
    default:
      return null
  }
}
```

- [ ] **Step 9: Прогнать тесты**

Run: `pnpm --filter @chatbotx.io/integration-max test && pnpm --filter @chatbotx.io/integration-max check-types`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add integrations/max pnpm-lock.yaml
git commit -m "feat(max): add MAX integration package with API client and update parser"
```

---

## Task 8: MAX — обработчики сообщений, определение интеграции, регистрация провайдера

**Files:**
- Create: `integrations/max/src/handlers/webhook.ts`, `handlers/message/{index,incoming-message,outgoing-message,to-max-messages}.ts`, `handlers/conversation.ts`, `src/integration.ts`
- Modify: `integrations/max/src/index.ts`
- Test: `integrations/max/__tests__/to-max-messages.test.ts`, `__tests__/webhook.test.ts`, `__tests__/send.test.ts`
- Modify: `packages/business/src/connection/store-bindings-channels.ts` (~строка 314)
- Modify: `packages/connections/src/registry.ts:30,158` и `packages/connections/package.json`
- Modify: `packages/channel-registry/src/registry.ts` (импорт, `integrations`, `case "max"`, `integrationTableByChannel`) и `package.json`
- Modify: `apps/builder/package.json`, `apps/worker/package.json`

- [ ] **Step 1: Написать падающие тесты преобразования** — `__tests__/to-max-messages.test.ts`:

```ts
import { describe, expect, test } from "vitest"
import { splitMaxText, toKeyboard } from "../src/handlers/message/to-max-messages"

describe("splitMaxText", () => {
  test("keeps short text as one chunk", () => {
    expect(splitMaxText("привет")).toEqual(["привет"])
  })

  test("splits at 4000 chars preferring a newline", () => {
    const first = `${"а".repeat(3990)}\n`
    const chunks = splitMaxText(`${first}${"б".repeat(20)}`)
    expect(chunks).toEqual([first.trimEnd(), "б".repeat(20)])
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(4000)
    }
  })
})

describe("toKeyboard", () => {
  test("rows of three, callback and link buttons", () => {
    const keyboard = toKeyboard([
      { type: "callback", text: "1", payload: "a" },
      { type: "callback", text: "2", payload: "b" },
      { type: "callback", text: "3", payload: "c" },
      { type: "link", text: "Сайт", url: "https://gkamion.ru" },
    ])
    expect(keyboard).toEqual({
      type: "inline_keyboard",
      payload: {
        buttons: [
          [
            { type: "callback", text: "1", payload: "a" },
            { type: "callback", text: "2", payload: "b" },
            { type: "callback", text: "3", payload: "c" },
          ],
          [{ type: "link", text: "Сайт", url: "https://gkamion.ru" }],
        ],
      },
    })
  })

  test("no buttons → no keyboard", () => {
    expect(toKeyboard([])).toBeUndefined()
  })
})
```

Run: `pnpm --filter @chatbotx.io/integration-max exec vitest run __tests__/to-max-messages.test.ts`
Expected: FAIL — модуль не найден.

- [ ] **Step 2: Модель исходящего сообщения** — `src/handlers/message/to-max-messages.ts`:

```ts
import {
  type ButtonStepProps,
  buttonTypes,
  encodeButtonPayload,
} from "@chatbotx.io/flow-config"
import type { MessageButtonTemplate } from "@chatbotx.io/sdk"
import { chunk } from "remeda"
import type { MaxMediaKind } from "../../apis/uploads"
import { MAX_BUTTONS_PER_ROW, MAX_TEXT_LIMIT } from "../../constants"
import type { MaxAttachmentRequest, MaxButton } from "../../schema"

/** One MAX message before media upload: text, media by URL, buttons. */
export type MaxOutgoing = {
  text?: string
  media?: { kind: MaxMediaKind; url: string; filename?: string }[]
  buttons?: MaxButton[]
}

export const splitMaxText = (text: string): string[] => {
  const chunks: string[] = []
  let rest = text
  while (rest.length > MAX_TEXT_LIMIT) {
    const window = rest.slice(0, MAX_TEXT_LIMIT)
    const cut = window.lastIndexOf("\n")
    const end = cut > 0 ? cut + 1 : MAX_TEXT_LIMIT
    chunks.push(rest.slice(0, end).trimEnd())
    rest = rest.slice(end)
  }
  if (rest.length > 0) {
    chunks.push(rest)
  }
  return chunks
}

export const toKeyboard = (
  buttons: MaxButton[],
): MaxAttachmentRequest | undefined =>
  buttons.length === 0
    ? undefined
    : {
        type: "inline_keyboard",
        payload: { buttons: chunk(buttons, MAX_BUTTONS_PER_ROW) },
      }

export const fromFlowButton = (
  flowId: string,
  button: ButtonStepProps,
): MaxButton =>
  button.buttonType === buttonTypes.enum.openWebsite
    ? { type: "link", text: button.label, url: button.beforeStep.url }
    : {
        type: "callback",
        text: button.label,
        payload: encodeButtonPayload({ flowId, buttonId: button.id }),
      }

export const fromTemplateButton = (
  button: MessageButtonTemplate,
): MaxButton =>
  button.buttonType === "url"
    ? { type: "link", text: button.label, url: button.url }
    : { type: "callback", text: button.label, payload: button.postback }

/** Long text splits into several messages; media and buttons ride on the last one. */
export const expandText = (outgoing: MaxOutgoing): MaxOutgoing[] => {
  const parts = outgoing.text ? splitMaxText(outgoing.text) : [undefined]
  return parts.map((text, index) =>
    index === parts.length - 1
      ? { ...outgoing, text }
      : { text },
  )
}
```

Run: тест из шага 1. Expected: PASS.

- [ ] **Step 3: Тест отправки (msw)** — `__tests__/send.test.ts`: поднять `setupServer` с обработчиками `POST https://platform-api2.max.ru/messages` (вернуть `{ message: { body: { mid: "m1" } } }` и сохранить тело запроса) и `POST https://platform-api2.max.ru/uploads` (вернуть `{ url: "https://upload.max.test/u", token: "vt" }`), `POST https://upload.max.test/u` (200 `{}`), `GET https://cdn.test/v.mp4` (байты). Проверить:
  1. `deliverMaxOutgoing({ token: "t", userId: "555", outgoing: { text: "hi", buttons: [{ type: "callback", text: "Да", payload: "y" }] } })` отправляет тело `{ text: "hi", attachments: [{ type: "inline_keyboard", … }] }` с `?user_id=555` и заголовком `Authorization: t`, возвращает `["m1"]`.
  2. Видео по URL: сначала `uploads?type=video`, потом сообщение с `{ type: "video", payload: { token: "vt" } }`.
  3. Ответ 400 `{ code: "attachment.not.ready" }` на первую отправку и 200 на вторую → функция возвращает `["m1"]` (использовать `vi.useFakeTimers()` и `vi.advanceTimersByTimeAsync(1000)`).
  4. Файл вместе с картинкой уходит двумя сообщениями (MAX не смешивает file с image/video в одном сообщении).

Run: `pnpm --filter @chatbotx.io/integration-max exec vitest run __tests__/send.test.ts`
Expected: FAIL — `deliverMaxOutgoing` не найден.

- [ ] **Step 4: Отправка** — `src/handlers/message/outgoing-message.ts`:

```ts
import {
  type SendAudioStepSchema,
  type SendCarouselStepSchema,
  type SendFileStepSchema,
  type SendImageStepSchema,
  type SendMultipleImagesStepSchema,
  type SendQuickReplyStepSchema,
  type SendTextStepSchema,
  type SendVideoStepSchema,
  type StepType,
  stepTypes,
} from "@chatbotx.io/flow-config"
import type { MessageHandlers } from "@chatbotx.io/sdk"
import { sendMaxMessage } from "../../apis/messages"
import { toMaxMediaAttachment } from "../../apis/uploads"
import { mapToChannelError } from "../../lib/error-mapper"
import { logger } from "../../lib/logger"
import type { MaxAttachmentRequest, MaxAuthValue } from "../../schema"
import {
  expandText,
  fromFlowButton,
  fromTemplateButton,
  type MaxOutgoing,
  toKeyboard,
} from "./to-max-messages"

export const handledFlowStepTypes = [
  stepTypes.enum.sendText,
  stepTypes.enum.sendImage,
  stepTypes.enum.sendVideo,
  stepTypes.enum.sendMultipleImages,
  stepTypes.enum.sendAudio,
  stepTypes.enum.sendFile,
  stepTypes.enum.sendGif,
  stepTypes.enum.sendQuickReply,
  stepTypes.enum.sendCarousel,
] as const satisfies readonly StepType[]

/** MAX refuses a file mixed with image/video in one message — split it out. */
const separateFiles = (outgoing: MaxOutgoing): MaxOutgoing[] => {
  const media = outgoing.media ?? []
  const files = media.filter((item) => item.kind === "file")
  const visual = media.filter((item) => item.kind !== "file")
  if (files.length === 0 || visual.length === 0) {
    return [outgoing]
  }
  return [{ media: visual }, { ...outgoing, media: files }]
}

export const deliverMaxOutgoing = async (props: {
  token: string
  userId: string
  outgoing: MaxOutgoing
}): Promise<string[]> => {
  const ids: string[] = []
  for (const message of expandText(props.outgoing).flatMap(separateFiles)) {
    const attachments: MaxAttachmentRequest[] = []
    for (const item of message.media ?? []) {
      attachments.push(
        await toMaxMediaAttachment({ token: props.token, ...item }),
      )
    }
    const keyboard = toKeyboard(message.buttons ?? [])
    if (keyboard) {
      attachments.push(keyboard)
    }
    ids.push(
      await sendMaxMessage({
        token: props.token,
        userId: props.userId,
        body: {
          ...(message.text ? { text: message.text } : {}),
          ...(attachments.length > 0 ? { attachments } : {}),
        },
      }),
    )
  }
  return ids
}

type FlowStepProps<TStep> = Parameters<
  MessageHandlers<MaxAuthValue, TStep>["sendFlowStep"]
>[0]

const stepToOutgoing = (
  props: FlowStepProps<unknown>,
): MaxOutgoing[] => {
  const { step, flowId, quickReplies } = props.data
  const replies = (quickReplies ?? []).map(fromTemplateButton)
  const flowButtons = (buttons: Parameters<typeof fromFlowButton>[1][]) => [
    ...buttons.map((button) => fromFlowButton(flowId, button)),
    ...replies,
  ]
  switch (step.stepType) {
    case stepTypes.enum.sendText: {
      const s = step as SendTextStepSchema
      return [{ text: s.text, buttons: flowButtons(s.buttons) }]
    }
    case stepTypes.enum.sendImage:
    case stepTypes.enum.sendGif: {
      const s = step as SendImageStepSchema
      return [
        {
          media: [{ kind: "image", url: s.url }],
          buttons: flowButtons(s.buttons ?? []),
        },
      ]
    }
    case stepTypes.enum.sendVideo: {
      const s = step as SendVideoStepSchema
      return [
        {
          media: [{ kind: "video", url: s.url }],
          buttons: flowButtons(s.buttons),
        },
      ]
    }
    case stepTypes.enum.sendAudio: {
      const s = step as SendAudioStepSchema
      return [
        {
          media: [{ kind: "audio", url: s.url }],
          buttons: flowButtons(s.buttons),
        },
      ]
    }
    case stepTypes.enum.sendFile: {
      const s = step as SendFileStepSchema
      return [
        {
          media: [{ kind: "file", url: s.url }],
          buttons: flowButtons(s.buttons),
        },
      ]
    }
    case stepTypes.enum.sendMultipleImages: {
      const s = step as SendMultipleImagesStepSchema
      return [
        {
          media: s.images.map((image) => ({
            kind: "image" as const,
            url: image.url,
          })),
          buttons: replies,
        },
      ]
    }
    case stepTypes.enum.sendQuickReply: {
      const s = step as SendQuickReplyStepSchema
      return [{ text: s.message, buttons: flowButtons(s.buttons) }]
    }
    case stepTypes.enum.sendCarousel: {
      const s = step as SendCarouselStepSchema
      return s.cards.map((card) => {
        const title = "title" in card ? card.title : undefined
        const subtitle = "subtitle" in card ? card.subtitle : undefined
        const imageUrl = "image" in card ? card.image?.url : undefined
        return {
          text: [title, subtitle].filter(Boolean).join("\n") || undefined,
          media: imageUrl ? [{ kind: "image" as const, url: imageUrl }] : [],
          buttons:
            "buttons" in card
              ? card.buttons.map((button) => fromFlowButton(flowId, button))
              : [],
        }
      })
    }
    default:
      throw new Error(`Unsupported MAX flow step: ${step.stepType}`)
  }
}

export const sendFlowStep: MessageHandlers<MaxAuthValue>["sendFlowStep"] =
  async (props) => {
    const userId = props.data.contact.sourceId
    try {
      const ids: string[] = []
      for (const outgoing of stepToOutgoing(props)) {
        ids.push(
          ...(await deliverMaxOutgoing({
            token: props.ctx.auth.secretText,
            userId,
            outgoing,
          })),
        )
      }
      return { messageIds: ids, sentCount: ids.length }
    } catch (error) {
      logger.error({ err: error }, "MAX sendFlowStep failed")
      throw mapToChannelError(error)
    }
  }

const ATTACHMENT_KIND = {
  image: "image",
  video: "video",
  audio: "audio",
} as const

export const sendMessage: MessageHandlers<MaxAuthValue>["sendMessage"] =
  async (props) => {
    const { contact, message, quickReplies } = props.data
    try {
      const ids = await deliverMaxOutgoing({
        token: props.ctx.auth.secretText,
        userId: contact.sourceId,
        outgoing: {
          text: message.text ?? undefined,
          media: (message.attachments ?? [])
            .filter((attachment) => attachment.url)
            .map((attachment) => ({
              kind:
                ATTACHMENT_KIND[
                  attachment.fileType as keyof typeof ATTACHMENT_KIND
                ] ?? "file",
              url: attachment.url as string,
            })),
          buttons: (quickReplies ?? []).map(fromTemplateButton),
        },
      })
      return { messageIds: ids, sentCount: ids.length }
    } catch (error) {
      logger.error({ err: error }, "MAX sendMessage failed")
      throw mapToChannelError(error)
    }
  }
```

Поля шагов (`url`, `buttons`, `images`, `message`, `cards`) — те же, что читает Telegram (`integrations/telegram/src/handlers/message/outgoing-message/*`). Если у какого-то шага `buttons` в схеме необязательны, писать `s.buttons ?? []`, как у `sendImage`.

Run: `pnpm --filter @chatbotx.io/integration-max exec vitest run __tests__/send.test.ts`
Expected: PASS.

- [ ] **Step 5: Входящие** — `src/handlers/message/incoming-message.ts`:

```ts
import {
  type Context,
  contentTypes,
  getMediaStoragePrefix,
  guessFileTypeFromMimeType,
  type IncomingAttachment,
  messageTypes,
  type ReceivedMessageResult,
} from "@chatbotx.io/sdk"
import { createId } from "@chatbotx.io/utils"
import { MaxException } from "../../exception"
import type { MaxAuthValue } from "../../schema"
import { type MaxInboundMedia, parseMaxUpdate } from "../parse-update"

const FALLBACK_MIME: Record<MaxInboundMedia["kind"], string> = {
  image: "image/jpeg",
  video: "video/mp4",
  audio: "audio/ogg",
  file: "application/octet-stream",
}

const storeMedia = async (
  ctx: Context<MaxAuthValue>,
  media: MaxInboundMedia,
): Promise<IncomingAttachment> => {
  const response = await fetch(media.url)
  if (!response.ok) {
    throw new MaxException(
      `Failed to download MAX attachment (status ${response.status})`,
    )
  }
  const mimeType =
    response.headers.get("content-type")?.split(";")[0] ??
    FALLBACK_MIME[media.kind]
  const bytes = await response.arrayBuffer()
  const originPath = `${getMediaStoragePrefix(ctx)}/${createId()}`
  await ctx.uploader?.putObject(originPath, Buffer.from(bytes), {
    ACL: "public-read",
    ContentType: mimeType,
  })
  return {
    sourceId: createId(),
    originPath,
    fileType: guessFileTypeFromMimeType(mimeType),
    mimeType,
    size: bytes.byteLength,
    ...(media.filename ? { name: media.filename } : {}),
  }
}

export const receiveMessage = async ({
  ctx,
  data,
}: {
  ctx: Context<MaxAuthValue>
  data: { integrationType: string; integrationIdentifier: string; payload: unknown }
}): Promise<ReceivedMessageResult> => {
  const inbound = parseMaxUpdate(data.payload)
  if (!inbound) {
    throw new MaxException("MAX update is not a user message")
  }
  const base = {
    sourceId: inbound.sourceId,
    messageType: messageTypes.enum.incoming,
    contentType: contentTypes.enum.text,
  }
  switch (inbound.kind) {
    case "callback":
      return {
        message: { ...base, text: inbound.payload, attachments: [] },
        contact: inbound.contact,
        postbackAction: inbound.payload,
        quickReplyAction: null,
        ref: null,
      }
    case "started":
      return {
        message: {
          ...base,
          text: inbound.ref ? `/start ${inbound.ref}` : "/start",
          attachments: [],
        },
        contact: inbound.contact,
        postbackAction: null,
        quickReplyAction: null,
        ref: inbound.ref,
      }
    default: {
      const attachments: IncomingAttachment[] = []
      for (const media of inbound.media) {
        attachments.push(await storeMedia(ctx, media))
      }
      return {
        message: { ...base, text: inbound.text, attachments },
        contact: inbound.contact,
        postbackAction: null,
        quickReplyAction: null,
        ref: null,
      }
    }
  }
}
```

Если в `IncomingAttachment` нет поля `name` — убрать эту строку (Telegram его не передаёт).

`src/handlers/message/index.ts`:

```ts
import { receiveMessage } from "./incoming-message"
import { sendFlowStep, sendMessage } from "./outgoing-message"

export const messageHandlers = { receiveMessage, sendMessage, sendFlowStep }
```

`src/handlers/conversation.ts`:

```ts
import type { ConversationHandlers } from "@chatbotx.io/sdk"
import { sendTypingOn } from "../apis/bot"
import type { MaxAuthValue } from "../schema"

const sendTyping: ConversationHandlers<MaxAuthValue>["sendTyping"] = async ({
  ctx,
  data: { contact, typing },
}) => {
  if (typing && contact.sourceId) {
    await sendTypingOn(ctx.auth.secretText, contact.sourceId)
  }
}

export const conversationHandlers = { sendTyping }
```

(В MAX `chat_id` диалога с пользователем не равен `user_id`. Если `POST /chats/{user_id}/actions` вернёт 404 на живом стенде, оставить `sendTyping` без вызова API и вынести в отдельную задачу: сохранять `chat_id` диалога в контакте. В тестах проверяется только вызов с `contact.sourceId`.)

- [ ] **Step 6: Вебхук** — тест `__tests__/webhook.test.ts`: `webhookHandler` с `config: { botId: "777", webhookSecret: "s" }` и `queue: { add: vi.fn() }`:
  1. без заголовка `X-Max-Bot-Api-Secret` → бросает `MaxWebhookException`, `queue.add` не вызван;
  2. с верным заголовком и `message-text.json` → `queue.add("incomingMessage", { type: "incomingMessage", data: { integrationType: "max", integrationIdentifier: "777", payload } })`, возвращает `"ok"`;
  3. с верным заголовком и `message-group.json` → `"ok"`, `queue.add` не вызван.

Реализация `src/handlers/webhook.ts`:

```ts
import type { HandleRequestProps } from "@chatbotx.io/sdk"
import { timingSafeStringEqual } from "@chatbotx.io/utils/crypto"
import { MAX_WEBHOOK_SECRET_HEADER } from "../constants"
import { MaxWebhookException } from "../exception"
import type { MaxConfig } from "../schema"
import { parseMaxUpdate } from "./parse-update"

export const webhookHandler = async (
  props: HandleRequestProps<MaxConfig>,
): Promise<string> => {
  const { req, config, queue } = props
  const presented = req.headers.get(MAX_WEBHOOK_SECRET_HEADER)
  if (
    !(
      config.webhookSecret &&
      presented &&
      timingSafeStringEqual(presented, config.webhookSecret)
    )
  ) {
    throw new MaxWebhookException("Invalid webhook secret")
  }
  const body = await req.text()
  if (!body) {
    throw new MaxWebhookException("Empty webhook payload")
  }
  const payload: unknown = JSON.parse(body)
  if (!parseMaxUpdate(payload)) {
    return "ok"
  }
  await queue?.add("incomingMessage", {
    type: "incomingMessage",
    data: {
      integrationType: "max",
      integrationIdentifier: config.botId ?? "",
      payload,
    },
  })
  return "ok"
}
```

Run: `pnpm --filter @chatbotx.io/integration-max exec vitest run __tests__/webhook.test.ts`
Expected: PASS.

- [ ] **Step 7: Определение интеграции** — `src/integration.ts`:

```ts
import { randomBytes } from "node:crypto"
import {
  HandleRequestType,
  Integration,
  type IntegrationDefinition,
  probeVerify,
} from "@chatbotx.io/sdk"
import { getMe } from "./apis/bot"
import { subscribeWebhook, unsubscribeWebhook } from "./apis/subscriptions"
import { MaxAPIException } from "./exception"
import { conversationHandlers } from "./handlers/conversation"
import { messageHandlers } from "./handlers/message"
import { webhookHandler } from "./handlers/webhook"
import { isRevokedTokenError } from "./lib/error-mapper"
import { resolveMaxWebhookUrl } from "./lib/webhook-url"
import type { MaxAuthValue, MaxConfig } from "./schema"

const config: IntegrationDefinition<MaxConfig, MaxAuthValue> = {
  name: "max",
  channels: {
    channel: {
      message: messageHandlers,
      conversation: conversationHandlers,
    },
  },
  connection: {
    kind: "channel",
    strategy: "token",
    multiAccount: false,
    startsPaused: true,
    configFields: [{ name: "secretText", type: "secret", required: true }],
    describe: (auth) => ({ sourceId: auth.botId, displayName: auth.botName }),
    fromCredentials: async (input: { secretText: string }) => {
      const bot = await getMe(input.secretText)
      return {
        authType: "secretText",
        secretText: input.secretText,
        botId: String(bot.user_id),
        botName: bot.username ? `@${bot.username}` : (bot.name ?? "MAX bot"),
        webhookSecret: randomBytes(24).toString("hex"),
      }
    },
    verify: async ({ auth }) =>
      await probeVerify(() => getMe(auth.secretText), {
        label: "MAX bot token",
        isRevoked: isRevokedTokenError,
      }),
    isRevokedTokenError,
    webhook: {
      subscribe: async ({ auth }) =>
        await subscribeWebhook({
          token: auth.secretText,
          url: resolveMaxWebhookUrl(auth.botId),
          secret: auth.webhookSecret,
        }),
      unsubscribe: async ({ auth }) =>
        await unsubscribeWebhook({
          token: auth.secretText,
          url: resolveMaxWebhookUrl(auth.botId),
        }),
    },
  },
  handleRequest: async (props) => {
    const action = new URL(props.req.url).pathname.split("/").pop()
    if (action === HandleRequestType.webhook) {
      return await webhookHandler(props)
    }
    throw new MaxAPIException(
      `${props.req.method} ${props.req.url} is not implemented`,
    )
  },
  disconnect: async (auth) => {
    await unsubscribeWebhook({
      token: auth.secretText,
      url: resolveMaxWebhookUrl(auth.botId),
    })
  },
}

export const integration = new Integration<
  IntegrationDefinition<MaxConfig, MaxAuthValue>
>(config)
```

Если `IntegrationDefinition` требует `actions` — добавить `actions: {}` и третий дженерик `Record<string, never>`. `src/index.ts`:

```ts
export { integration } from "./integration"
export { parseMaxUpdate } from "./handlers/parse-update"
export type { MaxAuthValue, MaxConfig } from "./schema"
```

- [ ] **Step 8: Регистрация провайдера**
- `store-bindings-channels.ts` рядом с `telegram`:

```ts
  max: makeChannelBinding({
    table: integrationMaxModel,
    tableName: "IntegrationMax",
    identityColumn: "botId",
    onDisconnect: "delete_row",
    duplicateConstraint: "IntegrationMax_botId_key",
    sealAuth: true,
  }),
```

(импорт `integrationMaxModel` из `@chatbotx.io/database/schema`; параметры `onDisconnect`/`duplicateConstraint` сверить с записью `telegram` и взять такие же по смыслу.)
- `packages/connections/src/registry.ts`: `import { integration as integrationMax } from "@chatbotx.io/integration-max"` и `max: fromIntegration(integrationMax, "max"),`; в `packages/connections/package.json` — `"@chatbotx.io/integration-max": "workspace:*"`.
- `packages/channel-registry/src/registry.ts`: импорт `integrationMax`; `max: integrationMax,` в `integrations`; в `switch` `identifyInboxAndIntegrationAuthFromIdentifier`:

```ts
      case "max": {
        modelName = "IntegrationMax"
        columnName = "botId"
        break
      }
```

и `max: "IntegrationMax",` в `integrationTableByChannel`; зависимость в `package.json`.
- `apps/builder/package.json` и `apps/worker/package.json`: `"@chatbotx.io/integration-max": "workspace:*"`.

Run: `CI=true pnpm install --no-frozen-lockfile`

- [ ] **Step 9: Проверка**

Run: `pnpm --filter @chatbotx.io/integration-max test && pnpm turbo run check-types --filter=@chatbotx.io/integration-max --filter=@chatbotx.io/business --filter=@chatbotx.io/connections --filter=@chatbotx.io/channel-registry --filter=worker`
Expected: PASS (кроме `CHANNEL_FLOW_POLICIES` — задача 12, и builder — задачи 9–11).

- [ ] **Step 10: Commit**

```bash
git add integrations/max packages/business/src/connection/store-bindings-channels.ts packages/connections/src/registry.ts packages/connections/package.json packages/channel-registry/src/registry.ts packages/channel-registry/package.json apps/builder/package.json apps/worker/package.json pnpm-lock.yaml
git commit -m "feat(max): add message handlers and register MAX connection provider"
```

---

## Task 9: Сервис `maxIntegrationService` и вебхук-маршрут builder

**Files:**
- Create: `packages/business/src/integration-max/service.ts`, `index.ts`
- Modify: `packages/business/src/index.ts`
- Test: `packages/business/src/integration-max/__tests__/service.test.ts`
- Modify: `apps/builder/src/app/integrations/[...integration]/webhook.ts`

- [ ] **Step 1: Написать падающий тест** — мокнуть `@chatbotx.io/database/client` (`db.select().from().where().limit()` → строка с запечатанным auth, полученным через настоящий `sealAuth`) и проверить, что `findByBotIdWithAuth("777")` возвращает `{ row, auth }` с расшифрованным `auth.webhookSecret`, а для отсутствующего бота — `null`. Также `listByWorkspace("ws-1")` возвращает строки с полем `connection: { id, status, statusReason }` (мок `connectionRepository.findByInboxId`).

- [ ] **Step 2: Реализация** — `service.ts`:

```ts
import { db, eq } from "@chatbotx.io/database/client"
import { connectionRepository } from "@chatbotx.io/database/repositories"
import { integrationMaxModel } from "@chatbotx.io/database/schema"
import type {
  ConnectionModel,
  IntegrationMaxModel,
} from "@chatbotx.io/database/types"
import type { AuthValue } from "@chatbotx.io/sdk"
import { openAuth } from "../connection/sealed-auth"

export type MaxChannelRow = Omit<IntegrationMaxModel, "auth"> & {
  connection: Pick<ConnectionModel, "id" | "status" | "statusReason"> | null
}

export const maxIntegrationService = {
  /** Webhook-only lookup by bot id; returns the opened auth for secret checks. */
  async findByBotIdWithAuth(
    botId: string,
  ): Promise<{ row: IntegrationMaxModel; auth: AuthValue } | null> {
    const [row] = await db
      .select()
      .from(integrationMaxModel)
      .where(eq(integrationMaxModel.botId, botId))
      .limit(1)
    if (!row) {
      return null
    }
    return { row, auth: await openAuth(row.auth) }
  },

  /** Settings list: never returns auth, adds the connection state for the on/off switch. */
  async listByWorkspace(workspaceId: string): Promise<MaxChannelRow[]> {
    const rows = await db
      .select()
      .from(integrationMaxModel)
      .where(eq(integrationMaxModel.workspaceId, workspaceId))
    return await Promise.all(
      rows.map(async ({ auth: _auth, ...row }) => {
        const connection = await connectionRepository.findByInboxId({
          inboxId: row.inboxId,
        })
        return {
          ...row,
          connection: connection
            ? {
                id: connection.id,
                status: connection.status,
                statusReason: connection.statusReason,
              }
            : null,
        }
      }),
    )
  },
}
```

Сигнатуру `connectionRepository.findByInboxId` сверить с `repository.ts:118` и передать аргументы ровно в её форме. `index.ts`: `export * from "./service"`; в `packages/business/src/index.ts` — `export * from "./integration-max"` рядом с `./integration-telegram`.

Run: `pnpm --filter @chatbotx.io/business exec vitest run src/integration-max && pnpm --filter @chatbotx.io/business check-types`
Expected: PASS.

- [ ] **Step 3: Вебхук-маршрут** — в `webhook.ts` рядом с веткой telegram:

```ts
  if (integrationType === "max") {
    return handleMaxWebhook(req)
  }
```

и функция по образцу `handleTelegramWebhook`:

```ts
const handleMaxWebhook = async (req: NextRequest) => {
  const botId = req.nextUrl.searchParams.get("botId")
  if (!botId) {
    return new Response(
      JSON.stringify({ message: "Missing botId query param" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    )
  }
  const found = await maxIntegrationService.findByBotIdWithAuth(botId)
  if (!found) {
    return new Response(JSON.stringify({ message: "Bot not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    })
  }
  const inbox = await inboxService.find({ where: { id: found.row.inboxId } })
  // A switched-off channel must not process a late delivery from MAX.
  if (inbox?.status !== "connected") {
    return new Response("ignored")
  }
  const auth = found.auth as { webhookSecret?: string }
  try {
    const result = await integrations.max.handleRequest?.({
      config: { botId, webhookSecret: auth.webhookSecret },
      req,
      queue: integrationQueue,
    })
    return new Response(result as BodyInit)
  } catch (e: unknown) {
    logger.error({ err: e, integrationType: "max" }, "MAX handleRequest failed")
    return new Response(JSON.stringify({ message: "Invalid request" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    })
  }
}
```

Импорт `inboxService`, `maxIntegrationService` из `@chatbotx.io/business`. Убедиться, что префикс `/integrations` уже в `publicRoutes` (`apps/builder/src/proxy.ts`) — Telegram работает через него же.

- [ ] **Step 4: Commit**

```bash
git add packages/business/src/integration-max packages/business/src/index.ts "apps/builder/src/app/integrations/[...integration]/webhook.ts"
git commit -m "feat(max): add MAX integration service and webhook route"
```

---

## Task 10: Действия builder — подключить, включить/выключить, отключить

**Files:**
- Create: `apps/builder/src/features/integration-max/schema/request.ts`
- Create: `apps/builder/src/features/integration-max/actions/{connect,set-enabled,disconnect}.action.ts`
- Create: `apps/builder/src/features/integration-max/queries/index.ts`
- Test: `apps/builder/__tests__/features/integration-max/actions.test.ts`

- [ ] **Step 1: Схемы**

```ts
import { z } from "zod"

export const connectMaxRequest = z.object({
  botToken: z.string().trim().min(1),
})
export type ConnectMaxRequest = z.infer<typeof connectMaxRequest>

export const setMaxEnabledRequest = z.object({
  connectionId: z.string().min(1),
  enabled: z.boolean(),
})
export type SetMaxEnabledRequest = z.infer<typeof setMaxEnabledRequest>
```

- [ ] **Step 2: Написать падающие тесты** — мокнуть `@chatbotx.io/connections` (`connectionService.connectFromCredentials`, `pause`, `resume`, `disconnect`) и `@chatbotx.io/business/audit`; вызывать внутренние функции-обработчики (вынести тела действий в экспортируемые `connectMax`, `setMaxEnabled`, `disconnectMax` в `actions/handlers.ts`, а `*.action.ts` — тонкие обёртки). Проверить:
  1. `connectMax({ workspaceId, userId, botToken })` вызывает `connectFromCredentials({ workspaceId, provider: "max", config: { secretText: botToken }, actorUserId: userId })` и возвращает `{ connectionId }`; результат со статусом `paused`.
  2. `setMaxEnabled({ workspaceId, connectionId, enabled: true })` → `resume`; `enabled: false` → `pause`.
  3. `disconnectMax` → `connectionService.disconnect`.

- [ ] **Step 3: Реализация** — `actions/handlers.ts`:

```ts
import { connectionService } from "@chatbotx.io/connections"

export const connectMax = async (input: {
  workspaceId: string
  userId: string
  botToken: string
}) => {
  const connection = await connectionService.connectFromCredentials({
    workspaceId: input.workspaceId,
    provider: "max",
    config: { secretText: input.botToken },
    actorUserId: input.userId,
  })
  return { connectionId: connection.id, status: connection.status }
}

export const setMaxEnabled = async (input: {
  workspaceId: string
  connectionId: string
  enabled: boolean
}) => {
  const ref = {
    connectionId: input.connectionId,
    workspaceId: input.workspaceId,
  }
  const connection = input.enabled
    ? await connectionService.resume(ref)
    : await connectionService.pause(ref)
  return { status: connection.status }
}

export const disconnectMax = async (input: {
  workspaceId: string
  connectionId: string
}) => {
  await connectionService.disconnect(input)
}
```

`connect.action.ts` (обычное действие воркспейса; права — как у других настроек каналов, `superAdmin` проверяется клиентом действия):

```ts
"use server"

import { workspaceIdrequestParams } from "@/features/common/schema"
import { workspaceActionClient } from "@/lib/safe-action"
import { connectMaxRequest } from "../schema/request"
import { connectMax } from "./handlers"

export const connectMaxAction = workspaceActionClient
  .bindArgsSchemas(workspaceIdrequestParams)
  .inputSchema(connectMaxRequest)
  .action(
    async ({ parsedInput, bindArgsParsedInputs: [workspaceId], ctx }) =>
      await connectMax({
        workspaceId,
        userId: ctx.user.id,
        botToken: parsedInput.botToken,
      }),
  )
```

`set-enabled.action.ts` — то же с `setMaxEnabledRequest` → `setMaxEnabled`. `disconnect.action.ts` — `workspaceActionClientAllowExpired` (инвариант 14), `.bindArgsSchemas(workspaceIdAndIdRequestParams)` без `.inputSchema()` → `disconnectMax({ workspaceId, connectionId: id })`.

`workspaceActionClient`/`workspaceActionClientAllowExpired` — из `apps/builder/src/lib/safe-action.ts`; `workspaceIdrequestParams` (именно со строчной `r`) и `workspaceIdAndIdRequestParams` — из `apps/builder/src/features/common/schema/index.ts`. Форму `ctx.user` сверить с любым действием на `workspaceActionClient`.

`queries/index.ts`:

```ts
import { maxIntegrationService } from "@chatbotx.io/business"

export const listMaxChannels = async ({
  workspaceId,
}: {
  workspaceId: string
}) => ({ data: await maxIntegrationService.listByWorkspace(workspaceId) })
```

Run: `pnpm --filter builder exec vitest run __tests__/features/integration-max`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/builder/src/features/integration-max apps/builder/__tests__/features/integration-max
git commit -m "feat(max): add builder actions to connect, switch and disconnect MAX"
```

---

## Task 11: UI MAX — форма подключения, переключатель, страница настроек, иконка

**Files:**
- Create: `apps/builder/src/features/integration-max/components/{max-connect,max-enabled-switch,max-disconnect}.tsx`, `max-manage.tsx`
- Create: `apps/builder/src/app/space/[workspaceId]/(settings)/settings/channels/max/page.tsx`
- Modify: `apps/builder/src/app/(no-sidebar)/channels/create/page.tsx`
- Modify: `apps/builder/src/features/inboxes/components/inbox-icon.tsx`, `provider/inbox-hook.ts`
- Create: `apps/builder/public/images/channels/max.svg` (если иконки каналов лежат файлами; иначе компонент `MaxIcon` рядом с `inbox-icon.tsx`)
- Modify: `apps/builder/messages/en.json`

Перед началом прочитать `.agents/skills/builder-ui-i18n/SKILL.md`.

- [ ] **Step 1: Ключи перевода** — в `en.json` в `fields` (рядом с `telegram`):

```json
"max": {
  "label": "MAX",
  "botToken": "Bot token",
  "connectInstructions": {
    "step1": "Open the <link>MAX business platform</link> and create a bot.",
    "step2": "Copy the bot token from <strong>Integration → Get token</strong>.",
    "step3": "Paste it below. The channel is added switched off — turn it on when you are ready."
  },
  "enabled": "Receiving and sending",
  "enabledHint": "Only one system may serve this bot. Switch the old bot off before turning this on.",
  "status": {
    "connected": "On",
    "paused": "Off",
    "needs_reauth": "Token rejected",
    "degraded": "Problem",
    "disconnected": "Disconnected"
  },
  "switchedOn": "MAX channel is on",
  "switchedOff": "MAX channel is off"
}
```

Перед добавлением проверить, нет ли уже подходящих ключей в `fields.*` (инвариант 7).

- [ ] **Step 2: Форма подключения** — `max-connect.tsx` по образцу `telegram-connect.tsx` с отличиями: действие `connectMaxAction.bind(null, workspaceId)` (инвариант 4), поле `botToken`, ссылка шага 1 — `https://business.max.ru/`, в `onSuccess` — `invalidateInboxes()`, затем `router.push(`/space/${workspaceId}/settings/channels/max`)`. `workspaceId` обязателен (`string`).

- [ ] **Step 3: Переключатель** — `max-enabled-switch.tsx`:

```tsx
"use client"

import { Switch } from "@chatbotx.io/ui/components/ui/switch"
import { useAction } from "next-safe-action/hooks"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { useInvalidateInboxes } from "@/features/inboxes/provider/inbox-hook"
import { setMaxEnabledAction } from "../actions/set-enabled.action"

type MaxEnabledSwitchProps = {
  workspaceId: string
  connectionId: string
  enabled: boolean
}

export const MaxEnabledSwitch = ({
  workspaceId,
  connectionId,
  enabled,
}: MaxEnabledSwitchProps) => {
  const t = useTranslations()
  const router = useRouter()
  const invalidateInboxes = useInvalidateInboxes()
  const { execute, isPending } = useAction(
    setMaxEnabledAction.bind(null, workspaceId),
    {
      onSuccess: ({ data }) => {
        invalidateInboxes()
        toast.success(
          data?.status === "connected"
            ? t("fields.max.switchedOn")
            : t("fields.max.switchedOff"),
        )
        router.refresh()
      },
      onError: ({ error }) => {
        if (error.serverError) {
          toast.error(error.serverError)
        }
      },
    },
  )

  const handleCheckedChange = (checked: boolean) =>
    execute({ connectionId, enabled: checked })

  return (
    <Switch
      aria-label={t("fields.max.enabled")}
      checked={enabled}
      disabled={isPending}
      onCheckedChange={handleCheckedChange}
    />
  )
}
```

Путь импорта `Switch` и `useAction` сверить с `InboxMarkReadOnOutboundSwitch`.

- [ ] **Step 4: Отключение и таблица** — `max-disconnect.tsx` по образцу `telegram-disconnect.tsx` (диалог подтверждения, `disconnectMaxAction.bind(null, workspaceId, connectionId)`, `execute()` без аргументов — инвариант 6, `invalidateInboxes()` в `onSuccess`). `max-manage.tsx` по образцу `telegram-manage.tsx`: колонки «Name», «Receiving and sending» (переключатель + подпись `fields.max.status.<status>` + подсказка `fields.max.enabledHint` мелким текстом), «Mark read on outbound», действия. `enabled = row.connection?.status === "connected" || row.connection?.status === "degraded"`; для строк без `connection` переключатель не показывать. Пустая таблица — существующий ключ «No data», если он есть в `en.json`; иначе добавить `fields.max.empty`.

- [ ] **Step 5: Страница настроек** — `settings/channels/max/page.tsx` — копия страницы Telegram: `requireVisibleChannel(workspaceId, "max")`, `listMaxChannels({ workspaceId })`, `resolveChannelCreatable(workspaceId, "max")`, рендер `MaxManage`.

- [ ] **Step 6: Страница создания** — в `channels/create/page.tsx` после ветки telegram:

```tsx
  if (selectedChannel === "max" && isVisible("max") && workspaceId) {
    return <MaxConnect autoOpen={true} workspaceId={workspaceId} />
  }
```

- [ ] **Step 7: Иконка и подпись** — `inbox-icon.tsx`: запись `max` с иконкой MAX (SVG-компонент `MaxIcon` с официальным логотипом из бренд-материалов MAX; если его нет под рукой — `MessageCircleIcon` из `lucide-react` с цветом `#0077FF`), `defaultLabelKey: "fields.max.label"`. `inbox-hook.ts`: `max: { label: "MAX", value: "max" }`.

- [ ] **Step 8: Проверка**

Run: `pnpm --filter builder check-types && pnpm --filter builder test`
Expected: PASS.

- [ ] **Step 9: Визуальная проверка** — `pnpm --filter builder dev`, открыть `/space/<id>/settings/channels/max`: форма открывается, без токена кнопка неактивна, таблица и переключатель отображаются (с тестовыми данными или пустая). Боевой токен не вводить. Сохранить скриншот для отчёта.

- [ ] **Step 10: Commit**

```bash
git add apps/builder/src/features/integration-max apps/builder/src/features/inboxes/components/inbox-icon.tsx apps/builder/src/features/inboxes/provider/inbox-hook.ts apps/builder/messages/en.json "apps/builder/src/app/space/[workspaceId]/(settings)/settings/channels/max/page.tsx" "apps/builder/src/app/(no-sidebar)/channels/create/page.tsx"
git commit -m "feat(max): add MAX channel settings UI with on/off switch"
```

---

## Task 12: Политика шагов flow для MAX и финальная проверка

**Files:**
- Create: `packages/flow-config/src/channel-rules/policies/max.ts`
- Modify: `packages/flow-config/src/channel-rules/policies/index.ts`

- [ ] **Step 1: Политика**

```ts
import { stepTypes } from "../../steps/step-action"
import { defineChannelFlowPolicy } from "./define"
// MAX Bot API messages are capped at 4,000 characters; longer text is split.

export const maxFlowPolicy = defineChannelFlowPolicy({
  limits: {
    buttonCount: 10,
    buttonLabel: 64,
    text: 4000,
  },
  supported: [
    stepTypes.enum.sendText,
    stepTypes.enum.sendImage,
    stepTypes.enum.sendVideo,
    stepTypes.enum.sendMultipleImages,
    stepTypes.enum.sendAudio,
    stepTypes.enum.sendFile,
    stepTypes.enum.sendGif,
    stepTypes.enum.sendQuickReply,
    stepTypes.enum.sendCarousel,
  ],
})
```

В `index.ts`: импорт и `[channelTypes.enum.max]: maxFlowPolicy,`. Если в `__tests__` flow-config есть тест, перечисляющий политики всех каналов (snapshot), — обновить его.

- [ ] **Step 2: Полная проверка**

Run: `pnpm lint`
Expected: PASS (в т.ч. `db:check-drift`).

Run: `pnpm turbo run check-types`
Expected: PASS.

Run: `pnpm turbo run test --filter=@chatbotx.io/business --filter=@chatbotx.io/connections --filter=@chatbotx.io/integration-max --filter=@chatbotx.io/channel-registry --filter=@chatbotx.io/flow-config --filter=builder --filter=worker`
Expected: PASS.

- [ ] **Step 3: Проверка инвариантов** — запустить субагента `invariant-guard` на ветке. Исправить найденное.

- [ ] **Step 4: CLI/MCP** — прочитать `.agents/skills/cli-mcp-docs/SKILL.md` и выполнить его для новых маршрутов `connections.pause`/`connections.resume` (документация CLI и навык MCP).

- [ ] **Step 5: Миграции на согласование** — показать пользователю SQL обеих сгенерированных миграций (задачи 1 и 5) и ждать явного «да». Не запускать `db:migrate` самостоятельно.

- [ ] **Step 6: Commit**

```bash
git add packages/flow-config/src/channel-rules/policies/max.ts packages/flow-config/src/channel-rules/policies/index.ts <файлы, изменённые на шагах 3–4>
git commit -m "feat(max): add MAX flow policy and docs for pause/resume"
```

---

## Проверка по спецификации

| Требование спецификации | Задача |
|---|---|
| Канал создаётся выключенным, включает только пользователь | 1, 2, 3, 10, 11 |
| Пробный период и реактивация тенанта не включают канал | 1 |
| Включение проверяет токен и подписывает вебхук, ошибка не меняет статус | 3 |
| API/CLI/MCP-паритет включения/выключения | 3, 12 |
| Секреты зашифрованы | 4, 8 |
| Отправка в выключенный канал блокируется | 4, 9 |
| MAX: входящие текст/медиа/кнопки/старт, вебхук с секретом | 7, 8, 9 |
| MAX: исходящие текст до 4000 с разбиением, медиа, клавиатура | 8 |
| UI с переключателем и подсказкой «одна система на канал» | 11 |
| Миграции только с согласия пользователя | 1, 5, 12 |

Вне этого плана: ZZAP и общий poll-фреймворк (план 2), DROM (план 3), перенос данных Геки и скрипт импорта (план 4), русификация (план 5).
