import { describe, expect, test } from "vitest"
import { canDeleteTask, canModifyTask } from "../../src/task/permissions"

const task = { createdByUserId: "author", assigneeUserId: "assignee" }
const member = (userId: string) =>
  ({ kind: "user", userId, isOwner: false }) as const

describe("canModifyTask", () => {
  test("api and flow actors act with workspace authority", () => {
    for (const actor of [
      { kind: "api", label: "Hermes" },
      { kind: "flow", label: "Welcome" },
    ] as const) {
      expect(canModifyTask({ actor, task, assigneeTeamMemberIds: [] })).toBe(
        true,
      )
    }
  })

  test("author, assignee, assignee team member and owner may modify", () => {
    expect(
      canModifyTask({
        actor: member("author"),
        task,
        assigneeTeamMemberIds: [],
      }),
    ).toBe(true)
    expect(
      canModifyTask({
        actor: member("assignee"),
        task,
        assigneeTeamMemberIds: [],
      }),
    ).toBe(true)
    expect(
      canModifyTask({
        actor: member("teammate"),
        task,
        assigneeTeamMemberIds: ["teammate"],
      }),
    ).toBe(true)
    expect(
      canModifyTask({
        actor: { kind: "user", userId: "boss", isOwner: true },
        task,
        assigneeTeamMemberIds: [],
      }),
    ).toBe(true)
  })

  test("any other member may not", () => {
    expect(
      canModifyTask({
        actor: member("stranger"),
        task,
        assigneeTeamMemberIds: [],
      }),
    ).toBe(false)
  })
})

describe("canDeleteTask", () => {
  test("only author, owner, workspace admin or a non-user actor", () => {
    expect(canDeleteTask({ actor: member("author"), task })).toBe(true)
    expect(canDeleteTask({ actor: member("assignee"), task })).toBe(false)
    expect(
      canDeleteTask({
        actor: { kind: "user", userId: "boss", isOwner: true },
        task,
      }),
    ).toBe(true)
    expect(
      canDeleteTask({ actor: { kind: "api", label: "Hermes" }, task }),
    ).toBe(true)
    expect(
      canDeleteTask({
        actor: {
          kind: "user",
          userId: "admin",
          isOwner: false,
          isWorkspaceAdmin: true,
        },
        task,
      }),
    ).toBe(true)
  })
})
