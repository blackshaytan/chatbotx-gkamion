import {
  EXTERNAL_AGENT_ACTIVITY_TYPE,
  EXTERNAL_AGENT_DEFAULT_MAX_RUN_MINUTES,
  EXTERNAL_AGENT_DEFAULT_PROGRESS_MESSAGE,
  externalAgentApiKeySchema,
} from "@chatbotx.io/database/partials"
import type { ExternalAgentModel } from "@chatbotx.io/database/types"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  findByWorkspace: vi.fn(),
  findActiveForInbox: vi.fn(),
  updateCheck: vi.fn(),
  upsert: vi.fn(),
  transaction: vi.fn(),
  createOrUpdate: vi.fn(),
  createMessageRepository: vi.fn(),
  encryptObject: vi.fn(),
  decryptObject: vi.fn(),
  withCache: vi.fn(),
  setNumberIfNotExists: vi.fn(),
  invalidateCacheByTags: vi.fn(),
  createHermesClient: vi.fn(),
  health: vi.fn(),
  findByUncached: vi.fn(),
  disableBotState: vi.fn(),
  findRecentByContactId: vi.fn(),
  bulkUpdateTracking: vi.fn(),
  listLabelsByIds: vi.fn(),
  logProviderError: vi.fn(),
  publishToWorkspaceParty: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
  chatQueueAdd: vi.fn(),
  notificationQueueAdd: vi.fn(),
}))

vi.mock("@chatbotx.io/worker-config", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@chatbotx.io/worker-config")>()
  return {
    ...actual,
    chatQueue: { add: mocks.chatQueueAdd },
    notificationQueue: { add: mocks.notificationQueueAdd },
  }
})

const TX = { tx: true }

vi.mock("@chatbotx.io/database/client", () => ({
  db: { transaction: mocks.transaction },
}))

vi.mock("@chatbotx.io/database/repositories", () => ({
  createMessageRepository: mocks.createMessageRepository,
  externalAgentRepository: {
    findByWorkspace: mocks.findByWorkspace,
    findActiveForInbox: mocks.findActiveForInbox,
    updateCheck: mocks.updateCheck,
    upsert: mocks.upsert,
  },
}))

vi.mock("@chatbotx.io/encryption", () => ({
  encryptUtils: {
    encryptObject: mocks.encryptObject,
    decryptObject: mocks.decryptObject,
  },
}))

vi.mock("@chatbotx.io/redis", () => ({
  withCache: mocks.withCache,
  distributedStore: { setNumberIfNotExists: mocks.setNumberIfNotExists },
  invalidateCacheByTags: mocks.invalidateCacheByTags,
}))

vi.mock("../../src/external-agent/hermes-client", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../src/external-agent/hermes-client")
  >()),
  createHermesClient: mocks.createHermesClient,
}))

vi.mock("../../src/conversation/service", () => ({
  conversationService: {
    findByUncached: mocks.findByUncached,
    disableBotState: mocks.disableBotState,
  },
}))

vi.mock("../../src/contact-inbox/service", () => ({
  contactInboxService: {
    findRecentByContactId: mocks.findRecentByContactId,
    bulkUpdateTracking: mocks.bulkUpdateTracking,
  },
}))

vi.mock("../../src/inbox/service", () => ({
  inboxService: { listLabelsByIds: mocks.listLabelsByIds },
}))

vi.mock("../../src/error-log/service", () => ({
  logProviderError: mocks.logProviderError,
}))

vi.mock("../../src/platform/realtime-broadcast", () => ({
  publishToWorkspaceParty: mocks.publishToWorkspaceParty,
}))

vi.mock("../../src/logger", () => ({
  logger: { warn: mocks.loggerWarn, error: mocks.loggerError, info: vi.fn() },
}))

const { externalAgentService, EXTERNAL_AGENT_HANDOVER_CLIENT_TEXT } =
  await import("../../src/external-agent/service")
const { HermesAuthError, HermesUnavailableError } = await import(
  "../../src/external-agent/hermes-client"
)

const NOW = new Date("2026-10-21T09:30:15.000Z")
const MINUTE_BUCKET = Math.floor(NOW.getTime() / 60_000)
const WORKSPACE_ID = "ws-1"
const SECRET = "hermes-secret-key"

