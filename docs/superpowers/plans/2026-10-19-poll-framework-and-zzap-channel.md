# Poll framework + ZZAP channel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a generic polling mechanism for channels without webhooks and, on top of it, the ZZAP (zzap.ru, B52 API) channel that receives buyer messages by polling and replies through `POST /messages`. The channel is created switched off.

**Architecture:** A connection provider may declare `poll` (SDK). One worker cron tick (every 15 s) asks `@chatbotx.io/connections` which `connected` poll connections are due and enqueues one `low` job per connection (jobId = connection, so polls never overlap). The job runs `connections.runPoll`, which loads the sealed auth and the cursor from the new `ConnectionPollState` table, calls `provider.poll.run` and enqueues every event into the existing `incomingMessage` integration job. It saves the cursor only after the events are enqueued. Switching off (`pause`) or `needs_reauth` takes the connection out of the due list, so no per-connection scheduler needs to be created or removed. ZZAP is a regular `integrations/zzap` package modelled on `integrations/max` (Plan 1).

**Tech Stack:** TypeScript, Drizzle/Postgres, BullMQ, ky, zod, vitest + msw, Next.js builder.

## Global Constraints

- Channels start `paused` (`startsPaused: true`); nothing in this plan switches a channel on.
- Never touch Geka, n8n, Dashboard, tmtr-runner or their containers/databases. Dashboard sources are read only as reference.
- `db:migrate` is never run without the user's explicit approval; migrations are generated and shown.
- No real external API calls in tests (msw / vi.mock).
- Log errors with `{ err }`; no `console` in server code.
- No dynamic `import()` in `packages/*`, `integrations/*`, `apps/worker`.
- App code → service → repository; `packages/connections` may call repositories but never raw `db`.
- Every new builder action goes into `apps/builder/__tests__/api-parity-manifest.json` (insert in place, never re-sort).
- Every new i18n key goes into all 21 `apps/builder/messages/*.json`.
- Stage specific files only (`git add <paths>`), never `-A`/`.`.
- PATH: `export PATH=/GKamion/chatbotX/.tools/node-24/bin:$PATH`. Builder tsc: `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p .`; at most two tsc runs in parallel.
- Contact `sourceId` for ZZAP = the buyer `user_key` (raw, like MAX uses the raw `user_id`).

## Deviations from the spec (`docs/superpowers/specs/2026-10-17-ru-channels-max-zzap-drom-design.md`)

1. §3.1.3 per-connection `upsertJobScheduler` + start-up reconciliation → one cron tick + due-list query. Same guarantees (no poll while not `connected`, one job per connection at a time), fewer moving parts.
2. §3.1.4 cursor columns in each channel table → one `ConnectionPollState` table (`connectionId` PK, `cursor`, `intervalSeconds`, `lastPolledAt`, `lastSucceededAt`). `Connection` stays unchanged; DROM reuses it.
3. §3.3 open `config` jsonb → ZZAP settings (`codeObject`, `typeObject`, `testMode`, intervals) live inside the sealed auth envelope, like MAX. One storage path, editable later via reconnect.
4. §4.2 Redis rate limiter → in-process limiter keyed by API key (Geka/Dashboard do the same; worker is one process here).
5. §4.2 orders → order lookups enrich the buyer's phone/email/name (what Geka actually uses them for). Writing `zzap_order_code` into custom fields is out of scope: `ReceivedMessageResult` has no custom-field channel and the order number is already in the message text.

## File map

| File | Responsibility |
|---|---|
| `packages/sdk/src/lib/connection.ts` | `ConnectionPoll`, `PollCursor`, `PollEvent`, `PollResult` types; `poll?` on the provider |
| `packages/database/src/schema/connection-poll-state.ts` | `ConnectionPollState` table |
| `packages/database/src/repositories/connection-poll-state/` | find / upsert / listDue |
| `packages/connections/src/poll.ts` | `listDuePolls`, `runPoll` orchestration |
| `packages/worker-config/src/queues/low/index.ts`, `schedule/index.ts` | `pollChannel` low job, `dispatchChannelPolls` schedule |
| `apps/worker/src/schedule/handlers/dispatch-channel-polls.ts` | tick → enqueue low jobs |
| `apps/worker/src/low/handlers/poll-channel.ts` | low job → `runPoll` |
| `integrations/zzap/**` | ZZAP package |
| `packages/business/src/integration-zzap/` | builder-facing listing service |
| `apps/builder/src/features/integration-zzap/**` | connect / switch / disconnect UI + actions |

---

### Task 1: SDK `poll` contract and `ConnectionPollState` table

**Files:**
- Modify: `packages/sdk/src/lib/connection.ts`
- Create: `packages/database/src/schema/connection-poll-state.ts`
- Modify: `packages/database/src/schema/index.ts`, `packages/database/src/types.ts`, `packages/database/src/relations/index.ts`
- Create: `packages/database/src/relations/connection-poll-state.ts`
- Create: `packages/database/src/repositories/connection-poll-state/{index.ts,repository.ts}`
- Modify: `packages/database/src/repositories/index.ts`
- Create: `packages/database/drizzle/<ts>_connection_poll_state/` (generated)

**Interfaces — Produces:**

```ts
// packages/sdk/src/lib/connection.ts
export type PollCursor = Record<string, unknown>
export type PollEvent = { payload: unknown }
export type PollResult = { events: PollEvent[]; cursor: PollCursor }
export type ConnectionPoll<IAuth extends AuthValue> = {
  intervalSeconds: (auth: IAuth) => number
  run: Handler<{ auth: IAuth; cursor: PollCursor | null }, PollResult>
}
// on ConnectionProviderCommon:
poll?: ConnectionPoll<IAuth>

// packages/database/src/repositories/connection-poll-state
connectionPollStateRepository.find(connectionId): Promise<ConnectionPollStateModel | undefined>
connectionPollStateRepository.upsert(values: {
  connectionId: string; workspaceId: string
  intervalSeconds?: number; cursor?: Record<string, unknown> | null
  lastPolledAt?: Date; lastSucceededAt?: Date
}): Promise<void>
connectionPollStateRepository.listDue(input: { providers: IntegrationType[]; now: Date; defaultIntervalSeconds: number }):
  Promise<{ connectionId: string; workspaceId: string }[]>
```

- [ ] **Step 1: SDK types.** In `packages/sdk/src/lib/connection.ts` add after `ConnectionCandidate`:

```ts
/** Opaque per-connection progress marker a polling provider round-trips. */
export type PollCursor = Record<string, unknown>

/** One inbound delivery, shaped exactly like the channel's webhook payload for `receiveMessage`. */
export type PollEvent = { payload: unknown }

export type PollResult = { events: PollEvent[]; cursor: PollCursor }

/**
 * Pull-based inbound delivery for channels without webhooks. The worker runs
 * `run` for `connected` connections only, at most once per `intervalSeconds`,
 * never two at a time for one connection, and persists `cursor` only after
 * every event was enqueued — so `run` must tolerate re-delivering events
 * (receivers dedupe on the message `sourceId`).
 */
export type ConnectionPoll<IAuth extends AuthValue> = {
  intervalSeconds: (auth: IAuth) => number
  run: Handler<{ auth: IAuth; cursor: PollCursor | null }, PollResult>
}
```

and inside `ConnectionProviderCommon` after `startsPaused?: boolean`:

```ts
  /** Present for channels that receive by polling instead of a webhook. */
  poll?: ConnectionPoll<IAuth>
```

Check `packages/sdk/src/index.ts` re-exports `./lib/connection` with `export *` (it does for the other connection types); if it lists names explicitly, add the four new names.

- [ ] **Step 2: Table.** `packages/database/src/schema/connection-poll-state.ts`:

```ts
import { integer, jsonb, pgTable, timestamp } from "drizzle-orm/pg-core"
import { bigintAsString } from "../partials/shared"
import { connectionModel } from "./connection"
import { workspaceModel } from "./workspace"

export const connectionPollStateModel = pgTable("ConnectionPollState", {
  connectionId: bigintAsString()
    .primaryKey()
    .references(() => connectionModel.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    }),
  workspaceId: bigintAsString()
    .notNull()
    .references(() => workspaceModel.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    }),
  cursor: jsonb().$type<Record<string, unknown>>(),
  intervalSeconds: integer().notNull(),
  lastPolledAt: timestamp({ precision: 6, withTimezone: true }),
  lastSucceededAt: timestamp({ precision: 6, withTimezone: true }),
})
```

Check the import path of `connectionModel` (`grep -n "export const connectionModel" packages/database/src/schema`) and match the timestamp helper style used in `schema/connection.ts`. Add `export * from "./connection-poll-state"` to `schema/index.ts` (alphabetical), `export type ConnectionPollStateModel = typeof schema.connectionPollStateModel.$inferSelect` to `types.ts`.

- [ ] **Step 3: Relations (both edits, invariant 2).** `relations/connection-poll-state.ts`:

```ts
import { defineRelationsPart } from "drizzle-orm"
// biome-ignore lint/performance/noNamespaceImport: drizzle schema
import * as schema from "../schema"

export const connectionPollStateRelations = defineRelationsPart(schema, (r) => ({
  connectionPollStateModel: {
    connection: r.one.connectionModel({
      from: r.connectionPollStateModel.connectionId,
      to: r.connectionModel.id,
      optional: false,
    }),
  },
}))
```

(Copy the exact `defineRelationsPart` import line from `relations/integration-max.ts`.) In `relations/index.ts` import it and spread it into the `relations` object, next to `integrationMaxRelations`.

- [ ] **Step 4: Repository.** `repositories/connection-poll-state/repository.ts`:

