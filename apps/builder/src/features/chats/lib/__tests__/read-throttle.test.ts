import { describe, expect, test } from "vitest"
import { canMarkChatRead } from "../read-throttle"

describe("canMarkChatRead", () => {
  test("throttles read markers for two seconds", () => {
    expect(
      canMarkChatRead({
        hasMessage: true,
        isPending: false,
        isSupportSession: false,
        lastMarkedAt: 1_000,
        now: 2_999,
      }),
    ).toBe(false)
    expect(
      canMarkChatRead({
        hasMessage: true,
        isPending: false,
        isSupportSession: false,
        lastMarkedAt: 1_000,
        now: 3_000,
      }),
    ).toBe(true)
  })

  test("never marks support sessions or pending mutations", () => {
    expect(
      canMarkChatRead({
        hasMessage: true,
        isPending: false,
        isSupportSession: true,
        lastMarkedAt: 0,
        now: 2_000,
      }),
    ).toBe(false)
    expect(
      canMarkChatRead({
        hasMessage: true,
        isPending: true,
        isSupportSession: false,
        lastMarkedAt: 0,
        now: 2_000,
      }),
    ).toBe(false)
  })
})
