import { describe, expect, test } from "vitest"
import {
  CHAT_LIMITS,
  CHAT_THREAD_TYPES,
  chatNotificationTypes,
  internalThreadTypeValues,
} from "../src/partials"

describe("staff chat partials", () => {
  test("extends thread types without changing the task enum order", () => {
    expect(internalThreadTypeValues).toEqual(["task", "direct", "agent"])
    expect(CHAT_THREAD_TYPES).toEqual(["direct", "agent"])
  })

  test("declares chat message and pagination limits", () => {
    expect(chatNotificationTypes.options).toEqual(["chatMessage"])
    expect(CHAT_LIMITS).toEqual({
      maxMessageLength: 10_000,
      defaultPageSize: 50,
      maxPageSize: 50,
    })
  })
})