const storedKey = { iv: "iv", tag: "tag", text: "stored", v: 1 }
const freshKey = { iv: "iv2", tag: "tag2", text: "fresh", v: 1 }

const makeAgent = (
  overrides: Partial<ExternalAgentModel> = {},
): ExternalAgentModel & { inboxIds: string[] } =>
  ({
    id: "agent-1",
    workspaceId: WORKSPACE_ID,
    provider: "hermes",
    baseUrl: "http://127.0.0.1:8647/v1",
    apiKey: storedKey,
    enabled: true,
    botName: null,
    signMessages: false,
    announceManager: false,
    resumeAfterHours: null,
    maxRunMinutes: 30,
    progressMessage: "Working on it",
    lastCheckedAt: null,
    lastCheckStatus: null,
    lastCheckError: null,
    createdAt: NOW,
    updatedAt: NOW,
    inboxIds: ["inbox-1"],
    ...overrides,
  }) as ExternalAgentModel & { inboxIds: string[] }

const conversation = (botEnabled: boolean) => ({
  id: "conv-1",
  workspaceId: WORKSPACE_ID,
  contactId: "contact-1",
  botEnabled,
})

const upsertedValues = () => mocks.upsert.mock.calls[0]?.[0]

beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(NOW)
  mocks.withCache.mockImplementation(
    (_key: string, fn: () => Promise<unknown>) => fn(),
  )
  mocks.transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(TX))
  mocks.upsert.mockImplementation(
    (input: { values: Partial<ExternalAgentModel> }) =>
      Promise.resolve(makeAgent(input.values)),
  )
  mocks.encryptObject.mockResolvedValue(freshKey)
  mocks.decryptObject.mockResolvedValue({ apiKey: SECRET })
  mocks.createHermesClient.mockReturnValue({ health: mocks.health })
  mocks.invalidateCacheByTags.mockResolvedValue(undefined)
  mocks.setNumberIfNotExists.mockResolvedValue(true)
  mocks.listLabelsByIds.mockImplementation((input: { ids: string[] }) =>
    Promise.resolve(input.ids.map((id) => ({ id, name: id }))),
  )
  mocks.createMessageRepository.mockResolvedValue({
    createOrUpdate: mocks.createOrUpdate,
  })
  mocks.createOrUpdate.mockImplementation((input: object) =>
    Promise.resolve({ message: { ...input }, isNew: true }),
  )
  mocks.findRecentByContactId.mockResolvedValue({ id: "ci-1" })
  mocks.bulkUpdateTracking.mockResolvedValue(null)
  mocks.disableBotState.mockResolvedValue(undefined)
  mocks.logProviderError.mockResolvedValue(undefined)
  mocks.chatQueueAdd.mockResolvedValue(undefined)
  mocks.notificationQueueAdd.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.useRealTimers()
})

describe("externalAgentService.get", () => {
  test("returns hasApiKey and never the key", async () => {
    mocks.findByWorkspace.mockResolvedValue(
      makeAgent({ lastCheckStatus: "ok" }),
    )

    const settings = await externalAgentService.get(WORKSPACE_ID)

    expect(settings).toEqual({
      enabled: true,
      provider: "hermes",
      baseUrl: "http://127.0.0.1:8647/v1",
      hasApiKey: true,
      botName: null,
      signMessages: false,
      announceManager: false,
      inboxIds: ["inbox-1"],
      resumeAfterHours: null,
      maxRunMinutes: 30,
      progressMessage: "Working on it",
      lastCheckedAt: null,
      lastCheckStatus: "ok",
      lastCheckError: null,
    })
    expect(settings).not.toHaveProperty("apiKey")
    expect(JSON.stringify(settings)).not.toContain("stored")
    expect(mocks.withCache).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Function),
      expect.objectContaining({ tags: [`externalAgent:${WORKSPACE_ID}`] }),
    )
  })

  test("returns null when the workspace has no agent", async () => {
    mocks.findByWorkspace.mockResolvedValue(null)

    await expect(externalAgentService.get(WORKSPACE_ID)).resolves.toBeNull()
  })
})

