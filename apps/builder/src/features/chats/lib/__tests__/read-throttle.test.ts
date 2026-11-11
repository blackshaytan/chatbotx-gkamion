import { describe, expect, test } from "vitest"
import { canMarkChatRead } from "../read-throttle"

describe("canMarkChatRead", () => {
  test("throttles read markers for two seconds", () => {
    expect(
      canMarkChatRead({
        hasMessage: true,
        isPending: false,
        isSupportSession: false,
        lastMarkedAt: 1000,
        now: 2999,
      }),
    ).toBe(false)
    expect(
      canMarkChatRead({
        hasMessage: true,
        isPending: false,
        isSupportSession: false,
        lastMarkedAt: 1000,
        now: 3000,
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
        now: 2000,
      }),
    ).toBe(false)
    expect(
      canMarkChatRead({
        hasMessage: true,
        isPending: true,
        isSupportSession: false,
        lastMarkedAt: 0,
        now: 2000,
      }),
    ).toBe(false)
  })
})