```ts
import type { IntegrationType } from "../../partials/integration"
import { and, type DatabaseClient, db, eq, inArray, isNull, lte, or, sql } from "../../client"
import { connectionModel, connectionPollStateModel } from "../../schema"
import type { ConnectionPollStateModel } from "../../types"

export type ConnectionPollStateUpsert = {
  connectionId: string
  workspaceId: string
  intervalSeconds?: number
  cursor?: Record<string, unknown> | null
  lastPolledAt?: Date
  lastSucceededAt?: Date
}

export const connectionPollStateRepository = {
  async find(
    connectionId: string,
    tx: DatabaseClient = db,
  ): Promise<ConnectionPollStateModel | undefined> {
    return await tx.query.connectionPollStateModel.findFirst({
      where: { connectionId },
    })
  },

  async upsert(
    values: ConnectionPollStateUpsert,
    tx: DatabaseClient = db,
  ): Promise<void> {
    const { connectionId, workspaceId, ...rest } = values
    await tx
      .insert(connectionPollStateModel)
      .values({
        connectionId,
        workspaceId,
        intervalSeconds: rest.intervalSeconds ?? 60,
        ...rest,
      })
      .onConflictDoUpdate({
        target: connectionPollStateModel.connectionId,
        set: rest,
      })
  },

  /** `connected` connections of the given providers whose next poll is due. */
  async listDue(
    input: {
      providers: IntegrationType[]
      now: Date
      defaultIntervalSeconds: number
    },
    tx: DatabaseClient = db,
  ): Promise<{ connectionId: string; workspaceId: string }[]> {
    if (input.providers.length === 0) {
      return []
    }
    const interval = sql`coalesce(${connectionPollStateModel.intervalSeconds}, ${input.defaultIntervalSeconds})`
    return await tx
      .select({
        connectionId: connectionModel.id,
        workspaceId: connectionModel.workspaceId,
      })
      .from(connectionModel)
      .leftJoin(
        connectionPollStateModel,
        eq(connectionPollStateModel.connectionId, connectionModel.id),
      )
      .where(
        and(
          inArray(connectionModel.provider, input.providers),
          eq(connectionModel.status, "connected"),
          or(
            isNull(connectionPollStateModel.lastPolledAt),
            lte(
              sql`${connectionPollStateModel.lastPolledAt} + make_interval(secs => ${interval})`,
              input.now,
            ),
          ),
        ),
      )
  },
}
```

If `client.ts` does not export `lte`/`isNull`, add them to its re-export list (it re-exports drizzle operators). `index.ts`: `export * from "./repository"`. Add `export * from "./connection-poll-state"` to `repositories/index.ts`.

- [ ] **Step 5: Generate migration (do NOT apply).**

Run: `cd packages/database && DATABASE_URL=postgres://x:x@127.0.0.1:1/x pnpm make:migration connection_poll_state && pnpm db:check-drift`
Expected: a new folder with `CREATE TABLE "ConnectionPollState"` + two FKs; drift check passes. Read the SQL.

- [ ] **Step 6: Type-check** `cd packages/database && NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit -p .` and `cd packages/sdk && npx tsc --noEmit -p .` — PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/sdk/src/lib/connection.ts packages/database/src/schema/connection-poll-state.ts packages/database/src/schema/index.ts packages/database/src/types.ts packages/database/src/relations/connection-poll-state.ts packages/database/src/relations/index.ts packages/database/src/repositories/connection-poll-state packages/database/src/repositories/index.ts packages/database/drizzle/<generated-folder>
git commit -m "feat(connections): add poll contract to providers and ConnectionPollState table"
```

---

### Task 2: `runPoll` / `listDuePolls` orchestration

**Files:**
- Create: `packages/connections/src/poll.ts`
- Modify: `packages/connections/src/index.ts` (export)
- Test: `packages/connections/__tests__/poll.test.ts`

**Interfaces:**
- Consumes: Task 1 repository + SDK types; `findOrThrow`, `resolveAdapter` (`./internal`); `connectionStateService.markUnhealthy`, `resolveForeignKey`, `resolveOwnerId` (`@chatbotx.io/business/connection`); `connectionRepository.update`.
- Produces:

```ts
export type PollEnqueue = (job: {
  integrationType: string
  integrationIdentifier: string
  payload: unknown
}) => Promise<void>
export const DEFAULT_POLL_INTERVAL_SECONDS = 60
export const listPollProviders: () => IntegrationType[]
export const listDuePolls: (now?: Date) => Promise<{ connectionId: string; workspaceId: string }[]>
export type RunPollResult =
  | { status: "skipped"; reason: "not_connected" | "not_pollable" }
  | { status: "revoked" }
  | { status: "ok"; events: number }
export const runPoll: (input: { connectionId: string; workspaceId: string; enqueue: PollEnqueue; now?: Date }) => Promise<RunPollResult>
```

- [ ] **Step 1: Look up the test style.** Open the existing pause/resume test (`ls packages/connections/__tests__`; `grep -ln "resume" packages/connections/__tests__`) and reuse its `vi.mock` setup for `./internal`, `@chatbotx.io/business/connection` and `@chatbotx.io/database/repositories`.

- [ ] **Step 2: Write failing tests** `packages/connections/__tests__/poll.test.ts` covering:

```ts
// 1. not connected → { status: "skipped", reason: "not_connected" }, provider.poll.run not called
// 2. provider without poll → skipped/not_pollable
// 3. happy path: run returns 2 events + cursor {n:1}
//    → enqueue called twice with { integrationType: "zzap", integrationIdentifier: "<describe().sourceId>", payload }
//    → upsert called first with { lastPolledAt: now, intervalSeconds: 180 } (before run)
//    → upsert called last with { cursor: {n:1}, lastSucceededAt: now }
//    → upsert order: cursor written AFTER the second enqueue (assert via mock.invocationCallOrder)
// 4. enqueue throws on the 2nd event → runPoll rejects, cursor upsert never called
// 5. run throws and provider.isRevokedTokenError(err) === true
//    → connectionStateService.markUnhealthy({ connectionId, ownerId }) called, returns { status: "revoked" }
// 6. run throws a non-revoked error → connectionRepository.update({ values: { lastError } }) and rethrows
// 7. listDuePolls passes providers ["zzap"] when only zzap has poll (mock resolveAdapter / registry)
```

Write them as real `it(...)` blocks with the fixtures:

```ts
const now = new Date("2026-10-19T12:00:00Z")
const connection = { id: "c1", workspaceId: "w1", provider: "zzap", status: "connected", inboxId: "i1" }
const auth = { authType: "secretText", secretText: "k", codeObject: "42" }
const run = vi.fn()
const adapter = {
  provider: {
    describe: () => ({ sourceId: "42", displayName: "ZZAP 42" }),
    isRevokedTokenError: (e: unknown) => e instanceof Error && e.message === "revoked",
    poll: { intervalSeconds: () => 180, run },
  },
  store: { loadAuthByForeignKey: vi.fn().mockResolvedValue(auth) },
}
```

- [ ] **Step 3: Run** `cd packages/connections && pnpm vitest run __tests__/poll.test.ts` → FAIL (module missing).

- [ ] **Step 4: Implement** `packages/connections/src/poll.ts`:

```ts
import {
  connectionStateService,
  resolveForeignKey,
  resolveOwnerId,
} from "@chatbotx.io/business/connection"
import { toPublicErrorMessage } from "@chatbotx.io/business/errors"
import type { IntegrationType } from "@chatbotx.io/database/partials"
import {
  connectionPollStateRepository,
  connectionRepository,
} from "@chatbotx.io/database/repositories"
import { findOrThrow, resolveAdapter } from "./internal"
import { logger } from "./logger"
import { connectionAdapters } from "./registry"

export const DEFAULT_POLL_INTERVAL_SECONDS = 60

export type PollEnqueue = (job: {
  integrationType: string
  integrationIdentifier: string
  payload: unknown
}) => Promise<void>

export type RunPollResult =
  | { status: "skipped"; reason: "not_connected" | "not_pollable" }
  | { status: "revoked" }
  | { status: "ok"; events: number }

export const listPollProviders = (): IntegrationType[] =>
  Object.entries(connectionAdapters)
    .filter(([, adapter]) => Boolean(adapter.provider.poll))
    .map(([provider]) => provider as IntegrationType)

export const listDuePolls = async (now: Date = new Date()) =>
  await connectionPollStateRepository.listDue({
    providers: listPollProviders(),
    now,
    defaultIntervalSeconds: DEFAULT_POLL_INTERVAL_SECONDS,
  })

export const runPoll = async (input: {
  connectionId: string
  workspaceId: string
  enqueue: PollEnqueue
  now?: Date
}): Promise<RunPollResult> => {
  const now = input.now ?? new Date()
  const connection = await findOrThrow(input)
  if (connection.status !== "connected") {
    return { status: "skipped", reason: "not_connected" }
  }
  const adapter = resolveAdapter(connection.provider)
  const poll = adapter.provider.poll
  const foreignKey = resolveForeignKey(connection)
  if (!(poll && adapter.store && foreignKey)) {
    return { status: "skipped", reason: "not_pollable" }
  }
  const auth = await adapter.store.loadAuthByForeignKey(
    foreignKey,
    connection.workspaceId,
  )
  const state = await connectionPollStateRepository.find(connection.id)
  await connectionPollStateRepository.upsert({
    connectionId: connection.id,
    workspaceId: connection.workspaceId,
    intervalSeconds: poll.intervalSeconds(auth),
    lastPolledAt: now,
  })

  let result: Awaited<ReturnType<typeof poll.run>>
  try {
    result = await poll.run({
      auth,
      cursor: (state?.cursor as Record<string, unknown> | null) ?? null,
    })
  } catch (err) {
    if (adapter.provider.isRevokedTokenError?.(err)) {
      await connectionStateService.markUnhealthy({
        connectionId: connection.id,
        ownerId: await resolveOwnerId(connection),
      })
      logger.warn(
        { err, connectionId: connection.id, provider: connection.provider },
        "channel poll: credentials revoked, connection needs reauth",
      )
      return { status: "revoked" }
    }
    await connectionRepository.update({
      id: connection.id,
      workspaceId: connection.workspaceId,
      values: { lastError: toPublicErrorMessage(err, "Polling failed") },
    })
    throw err
  }

  const integrationIdentifier = adapter.provider.describe(auth).sourceId
  for (const event of result.events) {
    await input.enqueue({
      integrationType: connection.provider,
      integrationIdentifier,
      payload: event.payload,
    })
  }
  await connectionPollStateRepository.upsert({
    connectionId: connection.id,
    workspaceId: connection.workspaceId,
    cursor: result.cursor,
    lastSucceededAt: now,
  })
  if (connection.lastError) {
    await connectionRepository.update({
      id: connection.id,
      workspaceId: connection.workspaceId,
      values: { lastError: null },
    })
  }
  return { status: "ok", events: result.events.length }
}
```

Check the real names: the adapter map export in `packages/connections/src/registry.ts` (`grep -n "^export const" packages/connections/src/registry.ts`) and the `findOrThrow` argument shape in `./internal` (pause.ts passes `{ connectionId, workspaceId }`). Export from `src/index.ts`: `export { listDuePolls, listPollProviders, runPoll, DEFAULT_POLL_INTERVAL_SECONDS, type PollEnqueue, type RunPollResult } from "./poll"`.

- [ ] **Step 5: Run tests** → PASS. `npx tsc --noEmit -p .` in `packages/connections` → PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/connections/src/poll.ts packages/connections/src/index.ts packages/connections/__tests__/poll.test.ts
git commit -m "feat(connections): add runPoll and due-poll listing for polling channels"
```

