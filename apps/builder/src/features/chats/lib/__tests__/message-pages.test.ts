import { describe, expect, test } from "vitest"
import { mergeChatMessagePages } from "../message-pages"

const message = (id: string, createdAt: string) => ({
  createdAt: new Date(createdAt),
  id,
})

describe("mergeChatMessagePages", () => {
  test("prepends older messages in chronological order", () => {
    const result = mergeChatMessagePages([
      [message("3", "2026-10-28T10:03:00Z"), message("4", "2026-10-28T10:04:00Z")],
      [message("1", "2026-10-28T10:01:00Z"), message("2", "2026-10-28T10:02:00Z")],
    ])

    expect(result.map((item) => item.id)).toEqual(["1", "2", "3", "4"])
  })

  test("removes a cursor-boundary duplicate", () => {
    const result = mergeChatMessagePages([
      [message("2", "2026-10-28T10:02:00Z"), message("3", "2026-10-28T10:03:00Z")],
      [message("1", "2026-10-28T10:01:00Z"), message("2", "2026-10-28T10:02:00Z")],
    ])

    expect(result.map((item) => item.id)).toEqual(["1", "2", "3"])
  })
})
