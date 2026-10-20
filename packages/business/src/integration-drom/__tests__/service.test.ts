import { beforeEach, describe, expect, test, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  findByInboxId: vi.fn(),
  findPollState: vi.fn(),
}))

vi.mock("@chatbotx.io/database/client", () => ({
  db: {
    query: {
      integrationDromModel: {
        findMany: (...args: unknown[]) => mocks.findMany(...args),
      },
    },
  },
}))

vi.mock("@chatbotx.io/database/repositories", () => ({
  connectionRepository: {
    findByInboxId: (...args: unknown[]) => mocks.findByInboxId(...args),
  },
  connectionPollStateRepository: {
    find: (...args: unknown[]) => mocks.findPollState(...args),
  },
}))

const { dromIntegrationService } = await import("../service")

const baseRow = {
  id: "int-1",
  sellerLogin: "seller",
  name: "DROM seller",
  workspaceId: "ws-1",
  inboxId: "inbox-1",
  createdAt: new Date("2026-10-19T00:00:00Z"),
  updatedAt: new Date("2026-10-19T00:00:00Z"),
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("dromIntegrationService.listByWorkspace", () => {
  test("drops auth and adds the connection and poll state", async () => {
    const polledAt = new Date("2026-10-19T10:00:00Z")
    const succeededAt = new Date("2026-10-19T09:57:00Z")
    mocks.findMany.mockResolvedValue([{ ...baseRow, auth: { sealed: "x" } }])
    mocks.findByInboxId.mockResolvedValue({
      id: "conn-1",
      status: "connected",
      statusReason: null,
      lastError: "DROM API 500",
      inboxId: "inbox-1",
    })
    mocks.findPollState.mockResolvedValue({
      connectionId: "conn-1",
      lastPolledAt: polledAt,
      lastSucceededAt: succeededAt,
    })

    const rows = await dromIntegrationService.listByWorkspace("ws-1")

    expect(mocks.findMany).toHaveBeenCalledWith({
      where: { workspaceId: "ws-1" },
      orderBy: { createdAt: "asc" },
    })
    expect(mocks.findPollState).toHaveBeenCalledWith("conn-1")
    expect(rows).toEqual([
      {
        ...baseRow,
        connection: {
          id: "conn-1",
          status: "connected",
          statusReason: null,
          lastError: "DROM API 500",
        },
        lastPolledAt: polledAt,
        lastSucceededAt: succeededAt,
      },
    ])
    expect(rows[0]).not.toHaveProperty("auth")
  })

  test("a row without a connection has no poll state", async () => {
    mocks.findMany.mockResolvedValue([{ ...baseRow, auth: {} }])
    mocks.findByInboxId.mockResolvedValue(undefined)

    const rows = await dromIntegrationService.listByWorkspace("ws-1")

    expect(rows[0]).toMatchObject({
      connection: null,
      lastPolledAt: null,
      lastSucceededAt: null,
    })
    expect(mocks.findPollState).not.toHaveBeenCalled()
  })

  test("a connection that was never polled reports null times", async () => {
    mocks.findMany.mockResolvedValue([{ ...baseRow, auth: {} }])
    mocks.findByInboxId.mockResolvedValue({
      id: "conn-1",
      status: "paused",
      statusReason: "user_paused",
      lastError: null,
    })
    mocks.findPollState.mockResolvedValue(undefined)

    const rows = await dromIntegrationService.listByWorkspace("ws-1")

    expect(rows[0]).toMatchObject({ lastPolledAt: null, lastSucceededAt: null })
    expect(rows[0]?.connection?.lastError).toBeNull()
  })
})
