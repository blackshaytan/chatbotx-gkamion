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
    connectionCredentialsRejectedException: vi.fn(() => new Error("rejected")),
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
  mocks.unsubscribe.mockResolvedValue(undefined)
  mocks.subscribe.mockResolvedValue(undefined)
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
