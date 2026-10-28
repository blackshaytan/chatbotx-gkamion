import { UnrecoverableError } from "bullmq"
import { beforeEach, expect, test, vi } from "vitest"

const mocks = vi.hoisted(() => {
  class HermesAuthError extends Error {}
  class HermesUnavailableError extends Error {}
  class HermesRequestError extends Error {
    readonly status: number
    constructor(status: number) {
      super("request failed")
      this.status = status
    }
  }
  return {
    HermesAuthError,
    HermesUnavailableError,
    HermesRequestError,
    guard: vi.fn(async (_id: string, fn: () => Promise<unknown>) => fn()),
    lock: vi.fn(async (_key: string, fn: () => Promise<unknown>) => fn()),
    load: vi.fn(),
    build: vi.fn(),
    attachments: vi.fn(),
    get: vi.fn(),
    put: vi.fn(),
    enqueueReply: vi.fn(),
    enqueueWatch: vi.fn(),
    save: vi.fn(),
    patch: vi.fn(),
    typing: vi.fn(),
    post: vi.fn(),
    log: vi.fn(),
    start: vi.fn(),
    steer: vi.fn(),
    stop: vi.fn(),
  }
})
vi.mock("@chatbotx.io/business", () => ({
  buildStaffRunInput: mocks.build,
  HermesAuthError: mocks.HermesAuthError,
  HermesUnavailableError: mocks.HermesUnavailableError,
  HermesRequestError: mocks.HermesRequestError,
  loadStaffAssistantTurn: mocks.load,
  logProviderError: mocks.log,
  toStaffAssistantInputMessages: mocks.attachments,
  withBlockedOwnerGuard: mocks.guard,
  staffAssistantService: {
    saveRunState: mocks.save,
    patchRunState: mocks.patch,
    publishTyping: mocks.typing,
    postAssistantMessage: mocks.post,
  },
}))
vi.mock("@chatbotx.io/redis", () => ({
  distributedStore: { get: mocks.get, put: mocks.put },
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
const { processStaffAssistantReply } = await import(
  "../src/ai-agent/handlers/staff-assistant-reply"
)
const data = { workspaceId: "ws", threadId: "thread", messageId: "message" }
const createdAt = new Date()
const turn = () => ({
  ...data,
  userId: "user",
  name: "User",
  role: "member",
  permissions: {},
  newMessages: [{ id: "message", createdAt }],
  history: [],
  state: undefined,
  runtime: {
    agent: { maxRunMinutes: 30 },
    client: { startRun: mocks.start, steer: mocks.steer },
  },
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.load.mockResolvedValue(turn())
  mocks.attachments.mockResolvedValue([])
  mocks.build.mockReturnValue({ input: "input", instructions: "instructions" })
  mocks.start.mockResolvedValue({ runId: "run" })
  mocks.get.mockResolvedValue(null)
})

test("starts a per-employee run and saves its cursor only after acceptance", async () => {
  await processStaffAssistantReply(data, { isFinalAttempt: false })
  expect(mocks.start).toHaveBeenCalledWith({
    sessionKey: "chatbotx:ws:staff:user",
    idempotencyKey: "staff:thread:message",
    input: "input",
    instructions: "instructions",
  })
  expect(mocks.save).toHaveBeenCalledWith(
    expect.objectContaining({
      values: expect.objectContaining({
        cursorAt: createdAt,
        cursorMessageId: "message",
        runId: "run",
      }),
    }),
  )
  expect(mocks.start.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.save.mock.invocationCallOrder[0],
  )
  expect(mocks.enqueueWatch).toHaveBeenCalledWith({
    workspaceId: "ws",
    threadId: "thread",
    runId: "run",
  })
})

test("blocked owners do not start a run", async () => {
  mocks.guard.mockImplementationOnce(async () => undefined)
  await processStaffAssistantReply(data, { isFinalAttempt: false })
  expect(mocks.load).not.toHaveBeenCalled()
  expect(mocks.start).not.toHaveBeenCalled()
})

test("requeues a steer conflict without advancing the cursor", async () => {
  mocks.load.mockResolvedValue({
    ...turn(),
    state: { runId: "run", runStartedAt: new Date() },
  })
  mocks.steer.mockRejectedValue(new mocks.HermesRequestError(409))
  await processStaffAssistantReply(data, { isFinalAttempt: false })
  expect(mocks.enqueueReply).toHaveBeenCalledWith(data)
  expect(mocks.patch).not.toHaveBeenCalled()
})

test("reports authentication failure once and stops retries", async () => {
  mocks.start.mockRejectedValue(new mocks.HermesAuthError("denied"))
  await expect(
    processStaffAssistantReply(data, { isFinalAttempt: false }),
  ).rejects.toBeInstanceOf(UnrecoverableError)
  expect(mocks.post).toHaveBeenCalledWith(
    expect.objectContaining({
      dedupeKey: "staffAssistant:thread:message:failed",
      message: { kind: "system", reason: "unavailable" },
    }),
  )
})

test("retries unavailable Hermes before creating a failure message", async () => {
  mocks.start.mockRejectedValue(new mocks.HermesUnavailableError("unavailable"))
  await expect(
    processStaffAssistantReply(data, { isFinalAttempt: false }),
  ).rejects.toBeInstanceOf(mocks.HermesUnavailableError)
  expect(mocks.post).not.toHaveBeenCalled()
  await processStaffAssistantReply(data, { isFinalAttempt: true })
  expect(mocks.post).toHaveBeenCalledWith(
    expect.objectContaining({
      message: { kind: "system", reason: "unavailable" },
    }),
  )
})