---

### Task 3: Worker tick and poll job

**Files:**
- Modify: `packages/worker-config/src/queues/low/index.ts` (`LowJobAction.pollChannel`, `LowJobPollChannel`, union)
- Modify: `packages/worker-config/src/queues/schedule/index.ts` (`ScheduleJobData.dispatchChannelPolls` + its job data type)
- Create: `apps/worker/src/schedule/handlers/dispatch-channel-polls.ts`
- Create: `apps/worker/src/low/handlers/poll-channel.ts`
- Modify: `apps/worker/src/low/worker.ts`, the schedule worker switch (`grep -rn "ScheduleJobData.purgeErrorLogs" apps/worker/src --include=*.ts` to find it), `apps/worker/src/schedule/handlers/register-schedules.ts`
- Modify: `apps/worker/package.json` if `@chatbotx.io/connections` is not yet a dependency (then `CI=true pnpm install --no-frozen-lockfile`)
- Test: `apps/worker/__tests__/channel-poll.test.ts`

**Interfaces:**
- Consumes: `listDuePolls`, `runPoll` (Task 2); `integrationQueue`, `lowQueue` from `@chatbotx.io/worker-config`.
- Produces: `LowJobAction.pollChannel` with `data: { connectionId: string; workspaceId: string }`; `buildChannelPollJobId(connectionId) => "channel-poll-<id>"`; `ScheduleJobData.dispatchChannelPolls`.

- [ ] **Step 1: Queue types.** In `low/index.ts` add `pollChannel: "pollChannel"` to `LowJobAction`, and:

```ts
/**
 * Poll one `connected` polling channel. jobId `channel-poll-<connectionId>`
 * with remove-on-complete/fail: the tick can never stack a second poll of the
 * same connection while one is waiting or running.
 */
export type LowJobPollChannel = {
  type: typeof LowJobAction.pollChannel
  data: { connectionId: string; workspaceId: string }
}

export const buildChannelPollJobId = (connectionId: string): string =>
  `channel-poll-${connectionId}`
```

and add `LowJobPollChannel` to the `LowJobData` union. In `schedule/index.ts` add `dispatchChannelPolls: "dispatchChannelPolls"` to `ScheduleJobData` and a `{ type: typeof ScheduleJobData.dispatchChannelPolls; data: Record<string, never> }` member to the schedule job union, mirroring `dispatchProfileSnapshots`.

- [ ] **Step 2: Failing worker test** `apps/worker/__tests__/channel-poll.test.ts` (mock `@chatbotx.io/connections` and `@chatbotx.io/worker-config` queues the way `apps/worker/__tests__/register-schedules-edition.test.ts` mocks queues):

```ts
// dispatchChannelPolls: listDuePolls → [{c1,w1},{c2,w2}]
//   → lowQueue.add("pollChannel", { type: "pollChannel", data: { connectionId: "c1", workspaceId: "w1" } },
//       { jobId: "channel-poll-c1", removeOnComplete: true, removeOnFail: true, attempts: 1 })  (and c2)
// pollChannel handler: runPoll called with enqueue; invoking enqueue({integrationType:"zzap", integrationIdentifier:"42", payload:{a:1}})
//   → integrationQueue.add("incomingMessage", { type: "incomingMessage", data: { integrationType:"zzap", integrationIdentifier:"42", payload:{a:1} } })
// registerSchedules: upsertJobScheduler(ScheduleJobData.dispatchChannelPolls, { every: 15000 }, ...)
```

Run `cd apps/worker && pnpm vitest run __tests__/channel-poll.test.ts` → FAIL.

- [ ] **Step 3: Handlers.** `schedule/handlers/dispatch-channel-polls.ts`:

```ts
import { listDuePolls } from "@chatbotx.io/connections"
import {
  buildChannelPollJobId,
  LowJobAction,
  lowQueue,
} from "@chatbotx.io/worker-config"

export const dispatchChannelPolls = async (): Promise<void> => {
  const due = await listDuePolls()
  for (const { connectionId, workspaceId } of due) {
    await lowQueue.add(
      LowJobAction.pollChannel,
      { type: LowJobAction.pollChannel, data: { connectionId, workspaceId } },
      {
        jobId: buildChannelPollJobId(connectionId),
        removeOnComplete: true,
        removeOnFail: true,
        attempts: 1,
      },
    )
  }
}
```

`low/handlers/poll-channel.ts`:

```ts
import { runPoll } from "@chatbotx.io/connections"
import {
  IntegrationJobAction,
  integrationQueue,
  type LowJobPollChannel,
} from "@chatbotx.io/worker-config"
import { logger } from "../../lib/logger"

export const pollChannel = async (
  data: LowJobPollChannel["data"],
): Promise<void> => {
  const result = await runPoll({
    ...data,
    enqueue: async (job) => {
      await integrationQueue.add(IntegrationJobAction.incomingMessage, {
        type: IntegrationJobAction.incomingMessage,
        data: job,
      })
    },
  })
  if (result.status === "ok" && result.events > 0) {
    logger.info({ ...data, events: result.events }, "channel poll enqueued events")
  }
}
```

Check the actual export names (`lowQueue`, `integrationQueue`) in `packages/worker-config/src/index.ts`; use whatever MAX's webhook path uses for `integrationQueue`. Add the `case LowJobAction.pollChannel: { await pollChannel(job.data.data); return }` branch to `processLowJob` in `low/worker.ts` (it is already wrapped in `withBlockedOwnerGuard`, invariant 15), and `case ScheduleJobData.dispatchChannelPolls: await dispatchChannelPolls(); break` to the schedule worker. In `register-schedules.ts` add:

```ts
  await scheduleQueue.upsertJobScheduler(
    ScheduleJobData.dispatchChannelPolls,
    { every: 15_000 },
    {
      name: ScheduleJobData.dispatchChannelPolls,
      data: { type: ScheduleJobData.dispatchChannelPolls, data: {} },
    },
  )
```

- [ ] **Step 4: Run tests** → PASS; run the whole worker suite `pnpm vitest run` (exhaustive switches) and `NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit -p .` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/worker-config/src/queues/low/index.ts packages/worker-config/src/queues/schedule/index.ts apps/worker/src/schedule/handlers/dispatch-channel-polls.ts apps/worker/src/low/handlers/poll-channel.ts apps/worker/src/low/worker.ts apps/worker/src/schedule/handlers/register-schedules.ts <schedule worker file> apps/worker/__tests__/channel-poll.test.ts
git commit -m "feat(worker): poll connected polling channels from a 15s schedule tick"
```

---

### Task 4: Register `zzap` as a channel (enums, table, records)

Mirror commit `c18a75802` (`git show c18a75802 --stat`) — same files, value `zzap`.

**Files:**
- Modify: `packages/utils/src/channel.ts` (`channelTypes` add `"zzap"` after `"max"`; `CHANNEL_CAPABILITIES.zzap = { creatable: true, manageable: true, requiresCredential: false, order: 8, callable: false, pausable: true }`, shift following `order` values by 1)
- Modify: `packages/database/src/partials/integration.ts` (`"zzap"` in `integrationTypes`)
- Create: `packages/database/src/schema/integration-zzap.ts`, `packages/database/src/relations/integration-zzap.ts`; Modify `schema/index.ts`, `relations/index.ts` (two edits), `types.ts`
- Create: `packages/flow-config/src/channel-rules/policies/zzap.ts`; Modify `policies/index.ts`, `__tests__/channel-policies.test.ts`, `__tests__/send-view-catalog-step.test.ts`
- Modify every `Record<ChannelType, …>` the compiler flags; known set from `c18a75802`: `apps/builder/src/features/contacts/lib/channel-identity.ts`, `features/inboxes/components/inbox-icon.tsx`, `features/inboxes/provider/inbox-hook.ts`, `features/messages/components/message-input.tsx`, `apps/worker/src/schedule/handlers/refresh-channel-tokens.ts`, `packages/business/src/contact/contact-inbox-identity.ts`, `packages/business/src/contact/profile-refresh/rules.ts`, `packages/business/src/inbox/utils.ts`, `packages/utils/src/error-log.ts`, `packages/utils/src/inbound-webhook-channel.ts` (+ its test)
- Modify: 21 × `apps/builder/messages/*.json` (`fields.zzap.label = "ZZAP"`, `fields.channelIdentity.zzapUserKey = "ZZAP user key"`)

- [ ] **Step 1: Table** `schema/integration-zzap.ts`:

```ts
import { index, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core"
import { bigintAsString, sharedColumns } from "../partials/shared"
import { inboxModel } from "./inbox"
import { workspaceModel } from "./workspace"

export const integrationZzapModel = pgTable(
  "IntegrationZzap",
  {
    ...sharedColumns,
    /** Sealed (encrypted) auth envelope — see business `sealed-auth.ts`. */
    auth: jsonb().$type<{ [x: string]: unknown }>().notNull(),
    /** ZZAP seller object code (`code_object`), the channel identity. */
    codeObject: text().notNull(),
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
    index("IntegrationZzap_workspaceId_idx").using(
      "btree",
      table.workspaceId.asc().nullsLast(),
    ),
    uniqueIndex("IntegrationZzap_inboxId_key").using(
      "btree",
      table.inboxId.asc().nullsLast(),
    ),
    uniqueIndex("IntegrationZzap_codeObject_key").using(
      "btree",
      table.codeObject.asc().nullsLast(),
    ),
  ],
)
```

Relations file = `relations/integration-max.ts` with `integrationMaxModel`→`integrationZzapModel`, `integrationMaxRelations`→`integrationZzapRelations`. `types.ts`: `export type IntegrationZzapModel = typeof schema.integrationZzapModel.$inferSelect`.

- [ ] **Step 2: Flow policy** `policies/zzap.ts`:

```ts
import { stepTypes } from "../../steps/step-action"
import { defineChannelFlowPolicy } from "./define"
// ZZAP chat is plain text: buttons and quick replies are sent as a numbered list.

