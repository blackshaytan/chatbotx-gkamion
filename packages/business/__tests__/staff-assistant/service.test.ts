import { beforeEach, describe, expect, test, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  find: vi.fn(),
  token: vi.fn(),
  upsert: vi.fn(),
  updateCheck: vi.fn(),
  transaction: vi.fn(),
  encrypt: vi.fn(),
  decrypt: vi.fn(),
  withCache: vi.fn(),
  invalidate: vi.fn(),
  throttle: vi.fn(),
  health: vi.fn(),
}))
vi.mock("@chatbotx.io/database/client", () => ({
  db: { transaction: mocks.transaction },
}))
vi.mock("@chatbotx.io/database/repositories", () => ({
  externalAgentRepository: {
    findByWorkspace: mocks.find,
    upsert: mocks.upsert,
    updateCheck: mocks.updateCheck,
  },
  workspaceApiTokenRepository: { findScopesForWorkspace: mocks.token },
}))
vi.mock("@chatbotx.io/encryption", () => ({
  encryptUtils: { encryptObject: mocks.encrypt, decryptObject: mocks.decrypt },
}))
vi.mock("@chatbotx.io/redis", () => ({
  withCache: mocks.withCache,
  invalidateCacheByTags: mocks.invalidate,
  distributedStore: { setNumberIfNotExists: mocks.throttle },
}))
vi.mock("../../src/external-agent/hermes-client", () => ({
  createHermesClient: () => ({ health: mocks.health }),
}))
vi.mock("../../src/external-agent/service", () => ({
  normalizeExternalAgentBaseUrl: (url: string) => url.trim(),
  normalizeExternalAgentBotName: (name: string | null) => name?.trim() || null,
  describeExternalAgentCheckError: () => "check failed",
}))
vi.mock("../../src/logger", () => ({ logger: { warn: vi.fn() } }))

const { staffAssistantService } = await import(
  "../../src/staff-assistant/service"
)
const TX = { tx: true }
const KEY = { iv: "iv", tag: "tag", text: "ciphertext", v: 1 }
const agent = {
  workspaceId: "ws",
  purpose: "staff",
  enabled: true,
  baseUrl: "https://agent.example",
  apiKey: KEY,
  botName: "Assistant",
  maxRunMinutes: 30,
  apiTokenId: "token",
  lastCheckedAt: null,
  lastCheckStatus: null,
  lastCheckError: null,
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.find.mockResolvedValue(agent)
  mocks.token.mockResolvedValue({ scopes: ["chats"] })
  mocks.transaction.mockImplementation((fn) => fn(TX))
  mocks.withCache.mockImplementation((_key, fn) => fn())
  mocks.encrypt.mockResolvedValue(KEY)
  mocks.decrypt.mockResolvedValue({ apiKey: "secret" })
  mocks.throttle.mockResolvedValue(true)
  mocks.upsert.mockResolvedValue(agent)
})

describe("staff assistant settings", () => {
  test("does not expose the key and rechecks the token when reading", async () => {
    const result = await staffAssistantService.get("ws")
    expect(result).toMatchObject({
      hasApiKey: true,
      available: true,
      tokenHasChatsScope: true,
    })
    expect(result).not.toHaveProperty("apiKey")
    mocks.token.mockResolvedValue(null)
    expect(await staffAssistantService.get("ws")).toMatchObject({
      available: false,
      tokenHasChatsScope: false,
    })
  })

  test("requires an explicitly chat-scoped token, including for null scopes", async () => {
    mocks.token.mockResolvedValue({ scopes: null })
    await expect(
      staffAssistantService.update("ws", { enabled: true }),
    ).rejects.toMatchObject({ httpStatusCode: 400 })
    expect(mocks.upsert).not.toHaveBeenCalled()
  })

  test("requires an assistant name and rejects inbox settings", async () => {
    await expect(
      staffAssistantService.update("ws", { botName: "", enabled: true }),
    ).rejects.toMatchObject({ httpStatusCode: 400 })
    await expect(
      staffAssistantService.update("ws", { inboxIds: ["inbox"] } as never),
    ).rejects.toMatchObject({ httpStatusCode: 400 })
    expect(mocks.upsert).not.toHaveBeenCalled()
  })

  test("allows disabling after a token loses its chat scope", async () => {
    mocks.token.mockResolvedValue({ scopes: null })
    await expect(
      staffAssistantService.update("ws", { enabled: false }),
    ).resolves.toMatchObject({ available: false })
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        values: expect.objectContaining({ enabled: false }),
      }),
      TX,
    )
  })

  test("uses a staff-specific encryption domain and locks token on binding", async () => {
    await staffAssistantService.update("ws", {
      apiKey: "new secret",
      apiTokenId: "token",
    })
    expect(mocks.encrypt).toHaveBeenCalledWith(
      { apiKey: "new secret" },
      "external-agent:ws:staff",
    )
    expect(mocks.token).toHaveBeenCalledWith(
      { workspaceId: "ws", id: "token", lock: true },
      TX,
    )
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "ws", purpose: "staff" }),
      TX,
    )
  })

  test("runtime refuses a revoked token and decrypts with staff AAD", async () => {
    expect(await staffAssistantService.getRuntime("ws")).not.toBeNull()
    expect(mocks.decrypt).toHaveBeenCalledWith(
      KEY,
      expect.anything(),
      "external-agent:ws:staff",
    )
    mocks.token.mockResolvedValue(null)
    expect(await staffAssistantService.getRuntime("ws")).toBeNull()
  })

  test("throttles connection checks separately for staff", async () => {
    await expect(staffAssistantService.test("ws")).resolves.toMatchObject({
      status: "ok",
    })
    expect(mocks.throttle).toHaveBeenCalledWith(
      "externalAgent:test:ws:staff",
      1,
      10,
    )
    expect(mocks.updateCheck).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "ws", purpose: "staff" }),
    )
    mocks.throttle.mockResolvedValue(false)
    await expect(staffAssistantService.test("ws")).rejects.toMatchObject({
      httpStatusCode: 429,
    })
  })
})
