import { UnrecoverableError } from "bullmq"
import { beforeEach, describe, expect, test, vi } from "vitest"

const mocks = vi.hoisted(() => {
  class HermesAuthError extends Error {
    constructor() {
      super("Hermes rejected the API key")
      this.name = "HermesAuthError"
    }
  }
  class HermesUnavailableError extends Error {
    constructor(message = "Hermes is unavailable") {
      super(message)
      this.name = "HermesUnavailableError"
    }
  }
  class HermesRequestError extends Error {
    readonly status: number
    constructor(status: number) {
      super(`Hermes request failed with status ${status}`)
      this.name = "HermesRequestError"
      this.status = status
    }
  }
  return {
    HermesAuthError,
    HermesUnavailableError,
    HermesRequestError,
    withBlockedOwnerGuard: vi.fn(
      async (_workspaceId: string | undefined, fn: () => Promise<unknown>) =>
        await fn(),
    ),
    runExclusive: vi.fn(
      async ({ fn }: { fn: () => Promise<unknown> }) => await fn(),
    ),
    storeGet: vi.fn(),
    storePut: vi.fn(),
    findConversation: vi.fn(),
    ensureActive: vi.fn(),
    findContactInbox: vi.fn(),
    findContact: vi.fn(),
    getRuntime: vi.fn(),
    getRuntimeForWorkspace: vi.fn(),
    findConversationState: vi.fn(),
    saveConversationState: vi.fn(),
    patchConversationState: vi.fn(),
    failToHuman: vi.fn(),
    listMessages: vi.fn(),
    buildRunInput: vi.fn(),
    buildAttachmentProxyUrl: vi.fn(),
    enqueueExternalAgentReply: vi.fn(),
    enqueueExternalAgentWatch: vi.fn(),
    chatQueueAdd: vi.fn(),
    startRun: vi.fn(),
    steer: vi.fn(),
    stop: vi.fn(),
  }
})

vi.mock("@chatbotx.io/business", () => ({
  buildAttachmentProxyUrl: mocks.buildAttachmentProxyUrl,
  buildRunInput: mocks.buildRunInput,
  contactInboxService: { findByUncached: mocks.findContactInbox },
  contactService: { findById: mocks.findContact },
  conversationService: {
    findByUncached: mocks.findConversation,
    ensureActive: mocks.ensureActive,
  },
  externalAgentService: {
    getRuntime: mocks.getRuntime,
    getRuntimeForWorkspace: mocks.getRuntimeForWorkspace,
    findConversationState: mocks.findConversationState,
    saveConversationState: mocks.saveConversationState,
    patchConversationState: mocks.patchConversationState,
    failToHuman: mocks.failToHuman,
  },
  HermesAuthError: mocks.HermesAuthError,
  HermesRequestError: mocks.HermesRequestError,
  HermesUnavailableError: mocks.HermesUnavailableError,
  isFailedOriginPath: (originPath: string) => originPath.startsWith("failed:"),
  messageService: { listLastMessagesWithAttachments: mocks.listMessages },
  withBlockedOwnerGuard: mocks.withBlockedOwnerGuard,
}))

vi.mock("@chatbotx.io/redis", () => ({
  distributedLock: { runExclusive: mocks.runExclusive },
  distributedStore: { get: mocks.storeGet, put: mocks.storePut },
}))

vi.mock("@chatbotx.io/worker-config", () => ({
  ChatJobAction: { sendChatMessage: "sendChatMessage" },
  chatQueue: { add: mocks.chatQueueAdd },
  enqueueExternalAgentReply: mocks.enqueueExternalAgentReply,
  enqueueExternalAgentWatch: mocks.enqueueExternalAgentWatch,
}))

vi.mock("../src/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const { processExternalAgentReply } = await import(
  "../src/ai-agent/handlers/external-agent-reply"
)

const BASE_TIME = Date.parse("2026-10-21T10:00:00.000Z")
const at = (seconds: number) => new Date(BASE_TIME + seconds * 1000)

const data = {
  workspaceId: "ws-1",
  conversationId: "conv-1",
  contactInboxId: "ci-1",
  messageId: "m-new-2",
}

const conversation = {
  id: "conv-1",
  workspaceId: "ws-1",
  contactId: "contact-1",
  botEnabled: true,
  botResumeAt: null,
}
const contactInbox = {
  id: "ci-1",
  contactId: "contact-1",
  inboxId: "inbox-1",
  channel: "max",
}
const runtime = {
  agent: { maxRunMinutes: 30, progressMessage: "Работаю над запросом" },
  client: { startRun: mocks.startRun, steer: mocks.steer, stop: mocks.stop },
}

