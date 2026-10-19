import { beforeEach, describe, expect, test, vi } from "vitest"
import { sealAuth } from "../../connection/sealed-auth"

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findMany: vi.fn(),
  findByInboxId: vi.fn(),
}))

vi.mock("@chatbotx.io/database/client", () => ({
  db: {
    query: {
      integrationMaxModel: {
        findFirst: (...args: unknown[]) => mocks.findFirst(...args),
        findMany: (...args: unknown[]) => mocks.findMany(...args),
      },
    },
  },
}))

vi.mock("@chatbotx.io/database/repositories", () => ({
  connectionRepository: {
    findByInboxId: (...args: unknown[]) => mocks.findByInboxId(...args),
  },
}))

const { maxIntegrationService } = await import("../service")

const auth = {
  authType: "secretText" as const,
  secretText: "max-token",
  botId: "777",
  botName: "@gkamion_bot",
  webhookSecret: "hook-secret",
}

const baseRow = {
  id: "int-1",
  botId: "777",
  name: "@gkamion_bot",
  workspaceId: "ws-1",
  inboxId: "inbox-1",
  createdAt: new Date("2026-10-19T00:00:00Z"),
  updatedAt: new Date("2026-10-19T00:00:00Z"),
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("maxIntegrationService.findByBotIdWithAuth", () => {
  test("opens the sealed auth of the bot", async () => {
    mocks.findFirst.mockResolvedValue({
      ...baseRow,
      auth: await sealAuth(auth),
    })

    const found = await maxIntegrationService.findByBotIdWithAuth("777")

    expect(mocks.findFirst).toHaveBeenCalledWith({ where: { botId: "777" } })
    expect(found?.row.inboxId).toBe("inbox-1")
    expect(found?.auth).toEqual(auth)
  })

  test("returns null for an unknown bot", async () => {
    mocks.findFirst.mockResolvedValue(undefined)

    await expect(
      maxIntegrationService.findByBotIdWithAuth("404"),
    ).resolves.toBeNull()
  })
})

describe("maxIntegrationService.listByWorkspace", () => {
  test("drops auth and adds the connection state", async () => {
    mocks.findMany.mockResolvedValue([
      { ...baseRow, auth: await sealAuth(auth) },
    ])
    mocks.findByInboxId.mockResolvedValue({
      id: "conn-1",
      status: "paused",
      statusReason: "user_paused",
      inboxId: "inbox-1",
    })

    const rows = await maxIntegrationService.listByWorkspace("ws-1")

    expect(mocks.findMany).toHaveBeenCalledWith({
      where: { workspaceId: "ws-1" },
      orderBy: { createdAt: "asc" },
    })
    expect(mocks.findByInboxId).toHaveBeenCalledWith({ inboxId: "inbox-1" })
    expect(rows).toEqual([
      {
        ...baseRow,
        connection: {
          id: "conn-1",
          status: "paused",
          statusReason: "user_paused",
        },
      },
    ])
    expect(rows[0]).not.toHaveProperty("auth")
  })

  test("a row without a connection reports null", async () => {
    mocks.findMany.mockResolvedValue([{ ...baseRow, auth: {} }])
    mocks.findByInboxId.mockResolvedValue(undefined)

    const rows = await maxIntegrationService.listByWorkspace("ws-1")

    expect(rows[0]?.connection).toBeNull()
  })
})
