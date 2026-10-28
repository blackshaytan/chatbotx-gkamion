import { describe, expect, test } from "vitest"
import { groupChatMessages } from "../message-groups"

const message = (
  id: string,
  authorUserId: string | null,
  createdAt: string,
  kind: "comment" | "system" = "comment",
) => ({ authorUserId, createdAt: new Date(createdAt), id, kind })

describe("groupChatMessages", () => {
  test("groups adjacent comments from the same author within five minutes", () => {
    expect(
      groupChatMessages([
        message("1", "user-1", "2026-10-28T10:00:00Z"),
        message("2", "user-1", "2026-10-28T10:04:59Z"),
        message("3", "user-2", "2026-10-28T10:05:00Z"),
      ]).map((group) => group.map((item) => item.id)),
    ).toEqual([["1", "2"], ["3"]])
  })

  test("keeps system events and delayed messages separate", () => {
    expect(
      groupChatMessages([
        message("1", "user-1", "2026-10-28T10:00:00Z"),
        message("2", "user-1", "2026-10-28T10:06:00Z"),
        message("3", null, "2026-10-28T10:06:01Z", "system"),
      ]).map((group) => group.map((item) => item.id)),
    ).toEqual([["1"], ["2"], ["3"]])
  })
})
