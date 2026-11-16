import { beforeEach, describe, expect, test, vi } from "vitest"

const resumeDueBotsService = vi.fn()
const runExclusive = vi.fn(async ({ fn }: { fn: () => Promise<unknown> }) =>
  fn(),
)
const lockExists = vi.fn()
const info = vi.fn()
const warn = vi.fn()

vi.mock("@chatbotx.io/business", () => ({
  conversationService: { resumeDueBots: resumeDueBotsService },
}))
vi.mock("@chatbotx.io/redis", async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    distributedLock: { runExclusive },
    distributedStore: { exists: lockExists },
  }
})
vi.mock("@chatbotx.io/logger", () => ({
  getChildLogger: () => ({ info, warn }),
}))

const { resumeDueBots } = await import(
  "../src/schedule/handlers/resume-due-bots"
)

beforeEach(() => {
  resumeDueBotsService.mockReset()
  runExclusive.mockClear()
  lockExists.mockReset()
  lockExists.mockResolvedValue(false)
  info.mockReset()
  warn.mockReset()
  resumeDueBotsService.mockResolvedValue(0)
})

describe("resumeDueBots", () => {
  test("claims due pauses under the distributed lock", async () => {
    await resumeDueBots()

    expect(runExclusive).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "schedule:resume-due-bots",
        retryTimeoutInSeconds: 5,
        timeoutInSeconds: 50,
      }),
    )
    expect(resumeDueBotsService).toHaveBeenCalledWith({ limit: 200 })
  })

  test("keeps claiming while a batch is full", async () => {
    resumeDueBotsService
      .mockResolvedValueOnce(200)
      .mockResolvedValueOnce(200)
      .mockResolvedValueOnce(3)

    await resumeDueBots()

    expect(resumeDueBotsService).toHaveBeenCalledTimes(3)
    expect(info).toHaveBeenCalledWith(
      { resumed: 403 },
      "resumeDueBots: paused bots resumed",
    )
    expect(warn).not.toHaveBeenCalled()
  })

  test("warns when the per-run cap leaves a backlog", async () => {
    resumeDueBotsService.mockResolvedValue(200)

    await resumeDueBots()

    expect(resumeDueBotsService).toHaveBeenCalledTimes(10)
    expect(warn).toHaveBeenCalledWith(
      { resumed: 2000, batchSize: 200, maxBatches: 10 },
      "resumeDueBots: per-run batch cap hit; backlog remains for the next tick",
    )
  })

  test("does not log when nothing was due", async () => {
    await resumeDueBots()

    expect(info).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
  })

  test("skips when another run still holds the lock", async () => {
    const err = Object.assign(new Error("lock held"), {
      name: "LockAcquisitionError",
      code: "LOCK_ACQUISITION_FAILED",
      key: "schedule:resume-due-bots",
    })
    runExclusive.mockRejectedValueOnce(err)
    lockExists.mockResolvedValueOnce(true)

    await expect(resumeDueBots()).resolves.toBeUndefined()

    expect(resumeDueBotsService).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(
      { err },
      "resumeDueBots: skipped because another run still holds the lock",
    )
  })

  test("rethrows when the lock error is not a held lock", async () => {
    const err = Object.assign(new Error("redis unavailable"), {
      name: "LockAcquisitionError",
      code: "LOCK_ACQUISITION_FAILED",
      key: "schedule:resume-due-bots",
    })
    runExclusive.mockRejectedValueOnce(err)
    lockExists.mockResolvedValueOnce(false)

    await expect(resumeDueBots()).rejects.toBe(err)
    expect(resumeDueBotsService).not.toHaveBeenCalled()
  })

  test("skips when a local run is already in progress", async () => {
    let resolveRun: (() => void) | undefined
    resumeDueBotsService.mockImplementationOnce(
      () =>
        new Promise<number>((resolve) => {
          resolveRun = () => resolve(0)
        }),
    )

    const firstRun = resumeDueBots()
    await Promise.resolve()
    await expect(resumeDueBots()).resolves.toBeUndefined()

    expect(runExclusive).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(
      "resumeDueBots: skipped because a local run is still in progress",
    )

    resolveRun?.()
    await firstRun
  })
})