describe("externalAgentService.update", () => {
  test("keeps the stored encrypted key when apiKey is omitted", async () => {
    mocks.findByWorkspace.mockResolvedValue(makeAgent())

    await externalAgentService.update(WORKSPACE_ID, { enabled: false })

    expect(mocks.encryptObject).not.toHaveBeenCalled()
    expect(upsertedValues()).toMatchObject({
      workspaceId: WORKSPACE_ID,
      values: { apiKey: storedKey, enabled: false },
      inboxIds: undefined,
    })
  })

  test("encrypts a new apiKey with the workspace AAD", async () => {
    mocks.findByWorkspace.mockResolvedValue(makeAgent())

    const settings = await externalAgentService.update(WORKSPACE_ID, {
      apiKey: ` ${SECRET} `,
    })

    expect(mocks.encryptObject).toHaveBeenCalledWith(
      { apiKey: SECRET },
      `external-agent:${WORKSPACE_ID}`,
    )
    expect(upsertedValues()).toMatchObject({ values: { apiKey: freshKey } })
    expect(JSON.stringify(settings)).not.toContain(SECRET)
  })

  test("creates with defaults inside a transaction and invalidates the cache", async () => {
    mocks.findByWorkspace.mockResolvedValue(null)

    await externalAgentService.update(WORKSPACE_ID, {
      baseUrl: "https://hermes.example.com/v1//",
      apiKey: SECRET,
      inboxIds: ["inbox-1", "inbox-2", "inbox-1"],
    })

    expect(mocks.upsert).toHaveBeenCalledWith(
      {
        workspaceId: WORKSPACE_ID,
        purpose: "client",
        values: {
          provider: "hermes",
          baseUrl: "https://hermes.example.com/v1",
          apiKey: freshKey,
          enabled: false,
          botName: null,
          signMessages: false,
          announceManager: false,
          resumeAfterHours: null,
          maxRunMinutes: EXTERNAL_AGENT_DEFAULT_MAX_RUN_MINUTES,
          progressMessage: EXTERNAL_AGENT_DEFAULT_PROGRESS_MESSAGE,
        },
        inboxIds: ["inbox-1", "inbox-2"],
      },
      TX,
    )
    expect(mocks.invalidateCacheByTags).toHaveBeenCalledWith([
      `externalAgent:${WORKSPACE_ID}`,
    ])
  })

  test("requires baseUrl and apiKey on first create", async () => {
    mocks.findByWorkspace.mockResolvedValue(null)

    await expect(
      externalAgentService.update(WORKSPACE_ID, { apiKey: SECRET }),
    ).rejects.toMatchObject({ httpStatusCode: 400 })
    await expect(
      externalAgentService.update(WORKSPACE_ID, {
        baseUrl: "http://127.0.0.1:8647",
      }),
    ).rejects.toMatchObject({ httpStatusCode: 400 })
    expect(mocks.upsert).not.toHaveBeenCalled()
  })

  test.each([
    "ftp://hermes.example.com",
    "javascript:alert(1)",
    "not a url",
    "http://user:pass@hermes.example.com",
  ])("rejects baseUrl %s", async (baseUrl) => {
    mocks.findByWorkspace.mockResolvedValue(makeAgent())

    await expect(
      externalAgentService.update(WORKSPACE_ID, { baseUrl }),
    ).rejects.toMatchObject({
      code: "invalidExternalAgentUrl",
      httpStatusCode: 400,
    })
    expect(mocks.upsert).not.toHaveBeenCalled()
  })

  test("rejects inboxes of another workspace", async () => {
    mocks.findByWorkspace.mockResolvedValue(makeAgent())
    mocks.listLabelsByIds.mockResolvedValue([{ id: "inbox-1", name: "A" }])

    await expect(
      externalAgentService.update(WORKSPACE_ID, {
        inboxIds: ["inbox-1", "foreign-inbox"],
      }),
    ).rejects.toMatchObject({
      code: "invalidExternalAgentInbox",
      httpStatusCode: 400,
    })
    expect(mocks.listLabelsByIds).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      ids: ["inbox-1", "foreign-inbox"],
    })
    expect(mocks.upsert).not.toHaveBeenCalled()
  })

  test("an empty inbox list clears the links without a lookup", async () => {
    mocks.findByWorkspace.mockResolvedValue(makeAgent())

    await externalAgentService.update(WORKSPACE_ID, { inboxIds: [] })

    expect(mocks.listLabelsByIds).not.toHaveBeenCalled()
    expect(upsertedValues()).toMatchObject({ inboxIds: [] })
  })

  test("round-trips sender presentation settings and normalizes botName", async () => {
    mocks.findByWorkspace.mockResolvedValue(makeAgent())

    const settings = await externalAgentService.update(WORKSPACE_ID, {
      botName: "  Гека  ",
      signMessages: true,
      announceManager: true,
    })

    expect(upsertedValues()).toMatchObject({
      values: {
        botName: "Гека",
        signMessages: true,
        announceManager: true,
      },
    })
    expect(settings).toMatchObject({
      botName: "Гека",
      signMessages: true,
      announceManager: true,
    })
  })

  test("clears a blank botName and rejects names over 40 characters", async () => {
    mocks.findByWorkspace.mockResolvedValue(makeAgent({ botName: "Гека" }))

    await externalAgentService.update(WORKSPACE_ID, { botName: "   " })
    expect(upsertedValues()).toMatchObject({ values: { botName: null } })

    await expect(
      externalAgentService.update(WORKSPACE_ID, { botName: "a".repeat(41) }),
    ).rejects.toMatchObject({ code: "invalidExternalAgentSettings" })
  })

  test.each([0, 241, 1.5])("rejects maxRunMinutes %s", async (value) => {
    mocks.findByWorkspace.mockResolvedValue(makeAgent())

    await expect(
      externalAgentService.update(WORKSPACE_ID, { maxRunMinutes: value }),
    ).rejects.toMatchObject({ httpStatusCode: 400 })
  })

  test.each([1, 240])("accepts maxRunMinutes %s", async (value) => {
    mocks.findByWorkspace.mockResolvedValue(makeAgent())

    await externalAgentService.update(WORKSPACE_ID, { maxRunMinutes: value })

    expect(upsertedValues()).toMatchObject({
      values: { maxRunMinutes: value },
    })
  })

  test.each([0, 721, 2.5])("rejects resumeAfterHours %s", async (value) => {
    mocks.findByWorkspace.mockResolvedValue(makeAgent())

    await expect(
      externalAgentService.update(WORKSPACE_ID, { resumeAfterHours: value }),
    ).rejects.toMatchObject({ httpStatusCode: 400 })
  })

  test.each([null, 1, 720])("accepts resumeAfterHours %s", async (value) => {
    mocks.findByWorkspace.mockResolvedValue(makeAgent({ resumeAfterHours: 5 }))

    await externalAgentService.update(WORKSPACE_ID, {
      resumeAfterHours: value,
    })

    expect(upsertedValues()).toMatchObject({
      values: { resumeAfterHours: value },
    })
  })
})

