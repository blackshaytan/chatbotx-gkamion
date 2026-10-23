// @vitest-environment node
import { describe, expect, test } from "vitest"
import {
  buildTaskListWhere,
  TASK_LIST_ORDER_BY,
} from "../src/repositories/task/list-where"

describe("buildTaskListWhere", () => {
  test("always scopes to the workspace", () => {
    expect(buildTaskListWhere({ workspaceId: "ws-1" })).toEqual({
      workspaceId: "ws-1",
    })
  })

  test("maps scalar filters and statuses", () => {
    expect(
      buildTaskListWhere({
        workspaceId: "ws-1",
        statuses: ["todo", "in_progress"],
        priority: "urgent",
        assigneeUserId: "u-1",
        assigneeTeamId: "t-1",
        createdByUserId: "u-2",
      }),
    ).toEqual({
      workspaceId: "ws-1",
      status: { in: ["todo", "in_progress"] },
      priority: "urgent",
      assigneeUserId: "u-1",
      assigneeTeamId: "t-1",
      createdByUserId: "u-2",
    })
  })

  test("filters by watcher and both target kinds through relations", () => {
    expect(
      buildTaskListWhere({
        workspaceId: "ws-1",
        watcherUserId: "u-3",
        contactId: "c-1",
        conversationId: "conv-1",
      }),
    ).toEqual({
      workspaceId: "ws-1",
      watchers: { userId: "u-3" },
      AND: [
        { targets: { contactId: "c-1" } },
        { targets: { conversationId: "conv-1" } },
      ],
    })
  })

  test("builds a due window, or matches tasks without a due date", () => {
    const from = new Date("2026-10-23T00:00:00Z")
    const before = new Date("2026-10-24T00:00:00Z")
    expect(
      buildTaskListWhere({
        workspaceId: "ws-1",
        dueFrom: from,
        dueBefore: before,
      }).dueAt,
    ).toEqual({ gte: from, lt: before })
    expect(
      buildTaskListWhere({ workspaceId: "ws-1", withoutDue: true }).dueAt,
    ).toEqual({ isNull: true })
  })

  test("orders by due date, then priority, then newest", () => {
    expect(TASK_LIST_ORDER_BY).toEqual({
      dueAt: "asc",
      priority: "desc",
      createdAt: "desc",
      id: "desc",
    })
  })
})
