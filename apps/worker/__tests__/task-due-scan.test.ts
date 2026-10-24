import { beforeEach, describe, expect, test, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  processDueTaskNotifications: vi.fn(),
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

vi.mock("@chatbotx.io/business", () => ({
  notificationService: {
    processDueTaskNotifications: mocks.processDueTaskNotifications,
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

describe("taskDueScan", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.processDueTaskNotifications.mockResolvedValue({
      reminders: 0,
      overdue: 0,
    })
  })

  test("uses distributed lock with the task due scan key", async () => {
    await taskDueScan()

    expect(mocks.runExclusive).toHaveBeenCalledWith(
      expect.objectContaining({ key: "schedule:task-due-scan" }),
    )
  })

  test("delegates scan batches to notificationService under the guard", async () => {
    mocks.processDueTaskNotifications.mockResolvedValueOnce({
      reminders: 3,
      overdue: 1,
    })

    await taskDueScan()

    expect(mocks.processDueTaskNotifications).toHaveBeenCalledWith(
      expect.objectContaining({
        batchSize: 200,
        maxBatches: 10,
        guard: mocks.withBlockedOwnerGuard,
      }),
    )
    expect(mocks.loggerInfo).toHaveBeenCalledWith(
      { reminders: 3, overdue: 1 },
      "Task due scan processed notifications",
    )
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