describe("externalAgentService.test", () => {
  test("throttles one check per 10 seconds per workspace", async () => {
    mocks.findByWorkspace.mockResolvedValue(makeAgent())
    mocks.setNumberIfNotExists.mockResolvedValue(false)

    await expect(externalAgentService.test(WORKSPACE_ID)).rejects.toMatchObject(
      { httpStatusCode: 429 },
    )
    expect(mocks.setNumberIfNotExists).toHaveBeenCalledWith(
      `externalAgent:test:${WORKSPACE_ID}`,
      1,
      10,
    )
    expect(mocks.health).not.toHaveBeenCalled()
    expect(mocks.updateCheck).not.toHaveBeenCalled()
  })

  test("calls health with the decrypted key and records ok", async () => {
    mocks.findByWorkspace.mockResolvedValue(makeAgent())
    mocks.health.mockResolvedValue(undefined)

    await expect(externalAgentService.test(WORKSPACE_ID)).resolves.toEqual({
      status: "ok",
      error: null,
      checkedAt: NOW,
    })
    expect(mocks.decryptObject).toHaveBeenCalledWith(
      storedKey,
      externalAgentApiKeySchema,
      `external-agent:${WORKSPACE_ID}`,
    )
    expect(mocks.createHermesClient).toHaveBeenCalledWith({
      baseUrl: "http://127.0.0.1:8647/v1",
      apiKey: SECRET,
    })
    expect(mocks.updateCheck).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      purpose: "client",
      status: "ok",
      error: null,
      checkedAt: NOW,
    })
  })

  test("records an error without the secret", async () => {
    mocks.findByWorkspace.mockResolvedValue(makeAgent())
    mocks.health.mockRejectedValue(new HermesAuthError())

    const result = await externalAgentService.test(WORKSPACE_ID)

    expect(result).toEqual({
      status: "error",
      error: "Hermes rejected the API key",
      checkedAt: NOW,
    })
    expect(mocks.updateCheck).toHaveBeenCalledWith(
      expect.objectContaining({ status: "error" }),
    )
    expect(JSON.stringify(mocks.updateCheck.mock.calls)).not.toContain(SECRET)
  })

  test("reports a non-Hermes failure generically", async () => {
    mocks.findByWorkspace.mockResolvedValue(makeAgent())
    mocks.decryptObject.mockRejectedValue(new Error(`bad key ${SECRET}`))

    const result = await externalAgentService.test(WORKSPACE_ID)

    expect(result.status).toBe("error")
    expect(result.error).toBe("External agent check failed")
  })

  test("is not found when the agent is not configured", async () => {
    mocks.findByWorkspace.mockResolvedValue(null)

    await expect(externalAgentService.test(WORKSPACE_ID)).rejects.toMatchObject(
      { httpStatusCode: 404 },
    )
  })
})

