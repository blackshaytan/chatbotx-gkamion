import { beforeEach, describe, expect, test, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  claimDueReminders: vi.fn(),
  claimOverdue: vi.fn(),
  notifyTaskReminder: vi.fn(),
  notifyTaskOverdue: vi.fn(),
  purgeOlderThan: vi.fn(),
  withBlockedOwnerGuard: vi.fn(
    async (_workspaceId: string, fn: () => Promise<void>) => {
      await fn()
    },
  ),
  runExclusive: vi.fn(async ({ fn }: { fn: () => Promise<void> }) => {
    await fn()
  }),
  loggerError: vi.fn(),
  loggerInfo: vi.fn(),
}))

vi.mock("@chatbotx.io/database/repositories", () => ({
  taskRepository: {
    claimDueReminders: mocks.claimDueReminders,
    claimOverdue: mocks.claimOverdue,
  },
}))

vi.mock("@chatbotx.io/business", () => ({
  notificationService: {
    notifyTaskReminder: mocks.notifyTaskReminder,
    notifyTaskOverdue: mocks.notifyTaskOverdue,
    purgeOlderThan: mocks.purgeOlderThan,
  },
  withBlockedOwnerGuard: mocks.withBlockedOwnerGuard,
}))

vi.mock("@chatbotx.io/redis", () => ({
  distributedLock: {
    runExclusive: mocks.runExclusive,
  },
}))

vi.mock("../src/lib/logger", () => ({
  logger: {
    error: mocks.loggerError,
    info: mocks.loggerInfo,
    warn: vi.fn(),
  },
}))

const { taskDueScan } = await import("../src/schedule/handlers/task-due-scan")
const { purgeOldNotifications } = await import(
  "../src/schedule/handlers/purge-old-notifications"
)

const makeTask = (overrides: Record<string, unknown> = {}) => ({
  id: "task-1",
  workspaceId: "ws-1",
  title: "Reminder task",
  assigneeUserId: "user-1",
  assigneeTeamId: null,
  createdByUserId: "user-2",
  ...overrides,
})

describe("taskDueScan", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.claimDueReminders.mockResolvedValue([])
    mocks.claimOverdue.mockResolvedValue([])
    mocks.notifyTaskReminder.mockResolvedValue(undefined)
    mocks.notifyTaskOverdue.mockResolvedValue(undefined)
  })

  test("uses distributed lock with the task due scan key", async () => {
    await taskDueScan()

    expect(mocks.runExclusive).toHaveBeenCalledWith(
      expect.objectContaining({ key: "schedule:task-due-scan" }),
    )
  })

  test("sends a reminder only once when claim returns empty on the second run", async () => {
    mocks.claimDueReminders
      .mockResolvedValueOnce([makeTask()])
      .mockResolvedValueOnce([])
    mocks.claimOverdue.mockResolvedValue([])

    await taskDueScan()
    await taskDueScan()

    expect(mocks.notifyTaskReminder).toHaveBeenCalledTimes(1)
  })

  test("sends overdue only once when claim returns empty on the second run", async () => {
    mocks.claimDueReminders.mockResolvedValue([])
    mocks.claimOverdue
      .mockResolvedValueOnce([makeTask({ id: "task-overdue" })])
      .mockResolvedValueOnce([])

    await taskDueScan()
    await taskDueScan()

    expect(mocks.notifyTaskOverdue).toHaveBeenCalledTimes(1)
  })

  test("skips notification delivery for blocked workspaces", async () => {
    mocks.claimDueReminders.mockResolvedValueOnce([makeTask()])
    mocks.withBlockedOwnerGuard.mockImplementationOnce(() => Promise.resolve())

    await taskDueScan()

    expect(mocks.withBlockedOwnerGuard).toHaveBeenCalledWith(
      "ws-1",
      expect.any(Function),
    )
    expect(mocks.notifyTaskReminder).not.toHaveBeenCalled()
  })

  test("processes at most ten reminder batches per run", async () => {
    const fullBatch = Array.from({ length: 200 }, (_, index) =>
      makeTask({ id: `task-${index}` }),
    )
    mocks.claimDueReminders.mockResolvedValue(fullBatch)
    mocks.claimOverdue.mockResolvedValue([])

    await taskDueScan()

    expect(mocks.claimDueReminders).toHaveBeenCalledTimes(10)
    expect(mocks.notifyTaskReminder).toHaveBeenCalledTimes(2000)
  })
})

describe("purgeOldNotifications", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-10-23T12:00:00.000Z"))
    mocks.purgeOlderThan.mockReset()
  })

  test("purges notifications older than ninety days in batches", async () => {
    mocks.purgeOlderThan.mockResolvedValueOnce(5000).mockResolvedValueOnce(120)

    await purgeOldNotifications()

    expect(mocks.purgeOlderThan).toHaveBeenCalledTimes(2)
    expect(mocks.purgeOlderThan.mock.calls[0]?.[0]).toMatchObject({
      limit: 5000,
      before: new Date("2026-07-25T12:00:00.000Z"),
    })
  })
})
