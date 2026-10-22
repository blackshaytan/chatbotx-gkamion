import { describe, expect, test } from "vitest"
import { isConversationUnread } from "../is-conversation-unread"

describe("isConversationUnread", () => {
  test("returns false when neither timestamp exists", () => {
    expect(
      isConversationUnread({
        inboxActivityAt: null,
        agentLastReadAt: null,
        handedOverAt: null,
      }),
    ).toBe(false)
  })

  test("returns true when activity exists but the agent has never read", () => {
    expect(
      isConversationUnread({
        inboxActivityAt: new Date("2026-01-02T00:00:00Z"),
        agentLastReadAt: null,
        handedOverAt: null,
      }),
    ).toBe(true)
  })

  test("returns true when the last read is older than activity", () => {
    expect(
      isConversationUnread({
        inboxActivityAt: new Date("2026-01-02T00:00:00Z"),
        agentLastReadAt: new Date("2026-01-01T00:00:00Z"),
        handedOverAt: null,
      }),
    ).toBe(true)
  })

  test("returns false when the last read equals activity", () => {
    const at = new Date("2026-01-02T00:00:00Z")
    expect(
      isConversationUnread({
        inboxActivityAt: at,
        agentLastReadAt: at,
        handedOverAt: null,
      }),
    ).toBe(false)
  })

  test("returns false when the last read is newer than activity", () => {
    expect(
      isConversationUnread({
        inboxActivityAt: new Date("2026-01-01T00:00:00Z"),
        agentLastReadAt: new Date("2026-01-02T00:00:00Z"),
        handedOverAt: null,
      }),
    ).toBe(false)
  })

  test("returns true when a handover is newer than the last read, even with no client activity", () => {
    expect(
      isConversationUnread({
        inboxActivityAt: null,
        agentLastReadAt: new Date("2026-01-01T00:00:00Z"),
        handedOverAt: new Date("2026-01-02T00:00:00Z"),
      }),
    ).toBe(true)
  })

  test("returns true when a handover exists and the agent has never read", () => {
    expect(
      isConversationUnread({
        inboxActivityAt: null,
        agentLastReadAt: null,
        handedOverAt: new Date("2026-01-02T00:00:00Z"),
      }),
    ).toBe(true)
  })

  test("returns false when the agent read after the handover", () => {
    expect(
      isConversationUnread({
        inboxActivityAt: new Date("2026-01-01T00:00:00Z"),
        agentLastReadAt: new Date("2026-01-03T00:00:00Z"),
        handedOverAt: new Date("2026-01-02T00:00:00Z"),
      }),
    ).toBe(false)
  })
})