describe("externalAgentService.getRuntime", () => {
  test("returns the agent and a client for a linked inbox", async () => {
    const agent = makeAgent({
      botName: "Гека",
      signMessages: true,
      announceManager: true,
    })
    mocks.findActiveForInbox.mockResolvedValue(agent)

    const runtime = await externalAgentService.getRuntime({
      workspaceId: WORKSPACE_ID,
      inboxId: "inbox-1",
    })

    expect(mocks.findActiveForInbox).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      inboxId: "inbox-1",
    })
    expect(runtime).toEqual({ agent, client: { health: mocks.health } })
    expect(runtime?.agent).toMatchObject({
      botName: "Гека",
      signMessages: true,
      announceManager: true,
    })
  })

  test("returns null when the agent is disabled or the inbox is not linked", async () => {
    mocks.findActiveForInbox.mockResolvedValue(null)

    await expect(
      externalAgentService.getRuntime({
        workspaceId: WORKSPACE_ID,
        inboxId: "inbox-2",
      }),
    ).resolves.toBeNull()
    expect(mocks.createHermesClient).not.toHaveBeenCalled()
  })

  test("getRuntimeForWorkspace returns null for a disabled agent", async () => {
    mocks.findByWorkspace.mockResolvedValue(makeAgent({ enabled: false }))

    await expect(
      externalAgentService.getRuntimeForWorkspace(WORKSPACE_ID),
    ).resolves.toBeNull()
  })

  test("getRuntimeForWorkspace returns a client for an enabled agent", async () => {
    mocks.findByWorkspace.mockResolvedValue(makeAgent())

    const runtime =
      await externalAgentService.getRuntimeForWorkspace(WORKSPACE_ID)

    expect(runtime?.client).toEqual({ health: mocks.health })
  })
})

