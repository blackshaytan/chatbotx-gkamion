import { describe, expect, test } from "vitest"
import { resolveTaskDueWindow } from "../../src/task/due-window"

// 23:30 in Moscow on Oct 23 is 20:30 UTC.
const now = new Date("2026-10-23T20:30:00Z")

describe("resolveTaskDueWindow", () => {
  test("overdue = open tasks due before now", () => {
    expect(
      resolveTaskDueWindow({ due: "overdue", now, timezone: "Europe/Moscow" }),
    ).toEqual({
      dueBefore: now,
      openOnly: true,
    })
  })

  test("today is the workspace's calendar day", () => {
    expect(
      resolveTaskDueWindow({ due: "today", now, timezone: "Europe/Moscow" }),
    ).toEqual({
      dueFrom: new Date("2026-10-22T21:00:00Z"),
      dueBefore: new Date("2026-10-23T21:00:00Z"),
    })
  })

  test("week is seven calendar days starting today", () => {
    expect(resolveTaskDueWindow({ due: "week", now, timezone: "UTC" })).toEqual(
      {
        dueFrom: new Date("2026-10-23T00:00:00Z"),
        dueBefore: new Date("2026-10-30T00:00:00Z"),
      },
    )
  })

  test("none = no due date", () => {
    expect(resolveTaskDueWindow({ due: "none", now, timezone: "UTC" })).toEqual(
      {
        withoutDue: true,
      },
    )
  })
})
