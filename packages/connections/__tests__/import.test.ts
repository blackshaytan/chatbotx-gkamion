import { beforeEach, describe, expect, test, vi } from "vitest"
import { importFromAuth } from "../src/import"

const mocks = vi.hoisted(() => ({
  resolveAdapter: vi.fn(),
  connectAndPersist: vi.fn(),
  findByProviderSourceId: vi.fn(),
  upsertPollState: vi.fn(async () => undefined),
  saveAuthByForeignKey: vi.fn(async () => true),
  fromCredentials: vi.fn(),
  subscribe: vi.fn(),
}))

vi.mock("@chatbotx.io/business/connection", () => ({
  isActiveConnectionStatus: (status: string) =>
    status === "connected" || status === "degraded",
  resolveForeignKey: (connection: { inboxId: string | null }) =>
    connection.inboxId,
  resolveOwnerId: vi.fn(async () => "owner-1"),
}))

vi.mock("@chatbotx.io/business/errors", () => ({
  connectionNotConfiguredException: vi.fn(() => new Error("not configured")),
  connectionNotPausableException: vi.fn(() => new Error("not pausable")),
}))

vi.mock("@chatbotx.io/database/repositories", () => ({
  connectionRepository: {
    findByProviderSourceId: mocks.findByProviderSourceId,
  },
  connectionPollStateRepository: { upsert: mocks.upsertPollState },
}))

vi.mock("../src/internal", () => ({
  connectAndPersist: mocks.connectAndPersist,
  resolveAdapter: mocks.resolveAdapter,
}))

const auth = {
  authType: "secretText" as const,
  secretText: "cookie",
  sellerLogin: "seller",
}
const cursor = { dialogs: { "1": { lastInboundId: "5" } } }

const adapterFor = (overrides: Record<string, unknown> = {}) => ({
  provider: {
    kind: "channel",
    startsPaused: true,
    describe: (value: typeof auth) => ({
      sourceId: value.sellerLogin,
      displayName: `DROM ${value.sellerLogin}`,
    }),
    fromCredentials: mocks.fromCredentials,
    webhook: { subscribe: mocks.subscribe },
    poll: { intervalSeconds: () => 30 },
    ...overrides,
  },
  store: { saveAuthByForeignKey: mocks.saveAuthByForeignKey },
})

const connection = (status: string) => ({
  id: "conn-1",
  workspaceId: "ws-1",
  inboxId: "inbox-1",
  status,
})

const run = (pollCursor?: Record<string, unknown> | null) =>
  importFromAuth({
    workspaceId: "ws-1",
    provider: "drom",
    auth,
    pollCursor,
  })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.resolveAdapter.mockReturnValue(adapterFor())
  mocks.connectAndPersist.mockResolvedValue(connection("paused"))
})

describe("importFromAuth", () => {
  test("creates a new connection paused and writes the cursor, without probing", async () => {
    mocks.findByProviderSourceId.mockResolvedValue(undefined)

    const result = await run(cursor)

    expect(result.outcome).toBe("created")
    expect(result.connection.status).toBe("paused")
    expect(mocks.fromCredentials).not.toHaveBeenCalled()
    expect(mocks.subscribe).not.toHaveBeenCalled()
    expect(mocks.connectAndPersist).toHaveBeenCalledWith(
      expect.objectContaining({
        auth,
        existing: undefined,
        ownerId: "owner-1",
        descriptor: { sourceId: "seller", displayName: "DROM seller" },
      }),
    )
    expect(mocks.upsertPollState).toHaveBeenCalledWith({
      connectionId: "conn-1",
      workspaceId: "ws-1",
      intervalSeconds: 30,
      cursor,
    })
  })

  test("revives a paused connection and resets its cursor to null", async () => {
    mocks.findByProviderSourceId.mockResolvedValue(connection("paused"))

    const result = await run(null)

    expect(result.outcome).toBe("revived")
    expect(mocks.connectAndPersist).toHaveBeenCalledWith(
      expect.objectContaining({ existing: connection("paused") }),
    )
    expect(mocks.upsertPollState).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: null }),
    )
  })

  test("leaves the cursor alone when none is passed", async () => {
    mocks.findByProviderSourceId.mockResolvedValue(undefined)

    await run()

    expect(mocks.upsertPollState).not.toHaveBeenCalled()
  })

  test("only replaces the auth of an active connection", async () => {
    mocks.findByProviderSourceId.mockResolvedValue(connection("connected"))

    const result = await run(cursor)

    expect(result).toEqual({
      connection: connection("connected"),
      outcome: "updatedAuth",
    })
    expect(mocks.saveAuthByForeignKey).toHaveBeenCalledWith(
      "inbox-1",
      "ws-1",
      auth,
    )
    expect(mocks.connectAndPersist).not.toHaveBeenCalled()
    expect(mocks.upsertPollState).not.toHaveBeenCalled()
  })

  test("fails loudly when the active connection's satellite row is gone", async () => {
    mocks.findByProviderSourceId.mockResolvedValue(connection("connected"))
    mocks.saveAuthByForeignKey.mockResolvedValueOnce(false)

    await expect(run(cursor)).rejects.toThrow("did not match a satellite row")
  })

  test("refuses providers that would start active", async () => {
    mocks.resolveAdapter.mockReturnValue(adapterFor({ startsPaused: false }))

    await expect(run(cursor)).rejects.toThrow("not pausable")
    expect(mocks.findByProviderSourceId).not.toHaveBeenCalled()
  })
})