describe("externalAgentService.handover", () => {
  test("disables the bot and writes a handover note with the reason", async () => {
    mocks.findByUncached.mockResolvedValue(conversation(true))

    await expect(
      externalAgentService.handover({
        workspaceId: WORKSPACE_ID,
        conversationId: "conv-1",
        reason: "Client asks for a manager",
      }),
    ).resolves.toEqual({ conversationId: "conv-1", botEnabled: false })

    expect(mocks.findByUncached).toHaveBeenCalledWith({
      where: { id: "conv-1", workspaceId: WORKSPACE_ID },
    })
    expect(mocks.disableBotState).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      conversations: [{ id: "conv-1", contactId: "contact-1" }],
      triggerContext: {
        triggerSource: "system",
        triggerHandler: "externalAgent",
        triggerType: "external_agent_handover",
      },
      noAutoResume: true,
      handoverCategory: "other",
    })
    expect(mocks.createOrUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "conv-1",
        contactInboxId: "ci-1",
        workspaceId: WORKSPACE_ID,
        messageType: "activity",
        senderType: "system",
        sourceId: `externalAgent:handover:conv-1:${MINUTE_BUCKET}`,
        text: "AI agent handed the conversation over to a manager: Client asks for a manager",
        contentAttributes: {
          type: EXTERNAL_AGENT_ACTIVITY_TYPE,
          event: "handover",
          reason: "Client asks for a manager",
          category: "other",
        },
      }),
    )
    expect(mocks.publishToWorkspaceParty).toHaveBeenCalledWith(
      WORKSPACE_ID,
      expect.objectContaining({
        data: expect.objectContaining({ attachments: [] }),
      }),
    )
    expect(mocks.chatQueueAdd).toHaveBeenCalledWith("sendChatMessage", {
      type: "sendChatMessage",
      data: {
        conversation: conversation(true),
        contactInbox: { id: "ci-1" },
        text: EXTERNAL_AGENT_HANDOVER_CLIENT_TEXT,
      },
    })
    expect(mocks.notificationQueueAdd).toHaveBeenCalledOnce()
    expect(mocks.notificationQueueAdd).toHaveBeenCalledWith(
      "notifyAgentHandover",
      {
        type: "notifyAgentHandover",
        data: {
          workspaceId: WORKSPACE_ID,
          conversationId: "conv-1",
          category: "other",
          reason: "Client asks for a manager",
        },
      },
    )
  })

  test("passes the given category to the bot pause, the note and the push", async () => {
    mocks.findByUncached.mockResolvedValue(conversation(true))

    await externalAgentService.handover({
      workspaceId: WORKSPACE_ID,
      conversationId: "conv-1",
      reason: "Wants a refund",
      category: "return",
    })

    expect(mocks.disableBotState).toHaveBeenCalledWith(
      expect.objectContaining({
        noAutoResume: true,
        handoverCategory: "return",
      }),
    )
    expect(mocks.createOrUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        contentAttributes: expect.objectContaining({ category: "return" }),
      }),
    )
    expect(mocks.notificationQueueAdd).toHaveBeenCalledWith(
      "notifyAgentHandover",
      expect.objectContaining({
        data: expect.objectContaining({ category: "return" }),
      }),
    )
  })

  test("a failed handover notification does not fail the handover", async () => {
    mocks.findByUncached.mockResolvedValue(conversation(true))
    mocks.notificationQueueAdd.mockRejectedValue(new Error("redis down"))

    await expect(
      externalAgentService.handover({
        workspaceId: WORKSPACE_ID,
        conversationId: "conv-1",
        reason: "Client asks for a manager",
      }),
    ).resolves.toEqual({ conversationId: "conv-1", botEnabled: false })

    expect(mocks.loggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.any(Error),
        conversationId: "conv-1",
      }),
      "External agent: unable to enqueue the handover notification",
    )
  })

  test("a failed confirmation send does not fail the handover", async () => {
    mocks.findByUncached.mockResolvedValue(conversation(true))
    mocks.chatQueueAdd.mockRejectedValue(new Error("redis down"))

    await expect(
      externalAgentService.handover({
        workspaceId: WORKSPACE_ID,
        conversationId: "conv-1",
        reason: "Client asks for a manager",
      }),
    ).resolves.toEqual({ conversationId: "conv-1", botEnabled: false })

    expect(mocks.loggerError).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: "conv-1" }),
      "External agent: unable to send the handover confirmation",
    )
    expect(mocks.createOrUpdate).toHaveBeenCalled()
  })

  test("a repeat on a disabled bot does not disable again nor duplicate the note", async () => {
    mocks.findByUncached.mockResolvedValue(conversation(false))
    mocks.createOrUpdate.mockImplementation((input: object) =>
      Promise.resolve({ message: { ...input }, isNew: false }),
    )

    await expect(
      externalAgentService.handover({
        workspaceId: WORKSPACE_ID,
        conversationId: "conv-1",
        reason: "again",
      }),
    ).resolves.toEqual({ conversationId: "conv-1", botEnabled: false })

    expect(mocks.disableBotState).not.toHaveBeenCalled()
    expect(mocks.chatQueueAdd).not.toHaveBeenCalled()
    expect(mocks.notificationQueueAdd).not.toHaveBeenCalled()
    expect(mocks.createOrUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId: `externalAgent:handover:conv-1:${MINUTE_BUCKET}`,
      }),
    )
    expect(mocks.publishToWorkspaceParty).not.toHaveBeenCalled()
    expect(mocks.bulkUpdateTracking).not.toHaveBeenCalled()
  })

  test("is not found for a conversation outside the workspace", async () => {
    mocks.findByUncached.mockResolvedValue(undefined)

    await expect(
      externalAgentService.handover({
        workspaceId: WORKSPACE_ID,
        conversationId: "other",
        reason: "x",
      }),
    ).rejects.toMatchObject({ httpStatusCode: 404 })
    expect(mocks.disableBotState).not.toHaveBeenCalled()
  })
})

