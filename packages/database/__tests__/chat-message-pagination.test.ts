import { describe, expect, test } from "vitest"
import { chatMessagePageOrder } from "../src/repositories/chat/repository"

describe("chat message pagination", () => {
  test("opens the initial page from newest messages", () => {
    expect(chatMessagePageOrder({})).toBe("desc")
  })

  test("scans backwards for beforeId and forwards for afterId", () => {
    expect(chatMessagePageOrder({ beforeId: "50" })).toBe("desc")
    expect(chatMessagePageOrder({ afterId: "50" })).toBe("asc")
  })
})