type TestMessage = {
  id: string
  messageType: "incoming" | "outgoing"
  senderType: "contact" | "bot" | "user"
  text: string | null
  createdAt: Date
  attachments: { id: string; originPath: string }[]
}

const incoming = (
  id: string,
  seconds: number,
  overrides: Partial<TestMessage> = {},
): TestMessage => ({
  id,
  messageType: "incoming",
  senderType: "contact",
  text: `text ${id}`,
  createdAt: at(seconds),
  attachments: [],
  ...overrides,
})

const outgoing = (id: string, seconds: number): TestMessage => ({
  id,
  messageType: "outgoing",
  senderType: "bot",
  text: `reply ${id}`,
  createdAt: at(seconds),
  attachments: [],
})

const state = (overrides: Record<string, unknown> = {}) => ({
  conversationId: "conv-1",
  workspaceId: "ws-1",
  cursorAt: at(100),
  cursorMessageId: "m-old",
  includeHistory: false,
  runId: null,
  runStartedAt: null,
  lastEventAt: null,
  lastEventSeq: -1,
  lastProgressSentAt: null,
  lastProgressText: null,
  lastClientSendAt: null,
  progressFallbackSentAt: null,
  failureCount: 0,
  lastError: null,
  ...overrides,
})

/** 11 messages up to the cursor, then two new contact messages after it. */
const conversationMessages = (): TestMessage[] => [
  ...Array.from({ length: 11 }, (_, index) =>
    index % 2 === 0
      ? incoming(`h-${index}`, index * 5)
      : outgoing(`h-${index}`, index * 5),
  ),
  incoming("m-old", 100),
  incoming("m-new-1", 110),
  incoming("m-new-2", 120),
]

const run = (options = { isFinalAttempt: false }) =>
  processExternalAgentReply(data, options)

