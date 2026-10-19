import { describe, expect, test } from "vitest"
import { resolvePostConnectStep } from "../src/post-connect"

describe("resolvePostConnectStep", () => {
  test("startsPaused providers pause instead of subscribing", () => {
    expect(resolvePostConnectStep({ startsPaused: true })).toBe("pause")
  })

  test("other providers subscribe their webhook", () => {
    expect(resolvePostConnectStep({})).toBe("subscribe")
    expect(resolvePostConnectStep({ startsPaused: false })).toBe("subscribe")
  })
})