describe("externalAgentService.failToHuman", () => {
  const failInput = (sendText: (text: string) => Promise<void>) => ({
    workspaceId: WORKSPACE_ID,
    conversationId: "conv-1",
    contactInboxId: "ci-1",
    event: "unavailable" as const,
    error: new HermesUnavailableError(),
    sendText,
  })

  test("tells the client, disables the bot, writes the note and logs the provider error", async () => {
    mocks.findByUncached.mockResolvedValue(conversation(true))
    const sendText = vi.fn().mockResolvedValue(undefined)
    const input = failInput(sendText)

    await externalAgentService.failToHuman(input)

    expect(sendText).toHaveBeenCalledWith(EXTERNAL_AGENT_HANDOVER_CLIENT_TEXT)
    expect(EXTERNAL_AGENT_HANDOVER_CLIENT_TEXT).toBe(
      "Передал ваш запрос менеджеру",
    )
    expect(mocks.disableBotState).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      conversations: [{ id: "conv-1", contactId: "contact-1" }],
      triggerContext: {
        triggerSource: "system",
        triggerHandler: "externalAgent",
        triggerType: "external_agent_failure",
      },
    })
    expect(mocks.createOrUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        contactInboxId: "ci-1",
        sourceId: `externalAgent:unavailable:conv-1:${MINUTE_BUCKET}`,
        contentAttributes: {
          type: EXTERNAL_AGENT_ACTIVITY_TYPE,
          event: "unavailable",
        },
      }),
    )
    expect(mocks.logProviderError).toHaveBeenCalledWith({
      provider: "hermes",
      workspaceId: WORKSPACE_ID,
      contactId: "contact-1",
      error: input.error,
    })
  })

  test("does not message the client when the bot is already off", async () => {
    mocks.findByUncached.mockResolvedValue(conversation(false))
    const sendText = vi.fn().mockResolvedValue(undefined)

    await externalAgentService.failToHuman({
      ...failInput(sendText),
      event: "timeout",
    })

    expect(sendText).not.toHaveBeenCalled()
    expect(mocks.disableBotState).not.toHaveBeenCalled()
    expect(mocks.createOrUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId: `externalAgent:timeout:conv-1:${MINUTE_BUCKET}`,
      }),
    )
    expect(mocks.logProviderError).toHaveBeenCalled()
  })

  test("a failing step does not skip the rest", async () => {
    mocks.findByUncached.mockResolvedValue(conversation(true))
    const sendText = vi.fn().mockRejectedValue(new Error("channel down"))
    mocks.disableBotState.mockRejectedValue(new Error("db down"))

    await expect(
      externalAgentService.failToHuman(failInput(sendText)),
    ).resolves.toBeUndefined()

    expect(mocks.disableBotState).toHaveBeenCalled()
    expect(mocks.createOrUpdate).toHaveBeenCalled()
    expect(mocks.logProviderError).toHaveBeenCalled()
    expect(mocks.loggerError).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error), step: "sendText" }),
      expect.any(String),
    )
  })
})
