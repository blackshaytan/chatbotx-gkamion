import { afterEach, describe, expect, test, vi } from "vitest"
import { acquireRequestSlot } from "../src/lib/shared/request-lane"

describe("acquireRequestSlot", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  test("spaces requests of one key from the previous release", async () => {
    vi.useFakeTimers()
    const started: string[] = []
    const first = acquireRequestSlot("key-a", 3000).then((release) => {
      started.push("first")
      return release
    })
    const second = acquireRequestSlot("key-a", 3000).then((release) => {
      started.push("second")
      release()
    })
    const releaseFirst = await first
    await vi.advanceTimersByTimeAsync(10_000)
    expect(started).toEqual(["first"])

    releaseFirst()
    await vi.advanceTimersByTimeAsync(2999)
    expect(started).toEqual(["first"])
    await vi.advanceTimersByTimeAsync(1)
    await second
    expect(started).toEqual(["first", "second"])
  })

  test("does not hold back other keys", async () => {
    const releaseA = await acquireRequestSlot("key-b", 60_000)
    const releaseC = await acquireRequestSlot("key-c", 60_000)
    releaseA()
    releaseC()
  })
})
