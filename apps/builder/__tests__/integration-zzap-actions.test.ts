import { beforeEach, describe, expect, test, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  startConnect: vi.fn(),
  resolvePlatformOwnerId: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  disconnect: vi.fn(),
  record: vi.fn(),
}))

vi.mock("@/features/connections/lib/connect-flow", () => ({
  startConnect: (...args: unknown[]) => mocks.startConnect(...args),
}))

vi.mock("@/lib/platform-credential-owner", () => ({
  resolvePlatformOwnerId: (...args: unknown[]) =>
    mocks.resolvePlatformOwnerId(...args),
}))

vi.mock("@chatbotx.io/connections", () => ({
  connectionService: {
    pause: (...args: unknown[]) => mocks.pause(...args),
    resume: (...args: unknown[]) => mocks.resume(...args),
    disconnect: (...args: unknown[]) => mocks.disconnect(...args),
  },
}))

vi.mock("@chatbotx.io/business/audit", () => ({
  auditService: { record: (...args: unknown[]) => mocks.record(...args) },
}))

const { connectZzap, disconnectZzap, setZzapEnabled } = await import(
  "@/features/integration-zzap/lib/zzap-connection"
)

const actor = { workspaceId: "ws-1", userId: "user-1" }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.resolvePlatformOwnerId.mockResolvedValue("owner-1")
})

describe("connectZzap", () => {
  test("connects through the shared connect flow and stays paused", async () => {
    mocks.startConnect.mockResolvedValue({
      connection: { id: "conn-1", status: "paused" },
      session: null,
    })

    const result = await connectZzap({
      ...actor,
      config: {
        secretText: "zzap-key",
        codeObject: "42",
        typeObject: "1",
        testMode: false,
      },
    })

    expect(mocks.resolvePlatformOwnerId).toHaveBeenCalledWith(actor)
    expect(mocks.startConnect).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      provider: "zzap",
      config: {
        secretText: "zzap-key",
        codeObject: "42",
        typeObject: "1",
        testMode: false,
      },
      redirectUrl: undefined,
      ownerId: "owner-1",
      actor: { actorUserId: "user-1" },
    })
    expect(result).toEqual({ connectionId: "conn-1", status: "paused" })
    expect(mocks.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "connect", ...actor }),
    )
  })
})

describe("setZzapEnabled", () => {
  test("enabled: true resumes the connection", async () => {
    mocks.resume.mockResolvedValue({ id: "conn-1", status: "connected" })

    const result = await setZzapEnabled({
      ...actor,
      connectionId: "conn-1",
      enabled: true,
    })

    expect(mocks.resume).toHaveBeenCalledWith({
      connectionId: "conn-1",
      workspaceId: "ws-1",
    })
    expect(mocks.pause).not.toHaveBeenCalled()
    expect(result).toEqual({ status: "connected" })
  })

  test("enabled: false pauses the connection", async () => {
    mocks.pause.mockResolvedValue({ id: "conn-1", status: "paused" })

    const result = await setZzapEnabled({
      ...actor,
      connectionId: "conn-1",
      enabled: false,
    })

    expect(mocks.pause).toHaveBeenCalledWith({
      connectionId: "conn-1",
      workspaceId: "ws-1",
    })
    expect(mocks.resume).not.toHaveBeenCalled()
    expect(result).toEqual({ status: "paused" })
  })
})

describe("disconnectZzap", () => {
  test("disconnects through the connection engine", async () => {
    mocks.disconnect.mockResolvedValue({ id: "conn-1" })

    await disconnectZzap({ ...actor, connectionId: "conn-1" })

    expect(mocks.disconnect).toHaveBeenCalledWith({
      connectionId: "conn-1",
      workspaceId: "ws-1",
    })
    expect(mocks.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "disconnect", ...actor }),
    )
  })
})
