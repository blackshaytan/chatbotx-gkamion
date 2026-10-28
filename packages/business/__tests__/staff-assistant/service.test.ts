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
  openAgentChannel: vi.fn(),
  lockWorkspaceTokens: vi.fn(),
  findStaffAvailability: vi.fn(),
  findChat: vi.fn(),
  listMembers: vi.fn(),
  insertMessage: vi.fn(),
  touchLastMessage: vi.fn(),
  findStateForUpdate: vi.fn(),
  available: vi.fn(),
  deliver: vi.fn(),
  publish: vi.fn(),
  isMember: vi.fn(),
  sendToMember: vi.fn(),
  enqueue: vi.fn(),
}))
vi.mock("@chatbotx.io/database/client", () => ({
  db: { transaction: mocks.transaction },
}))
vi.mock("@chatbotx.io/database/repositories", () => ({
  externalAgentRepository: {
    findByWorkspace: mocks.find,
    upsert: mocks.upsert,
    updateCheck: mocks.updateCheck,
    findStaffAvailability: mocks.findStaffAvailability,
  },
  workspaceApiTokenRepository: {
    findScopesForWorkspace: mocks.token,
    lockWorkspaceTokens: mocks.lockWorkspaceTokens,
  },
  chatRepository: {
    findAccessible: mocks.findChat,
    listMembers: mocks.listMembers,
    touchLastMessage: mocks.touchLastMessage,
  },
  internalThreadRepository: { insertDeduplicatedMessage: mocks.insertMessage },
  externalAgentChatStateRepository: { findForUpdate: mocks.findStateForUpdate },
}))
vi.mock("@chatbotx.io/encryption", () => ({
  encryptUtils: { encryptObject: mocks.encrypt, decryptObject: mocks.decrypt },
}))
vi.mock("@chatbotx.io/worker-config", () => ({
  enqueueStaffAssistantReply: mocks.enqueue,
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
vi.mock("../../src/chat/service", () => ({
  chatService: { openAgentChannel: mocks.openAgentChannel },
}))
vi.mock("../../src/staff-assistant/availability", () => ({
  isStaffAssistantAvailable: mocks.available,
}))
vi.mock("../../src/chat-delivery", () => ({
  deliverStaffChatMessage: mocks.deliver,
  publishStaffChatChanged: mocks.publish,
}))
vi.mock("../../src/workspace-member/service", () => ({
  workspaceMemberService: { isMember: mocks.isMember },
}))
vi.mock("../../src/platform/realtime-broadcast", () => ({
  sendToWorkspaceMember: mocks.sendToMember,
}))

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
  mocks.available.mockResolvedValue(true)
  mocks.findStaffAvailability.mockResolvedValue(agent)
  mocks.findChat.mockResolvedValue({
    thread: { type: "agent", directKey: "agent:user:staff" },
  })
  mocks.listMembers.mockResolvedValue([
    { userId: "user", isWorkspaceMember: true },
  ])
  mocks.findStateForUpdate.mockResolvedValue({ runId: "run" })
  mocks.isMember.mockResolvedValue(true)
})

describe("assistant message persistence", () => {
  const input = {
    workspaceId: "ws",
    threadId: "thread",
    userId: "user",
    dedupeKey: "run:final",
    expectedRunId: "run",
    message: { kind: "comment" as const, text: "Hello" },
  }

  test("only delivers effects for an inserted message", async () => {
    mocks.insertMessage.mockResolvedValueOnce(undefined)
    await expect(
      staffAssistantService.postAssistantMessage(input),
    ).resolves.toBeNull()
    expect(mocks.deliver).not.toHaveBeenCalled()
    expect(mocks.touchLastMessage).not.toHaveBeenCalled()
  })

  test("does not send a result for a replaced run", async () => {
    mocks.findStateForUpdate.mockResolvedValue({ runId: "other" })
    await expect(
      staffAssistantService.postAssistantMessage(input),
    ).resolves.toBeNull()
    expect(mocks.insertMessage).not.toHaveBeenCalled()
  })

  test("delivers a single inserted assistant reply", async () => {
    mocks.insertMessage.mockResolvedValue({
      id: "message",
      kind: "comment",
      authorUserId: null,
      authorLabel: "Assistant",
      text: "Hello",
      systemEvent: null,
      createdAt: new Date(),
      editedAt: null,
      deletedAt: null,
      mentions: { userIds: [], teamIds: [] },
      attachments: [],
    })
    await staffAssistantService.postAssistantMessage(input)
    expect(mocks.deliver).toHaveBeenCalledOnce()
    expect(mocks.publish).not.toHaveBeenCalled()
    expect(mocks.touchLastMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws",
        threadId: "thread",
        messageId: "message",
      }),
    )
  })

  test("system failures publish realtime without a notification", async () => {
    mocks.insertMessage.mockResolvedValue({
      id: "message",
      kind: "system",
      authorUserId: null,
      authorLabel: "Assistant",
      text: null,
      systemEvent: { type: "assistantFailed", reason: "timeout" },
      createdAt: new Date(),
      editedAt: null,
      deletedAt: null,
      mentions: { userIds: [], teamIds: [] },
      attachments: [],
    })
    await staffAssistantService.postAssistantMessage({
      ...input,
      message: { kind: "system", reason: "timeout" },
    })
    expect(mocks.publish).toHaveBeenCalledOnce()
    expect(mocks.deliver).not.toHaveBeenCalled()
  })
})

