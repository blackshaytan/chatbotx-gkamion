import { beforeEach, describe, expect, test, vi } from "vitest"
import { listDuePolls, listPollProviders, runPoll } from "../src/poll"

const mocks = vi.hoisted(() => ({
  findOrThrow: vi.fn(),
  resolveAdapter: vi.fn(),
  resolveForeignKey: vi.fn(() => "inbox-1"),
  resolveOwnerId: vi.fn(async () => "owner-1"),
  markUnhealthy: vi.fn(),
  update: vi.fn(),
  find: vi.fn(),
  upsert: vi.fn(),
  listDue: vi.fn(),
  loadAuthByForeignKey: vi.fn(),
  run: vi.fn(),
  enqueue: vi.fn(),
  registry: {} as Record<string, unknown>,
}))

vi.mock("@chatbotx.io/business/connection", () => ({
  connectionStateService: { markUnhealthy: mocks.markUnhealthy },
  resolveForeignKey: mocks.resolveForeignKey,
  resolveOwnerId: mocks.resolveOwnerId,
}))

vi.mock("@chatbotx.io/business/errors", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@chatbotx.io/business/errors")>()
  return { toPublicErrorMessage: actual.toPublicErrorMessage }
})

vi.mock("@chatbotx.io/database/repositories", () => ({
  connectionRepository: { update: mocks.update },
  connectionPollStateRepository: {
    find: mocks.find,
    upsert: mocks.upsert,
    listDue: mocks.listDue,
  },
}))

vi.mock("../src/internal", () => ({
  findOrThrow: mocks.findOrThrow,
  resolveAdapter: mocks.resolveAdapter,
}))

vi.mock("../src/registry", () => ({ CONNECTION_REGISTRY: mocks.registry }))

vi.mock("../src/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))

const now = new Date("2026-10-19T12:00:00Z")
const auth = { authType: "secretText", secretText: "k", codeObject: "42" }
const adapter = {
  provider: {
    describe: () => ({ sourceId: "42", displayName: "ZZAP 42" }),
    isRevokedTokenError: (err: unknown) =>
      err instanceof Error && err.message === "revoked",
    poll: { intervalSeconds: () => 180, run: mocks.run },
  },
  store: { loadAuthByForeignKey: mocks.loadAuthByForeignKey },
}
const connection = {
  id: "c1",
  workspaceId: "w1",
  provider: "zzap",
  status: "connected",
  inboxId: "inbox-1",
  integrationId: null,
  lastError: null,
}
const ref = { connectionId: "c1", workspaceId: "w1", now }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.findOrThrow.mockResolvedValue(connection)
  mocks.resolveAdapter.mockReturnValue(adapter)
  mocks.loadAuthByForeignKey.mockResolvedValue(auth)
  mocks.find.mockResolvedValue({ cursor: { n: 0 } })
  mocks.enqueue.mockResolvedValue(undefined)
  for (const key of Object.keys(mocks.registry)) {
    delete mocks.registry[key]
  }
})

describe("runPoll", () => {
  test("skips a connection that is not connected", async () => {
    mocks.findOrThrow.mockResolvedValue({ ...connection, status: "paused" })
    const result = await runPoll({ ...ref, enqueue: mocks.enqueue })
    expect(result).toEqual({ status: "skipped", reason: "not_connected" })
    expect(mocks.run).not.toHaveBeenCalled()
  })

  test("skips a provider without poll", async () => {
    mocks.resolveAdapter.mockReturnValue({
      ...adapter,
      provider: { ...adapter.provider, poll: undefined },
    })
    const result = await runPoll({ ...ref, enqueue: mocks.enqueue })
    expect(result).toEqual({ status: "skipped", reason: "not_pollable" })
  })

  test("enqueues every event, then saves the cursor", async () => {
    mocks.run.mockResolvedValue({
      events: [{ payload: { a: 1 } }, { payload: { a: 2 } }],
      cursor: { n: 1 },
    })
    const result = await runPoll({ ...ref, enqueue: mocks.enqueue })

    expect(result).toEqual({ status: "ok", events: 2 })
    expect(mocks.run).toHaveBeenCalledWith({ auth, cursor: { n: 0 } })
    expect(mocks.enqueue).toHaveBeenNthCalledWith(1, {
      integrationType: "zzap",
      integrationIdentifier: "42",
      payload: { a: 1 },
    })
    expect(mocks.upsert).toHaveBeenNthCalledWith(1, {
      connectionId: "c1",
      workspaceId: "w1",
      intervalSeconds: 180,
      lastPolledAt: now,
    })
    expect(mocks.upsert).toHaveBeenLastCalledWith({
      connectionId: "c1",
      workspaceId: "w1",
      cursor: { n: 1 },
      lastSucceededAt: now,
    })
    const lastEnqueue = mocks.enqueue.mock.invocationCallOrder[1]
    const cursorWrite = mocks.upsert.mock.invocationCallOrder[1]
    expect(cursorWrite).toBeGreaterThan(lastEnqueue ?? 0)
  })

  test("does not save the cursor when enqueueing fails", async () => {
    mocks.run.mockResolvedValue({
      events: [{ payload: 1 }, { payload: 2 }],
      cursor: { n: 1 },
    })
    mocks.enqueue
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("redis down"))
    await expect(runPoll({ ...ref, enqueue: mocks.enqueue })).rejects.toThrow(
      "redis down",
    )
    expect(mocks.upsert).toHaveBeenCalledTimes(1)
  })

  test("marks the connection unhealthy on a revoked credential", async () => {
    mocks.run.mockRejectedValue(new Error("revoked"))
    const result = await runPoll({ ...ref, enqueue: mocks.enqueue })
    expect(result).toEqual({ status: "revoked" })
    expect(mocks.markUnhealthy).toHaveBeenCalledWith({
      connectionId: "c1",
      ownerId: "owner-1",
    })
  })

  test("records lastError and rethrows other failures", async () => {
    mocks.run.mockRejectedValue(new Error("boom"))
    await expect(runPoll({ ...ref, enqueue: mocks.enqueue })).rejects.toThrow(
      "boom",
    )
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "c1",
        workspaceId: "w1",
        values: { lastError: expect.any(String) },
      }),
    )
  })

  test("clears a previous lastError after a successful poll", async () => {
    mocks.findOrThrow.mockResolvedValue({ ...connection, lastError: "old" })
    mocks.run.mockResolvedValue({ events: [], cursor: {} })
    await runPoll({ ...ref, enqueue: mocks.enqueue })
    expect(mocks.update).toHaveBeenCalledWith({
      id: "c1",
      workspaceId: "w1",
      values: { lastError: null },
    })
  })
})

describe("listDuePolls", () => {
  test("asks only for providers that declare poll", async () => {
    mocks.registry.zzap = adapter
    mocks.registry.max = { provider: { describe: vi.fn() } }
    mocks.registry.metaCatalog = null
    mocks.listDue.mockResolvedValue([{ connectionId: "c1", workspaceId: "w1" }])

    expect(listPollProviders()).toEqual(["zzap"])
    await expect(listDuePolls(now)).resolves.toEqual([
      { connectionId: "c1", workspaceId: "w1" },
    ])
    expect(mocks.listDue).toHaveBeenCalledWith({
      providers: ["zzap"],
      now,
      defaultIntervalSeconds: 60,
    })
  })
})
