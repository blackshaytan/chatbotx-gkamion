import type { InternalMessageModel } from "@chatbotx.io/database/types"
import { describe, expect, test } from "vitest"
import {
  selectNewEmployeeMessages,
  selectStaffHistory,
} from "../../src/staff-assistant/messages"

const message = (
  id: string,
  authorUserId: string | null,
  extra: Partial<InternalMessageModel> = {},
) =>
  ({
    id,
    authorUserId,
    kind: "comment",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    deletedAt: null,
    ...extra,
  }) as InternalMessageModel

describe("staff assistant message selection", () => {
  test("first turn includes only employee messages after the last assistant message", () => {
    const messages = [
      message("1", "1"),
      message("2", null),
      message("3", "1"),
      message("4", "2"),
      message("5", "1", { deletedAt: new Date() }),
    ]
    const selected = selectNewEmployeeMessages({
      messages,
      userId: "1",
      cursorAt: null,
      cursorMessageId: null,
    })
    expect(selected.map(({ id }) => id)).toEqual(["3"])
    expect(selectStaffHistory(messages, selected).map(({ id }) => id)).toEqual([
      "1",
      "2",
    ])
  })

  test("uses message id to avoid skipping same-timestamp messages", () => {
    const messages = [
      message("9", "1"),
      message("10", "1"),
      message("11", null),
      message("12", "1"),
    ]
    const selected = selectNewEmployeeMessages({
      messages,
      userId: "1",
      cursorAt: messages[0].createdAt,
      cursorMessageId: "9",
    })
    expect(selected.map(({ id }) => id)).toEqual(["10", "12"])
  })

  test("limits the first turn to ten and excludes system messages", () => {
    const messages = Array.from({ length: 12 }, (_, index) =>
      message(String(index + 1), "1"),
    )
    messages.push(message("13", "1", { kind: "system" }))
    expect(
      selectNewEmployeeMessages({
        messages,
        userId: "1",
        cursorAt: null,
        cursorMessageId: null,
      }).map(({ id }) => id),
    ).toEqual(["3", "4", "5", "6", "7", "8", "9", "10", "11", "12"])
  })
})