test("typing is delivered only to the real member of this staff chat", async () => {
  await staffAssistantService.publishTyping({
    workspaceId: "ws",
    threadId: "thread",
    userId: "user",
    typing: true,
  })
  expect(mocks.sendToMember).toHaveBeenCalledWith(
    { workspaceId: "ws", userId: "user" },
    {
      eventType: "chatTyping",
      data: { threadId: "thread", typing: true, seconds: 20 },
    },
  )
  mocks.sendToMember.mockClear()
  mocks.isMember.mockResolvedValue(false)
  await staffAssistantService.publishTyping({
    workspaceId: "ws",
    threadId: "thread",
    userId: "user",
    typing: true,
  })
  expect(mocks.sendToMember).not.toHaveBeenCalled()
})

test("only enqueues replies for a matching staff chat", async () => {
  const input = {
    workspaceId: "ws",
    threadId: "thread",
    userId: "user",
    messageId: "message",
  }
  await staffAssistantService.enqueueReplyIfNeeded(input)
  expect(mocks.enqueue).toHaveBeenCalledWith({
    workspaceId: "ws",
    threadId: "thread",
    messageId: "message",
  })
  mocks.enqueue.mockClear()
  mocks.findChat.mockResolvedValue({
    thread: { type: "agent", directKey: "agent:user:token:other" },
  })
  await staffAssistantService.enqueueReplyIfNeeded(input)
  expect(mocks.enqueue).not.toHaveBeenCalled()
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

  test("both token and employee paths select the staff channel", async () => {
    expect(
      await staffAssistantService.resolveAgentChannel({
        workspaceId: "ws",
        tokenId: "token",
        tokenName: "old name",
      }),
    ).toEqual({ kind: "staff", title: "Assistant" })
    expect(
      await staffAssistantService.resolveAgentChannel({
        workspaceId: "ws",
        tokenId: "other",
        tokenName: "Other",
      }),
    ).toEqual({ kind: "token", id: "other", label: "Other" })
    await staffAssistantService.openForEmployee({
      workspaceId: "ws",
      userId: "user",
    })
    expect(mocks.openAgentChannel).toHaveBeenCalledWith({
      workspaceId: "ws",
      userId: "user",
      channel: { kind: "staff", title: "Assistant" },
    })
    mocks.token.mockResolvedValue(null)
    await expect(
      staffAssistantService.openForEmployee({
        workspaceId: "ws",
        userId: "user",
      }),
    ).rejects.toMatchObject({ httpStatusCode: 400 })
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
