import { describe, expect, test } from "vitest"
import {
  assertRemindBeforeDue,
  buildTaskChangeEvents,
  buildTaskUpdateSet,
} from "../../src/task/changes"

const now = new Date("2026-10-23T10:00:00Z")
const base = {
  status: "todo" as const,
  priority: "normal" as const,
  dueAt: new Date("2026-10-24T12:00:00Z"),
  remindAt: null,
  assigneeUserId: "u-1",
  assigneeTeamId: null,
}

describe("buildTaskUpdateSet", () => {
  test("done stamps completedAt, leaving done clears it", () => {
    expect(buildTaskUpdateSet(base, { status: "done" }, now)).toEqual({
      status: "done",
      completedAt: now,
    })
    expect(
      buildTaskUpdateSet({ ...base, status: "done" }, { status: "todo" }, now),
    ).toEqual({ status: "todo", completedAt: null })
  })

  test("moving the due date or reminder resets its notification flag", () => {
    const dueAt = new Date("2026-10-25T12:00:00Z")
    const remindAt = new Date("2026-10-25T11:00:00Z")
    expect(buildTaskUpdateSet(base, { dueAt, remindAt }, now)).toEqual({
      dueAt,
      overdueNotifiedAt: null,
      remindAt,
      remindedAt: null,
    })
  })

  test("an unchanged value writes nothing", () => {
    expect(
      buildTaskUpdateSet(
        base,
        { status: "todo", dueAt: new Date(base.dueAt) },
        now,
      ),
    ).toEqual({})
  })

  test("a team assignee clears the user assignee", () => {
    expect(
      buildTaskUpdateSet(
        base,
        { assignee: { type: "team", teamId: "t-1" } },
        now,
      ),
    ).toEqual({ assigneeUserId: null, assigneeTeamId: "t-1" })
  })
})

describe("buildTaskChangeEvents", () => {
  test("one system event per tracked field that changed", () => {
    expect(
      buildTaskChangeEvents(
        base,
        {
          status: "in_progress",
          priority: "urgent",
          dueAt: null,
          assignee: { type: "team", teamId: "t-1" },
          title: "ignored",
        },
        "u-9",
      ),
    ).toEqual([
      { type: "status", from: "todo", to: "in_progress", byUserId: "u-9" },
      {
        type: "due",
        from: "2026-10-24T12:00:00.000Z",
        to: null,
        byUserId: "u-9",
      },
      { type: "assignee", from: "user:u-1", to: "team:t-1", byUserId: "u-9" },
      { type: "priority", from: "normal", to: "urgent", byUserId: "u-9" },
    ])
  })

  test("no events when nothing tracked changed", () => {
    expect(
      buildTaskChangeEvents(
        base,
        { assignee: { type: "user", userId: "u-1" } },
        null,
      ),
    ).toEqual([])
  })
})

describe("assertRemindBeforeDue", () => {
  test("rejects a reminder after the due date", () => {
    expect(() =>
      assertRemindBeforeDue(
        new Date("2026-10-25T00:00:00Z"),
        new Date("2026-10-24T00:00:00Z"),
      ),
    ).toThrow("Reminder must not be later than the due date")
    expect(() => assertRemindBeforeDue(new Date(), null)).not.toThrow()
  })
})
