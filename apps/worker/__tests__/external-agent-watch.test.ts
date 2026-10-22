import { UnrecoverableError } from "bullmq"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

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
    findConversation: vi.fn(),
    findContactInbox: vi.fn(),
    getRuntime: vi.fn(),
    getRuntimeForWorkspace: vi.fn(),
    findConversationState: vi.fn(),
    patchConversationState: vi.fn(),
    failToHuman: vi.fn(),
    listMessages: vi.fn(),
    enqueueExternalAgentReply: vi.fn(),
    enqueueExternalAgentWatch: vi.fn(),
    chatQueueAdd: vi.fn(),
    readEvents: vi.fn(),
    getRun: vi.fn(),
    stop: vi.fn(),
  }
})

vi.mock("@chatbotx.io/business", async () => {
  const progress = await vi.importActual<
    typeof import("../../../packages/business/src/external-agent/progress")
  >("../../../packages/business/src/external-agent/progress")
  return {
    buildAttachmentProxyUrl: vi.fn(),
    contactInboxService: { findByUncached: mocks.findContactInbox },
    conversationService: { findByUncached: mocks.findConversation },
    decideFallback: progress.decideFallback,
    decideInterim: progress.decideInterim,
    decideLimit: progress.decideLimit,
    externalAgentService: {
      getRuntime: mocks.getRuntime,
      getRuntimeForWorkspace: mocks.getRuntimeForWorkspace,
      findConversationState: mocks.findConversationState,
      patchConversationState: mocks.patchConversationState,
      failToHuman: mocks.failToHuman,
    },
    HermesAuthError: mocks.HermesAuthError,
    HermesRequestError: mocks.HermesRequestError,
    HermesUnavailableError: mocks.HermesUnavailableError,
    isFailedOriginPath: () => false,
    messageService: { listLastMessagesWithAttachments: mocks.listMessages },
    withBlockedOwnerGuard: mocks.withBlockedOwnerGuard,
  }
})

