import { beforeEach, expect, test, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  HermesRequestError: class extends Error {},
  guard: vi.fn(async (_id: string, fn: () => Promise<unknown>) => fn()),
  lock: vi.fn(async (_key: string, fn: () => Promise<unknown>) => fn()),
  load: vi.fn(),
  member: vi.fn(),
  getClient: vi.fn(),
  patch: vi.fn(),
  post: vi.fn(),
  typing: vi.fn(),
  log: vi.fn(),
  stop: vi.fn(),
  getRun: vi.fn(),
  enqueueReply: vi.fn(),
  enqueueWatch: vi.fn(),
  read: vi.fn(),
}))
vi.mock("@chatbotx.io/business", () => ({
  HermesRequestError: mocks.HermesRequestError,
  findStaffChatParticipant: mocks.member,
  loadStaffAssistantTurn: mocks.load,
  logProviderError: mocks.log,
  withBlockedOwnerGuard: mocks.guard,
  staffAssistantService: {
    getClientForWorkspace: mocks.getClient,
    patchRunState: mocks.patch,
    postAssistantMessage: mocks.post,
    publishTyping: mocks.typing,
  },
}))
vi.mock("@chatbotx.io/worker-config", () => ({
  enqueueStaffAssistantReply: mocks.enqueueReply,
  enqueueStaffAssistantWatch: mocks.enqueueWatch,
}))
vi.mock("../src/ai-agent/handlers/external-agent-shared", () => ({
  withRunLock: mocks.lock,
  stopRunQuietly: mocks.stop,
}))
vi.mock("../src/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn() },
}))
vi.mock("../src/ai-agent/handlers/external-agent-run-follower", () => ({
  readRunEvents: mocks.read,
  readOutputText: (value: unknown) =>
    typeof value === "string" ? value.trim() : "",
  applyRunEvent: async (
    port: { complete: (text: string) => Promise<void> },
    event: { data: { output: string } },
  ) => {
    await port.complete(event.data.output)
    return true
  },
  processRunWindow: async (
    read: { events: unknown[]; error: unknown },
    port: {
      applyEvent: (event: unknown) => Promise<boolean>
      handleError: (error: unknown) => Promise<void>
    },
  ) => {
    for (const event of read.events) {
      if (await port.applyEvent(event)) {
        return
      }
    }
    if (read.error !== null) {
      await port.handleError(read.error)
    }
  },
  settleRunStatus: vi.fn(),
  checkRunLimit: vi.fn(),
  handleRunWatchError: vi.fn(),
}))
const { processStaffAssistantWatch } = await import(
  "../src/ai-agent/handlers/staff-assistant-watch"
)
const data = { workspaceId: "ws", threadId: "thread", runId: "run" }
const turn = () => ({
  userId: "user",
  newMessages: [],
  state: {
    runId: "run",
    runStartedAt: new Date(),
    lastEventSeq: -1,
    lastEventAt: null,
    lastProgressSentAt: null,
    lastProgressText: null,
    lastClientSendAt: null,
    failureCount: 0,
  },
  runtime: { agent: { maxRunMinutes: 30 }, client: { getRun: mocks.getRun } },
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.load.mockResolvedValue(turn())
  mocks.read.mockResolvedValue({
    events: [{ data: { output: "Done" } }],
    result: null,
    error: null,
  })
  mocks.patch.mockResolvedValue(1)
  mocks.member.mockResolvedValue({ userId: "user", isWorkspaceMember: true })
})

test("publishes a deduplicated final reply and ends typing", async () => {
  await processStaffAssistantWatch(data, { isFinalAttempt: false })
  expect(mocks.post).toHaveBeenCalledWith(
    expect.objectContaining({
      userId: "user",
      expectedRunId: "run",
      dedupeKey: "staffAssistant:run:final",
      message: { kind: "comment", text: "Done" },
    }),
  )
  expect(mocks.patch).toHaveBeenCalledWith(
    expect.objectContaining({
      expectedRunId: "run",
      values: expect.objectContaining({ runId: null }),
    }),
  )
  expect(mocks.typing).toHaveBeenCalledWith(
    expect.objectContaining({ userId: "user", typing: false }),
  )
})

test("stops a disabled assistant run and emits no message", async () => {
  mocks.load.mockResolvedValue(null)
  mocks.getClient.mockResolvedValue({ stop: vi.fn() })
  await processStaffAssistantWatch(data, { isFinalAttempt: false })
  expect(mocks.stop).toHaveBeenCalled()
  expect(mocks.post).not.toHaveBeenCalled()
  expect(mocks.typing).toHaveBeenCalledWith(
    expect.objectContaining({ userId: "user", typing: false }),
  )
})

test("does not turn off typing for a replacement run", async () => {
  mocks.load.mockResolvedValue({
    ...turn(),
    state: { ...turn().state, runId: "new-run" },
  })
  mocks.patch.mockResolvedValue(0)
  await processStaffAssistantWatch(data, { isFinalAttempt: false })
  expect(mocks.typing).not.toHaveBeenCalled()
  expect(mocks.post).not.toHaveBeenCalled()
})

test("blocked owners do not load or publish anything", async () => {
  mocks.guard.mockImplementationOnce(async () => undefined)
  await processStaffAssistantWatch(data, { isFinalAttempt: false })
  expect(mocks.load).not.toHaveBeenCalled()
  expect(mocks.post).not.toHaveBeenCalled()
  expect(mocks.typing).not.toHaveBeenCalled()
})

test("does not retry a Hermes request error and publishes a failure", async () => {
  mocks.read.mockResolvedValue({
    events: [],
    result: null,
    error: new mocks.HermesRequestError("bad request"),
  })
  await expect(
    processStaffAssistantWatch(data, { isFinalAttempt: false }),
  ).rejects.toMatchObject({ name: "UnrecoverableError" })
  expect(mocks.post).toHaveBeenCalledWith(
    expect.objectContaining({
      message: { kind: "system", reason: "unavailable" },
    }),
  )
})
