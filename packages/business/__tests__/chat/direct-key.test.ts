import { describe, expect, test } from "vitest"
import { buildAgentChatKey, buildDirectKey } from "../../src/chat/direct-key"

describe("chat keys", () => {
  test("orders direct ids numerically", () => {
    expect(buildDirectKey("10", "9")).toBe("9:10")
  })

  test("uses a stable staff key and trims token labels", () => {
    expect(buildAgentChatKey("9", { kind: "staff", title: "Hermes" })).toBe(
      "agent:9:staff",
    )
    expect(buildAgentChatKey("9", { kind: "token", label: " Hermes " })).toBe(
      "agent:9:token:Hermes",
    )
  })
})