describe("processExternalAgentReply", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.findConversation.mockResolvedValue(conversation)
    mocks.ensureActive.mockResolvedValue(true)
    mocks.findContactInbox.mockResolvedValue(contactInbox)
    mocks.findContact.mockResolvedValue({ fullName: "Иван" })
    mocks.getRuntime.mockResolvedValue(runtime)
    mocks.findConversationState.mockResolvedValue(state())
    mocks.listMessages.mockResolvedValue(conversationMessages())
    mocks.patchConversationState.mockResolvedValue(1)
    mocks.storeGet.mockResolvedValue(null)
    mocks.buildAttachmentProxyUrl.mockImplementation(
      async ({ attachmentId }: { attachmentId: string }) =>
        `https://app.test/media/attachment/${attachmentId}`,
    )
    mocks.buildRunInput.mockImplementation(
      (params: { messages: { text: string | null }[] }) => ({
        input: params.messages.map((message) => message.text).join("\n"),
        instructions: "chatbotx context",
      }),
    )
    mocks.startRun.mockResolvedValue({ runId: "run-9" })
    mocks.steer.mockResolvedValue({ accepted: true })
  })

  test("runs under the blocked-owner guard and the conversation lock", async () => {
    await run()

    expect(mocks.withBlockedOwnerGuard).toHaveBeenCalledWith(
      "ws-1",
      expect.any(Function),
    )
    expect(mocks.runExclusive).toHaveBeenCalledWith({
      key: "externalAgent:conv-1",
      timeoutInSeconds: 60,
      retryTimeoutInSeconds: 10,
      fn: expect.any(Function),
    })
  })

  test("does nothing when the bot is off", async () => {
    mocks.ensureActive.mockResolvedValue(false)

    await run()

    expect(mocks.getRuntime).not.toHaveBeenCalled()
    expect(mocks.startRun).not.toHaveBeenCalled()
    expect(mocks.steer).not.toHaveBeenCalled()
  })

  test("does nothing when the agent is off for the inbox", async () => {
    mocks.getRuntime.mockResolvedValue(null)

    await run()

    expect(mocks.getRuntime).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      inboxId: "inbox-1",
    })
    expect(mocks.findConversationState).not.toHaveBeenCalled()
    expect(mocks.startRun).not.toHaveBeenCalled()
  })

  test("does nothing when no contact message came after the cursor", async () => {
    mocks.findConversationState.mockResolvedValue(
      state({ cursorAt: at(120), cursorMessageId: "m-new-2" }),
    )

    await run()

    expect(mocks.startRun).not.toHaveBeenCalled()
    expect(mocks.steer).not.toHaveBeenCalled()
    expect(mocks.saveConversationState).not.toHaveBeenCalled()
  })

  test("steers new messages into the active run and moves the cursor", async () => {
    mocks.findConversationState.mockResolvedValue(
      state({ runId: "run-1", runStartedAt: new Date() }),
    )

    await run()

    expect(mocks.steer).toHaveBeenCalledWith(
      "run-1",
      "text m-new-1\ntext m-new-2",
    )
    expect(mocks.patchConversationState).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      conversationId: "conv-1",
      values: { cursorAt: at(120), cursorMessageId: "m-new-2" },
      expectedRunId: "run-1",
    })
    expect(mocks.startRun).not.toHaveBeenCalled()
    expect(mocks.enqueueExternalAgentWatch).not.toHaveBeenCalled()
  })

  test("re-queues the reply (5 s debounce) when the run no longer accepts steering", async () => {
    mocks.findConversationState.mockResolvedValue(
      state({ runId: "run-1", runStartedAt: new Date() }),
    )
    mocks.steer.mockResolvedValue({ accepted: false })

    await run()

    expect(mocks.enqueueExternalAgentReply).toHaveBeenCalledWith({
      ...data,
      messageId: "m-new-2",
    })
    expect(mocks.patchConversationState).not.toHaveBeenCalled()
    expect(mocks.startRun).not.toHaveBeenCalled()
  })

  test("starts a new run when the steered run is gone (404)", async () => {
    mocks.findConversationState.mockResolvedValue(
      state({ runId: "run-1", runStartedAt: new Date() }),
    )
    mocks.steer.mockRejectedValue(new mocks.HermesRequestError(404))

    await run()

    expect(mocks.patchConversationState).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      conversationId: "conv-1",
      values: { runId: null, runStartedAt: null },
      expectedRunId: "run-1",
    })
    expect(mocks.startRun).toHaveBeenCalledTimes(1)
  })

  test("starts a run with session and idempotency keys, 10 history messages, then hands it to the watch", async () => {
    mocks.findConversationState.mockResolvedValue(
      state({ includeHistory: true }),
    )

    await run()

    const params = mocks.buildRunInput.mock.calls[0]?.[0]
    expect(
      params.messages.map((message: { text: string }) => message.text),
    ).toEqual(["text m-new-1", "text m-new-2"])
    expect(params.history).toHaveLength(10)
    expect(params.history[0]).toEqual({
      role: "contact",
      text: "text h-2",
      attachmentUrls: [],
    })
    expect(params.history[1]).toEqual({
      role: "bot",
      text: "reply h-3",
      attachmentUrls: [],
    })
    expect(params.history.at(-1)).toEqual({
      role: "contact",
      text: "text m-old",
      attachmentUrls: [],
    })
    expect(params).toMatchObject({
      contact: { name: "Иван" },
      channel: "max",
      conversationId: "conv-1",
      contactId: "contact-1",
      workspaceId: "ws-1",
    })

    expect(mocks.startRun).toHaveBeenCalledWith({
      sessionKey: "chatbotx:ws-1:conv-1",
      idempotencyKey: "conv-1:m-new-2",
      input: "text m-new-1\ntext m-new-2",
      instructions: "chatbotx context",
    })
    expect(mocks.saveConversationState).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws-1",
        conversationId: "conv-1",
        cursorAt: at(120),
        cursorMessageId: "m-new-2",
        includeHistory: false,
        runId: "run-9",
        runStartedAt: expect.any(Date),
        lastEventSeq: -1,
        progressFallbackSentAt: null,
      }),
    )
    expect(mocks.enqueueExternalAgentWatch).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      conversationId: "conv-1",
      contactInboxId: "ci-1",
      runId: "run-9",
    })
    expect(mocks.storePut).toHaveBeenCalledWith(
      "externalAgent:runInput:conv-1:m-new-2",
      { input: "text m-new-1\ntext m-new-2", instructions: "chatbotx context" },
      86_400,
    )
  })

  test("sends no history once includeHistory is off", async () => {
    await run()

    expect(mocks.buildRunInput.mock.calls[0]?.[0].history).toEqual([])
  })

  test("reuses the stored payload on a retry with the same idempotency key", async () => {
    mocks.storeGet.mockResolvedValue({
      input: "stored input",
      instructions: "stored instructions",
    })

    await run()

    expect(mocks.buildRunInput).not.toHaveBeenCalled()
    expect(mocks.startRun).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: "conv-1:m-new-2",
        input: "stored input",
        instructions: "stored instructions",
      }),
    )
  })

  test("passes photos as signed 24 h media links", async () => {
    mocks.listMessages.mockResolvedValue([
      ...conversationMessages().slice(0, 12),
      incoming("m-photo", 130, {
        text: null,
        attachments: [
          { id: "att-1", originPath: "ws-1/photo.jpg" },
          { id: "att-2", originPath: "failed:gone" },
        ],
      }),
    ])

    await run({ isFinalAttempt: false })

    expect(mocks.buildAttachmentProxyUrl).toHaveBeenCalledTimes(1)
    expect(mocks.buildAttachmentProxyUrl).toHaveBeenCalledWith(
      { workspaceId: "ws-1", attachmentId: "att-1", messageCreatedAt: at(130) },
      86_400_000,
    )
    expect(mocks.buildRunInput.mock.calls[0]?.[0].messages).toEqual([
      {
        role: "contact",
        text: null,
        attachmentUrls: ["https://app.test/media/attachment/att-1"],
      },
    ])
  })

  test("first turn: contact messages after the last outgoing one", async () => {
    mocks.findConversationState.mockResolvedValue(undefined)

    await run()

    const params = mocks.buildRunInput.mock.calls[0]?.[0]
    expect(
      params.messages.map((message: { text: string }) => message.text),
    ).toEqual(["text h-10", "text m-old", "text m-new-1", "text m-new-2"])
    expect(params.history).toHaveLength(10)
  })

  test("after a bot auto-resume the trigger message saved before the reset cursor is new", async () => {
    // enableBotState stamps cursorAt = now after the trigger was saved.
    mocks.findConversationState.mockResolvedValue(
      state({ cursorAt: at(121), cursorMessageId: null, includeHistory: true }),
    )

    await run()

    const params = mocks.buildRunInput.mock.calls[0]?.[0]
    expect(
      params.messages.map((message: { text: string }) => message.text),
    ).toEqual(["text m-new-2"])
    expect(mocks.startRun).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: "conv-1:m-new-2" }),
    )
  })

  test("Hermes auth error hands over at once without retries", async () => {
    mocks.startRun.mockRejectedValue(new mocks.HermesAuthError())

    await expect(run()).rejects.toBeInstanceOf(UnrecoverableError)

    expect(mocks.failToHuman).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws-1",
        conversationId: "conv-1",
        contactInboxId: "ci-1",
        event: "unavailable",
        sendText: expect.any(Function),
      }),
    )
    expect(mocks.enqueueExternalAgentWatch).not.toHaveBeenCalled()
  })

  test("Hermes unavailable before the last attempt is retried by BullMQ", async () => {
    const error = new mocks.HermesUnavailableError()
    mocks.startRun.mockRejectedValue(error)

    await expect(run({ isFinalAttempt: false })).rejects.toBe(error)

    expect(mocks.failToHuman).not.toHaveBeenCalled()
    expect(mocks.saveConversationState).not.toHaveBeenCalled()
  })

  test("Hermes unavailable on the last attempt hands over to a human", async () => {
    mocks.startRun.mockRejectedValue(new mocks.HermesUnavailableError())

    await expect(run({ isFinalAttempt: true })).resolves.toBeUndefined()

    expect(mocks.failToHuman).toHaveBeenCalledWith(
      expect.objectContaining({ event: "unavailable" }),
    )
    expect(mocks.saveConversationState).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      conversationId: "conv-1",
      failureCount: 1,
      lastError: "Hermes is unavailable",
    })
    expect(mocks.enqueueExternalAgentWatch).not.toHaveBeenCalled()
  })

  test("hand-over text goes to the triggering contact inbox", async () => {
    mocks.startRun.mockRejectedValue(new mocks.HermesUnavailableError())
    mocks.failToHuman.mockImplementation(
      async ({ sendText }: { sendText: (text: string) => Promise<void> }) => {
        await sendText("Передал ваш запрос менеджеру")
      },
    )

    await run({ isFinalAttempt: true })

    expect(mocks.chatQueueAdd).toHaveBeenCalledWith(
      "sendChatMessage",
      {
        type: "sendChatMessage",
        data: {
          conversation,
          contactInbox,
          text: "Передал ваш запрос менеджеру",
        },
      },
      undefined,
    )
  })
})
