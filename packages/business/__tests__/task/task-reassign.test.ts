import { beforeEach, describe, expect, test, vi } from "vitest"

const repo = vi.hoisted(() => ({
  task: {
    findWorkspace: vi.fn(),
    listAssignedToUser: vi.fn(),
    listAssignedToTeams: vi.fn(),
    assignToUser: vi.fn(),
    insertWatchers: vi.fn(),
    deleteWatchersForUser: vi.fn(),
  },
  thread: {
    insertMembers: vi.fn(),
    insertMessages: vi.fn(),
    deleteMembersForUser: vi.fn(),
  },
}))

vi.mock("@chatbotx.io/database/client", () => ({ db: {} }))
vi.mock("@chatbotx.io/database/repositories", () => ({
  taskRepository: repo.task,
  internalThreadRepository: repo.thread,
  inboxTeamMemberRepository: {},
}))
vi.mock("@chatbotx.io/redis", () => ({ invalidateCacheByTags: vi.fn() }))
vi.mock("../../src/audit/dispatcher", () => ({ dispatchAuditRecord: vi.fn() }))
vi.mock("../../src/platform/settings", () => ({
  resolveTenantSettings: vi.fn(async () => ({
    appUrl: "https://app.test",
  })),
}))

const { taskService } = await import("../../src/task/service")

beforeEach(() => {
  vi.clearAllMocks()
  repo.task.findWorkspace.mockResolvedValue({
    ownerId: "u-owner",
    timezone: "UTC",
  })
})

describe("taskService.reassignFromMember", () => {
  test("moves the member's tasks to the owner with a system message", async () => {
    repo.task.listAssignedToUser.mockResolvedValue([
      {
        id: "t-1",
        threadId: "th-1",
        assigneeUserId: "u-1",
        assigneeTeamId: null,
      },
    ])

    await taskService.reassignFromMember({
      workspaceId: "ws-1",
      userId: "u-1",
      tx: "tx" as never,
    })

    expect(repo.task.assignToUser).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      taskIds: ["t-1"],
      userId: "u-owner",
      tx: "tx",
    })
    expect(repo.task.insertWatchers).toHaveBeenCalledWith({
      rows: [{ taskId: "t-1", userId: "u-owner" }],
      tx: "tx",
    })
    expect(repo.thread.insertMessages).toHaveBeenCalledWith({
      rows: [
        expect.objectContaining({
          threadId: "th-1",
          systemEvent: {
            type: "assignee",
            from: "user:u-1",
            to: "user:u-owner",
            byUserId: null,
          },
        }),
      ],
      tx: "tx",
    })
    expect(repo.task.deleteWatchersForUser).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      userId: "u-1",
      tx: "tx",
    })
    expect(repo.thread.deleteMembersForUser).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      userId: "u-1",
      tx: "tx",
    })
  })

  test("does nothing for the owner or a member without tasks", async () => {
    await taskService.reassignFromMember({
      workspaceId: "ws-1",
      userId: "u-owner",
    })
    expect(repo.task.listAssignedToUser).not.toHaveBeenCalled()

    repo.task.listAssignedToUser.mockResolvedValue([])
    await taskService.reassignFromMember({ workspaceId: "ws-1", userId: "u-2" })
    expect(repo.task.assignToUser).not.toHaveBeenCalled()
    expect(repo.task.deleteWatchersForUser).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      userId: "u-2",
      tx: {},
    })
    expect(repo.thread.deleteMembersForUser).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      userId: "u-2",
      tx: {},
    })
  })
})

describe("taskService.reassignFromTeams", () => {
  test("moves team tasks to the owner, naming the old team", async () => {
    repo.task.listAssignedToTeams.mockResolvedValue([
      {
        id: "t-2",
        threadId: "th-2",
        assigneeUserId: null,
        assigneeTeamId: "team-1",
      },
    ])
    await taskService.reassignFromTeams({
      workspaceId: "ws-1",
      teamIds: ["team-1"],
    })
    expect(repo.thread.insertMessages).toHaveBeenCalledWith({
      rows: [
        expect.objectContaining({
          systemEvent: {
            type: "assignee",
            from: "team:team-1",
            to: "user:u-owner",
            byUserId: null,
          },
        }),
      ],
      tx: {},
    })
  })
})