export const zzapFlowPolicy = defineChannelFlowPolicy({
  limits: {
    buttonCount: 10,
    buttonLabel: 64,
    text: 4000,
  },
  supported: [
    stepTypes.enum.sendText,
    stepTypes.enum.sendImage,
    stepTypes.enum.sendFile,
    stepTypes.enum.sendQuickReply,
  ],
})
```

Register `[channelTypes.enum.zzap]: zzapFlowPolicy`; in `channel-policies.test.ts` add `zzap` to `MEDIA_SUPPORT_BY_CHANNEL` (derive the five entries by running the test once and reading the computed support for image/video/audio/file/gif) and `TEXT_LIMITS.zzap = 4000`; `send-view-catalog-step.test.ts`: `zzap: stepSupport.unsupported`.

- [ ] **Step 3: Records.** Per file, the `zzap` entry:
  - `channel-identity.ts`: `{ labelKey: "fields.channelIdentity.zzapUserKey", hideWhenSourceUserIdKeyed: false }`
  - `inbox-icon.tsx`: `{ Icon: ShoppingCartIcon, iconClassName: "stroke-[#E30613]", defaultLabelKey: "fields.zzap.label" }` (import `ShoppingCartIcon` from lucide-react)
  - `inbox-hook.ts`: `{ label: "ZZAP", value: "zzap" }`
  - `message-input.tsx`: `zzap: 0`
  - `refresh-channel-tokens.ts`: `zzap: undefined`
  - `contact-inbox-identity.ts`: `zzap: asSent`, `zzap: fromChannelUserId("zzap")`
  - `profile-refresh/rules.ts`: `zzap: { inbound: "payload", onDemand: false }, // poll event carries buyer name/phone/email`
  - `inbox/utils.ts`: `buildInboxLink` → `zzap: { url: "https://www.zzap.ru/", refKey: "", refValue }` only if the map requires every channel (otherwise skip); `buildPostLink`/`buildMessageLink`: `zzap: ""`. Do NOT add to `REF_CAPABLE_CHANNELS`.
  - `error-log.ts`: `zzap: "ZZAP"`
  - `inbound-webhook-channel.ts`: `zzap: { inboxIdentifiers: [{ kind: "codeObject", strategy: "inboxSourceId", examplePath: "$.code_object" }], channelUserId: null, creationIdentities: [] }` — if `kind` is a closed union, add `"codeObject"` to it; update the test's expected `PAYLOAD_RESOLVABLE_CHANNELS` list accordingly.

Then run `cd apps/builder && NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p .` plus tsc in `packages/business`, `apps/worker`, `packages/flow-config` (two at a time) and fix every remaining `Record<ChannelType…>` hit.

- [ ] **Step 4: i18n (all 21 locales).** Script it so the key order matches `max`:

```bash
cd apps/builder/messages && for f in *.json; do node -e '
const fs=require("fs");const f=process.argv[1];const j=JSON.parse(fs.readFileSync(f,"utf8"));
const ins=(obj,after,key,val)=>{const o={};for(const k of Object.keys(obj)){o[k]=obj[k];if(k===after)o[key]=val}if(!(key in o))o[key]=val;return o};
j.fields=ins(j.fields,"max","zzap",{label:"ZZAP"});
j.fields.channelIdentity=ins(j.fields.channelIdentity,"maxUserId","zzapUserKey","ZZAP user key");
fs.writeFileSync(f,JSON.stringify(j,null,2)+"\n")' "$f"; done
```

