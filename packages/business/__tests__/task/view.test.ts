import { describe, expect, test } from "vitest"
import { toTaskView } from "../../src/task/view"

const task = {
  id: "t-1",
  workspaceId: "ws-1",
  title: "Check stock",
  description: null,
  status: "todo" as const,
  priority: "normal" as const,
  dueAt: null,
  remindAt: null,
  assigneeUserId: "u-1",
  assigneeTeamId: null,
  createdByUserId: null,
  createdBySource: "api" as const,
  createdByLabel: "Hermes",
  threadId: "th-1",
  completedAt: null,
  remindedAt: null,
  overdueNotifiedAt: null,
  createdAt: new Date("2026-10-23T00:00:00Z"),
  updatedAt: new Date("2026-10-23T00:00:00Z"),
  watchers: [{ userId: "u-1" }],
  targets: [
    {
      id: "1",
      taskId: "t-1",
      contactId: "c-1",
      conversationId: null,
      messageId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      contact: { fullName: "Alice" },
    },
    {
      id: "2",
      taskId: "t-1",
      contactId: null,
      conversationId: "conv-1",
      messageId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: "3",
      taskId: "t-1",
      contactId: null,
      conversationId: null,
      messageId: "m-1",
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ],
}

describe("toTaskView", () => {
  test("unrestricted callers see every target id and watcher", () => {
    const view = toTaskView(task, null)
    expect(view.watcherUserIds).toEqual(["u-1"])
    expect(view.targets).toEqual([
      { type: "contact", id: "c-1", hidden: false, label: "Alice" },
      { type: "conversation", id: "conv-1", hidden: false, label: null },
      { type: "message", id: "m-1", hidden: false, label: null },
    ])
    expect(view).not.toHaveProperty("remindedAt")
    expect(view).not.toHaveProperty("overdueNotifiedAt")
  })

  test("a member limited to assigned contacts gets hidden targets", () => {
    const view = toTaskView(task, {
      contactIds: new Set(),
      conversationIds: new Set(),
    })
    expect(view.targets).toEqual([
      { type: "contact", id: null, hidden: true, label: null },
      { type: "conversation", id: null, hidden: true, label: null },
      { type: "message", id: null, hidden: true, label: null },
    ])
  })

  test("a restricted member sees a message only with its conversation", () => {
    const visibility = {
      contactIds: new Set(["c-1"]),
      conversationIds: new Set(["conv-1"]),
    }
    expect(toTaskView(task, visibility).targets[2]).toEqual({
      type: "message",
      id: "m-1",
      hidden: false,
      label: null,
    })
    const withoutConversation = {
      ...task,
      targets: task.targets.filter((target) => !target.conversationId),
    }
    expect(toTaskView(withoutConversation, visibility).targets[1]).toEqual({
      type: "message",
      id: null,
      hidden: true,
      label: null,
    })
  })
})