vi.mock("@chatbotx.io/redis", () => ({
  distributedLock: { runExclusive: mocks.runExclusive },
  distributedStore: { get: vi.fn(), put: vi.fn() },
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

const { processExternalAgentWatch, EXTERNAL_AGENT_WATCH_WINDOW_MS } =
  await import("../src/ai-agent/handlers/external-agent-watch")

const NOW = new Date("2026-10-21T10:00:00.000Z")
const ago = (ms: number) => new Date(NOW.getTime() - ms)
const SECOND = 1000
const MINUTE = 60 * SECOND

const data = {
  workspaceId: "ws-1",
  conversationId: "conv-1",
  contactInboxId: "ci-1",
  runId: "run-1",
}

const conversation = {
  id: "conv-1",
  workspaceId: "ws-1",
  contactId: "contact-1",
  botEnabled: true,
}
const disabledConversation = { ...conversation, botEnabled: false }
const contactInbox = {
  id: "ci-1",
  contactId: "contact-1",
  inboxId: "inbox-1",
  channel: "max",
}
const client = {
  readEvents: mocks.readEvents,
  getRun: mocks.getRun,
  stop: mocks.stop,
}
const runtime = {
  agent: { maxRunMinutes: 30, progressMessage: "  Работаю над запросом  " },
  client,
}

const state = (overrides: Record<string, unknown> = {}) => ({
  conversationId: "conv-1",
  workspaceId: "ws-1",
  cursorAt: ago(20 * SECOND),
  cursorMessageId: "m-1",
  includeHistory: false,
  runId: "run-1",
  runStartedAt: ago(20 * SECOND),
  lastEventAt: ago(5 * SECOND),
  lastEventSeq: 2,
  lastProgressSentAt: null,
  lastProgressText: null,
  lastClientSendAt: null,
  progressFallbackSentAt: null,
  failureCount: 0,
  lastError: null,
  ...overrides,
})

type StreamEvent = { id: number | null; data: Record<string, unknown> }

const streamEvents = (
  events: StreamEvent[],
  result = { closed: false, notFound: false },
) => {
  mocks.readEvents.mockImplementation(
    ({ onEvent }: { onEvent: (event: StreamEvent) => void }) => {
      for (const event of events) {
        onEvent(event)
      }
      return Promise.resolve(result)
    },
  )
}

const sentTexts = () =>
  mocks.chatQueueAdd.mock.calls.map(
    (call) => (call[1] as { data: { text: string } }).data.text,
  )

const patchedValues = () =>
  mocks.patchConversationState.mock.calls.map(
    (call) => (call[0] as { values: Record<string, unknown> }).values,
  )

const run = (options = { isFinalAttempt: false }) =>
  processExternalAgentWatch(data, options)

describe("processExternalAgentWatch", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(NOW)
    mocks.findConversation.mockResolvedValue(conversation)
    mocks.findContactInbox.mockResolvedValue(contactInbox)
    mocks.getRuntime.mockResolvedValue(runtime)
    mocks.getRuntimeForWorkspace.mockResolvedValue(runtime)
    mocks.findConversationState.mockResolvedValue(state())
    mocks.patchConversationState.mockResolvedValue(1)
    mocks.listMessages.mockResolvedValue([])
    mocks.getRun.mockResolvedValue({
      status: "running",
      output: null,
      error: null,
    })
    streamEvents([])
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test("reads one 15 s window from the last seen event under the guard and lock", async () => {
    await run()

    expect(EXTERNAL_AGENT_WATCH_WINDOW_MS).toBe(15_000)
    expect(mocks.withBlockedOwnerGuard).toHaveBeenCalledWith(
      "ws-1",
      expect.any(Function),
    )
    expect(mocks.readEvents).toHaveBeenCalledWith({
      runId: "run-1",
      lastSeq: 2,
      windowMs: 15_000,
      onEvent: expect.any(Function),
    })
    expect(mocks.runExclusive).toHaveBeenCalledWith(
      expect.objectContaining({ key: "externalAgent:conv-1" }),
    )
    expect(mocks.enqueueExternalAgentWatch).toHaveBeenCalledWith(data, 0)
  })

  test("relays a new interim message and records it", async () => {
    streamEvents([
      { id: 3, data: { event: "message.interim", text: " Ищу запчасть " } },
    ])

    await run()

    expect(mocks.chatQueueAdd).toHaveBeenCalledWith(
      "sendChatMessage",
      {
        type: "sendChatMessage",
        data: {
          conversation,
          contactInbox,
          text: "Ищу запчасть",
          signAs: "externalAgent",
        },
      },
      { jobId: "externalAgentSend-conv-1-run-1-interim-3" },
    )
    expect(mocks.patchConversationState).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      conversationId: "conv-1",
      values: {
        lastEventSeq: 3,
        lastEventAt: NOW,
        lastProgressSentAt: NOW,
        lastProgressText: "Ищу запчасть",
        lastClientSendAt: NOW,
      },
      expectedRunId: "run-1",
    })
    expect(mocks.enqueueExternalAgentWatch).toHaveBeenCalledWith(data, 0)
  })

  test("skips a repeated interim message", async () => {
    mocks.findConversationState.mockResolvedValue(
      state({
        lastProgressSentAt: ago(2 * MINUTE),
        lastProgressText: "ищу запчасть",
      }),
    )
    streamEvents([
      { id: 3, data: { event: "message.interim", text: "Ищу запчасть" } },
    ])

    await run()

    expect(mocks.chatQueueAdd).not.toHaveBeenCalled()
    expect(patchedValues()).toContainEqual(
      expect.objectContaining({ lastEventSeq: 3 }),
    )
  })

  test("skips an interim message sooner than 30 s after the previous one", async () => {
    mocks.findConversationState.mockResolvedValue(
      state({ lastProgressSentAt: ago(10 * SECOND), lastProgressText: "Ищу" }),
    )
    streamEvents([
      { id: 3, data: { event: "message.interim", text: "Нашёл три варианта" } },
    ])

    await run()

    expect(mocks.chatQueueAdd).not.toHaveBeenCalled()
  })

  test("tool and delta events only move the tracking", async () => {
    streamEvents([
      { id: 3, data: { event: "tool.started", tool: "search" } },
      { id: 4, data: { event: "message.delta", delta: "Нашё" } },
    ])

    await run()

    expect(mocks.chatQueueAdd).not.toHaveBeenCalled()
    expect(patchedValues()).toEqual([
      {
        lastEventSeq: 4,
        lastEventAt: NOW,
        lastProgressSentAt: null,
        lastProgressText: null,
        lastClientSendAt: null,
      },
    ])
    expect(mocks.enqueueExternalAgentWatch).toHaveBeenCalledWith(data, 0)
  })

  test("ignores events already applied by a previous window", async () => {
    streamEvents([
      { id: 2, data: { event: "message.interim", text: "Уже отправлено" } },
    ])

    await run()

    expect(mocks.chatQueueAdd).not.toHaveBeenCalled()
    expect(patchedValues()[0]).toMatchObject({ lastEventSeq: 2 })
  })

  test("run.completed sends the final reply, closes the run and picks up new messages", async () => {
    mocks.listMessages.mockResolvedValue([
      {
        id: "m-1",
        messageType: "incoming",
        senderType: "contact",
        createdAt: ago(20 * SECOND),
        attachments: [],
      },
      {
        id: "m-2",
        messageType: "incoming",
        senderType: "contact",
        createdAt: ago(3 * SECOND),
        attachments: [],
      },
    ])
    streamEvents([
      {
        id: 3,
        data: { event: "run.completed", output: " Готово: 3 позиции " },
      },
    ])

    await run()

    expect(mocks.chatQueueAdd).toHaveBeenCalledWith(
      "sendChatMessage",
      {
        type: "sendChatMessage",
        data: {
          conversation,
          contactInbox,
          text: "Готово: 3 позиции",
          signAs: "externalAgent",
        },
      },
      { jobId: "externalAgentSend-conv-1-run-1-final" },
    )
    expect(mocks.patchConversationState).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      conversationId: "conv-1",
      values: expect.objectContaining({
        lastEventSeq: 3,
        runId: null,
        runStartedAt: null,
        failureCount: 0,
        lastError: null,
        lastClientSendAt: NOW,
      }),
      expectedRunId: "run-1",
    })
    expect(mocks.enqueueExternalAgentReply).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      conversationId: "conv-1",
      contactInboxId: "ci-1",
      messageId: "m-2",
    })
    expect(mocks.enqueueExternalAgentWatch).not.toHaveBeenCalled()
  })

  test("run.completed without new contact messages queues no reply", async () => {
    streamEvents([
      { id: 3, data: { event: "run.completed", output: "Готово" } },
    ])

    await run()

    expect(sentTexts()).toEqual(["Готово"])
    expect(mocks.enqueueExternalAgentReply).not.toHaveBeenCalled()
  })

  test("an empty final output is read from the run", async () => {
    mocks.getRun.mockResolvedValue({
      status: "completed",
      output: "Ответ из getRun",
      error: null,
    })
    streamEvents([{ id: 3, data: { event: "run.completed", output: "" } }])

    await run()

    expect(mocks.getRun).toHaveBeenCalledWith("run-1")
    expect(sentTexts()).toEqual(["Ответ из getRun"])
  })

  test("a run completed after the bot was turned off sends nothing", async () => {
    mocks.findConversation
      .mockResolvedValueOnce(conversation)
      .mockResolvedValueOnce(conversation)
      .mockResolvedValue(disabledConversation)
    streamEvents([
      { id: 3, data: { event: "run.completed", output: "Готово" } },
    ])

    await run()

    expect(mocks.chatQueueAdd).not.toHaveBeenCalled()
    expect(patchedValues()).toContainEqual(
      expect.objectContaining({ runId: null, runStartedAt: null }),
    )
    expect(mocks.enqueueExternalAgentReply).not.toHaveBeenCalled()
  })

  test("a turned-off bot stops the run without reading events", async () => {
    mocks.findConversation.mockResolvedValue(disabledConversation)

    await run()

    expect(mocks.stop).toHaveBeenCalledWith("run-1")
    expect(mocks.readEvents).not.toHaveBeenCalled()
    expect(mocks.patchConversationState).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      conversationId: "conv-1",
      values: { runId: null, runStartedAt: null },
      expectedRunId: "run-1",
    })
    expect(mocks.chatQueueAdd).not.toHaveBeenCalled()
    expect(mocks.enqueueExternalAgentWatch).not.toHaveBeenCalled()
  })

  test.each([
    "run.failed",
    "run.cancelled",
    "run.interrupted",
  ])("%s hands the conversation over to a human", async (event) => {
    streamEvents([{ id: 3, data: { event, error: "boom" } }])

    await run()

    expect(patchedValues()).toContainEqual(
      expect.objectContaining({
        runId: null,
        runStartedAt: null,
        failureCount: 1,
        lastError: "boom",
      }),
    )
    expect(mocks.failToHuman).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws-1",
        conversationId: "conv-1",
        contactInboxId: "ci-1",
        event: "unavailable",
      }),
    )
    expect(mocks.enqueueExternalAgentWatch).not.toHaveBeenCalled()
  })

  test("an approval request stops the run and hands over", async () => {
    streamEvents([
      { id: 3, data: { event: "approval.request", command: "rm -rf /" } },
    ])

    await run()

    expect(mocks.stop).toHaveBeenCalledWith("run-1")
    expect(mocks.failToHuman).toHaveBeenCalledWith(
      expect.objectContaining({ event: "unavailable" }),
    )
  })

  test("sends the progress message once after 90 s of silence", async () => {
    mocks.findConversationState.mockResolvedValue(
      state({ runStartedAt: ago(95 * SECOND) }),
    )

    await run()

    expect(mocks.chatQueueAdd).toHaveBeenCalledWith(
      "sendChatMessage",
      {
        type: "sendChatMessage",
        data: {
          conversation,
          contactInbox,
          text: "Работаю над запросом",
          signAs: "externalAgent",
        },
      },
      { jobId: "externalAgentSend-conv-1-run-1-fallback" },
    )
    expect(patchedValues()).toContainEqual({
      progressFallbackSentAt: NOW,
      lastClientSendAt: NOW,
    })
    expect(mocks.enqueueExternalAgentWatch).toHaveBeenCalledWith(data, 0)
  })

  test("does not repeat the progress message", async () => {
    mocks.findConversationState.mockResolvedValue(
      state({
        runStartedAt: ago(5 * MINUTE),
        lastEventAt: ago(10 * SECOND),
        progressFallbackSentAt: ago(3 * MINUTE),
      }),
    )

    await run()

    expect(mocks.chatQueueAdd).not.toHaveBeenCalled()
  })

  test("a run without events for 5 minutes is stopped and handed over", async () => {
    mocks.findConversationState.mockResolvedValue(
      state({
        runStartedAt: ago(7 * MINUTE),
        lastEventAt: ago(6 * MINUTE),
        progressFallbackSentAt: ago(5 * MINUTE),
      }),
    )

    await run()

    expect(mocks.stop).toHaveBeenCalledWith("run-1")
    expect(mocks.failToHuman).toHaveBeenCalledWith(
      expect.objectContaining({ event: "timeout" }),
    )
    expect(patchedValues()).toContainEqual(
      expect.objectContaining({ runId: null, failureCount: 1 }),
    )
    expect(mocks.enqueueExternalAgentWatch).not.toHaveBeenCalled()
  })

  test("a run over maxRunMinutes is stopped and handed over", async () => {
    mocks.findConversationState.mockResolvedValue(
      state({ runStartedAt: ago(31 * MINUTE), lastEventAt: ago(SECOND) }),
    )

    await run()

    expect(mocks.stop).toHaveBeenCalledWith("run-1")
    expect(mocks.failToHuman).toHaveBeenCalledWith(
      expect.objectContaining({ event: "timeout" }),
    )
  })

  test("a run the stream no longer knows is settled from its status", async () => {
    streamEvents([], { closed: false, notFound: true })
    mocks.getRun.mockResolvedValue({
      status: "completed",
      output: "Финальный ответ",
      error: null,
    })

    await run()

    expect(sentTexts()).toEqual(["Финальный ответ"])
    expect(patchedValues()).toContainEqual(
      expect.objectContaining({ runId: null }),
    )
    expect(mocks.enqueueExternalAgentWatch).not.toHaveBeenCalled()
  })

  test("a closed stream for a running run is watched again after 5 s", async () => {
    streamEvents([], { closed: true, notFound: false })

    await run()

    expect(mocks.getRun).toHaveBeenCalledWith("run-1")
    expect(mocks.enqueueExternalAgentWatch).toHaveBeenCalledWith(data, 5000)
  })

  test("a run already cleared from the conversation is stopped and nothing is sent", async () => {
    mocks.findConversationState.mockResolvedValue(state({ runId: null }))

    await run()

    expect(mocks.stop).toHaveBeenCalledWith("run-1")
    expect(mocks.readEvents).not.toHaveBeenCalled()
    expect(mocks.chatQueueAdd).not.toHaveBeenCalled()
    expect(mocks.patchConversationState).not.toHaveBeenCalled()
    expect(mocks.enqueueExternalAgentWatch).not.toHaveBeenCalled()
  })

  test("a run replaced while reading is left alone", async () => {
    mocks.findConversationState
      .mockResolvedValueOnce(state())
      .mockResolvedValue(state({ runId: "run-2" }))
    streamEvents([
      { id: 3, data: { event: "run.completed", output: "Готово" } },
    ])

    await run()

    expect(mocks.chatQueueAdd).not.toHaveBeenCalled()
    expect(mocks.patchConversationState).not.toHaveBeenCalled()
    expect(mocks.enqueueExternalAgentWatch).not.toHaveBeenCalled()
  })

  test("stops quietly when the guarded state patch matches no row", async () => {
    mocks.patchConversationState.mockResolvedValue(0)
    streamEvents([{ id: 3, data: { event: "tool.started" } }])

    await run()

    expect(mocks.chatQueueAdd).not.toHaveBeenCalled()
    expect(mocks.failToHuman).not.toHaveBeenCalled()
    expect(mocks.enqueueExternalAgentWatch).not.toHaveBeenCalled()
  })

  test("Hermes unavailable before the last attempt is retried by BullMQ", async () => {
    const error = new mocks.HermesUnavailableError()
    mocks.readEvents.mockRejectedValue(error)

    await expect(run({ isFinalAttempt: false })).rejects.toBe(error)

    expect(mocks.failToHuman).not.toHaveBeenCalled()
    expect(mocks.enqueueExternalAgentWatch).not.toHaveBeenCalled()
  })

  test("Hermes unavailable on the last attempt hands over to a human", async () => {
    mocks.readEvents.mockRejectedValue(new mocks.HermesUnavailableError())

    await expect(run({ isFinalAttempt: true })).resolves.toBeUndefined()

    expect(mocks.failToHuman).toHaveBeenCalledWith(
      expect.objectContaining({ event: "unavailable" }),
    )
    expect(patchedValues()).toContainEqual(
      expect.objectContaining({ runId: null, failureCount: 1 }),
    )
  })

  test("Hermes auth error hands over without retries", async () => {
    mocks.readEvents.mockRejectedValue(new mocks.HermesAuthError())

    await expect(run()).rejects.toBeInstanceOf(UnrecoverableError)

    expect(mocks.failToHuman).toHaveBeenCalledWith(
      expect.objectContaining({ event: "unavailable" }),
    )
  })
})