Run `pnpm --filter builder i18n:check` → PASS. `git diff --stat apps/builder/messages` must show only small insertions per file (if a file's formatting changed wholesale, revert and insert by hand).

- [ ] **Step 5: Migration (do NOT apply).** `cd packages/database && DATABASE_URL=postgres://x:x@127.0.0.1:1/x pnpm make:migration integration_zzap && pnpm db:check-drift` → `CREATE TABLE "IntegrationZzap"` + 3 indexes + 2 FKs.

- [ ] **Step 6: Tests** `pnpm --filter @chatbotx.io/flow-config test`, `pnpm --filter @chatbotx.io/utils test`, `pnpm --filter @chatbotx.io/business test` → PASS.

- [ ] **Step 7: Commit** (list every modified file explicitly)

```bash
git commit -m "feat(zzap): add IntegrationZzap table and register zzap in every channel record"
```

---

### Task 5: `integrations/zzap` — client, rate limiter, media and id helpers

**Files (create):**
- `integrations/zzap/package.json`, `tsconfig.json`, `tsdown.config.ts`, `vitest.config.ts` — copy from `integrations/max/` and rename `max`→`zzap`; `vitest.config.ts` copied from `integrations/threads/vitest.config.ts` (msw setup)
- `src/constants.ts`, `src/schema.ts`, `src/exception.ts`
- `src/lib/logger.ts` (copy of max with `zzap`), `src/lib/rate-limiter.ts`, `src/lib/http-client.ts`, `src/lib/error-mapper.ts`, `src/lib/moscow-time.ts`, `src/lib/media.ts`, `src/lib/ids.ts`, `src/lib/orders.ts`
- `src/apis/threads.ts`, `src/apis/messages.ts`, `src/apis/users.ts`, `src/apis/orders.ts`
- Tests: `__tests__/rate-limiter.test.ts`, `__tests__/media.test.ts`, `__tests__/http-client.test.ts`, `__tests__/orders.test.ts`

**Interfaces — Produces:**

```ts
// schema.ts
export type ZzapAuthValue = SecretTextAuthValue & {
  codeObject: string
  typeObject: string
  testMode: boolean
  pollIntervalSeconds: number        // default 180
  maxThreadsPerPoll: number          // default 5
  requestMinIntervalSeconds: number  // default 3.5, floor 3
}
export type ZzapConfig = BaseConfig & { codeObject?: string }
export type ZzapThread = { user_key: string; user_name?: string; message_last?: string; message_last_date?: string; unread_count?: number; read_only?: boolean }
export type ZzapMessage = { user_key: string; user_name?: string; message: string; message_date: string }
export type ZzapBuyer = { name?: string; phone?: string; email?: string }

// lib/http-client.ts
export const createZzapClient: (auth: ZzapAuthValue) => ZzapClient
export type ZzapClient = {
  get: <T>(path: string, searchParams?: Record<string, string | number | boolean>) => Promise<T>
  post: <T>(path: string, body: unknown, searchParams?: Record<string, string | number | boolean>) => Promise<T>
}
// apis
listThreads(auth, { page?: number; pageSize?: number }): Promise<ZzapThread[]>
listMessages(auth, userKey): Promise<ZzapMessage[]>
sendZzapMessage(auth, { userKey: string; text: string; now?: Date }): Promise<{ messageId: string }>
getBuyer(auth, userKey): Promise<ZzapBuyer>
getOrderBuyer(auth, orderCode): Promise<ZzapBuyer>
// lib
parseZzapMedia(raw: string): { text: string; media: { url: string; filename: string; kind: "image" | "file" } | null }
isAllowedZzapFileUrl(url: string): boolean
formatMoscowDate(date: Date): string      // "YYYY-MM-DDTHH:mm:ss" Europe/Moscow
makeZzapMessageId(input: { userKey: string; messageDate: string; senderKey: string; message: string }): string // "zzap:<24 hex>"
extractOrderCodes(text: string): string[]
class ZzapAPIException { status?: number }, class ZzapRateLimitException extends ZzapAPIException
```

- [ ] **Step 1: constants/schema/exception.**

```ts
// constants.ts
export const ZZAP_API_BASE_URL = "https://b52-api.zzap.pro"
export const ZZAP_API_KEY_HEADER = "zzap-api-key"
export const ZZAP_TEXT_LIMIT = 4000
export const ZZAP_MIN_REQUEST_INTERVAL_SECONDS = 3
export const ZZAP_429_MAX_RETRIES = 3
export const ZZAP_DEFAULTS = {
  pollIntervalSeconds: 180,
  maxThreadsPerPoll: 5,
  requestMinIntervalSeconds: 3.5,
} as const
export const ZZAP_FILE_HOSTS = ["koj.blob.core.windows.net", "zzap.ru", "zzap.pro"] as const
```

`exception.ts`: copy `integrations/max/src/exception.ts`, rename classes to `ZzapException`, `ZzapAPIException` (keeps `status`), add:

```ts
export class ZzapRateLimitException extends ZzapAPIException {
  constructor() {
    super("ZZAP rate limit (429) persisted after retries", 429)
  }
}
```

(adapt the constructor signature to whatever `MaxAPIException` takes.)

- [ ] **Step 2: Failing tests** for rate limiter, media, ids, orders, http-client:

```ts
// rate-limiter.test.ts (vi.useFakeTimers)
// two acquire("k", 3000) calls: second resolves only after 3000ms; different keys do not wait for each other
// media.test.ts
expect(parseZzapMedia("Вот фото [img]https://zzap.ru/a/b.jpg[/img]")).toEqual({
  text: "Вот фото", media: { url: "https://zzap.ru/a/b.jpg", filename: "b.jpg", kind: "image" } })
expect(parseZzapMedia("[file]счет.pdf; https://koj.blob.core.windows.net/zzap-upload/x.pdf[/file]").media?.kind).toBe("file")
expect(parseZzapMedia("просто текст")).toEqual({ text: "просто текст", media: null })
expect(isAllowedZzapFileUrl("https://evil.example/x.jpg")).toBe(false)
expect(isAllowedZzapFileUrl("http://zzap.ru/x.jpg")).toBe(false)
// ids
expect(makeZzapMessageId({ userKey: "u", messageDate: "2026-10-19T10:00:00", senderKey: "u", message: "hi" })).toMatch(/^zzap:[0-9a-f]{24}$/)
// same input → same id; any field change → different id
// moscow time
expect(formatMoscowDate(new Date("2026-10-19T07:00:00Z"))).toBe("2026-10-19T10:00:00")
// orders
expect(extractOrderCodes("по заказу 12345678 и #87654321")).toEqual(["12345678", "87654321"])
expect(extractOrderCodes("Заказы: 11111111, 22222222")).toEqual(["11111111", "22222222"])
// http-client (msw): sends zzap-api-key header; adds code_object/type_object query when asked;
// 429 twice then 200 → resolves; 429 ×4 → ZzapRateLimitException; 500 body {success:false, errors:{error:"bad"}} → ZzapAPIException("bad", 500)
// 200 with {success:false} → ZzapAPIException
```

Run `cd integrations/zzap && pnpm vitest run` → FAIL.

- [ ] **Step 3: Implement.**

```ts
// lib/rate-limiter.ts — one in-flight ZZAP call per API key per process, spaced by minIntervalMs.
const lanes = new Map<string, Promise<void>>()

export const acquireZzapSlot = (key: string, minIntervalMs: number): Promise<void> => {
  const previous = lanes.get(key) ?? Promise.resolve()
  let release: () => void = () => undefined
  const next = new Promise<void>((resolve) => {
    release = resolve
  })
  lanes.set(key, previous.then(() => next))
  return previous.then(() => {
    setTimeout(release, minIntervalMs)
  })
}
```

(The caller proceeds once the previous slot's timer released; each slot holds the lane for `minIntervalMs` after it starts. The test asserts the observable spacing.)

```ts
// lib/moscow-time.ts
const FORMATTER = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Moscow",
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
})
export const formatMoscowDate = (date: Date): string =>
  FORMATTER.format(date).replace(" ", "T")
```

```ts
// lib/ids.ts
import { createHash } from "node:crypto"
export const makeZzapMessageId = (input: {
  userKey: string; messageDate: string; senderKey: string; message: string
}): string =>
  `zzap:${createHash("sha256")
    .update(`${input.userKey}|${input.messageDate}|${input.senderKey}|${input.message}`)
    .digest("hex")
    .slice(0, 24)}`
```

(Same formula as Dashboard `make_zzap_external_id`.)

```ts
// lib/media.ts
import { ZZAP_FILE_HOSTS } from "../constants"

const FILE_PATTERN = /\[file\]([^;\]]+);\s*([^\]]+)\[\/file\]/i
const IMG_PATTERN = /\[img\]\s*(https?:\/\/[^\s[\]]+)\s*(?:\[\/img\])?/i
const IMAGE_EXT_PATTERN = /\.(jpe?g|png|gif|webp|bmp|heic)(?:\?|$)/i

export type ZzapMedia = { url: string; filename: string; kind: "image" | "file" }

const filenameFromUrl = (url: string): string =>
  decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "") || "file"

export const isAllowedZzapFileUrl = (value: string): boolean => {
  if (value.length > 2048) return false
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.protocol !== "https:" || url.pathname.includes("..")) return false
  const host = url.hostname.toLowerCase()
  if ((ZZAP_FILE_HOSTS as readonly string[]).includes(host)) return true
  if (host.endsWith(".zzap.ru") || host.endsWith(".zzap.pro")) return true
  return host.endsWith(".blob.core.windows.net") && url.pathname.includes("/zzap-upload/")
}

export const parseZzapMedia = (raw: string): { text: string; media: ZzapMedia | null } => {
  const file = FILE_PATTERN.exec(raw)
  if (file) {
    const url = file[2].trim()
    const filename = file[1].trim() || filenameFromUrl(url)
    const kind = IMAGE_EXT_PATTERN.test(filename) || IMAGE_EXT_PATTERN.test(url) ? "image" : "file"
    return { text: raw.replace(file[0], "").trim(), media: { url, filename, kind } }
  }
  const img = IMG_PATTERN.exec(raw)
  if (img) {
    const url = img[1].trim()
    return { text: raw.replace(img[0], "").trim(), media: { url, filename: filenameFromUrl(url), kind: "image" } }
  }
  return { text: raw.trim(), media: null }
}
```

(Biome wants braces on single-line `if` — run `pnpm fix` after.)

```ts
// lib/orders.ts — same patterns as Dashboard zzap_customer_link.py
const ORDER_CODE_PATTERN = /(?:заказ|order|по\s+заказу)\s*#?\s*(\d{6,12})|#\s*(\d{6,12})/giu
const ORDER_HEAD_PATTERN = /(?:заказ\p{L}*|orders?)\s*[:#№]?/giu
const ORDER_NUM_PATTERN = /\d{6,12}/g

export const extractOrderCodes = (text: string): string[] => {
  const codes = new Set<string>()
  for (const match of text.matchAll(ORDER_CODE_PATTERN)) {
    const code = match[1] ?? match[2]
    if (code) codes.add(code)
  }
  for (const head of text.matchAll(ORDER_HEAD_PATTERN)) {
    const tail = text.slice((head.index ?? 0) + head[0].length, (head.index ?? 0) + head[0].length + 160)
    if (!/\d{6,12}/.test(tail.slice(0, 48))) continue
    for (const num of tail.matchAll(ORDER_NUM_PATTERN)) codes.add(num[0])
  }
  return [...codes]
}
```

```ts
// lib/http-client.ts
import ky, { HTTPError } from "ky"
import { ZZAP_429_MAX_RETRIES, ZZAP_API_BASE_URL, ZZAP_API_KEY_HEADER, ZZAP_MIN_REQUEST_INTERVAL_SECONDS } from "../constants"
import { ZzapAPIException, ZzapRateLimitException } from "../exception"
import type { ZzapAuthValue } from "../schema"
import { acquireZzapSlot } from "./rate-limiter"

type Envelope<T> = { success?: boolean; result?: T; errors?: { error?: string } | string; message?: string }
type Params = Record<string, string | number | boolean>

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export type ZzapClient = {
  get: <T>(path: string, searchParams?: Params) => Promise<T>
  post: <T>(path: string, body: unknown, searchParams?: Params) => Promise<T>
}

const errorText = (body: Envelope<unknown>, fallback: string): string => {
  const errors = body.errors
  if (typeof errors === "string" && errors) return errors
  if (errors && typeof errors === "object" && errors.error) return errors.error
  return body.message ?? fallback
}

export const createZzapClient = (auth: ZzapAuthValue): ZzapClient => {
  const minIntervalMs =
    Math.max(auth.requestMinIntervalSeconds, ZZAP_MIN_REQUEST_INTERVAL_SECONDS) * 1000
  const http = ky.create({
    prefixUrl: ZZAP_API_BASE_URL,
    headers: { [ZZAP_API_KEY_HEADER]: auth.secretText, Accept: "application/json" },
    retry: 0,
    timeout: 45_000,
    throwHttpErrors: false,
  })

  const request = async <T>(method: "get" | "post", path: string, init: { json?: unknown; searchParams?: Params }): Promise<T> => {
    for (let attempt = 0; attempt <= ZZAP_429_MAX_RETRIES; attempt++) {
      await acquireZzapSlot(auth.secretText, minIntervalMs)
      const response = await http(path.replace(/^\//, ""), { method, ...init })
      if (response.status === 429) {
        const retryAfter = Number(response.headers.get("retry-after"))
        await sleep(Math.max(Number.isFinite(retryAfter) ? retryAfter * 1000 : 0, minIntervalMs * (attempt + 1)))
        continue
      }
      const body = (await response.json().catch(() => ({}))) as Envelope<T>
      if (!response.ok || body.success === false) {
        throw new ZzapAPIException(errorText(body, response.statusText), response.status)
      }
      return body.result as T
    }
    throw new ZzapRateLimitException()
  }

  return {
    get: (path, searchParams) => request("get", path, { searchParams }),
    post: (path, json, searchParams) => request("post", path, { json, searchParams }),
  }
}
```

(`HTTPError` import is not needed with `throwHttpErrors: false`; drop it if unused. In tests set `requestMinIntervalSeconds: 0` is floored to 3 s — use `vi.useFakeTimers({ shouldAdvanceTime: true })` or export `ZZAP_MIN_REQUEST_INTERVAL_SECONDS` as a module constant the test can override via `vi.mock("../src/constants", …)` with `0`.)

```ts
// lib/error-mapper.ts — mirror integrations/max/src/lib/error-mapper.ts
export const isRevokedTokenError = (error: unknown): boolean =>
  error instanceof ZzapAPIException && (error.status === 401 || error.status === 403)
// mapToChannelError: same categories as MAX (401/403 → auth, 429 → rate_limit, 5xx → transient, else invalid_request)
```

```ts
// apis/threads.ts
const objectParams = (auth: ZzapAuthValue) => ({ code_object: auth.codeObject, type_object: auth.typeObject })
export const listThreads = async (auth: ZzapAuthValue, input: { page?: number; pageSize?: number } = {}) =>
  (await createZzapClient(auth).get<{ data?: ZzapThread[] }>("/api/client/v1/messages", {
    page: input.page ?? 1, page_size: input.pageSize ?? 100, ...objectParams(auth),
  }))?.data ?? []
// apis/messages.ts
export const listMessages = async (auth: ZzapAuthValue, userKey: string) =>
  (await createZzapClient(auth).get<{ data?: ZzapMessage[] }>(`/api/client/v1/messages/${encodeURIComponent(userKey)}`, {
    page: 1, page_size: 100, ...objectParams(auth),
  }))?.data ?? []
export const sendZzapMessage = async (auth: ZzapAuthValue, input: { userKey: string; text: string; now?: Date }) => {
  const messageDate = formatMoscowDate(input.now ?? new Date())
  await createZzapClient(auth).post("/api/client/v1/messages",
    { user_key: input.userKey, message: input.text, message_date: messageDate, is_online: false },
    { ...objectParams(auth), test: auth.testMode })
  return { messageId: `zzap-out:${createHash("sha256").update(`${input.userKey}|${messageDate}|${input.text}`).digest("hex").slice(0, 16)}` }
}
// apis/users.ts
export const getBuyer = async (auth: ZzapAuthValue, userKey: string): Promise<ZzapBuyer> => {
  const user = await createZzapClient(auth).get<Record<string, unknown>>(`/api/client/v1/user/${encodeURIComponent(userKey)}`)
  return {
    name: pickString(user, "class_user", "name_first"),
    phone: pickString(user, "phone1", "phone2", "phone_v2", "phone"),
    email: pickString(user, "email"),
  }
}
// apis/orders.ts
export const getOrderBuyer = async (auth: ZzapAuthValue, orderCode: string): Promise<ZzapBuyer> => {
  const order = await createZzapClient(auth).get<Record<string, unknown>>(`/api/client/v1/orders/seller/${encodeURIComponent(orderCode)}`)
  return {
    name: pickString(order, "client_name"),
    phone: pickString(order, "client_phone"),
    email: pickString(order, "client_email"),
  }
}
```

Put `objectParams` and `pickString(obj, ...keys)` (first non-empty trimmed string among `snake_case` and `camelCase` variants) in `src/lib/fields.ts`, shared by the apis. Share one `createZzapClient(auth)` per call site is fine: the limiter is module-level, keyed by API key.

- [ ] **Step 4: Install & test.** `CI=true pnpm install --no-frozen-lockfile` (new package, invariant 5), `cd integrations/zzap && pnpm vitest run` → PASS, `npx tsc --noEmit -p .` → PASS, `pnpm fix`.

- [ ] **Step 5: Commit**

```bash
git add integrations/zzap pnpm-lock.yaml
git commit -m "feat(zzap): add ZZAP B52 API client with per-key rate limiting and message helpers"
```

---

### Task 6: ZZAP poll (`poll.run`) with buyer enrichment

**Files:**
- Create: `integrations/zzap/src/handlers/poll.ts`, `integrations/zzap/src/handlers/event.ts`
- Test: `integrations/zzap/__tests__/poll.test.ts` (vi.mock `../src/apis/*`)

**Interfaces:**
- Consumes: Task 5 apis/helpers.
- Produces:

```ts
// handlers/event.ts
export type ZzapInboundEvent = {
  kind: "message"
  sourceId: string           // makeZzapMessageId(...)
  userKey: string
  userName: string
  messageDate: string
  text: string               // raw ZZAP text (media tags still inside)
  buyer: ZzapBuyer | null
}
export const zzapInboundEventSchema: z.ZodType<ZzapInboundEvent>
export const parseZzapEvent: (payload: unknown) => ZzapInboundEvent | null
// handlers/poll.ts
export type ZzapCursor = {
  since: string                                            // Moscow local, minus 5 min skew margin
  threads: Record<string, { lastDate: string; lastPreview: string }>
  buyers: Record<string, string>                           // userKey → ISO time of last profile fetch
}
export const pollZzap: (input: { auth: ZzapAuthValue; cursor: PollCursor | null; now?: Date }) => Promise<PollResult>
```

Rules (from Dashboard `zzap_inbound.py`, adapted):
1. `since` = `formatMoscowDate(now − 5 min)` stored at the end of every successful run; lower bound for threads without an entry. First run (`cursor === null`) uses the same value, so no history is imported (spec §5.3: ZZAP cursor starts "now").
2. Skip `read_only` threads and threads without `user_key`.
3. Candidate: with an entry → `lastDate` or `lastPreview` changed, or `unread_count > 0`; without an entry → `unread_count > 0` or `message_last_date >= previousSince`. Non-candidates without an entry get a baseline entry from the list row.
4. Candidates sorted by `unread_count` desc; at most `maxThreadsPerPoll` fetched.
5. For a fetched thread: events = messages whose `user_key === thread.user_key` (buyer, not shop), with non-empty text and `message_date >= (entry?.lastDate ?? previousSince)`; entry becomes `{ lastDate: max(message_date), lastPreview: thread.message_last }`. `>=` is deliberate: equal-second messages are re-emitted and deduped downstream by `sourceId`.
6. A candidate that was not fetched (limit or rate limit) and has no entry gets `{ lastDate: previousSince, lastPreview: "" }` so its lower bound survives the advance of `since`.
7. `ZzapRateLimitException` while fetching → stop fetching, keep already collected events, treat the rest as "not fetched". Any other error propagates (cursor not saved by `runPoll`).
8. Buyer: for each user with events, if `buyers[userKey]` is missing or older than 24 h → `getBuyer`; if it yields neither phone nor email and the events' text contains order codes → `getOrderBuyer(first code)`. Any enrichment error is logged with `{ err }` and ignored (`buyer: null`); `ZzapRateLimitException` here also stops further enrichment.
9. Prune thread entries whose `lastDate` is more than 30 days before `now` and buyer stamps older than 30 days.

- [ ] **Step 1: Failing tests** `__tests__/poll.test.ts` — one `it` per rule:

```ts
const auth = { authType: "secretText", secretText: "k", codeObject: "42", typeObject: "1", testMode: false,
  pollIntervalSeconds: 180, maxThreadsPerPoll: 2, requestMinIntervalSeconds: 3.5 } as ZzapAuthValue
const now = new Date("2026-10-19T09:00:00Z") // 12:00:00 Moscow
// first run: cursor null, thread A unread 1 with messages at 11:50 (before since 11:55) and 11:58 →
//   one event (11:58), cursor.since === "2026-10-19T11:55:00", cursor.threads.A.lastDate === "2026-10-19T11:58:00"
// shop messages (user_key !== thread key) never become events
// thread with unchanged entry and unread 0 → listMessages not called
// three candidates, maxThreadsPerPoll 2 → highest unread two fetched; third (no entry) gets { lastDate: previousSince, lastPreview: "" }
// listMessages rejects with ZzapRateLimitException on the 2nd thread → result has the 1st thread's events, no throw
// listMessages rejects with ZzapAPIException(500) → pollZzap rejects
// buyer fetched once; second run within 24h with new message → getBuyer not called again, event.buyer === null
// getBuyer returns {} and text "по заказу 12345678" → getOrderBuyer(auth, "12345678") called, event.buyer has its phone
// event.sourceId === makeZzapMessageId({ userKey: "A", messageDate, senderKey: "A", message })
// prune: entry with lastDate 40 days old is dropped
```

Run → FAIL.

- [ ] **Step 2: Implement** `handlers/event.ts` (zod schema matching the type; `parseZzapEvent` = `safeParse(...).success ? data : null`) and `handlers/poll.ts`:

```ts
import type { PollCursor, PollResult } from "@chatbotx.io/sdk"
import { getOrderBuyer } from "../apis/orders"
import { listMessages } from "../apis/messages"
import { listThreads } from "../apis/threads"
import { getBuyer } from "../apis/users"
import { ZzapRateLimitException } from "../exception"
import { makeZzapMessageId } from "../lib/ids"
import { logger } from "../lib/logger"
import { formatMoscowDate } from "../lib/moscow-time"
import { extractOrderCodes } from "../lib/orders"
import type { ZzapAuthValue, ZzapBuyer, ZzapThread } from "../schema"
import type { ZzapInboundEvent } from "./event"

const SKEW_MARGIN_MS = 5 * 60 * 1000
const BUYER_REFRESH_MS = 24 * 60 * 60 * 1000
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000

export type ZzapCursor = {
  since: string
  threads: Record<string, { lastDate: string; lastPreview: string }>
  buyers: Record<string, string>
}

const readCursor = (cursor: PollCursor | null, fallbackSince: string): ZzapCursor => ({
  since: typeof cursor?.since === "string" ? cursor.since : fallbackSince,
  threads: { ...((cursor?.threads as ZzapCursor["threads"] | undefined) ?? {}) },
  buyers: { ...((cursor?.buyers as ZzapCursor["buyers"] | undefined) ?? {}) },
})

const isCandidate = (thread: ZzapThread, entry: ZzapCursor["threads"][string] | undefined, since: string) => {
  const unread = thread.unread_count ?? 0
  if (entry) {
    return unread > 0 || entry.lastDate !== (thread.message_last_date ?? "") || entry.lastPreview !== (thread.message_last ?? "")
  }
  return unread > 0 || (thread.message_last_date ?? "") >= since
}

const enrichBuyer = async (auth: ZzapAuthValue, userKey: string, texts: string[]): Promise<ZzapBuyer | null> => {
  const buyer = await getBuyer(auth, userKey)
  if (buyer.phone || buyer.email) return buyer
  const [orderCode] = texts.flatMap(extractOrderCodes)
  if (!orderCode) return buyer
  const fromOrder = await getOrderBuyer(auth, orderCode)
  return { name: buyer.name ?? fromOrder.name, phone: fromOrder.phone, email: fromOrder.email }
}

export const pollZzap = async (input: { auth: ZzapAuthValue; cursor: PollCursor | null; now?: Date }): Promise<PollResult> => {
  const now = input.now ?? new Date()
  const nextSince = formatMoscowDate(new Date(now.getTime() - SKEW_MARGIN_MS))
  const cursor = readCursor(input.cursor, nextSince)
  const previousSince = cursor.since

  const candidates: ZzapThread[] = []
  for (const thread of await listThreads(input.auth)) {
    if (thread.read_only || !thread.user_key) continue
    const entry = cursor.threads[thread.user_key]
    if (isCandidate(thread, entry, previousSince)) {
      candidates.push(thread)
    } else if (!entry) {
      cursor.threads[thread.user_key] = { lastDate: thread.message_last_date ?? "", lastPreview: thread.message_last ?? "" }
    }
  }
  candidates.sort((a, b) => (b.unread_count ?? 0) - (a.unread_count ?? 0))

  const events: ZzapInboundEvent[] = []
  let rateLimited = false
  let fetched = 0
  for (const thread of candidates) {
    const userKey = thread.user_key
    const entry = cursor.threads[userKey]
    if (rateLimited || fetched >= input.auth.maxThreadsPerPoll) {
      if (!entry) cursor.threads[userKey] = { lastDate: previousSince, lastPreview: "" }
      continue
    }
    let messages: Awaited<ReturnType<typeof listMessages>>
    try {
      messages = await listMessages(input.auth, userKey)
    } catch (err) {
      if (!(err instanceof ZzapRateLimitException)) throw err
      logger.warn({ err, codeObject: input.auth.codeObject }, "zzap poll: rate limited, stopping early")
      rateLimited = true
      if (!entry) cursor.threads[userKey] = { lastDate: previousSince, lastPreview: "" }
      continue
    }
    fetched += 1
    const lowerBound = entry?.lastDate ?? previousSince
    let lastDate = entry?.lastDate ?? ""
    for (const message of messages) {
      if (message.message_date > lastDate) lastDate = message.message_date
      if (message.user_key !== userKey || !message.message?.trim() || message.message_date < lowerBound) continue
      events.push({
        kind: "message",
        sourceId: makeZzapMessageId({ userKey, messageDate: message.message_date, senderKey: message.user_key, message: message.message }),
        userKey,
        userName: thread.user_name ?? message.user_name ?? "",
        messageDate: message.message_date,
        text: message.message,
        buyer: null,
      })
    }
    cursor.threads[userKey] = { lastDate: lastDate || (thread.message_last_date ?? ""), lastPreview: thread.message_last ?? "" }
  }

  const usersWithEvents = [...new Set(events.map((event) => event.userKey))]
  for (const userKey of usersWithEvents) {
    if (rateLimited) break
    const stamp = cursor.buyers[userKey]
    if (stamp && now.getTime() - Date.parse(stamp) < BUYER_REFRESH_MS) continue
    try {
      const buyer = await enrichBuyer(input.auth, userKey, events.filter((e) => e.userKey === userKey).map((e) => e.text))
      cursor.buyers[userKey] = now.toISOString()
      for (const event of events) if (event.userKey === userKey) event.buyer = buyer
    } catch (err) {
      logger.warn({ err, codeObject: input.auth.codeObject }, "zzap poll: buyer enrichment failed")
      if (err instanceof ZzapRateLimitException) rateLimited = true
    }
  }

  const cutoff = formatMoscowDate(new Date(now.getTime() - RETENTION_MS))
  for (const [key, entry] of Object.entries(cursor.threads)) if (entry.lastDate && entry.lastDate < cutoff) delete cursor.threads[key]
  for (const [key, stamp] of Object.entries(cursor.buyers)) if (now.getTime() - Date.parse(stamp) > RETENTION_MS) delete cursor.buyers[key]

  return {
    events: events.map((payload) => ({ payload })),
    cursor: { since: nextSince, threads: cursor.threads, buyers: cursor.buyers },
  }
}
```

- [ ] **Step 3: Run tests** → PASS; `pnpm fix`; tsc → PASS.

- [ ] **Step 4: Commit**

```bash
git add integrations/zzap/src/handlers/poll.ts integrations/zzap/src/handlers/event.ts integrations/zzap/__tests__/poll.test.ts
git commit -m "feat(zzap): poll ZZAP threads with a per-thread cursor and buyer enrichment"
```

---

### Task 7: ZZAP message handlers, integration definition and provider registration

**Files:**
- Create: `integrations/zzap/src/handlers/message/{incoming-message.ts,outgoing-message.ts,to-zzap-text.ts,index.ts}`, `src/handlers/conversation.ts` (copy of max with typing a no-op returning `undefined` if the SDK handler is optional — check `integrations/max/src/handlers/conversation.ts`; omit the file if conversation handlers are optional), `src/integration.ts`, `src/index.ts`
- Modify: `packages/business/src/connection/store-bindings-channels.ts`, `packages/connections/src/registry.ts`, `packages/channel-registry/src/registry.ts`, `package.json` of connections / channel-registry / builder / worker (dep `@chatbotx.io/integration-zzap`)
- Test: `integrations/zzap/__tests__/{incoming-message.test.ts,to-zzap-text.test.ts,send.test.ts,integration.test.ts}`

**Interfaces:**
- Consumes: Tasks 5–6.
- Produces: `integration` (`Integration<IntegrationDefinition<ZzapConfig, ZzapAuthValue>>`) with `connection.poll = { intervalSeconds: (auth) => auth.pollIntervalSeconds, run: pollZzap }`; `toZzapText(step)`; `fromCredentials(input: { secretText: string; codeObject: string; typeObject: string; testMode?: boolean; pollIntervalSeconds?: number; maxThreadsPerPoll?: number; requestMinIntervalSeconds?: number })`.

- [ ] **Step 1: Failing tests.**

```ts
// to-zzap-text.test.ts
// sendText "Привет" with buttons [{title:"Да"},{title:"Нет"}] → "Привет\n\n1. Да\n2. Нет"
// sendQuickReply same shape → numbered list
// sendImage {url} with caption → "caption\nhttps://…/a.jpg"; sendFile → "📎 name\nurl"
// text longer than 4000 → split at paragraph boundary into ≤4000 chunks (reuse the MAX splitter: grep -n "export const split" integrations/max/src)
// incoming-message.test.ts
// payload event with text "Вот [img]https://zzap.ru/a.jpg[/img]" → message.text "Вот", 1 attachment uploaded via ctx.uploader.putObject (fetch mocked with msw), contact { sourceId:"A", firstName:"Иван", phoneNumber:"+7999…", email:"a@b.c" } when buyer present
// media URL on a foreign host → no download, text keeps "📎 a.jpg\nhttps://evil…"? → assert attachment list empty and URL kept in text
// message.sourceId === event.sourceId; invalid payload → throws ZzapException
// send.test.ts (msw): sendFlowStep posts one message per chunk to /api/client/v1/messages with code_object/type_object/test query, returns sourceIds "zzap-out:…"
//   401 from ZZAP → mapped ChannelError category auth (via mapToChannelError)
// integration.test.ts
// connection.startsPaused === true; connection.poll.intervalSeconds(auth) === 180 by default
// fromCredentials: listThreads mocked → returns auth with defaults applied, requestMinIntervalSeconds floored to 3; describe(auth) → { sourceId: "42", displayName: "ZZAP 42" }
// fromCredentials when listThreads rejects 401 → rejects
```

- [ ] **Step 2: Implement.**
  - `to-zzap-text.ts`: one function `toZzapTexts(step): string[]` handling `sendText`, `sendQuickReply`, `sendImage`, `sendFile` (step shapes: read `integrations/max/src/handlers/message/to-max-messages.ts` for the exact step field names and mirror them); buttons/quick replies → `${index + 1}. ${title}` lines; then split each text by the 4000 limit.
  - `outgoing-message.ts`: copy the structure of `integrations/max/src/handlers/message/outgoing-message.ts` (`ChannelSendFlowStepProps<ZzapAuthValue>`), replacing the delivery with `for (const text of toZzapTexts(step)) results.push(await sendZzapMessage(ctx.auth, { userKey: contact.sourceId, text }))`, errors through `mapToChannelError`. `sendMessage` (inbox reply) sends `message.text` plus attachment URLs as text lines.
  - `incoming-message.ts`: `parseZzapEvent(data.payload)`; `parseZzapMedia(event.text)`; download media only if `isAllowedZzapFileUrl` (same `storeMedia` as MAX); otherwise append `📎 ${filename}\n${url}` to the text. Contact:

```ts
const contact: IncomingContact = {
  sourceId: event.userKey,
  ...(event.buyer?.name || event.userName ? { firstName: event.buyer?.name || event.userName } : {}),
  ...(event.buyer?.phone ? { phoneNumber: event.buyer.phone } : {}),
  ...(event.buyer?.email ? { email: event.buyer.email } : {}),
}
```

    Return `{ message: { sourceId: event.sourceId, messageType: incoming, contentType: text, text, attachments }, contact, postbackAction: null, quickReplyAction: null, ref: null }`.
  - `integration.ts`:

```ts
const withDefaults = (input: ZzapCredentialsInput): ZzapAuthValue => ({
  authType: "secretText",
  secretText: input.secretText.trim(),
  codeObject: input.codeObject.trim(),
  typeObject: input.typeObject.trim(),
  testMode: input.testMode ?? false,
  pollIntervalSeconds: input.pollIntervalSeconds ?? ZZAP_DEFAULTS.pollIntervalSeconds,
  maxThreadsPerPoll: Math.max(1, input.maxThreadsPerPoll ?? ZZAP_DEFAULTS.maxThreadsPerPoll),
  requestMinIntervalSeconds: Math.max(
    ZZAP_MIN_REQUEST_INTERVAL_SECONDS,
    input.requestMinIntervalSeconds ?? ZZAP_DEFAULTS.requestMinIntervalSeconds,
  ),
})

const config: IntegrationDefinition<ZzapConfig, ZzapAuthValue> = {
  name: "zzap",
  channels: { channel: { message: messageHandlers, conversation: conversationHandlers } },
  connection: {
    kind: "channel",
    strategy: "api_key",
    multiAccount: false,
    startsPaused: true,
    configFields: [
      { name: "secretText", type: "secret", required: true },
      { name: "codeObject", type: "string", required: true },
      { name: "typeObject", type: "string", required: true },
      { name: "testMode", type: "boolean", required: false },
      { name: "pollIntervalSeconds", type: "number", required: false },
      { name: "maxThreadsPerPoll", type: "number", required: false },
      { name: "requestMinIntervalSeconds", type: "number", required: false },
    ],
    describe: (auth) => ({ sourceId: auth.codeObject, displayName: `ZZAP ${auth.codeObject}` }),
    fromCredentials: async (input: ZzapCredentialsInput) => {
      const auth = withDefaults(input)
      await listThreads(auth, { pageSize: 1 })
      return auth
    },
    verify: async ({ auth }) =>
      await probeVerify(() => listThreads(auth, { pageSize: 1 }), {
        label: "ZZAP API key",
        isRevoked: isRevokedTokenError,
      }),
    isRevokedTokenError,
    poll: { intervalSeconds: (auth) => auth.pollIntervalSeconds, run: pollZzap },
  },
  actions: {},
  handleRequest: async (props) => {
    throw new ZzapAPIException(`${props.req.method} ${props.req.url} is not implemented`)
  },
  disconnect: async () => undefined,
}
export const integration = new Integration<IntegrationDefinition<ZzapConfig, ZzapAuthValue>>(config)
```

    If `strategy: "api_key"` makes `startConnect` expect a different config shape than `token`, use `"token"` like MAX (check `packages/connections/src/registry.ts` `fromIntegration` / `connect-flow.ts`). `poll.run` signature: `run: ({ auth, cursor }) => pollZzap({ auth, cursor })`.
  - `src/index.ts`: `export { integration } from "./integration"`, `export { parseZzapEvent } from "./handlers/event"`, `export type { ZzapAuthValue, ZzapConfig } from "./schema"`.
  - Registrations (copy each `max` entry, value `zzap`):
    - `store-bindings-channels.ts`: `zzap: makeChannelBinding({ table: integrationZzapModel, tableName: "IntegrationZzap", identityColumn: "codeObject", onDisconnect: "delete_row", duplicateConstraint: "IntegrationZzap_codeObject_key", sealAuth: true })`
    - `connections/src/registry.ts`: `zzap: fromIntegration(integrationZzap, "zzap")`
    - `channel-registry/src/registry.ts`: integrations map `zzap: integrationZzap`; `case "zzap": { modelName = "IntegrationZzap"; columnName = "codeObject"; break }`; `integrationTableByChannel.zzap = "IntegrationZzap"`.
    - `CI=true pnpm install --no-frozen-lockfile`.

- [ ] **Step 3: Run** `integrations/zzap` tests, `packages/connections`, `packages/channel-registry`, `packages/business` tests and their tsc → PASS. Run the Task 2 `listPollProviders` expectation again: it must now return `["zzap"]`.

- [ ] **Step 4: Commit**

```bash
git add integrations/zzap packages/business/src/connection/store-bindings-channels.ts packages/connections/src/registry.ts packages/connections/package.json packages/channel-registry/src/registry.ts packages/channel-registry/package.json apps/builder/package.json apps/worker/package.json pnpm-lock.yaml
git commit -m "feat(zzap): add ZZAP message handlers and register the polling channel provider"
```

---

### Task 8: Business service, builder actions, settings UI, translations

Mirror Plan 1 Tasks for MAX (`packages/business/src/integration-max/`, `apps/builder/src/features/integration-max/`, `settings/channels/max/page.tsx`, create page). Rename `max`→`zzap`, `Max`→`Zzap`, `botId`→`codeObject`.

**Files:**
- Create: `packages/business/src/integration-zzap/{service.ts,index.ts,__tests__/service.test.ts}`; Modify `packages/business/src/index.ts`
- Create: `apps/builder/src/features/integration-zzap/{schema/request.ts,lib/zzap-connection.ts,actions/connect.action.ts,actions/set-enabled.action.ts,actions/disconnect.action.ts,queries/index.ts,components/zzap-connect.tsx,components/zzap-enabled-switch.tsx,components/zzap-disconnect.tsx,zzap-manage.tsx}`
- Create: `apps/builder/src/app/space/[workspaceId]/(settings)/settings/channels/zzap/page.tsx`
- Modify: `apps/builder/src/app/(no-sidebar)/channels/create/page.tsx` (ZzapConnect branch; `WORKSPACE_REQUIRED_CHANNELS = ["max", "zzap"]`)
- Modify: `apps/builder/__tests__/api-parity-manifest.json` (3 entries `covered:connections`, in place next to the MAX ones)
- Create: `apps/builder/__tests__/integration-zzap-actions.test.ts` (copy of `integration-max-actions.test.ts`)
- Modify: 21 × `apps/builder/messages/*.json` (`fields.zzap.*`)

**Interfaces:**
- Produces: `zzapIntegrationService.listByWorkspace(workspaceId): Promise<ZzapChannelRow[]>` where

```ts
export type ZzapChannelRow = {
  id: string
  inboxId: string
  codeObject: string
  name: string
  connection: { id: string; status: ConnectionStatus; statusReason: ConnectionStatusReason | null; lastError: string | null } | null
  lastPolledAt: Date | null
  lastSucceededAt: Date | null
}
```

(`lastPolledAt`/`lastSucceededAt` from `connectionPollStateRepository.find(connection.id)`.)

- [ ] **Step 1: Service test + implementation** — copy `packages/business/src/integration-max/service.ts` `listByWorkspace`, add `lastError` to the connection projection and the poll-state lookup; drop `findByBotIdWithAuth` (ZZAP has no webhook). Test: row without connection → `connection: null, lastPolledAt: null`; row with connection + state → fields mapped.

- [ ] **Step 2: Builder.**
  - `schema/request.ts`:

```ts
export const connectZzapRequest = z.object({
  secretText: z.string().trim().min(1),
  codeObject: z.string().trim().min(1),
  typeObject: z.string().trim().min(1),
  testMode: z.boolean().default(false),
})
export const setZzapEnabledRequest = z.object({ connectionId: z.string(), enabled: z.boolean() })
```

  - `lib/zzap-connection.ts`: `connectZzap` = MAX `connectMax` with `provider: "zzap"` and `config: input`; `setZzapEnabled`, `disconnectZzap` identical to MAX with audit detail `"zzap"`.
  - Actions/queries/components: same as MAX. `zzap-connect.tsx` form fields: API key (`InputField type="password"`, `fields.zzap.apiKey`), code object (`fields.zzap.codeObject`), type object (`fields.zzap.typeObject`), test mode switch (`fields.zzap.testMode`, hint `fields.zzap.testModeHint`), instructions `fields.zzap.connectInstructions.step1..2`.
  - `zzap-manage.tsx`: MAX table + two columns: last poll (`fields.zzap.lastPolledAt`, formatted with the builder's date formatter used elsewhere in settings tables — `grep -rn "useFormatter" apps/builder/src/features/integration-telegram` or the nearest settings table) and last error (`fields.zzap.lastError`, `connection.lastError ?? "—"`). Status labels reuse the `statusLabelKey` map pattern with `fields.zzap.status.*`.
- [ ] **Step 3: i18n.** Keys under `fields.zzap` (en text; other 20 locales get the same English text, `ru` arrives in Plan 5): `label` (exists), `apiKey: "API key"`, `codeObject: "Object code (code_object)"`, `typeObject: "Object type (type_object)"`, `testMode: "Test mode"`, `testModeHint: "Replies are sent with test=true and are not delivered to buyers."`, `connectInstructions.step1: "In the ZZAP seller account open B52 API settings and copy the API key."`, `connectInstructions.step2: "Enter the object code and type of your shop. The channel is created switched off."`, `enabled: "Enabled"`, `enabledHint: "While switched off ChatbotX does not poll ZZAP, so another system can serve this shop."`, `status.{connected,paused,needs_reauth,degraded,disconnected}` (copy MAX texts), `switchedOn: "ZZAP channel switched on"`, `switchedOff: "ZZAP channel switched off"`, `lastPolledAt: "Last poll"`, `lastError: "Last error"`. Insert with the same node script as Task 4 (`ins(j.fields, "zzap", ...)` → merge into the existing `fields.zzap` object). `pnpm --filter builder i18n:check` → PASS.
- [ ] **Step 4: Tests** `cd apps/builder && pnpm vitest run __tests__/integration-zzap-actions.test.ts __tests__/api-parity*.test.ts __tests__/i18n-messages.test.ts` → PASS; builder tsc → PASS.
- [ ] **Step 5: Commit** (explicit file list)

```bash
git commit -m "feat(zzap): add ZZAP channel settings with connect form, on/off switch and poll status"
```

---

### Task 9: Verification and docs

- [ ] **Step 1:** `pnpm --filter chatbotx` CLI/MCP need no code change (connections routes already exist); update `apps/cli/README.md` `### connections` example list with a ZZAP `connections create` example: `chatbotx connections create --provider zzap --config '{"secretText":"…","codeObject":"…","typeObject":"…"}'` (check the README's existing create example syntax and match it).
- [ ] **Step 2:** Run `pnpm exec ultracite check apps packages integrations` (tracked dirs only), tsc for `apps/builder`, `apps/worker`, `packages/business`, `packages/connections`, `packages/channel-registry`, `integrations/zzap` (two at a time), tests for those workspaces + `packages/flow-config`, `packages/utils`, `apps/cli`.
- [ ] **Step 3:** Dispatch `invariant-guard` on the branch diff since the Plan 1 tip (`4fbbdef0e..HEAD`); fix findings.
- [ ] **Step 4:** Show the user both generated migrations (`connection_poll_state`, `integration_zzap`) and ask for approval before `pnpm --filter @chatbotx.io/database db:migrate`.
- [ ] **Step 5:** After approval and migration: start `apps/builder` dev, sign in with the test user, screenshot `settings/channels/zzap` and the create page with Playwright (`/tmp/pw/shot.mjs`), confirm the empty state and the form render. Do not connect a real key.
- [ ] **Step 6:** Update `.superpowers/sdd/progress.md` ("PLAN 2 COMPLETE — next: Plan 3 (DROM)") and commit docs.
