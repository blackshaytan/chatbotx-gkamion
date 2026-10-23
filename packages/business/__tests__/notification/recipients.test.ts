import { describe, expect, test } from "vitest"
import { resolveTaskNotificationRecipients } from "../../src/notification/recipients"

const members = new Set(["1", "2", "3", "4", "5"])

describe("resolveTaskNotificationRecipients", () => {
  test("assigned notifies assignee", () => {
    const map = resolveTaskNotificationRecipients({
      actorUserId: "9",
      events: [{ kind: "assigned", userIds: ["2"] }],
      watcherUserIds: [],
      memberUserIds: members,
    })
    expect(map.get("2")).toBe("taskAssigned")
  })

  test("excludes the actor", () => {
    const map = resolveTaskNotificationRecipients({
      actorUserId: "2",
      events: [{ kind: "assigned", userIds: ["2"] }],
      watcherUserIds: [],
      memberUserIds: members,
    })
    expect(map.has("2")).toBe(false)
  })

  test("api actor leaves all recipients eligible", () => {
    const map = resolveTaskNotificationRecipients({
      actorUserId: null,
      events: [{ kind: "assigned", userIds: ["2", "3"] }],
      watcherUserIds: [],
      memberUserIds: members,
    })
    expect(map.get("2")).toBe("taskAssigned")
    expect(map.get("3")).toBe("taskAssigned")
  })

  test("mention plus comment collapses to taskMentioned for overlap", () => {
    const map = resolveTaskNotificationRecipients({
      actorUserId: "9",
      events: [{ kind: "mentioned", userIds: ["2"] }, { kind: "commented" }],
      watcherUserIds: ["2", "3"],
      memberUserIds: members,
    })
    expect(map.get("2")).toBe("taskMentioned")
    expect(map.get("3")).toBe("taskCommented")
  })

  test("status change goes to watchers", () => {
    const map = resolveTaskNotificationRecipients({
      actorUserId: "9",
      events: [{ kind: "statusChanged" }],
      watcherUserIds: ["2", "3"],
      memberUserIds: members,
    })
    expect(map.get("2")).toBe("taskStatusChanged")
    expect(map.get("3")).toBe("taskStatusChanged")
  })

  test("due change goes to watchers", () => {
    const map = resolveTaskNotificationRecipients({
      actorUserId: "9",
      events: [{ kind: "dueChanged" }],
      watcherUserIds: ["4"],
      memberUserIds: members,
    })
    expect(map.get("4")).toBe("taskDueChanged")
  })

  test("filters non-members", () => {
    const map = resolveTaskNotificationRecipients({
      actorUserId: null,
      events: [{ kind: "assigned", userIds: ["99"] }],
      watcherUserIds: [],
      memberUserIds: members,
    })
    expect(map.size).toBe(0)
  })

  test("mention beats assigned on the same user", () => {
    const map = resolveTaskNotificationRecipients({
      actorUserId: null,
      events: [
        { kind: "assigned", userIds: ["2"] },
        { kind: "mentioned", userIds: ["2"] },
      ],
      watcherUserIds: [],
      memberUserIds: members,
    })
    expect(map.get("2")).toBe("taskMentioned")
  })
})
