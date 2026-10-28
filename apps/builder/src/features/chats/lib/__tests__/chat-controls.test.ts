import { describe, expect, test } from "vitest"
import { canMutateChat } from "../chat-controls"

describe("canMutateChat", () => {
  test("allows a normal member to mutate a direct chat", () => {
    expect(
      canMutateChat({
        isBlocked: false,
        isSupportSession: false,
      }),
    ).toBe(true)
  })

  test("keeps support, blocked, and removed-peer sessions read-only", () => {
    expect(
      canMutateChat({ isBlocked: false, isSupportSession: true }),
    ).toBe(false)
    expect(
      canMutateChat({ isBlocked: true, isSupportSession: false }),
    ).toBe(false)
    expect(
      canMutateChat({
        hasRemovedPeer: true,
        isBlocked: false,
        isSupportSession: false,
      }),
    ).toBe(false)
  })
})
