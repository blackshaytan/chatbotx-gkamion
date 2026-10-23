import { beforeEach, describe, expect, test, vi } from "vitest"

const repo = vi.hoisted(() => ({
  task: {
    findWorkspace: vi.fn(),
    listMemberUserIds: vi.fn(),
    listTeamIds: vi.fn(),
    findContact: vi.fn(),
    findConversation: vi.fn(),
    listVisibleTargetIds: vi.fn(),
    insertTask: vi.fn(),
    insertWatchers: vi.fn(),
    insertTargets: vi.fn(),
    findById: vi.fn(),
    list: vi.fn(),
    count: vi.fn(),
    listTeamIdsForUser: vi.fn(),
    update: vi.fn(),
  },
  thread: {
    insertThread: vi.fn(),
    insertMembers: vi.fn(),
    insertMessages: vi.fn(),
  },
  teamMembers: { listUserIdsByTeamId: vi.fn() },
  message: { findTriggerMessage: vi.fn() },
}))

vi.mock("@chatbotx.io/database/client", () => ({
  db: { transaction: async (fn: (tx: unknown) => unknown) => await fn("tx") },
}))
vi.mock("@chatbotx.io/database/repositories", () => ({
  taskRepository: repo.task,
  internalThreadRepository: repo.thread,
  inboxTeamMemberRepository: repo.teamMembers,
  createMessageRepository: vi.fn(async () => ({
    findTriggerMessage: repo.message.findTriggerMessage,
  })),
  getSafeSinceTime: vi.fn((time: Date) => time),
}))
vi.mock("@chatbotx.io/redis", () => ({ invalidateCacheByTags: vi.fn() }))
vi.mock("../../src/audit/dispatcher", () => ({ dispatchAuditRecord: vi.fn() }))
vi.mock("../../src/notification/service", () => ({
  notificationService: {
    deleteForTask: vi.fn(),
    notifyTask: vi.fn(),
  },
  notifyTaskSafe: vi.fn(),
  formatCommentExcerpt: (text: string) => text,
}))
const { taskService } = await import("../../src/task/service")

const storedTask = (overrides: Record<string, unknown> = {}) => ({
  id: "t-1",
  workspaceId: "ws-1",
  title: "Check stock",
  description: null,
  status: "todo",
  priority: "normal",
  dueAt: null,
  remindAt: null,
  assigneeUserId: null,
  assigneeTeamId: "team-1",
  createdByUserId: "u-author",
  createdBySource: "user",
  createdByLabel: null,
  threadId: "th-1",
  completedAt: null,
  remindedAt: null,
  overdueNotifiedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  watchers: [{ userId: "u-1" }],
  targets: [],
  ...overrides,
})

beforeEach(() => {
  vi.clearAllMocks()
  repo.task.findById.mockResolvedValue(storedTask())
  repo.task.listMemberUserIds.mockImplementation(
    async ({ userIds }: { userIds: string[] }) => userIds,
  )
  repo.task.listTeamIds.mockImplementation(
    async ({ teamIds }: { teamIds: string[] }) => teamIds,
  )
  repo.teamMembers.listUserIdsByTeamId.mockResolvedValue(["u-taker"])
})

describe("taskService.list teamMemberUserId", () => {
  test("returns empty without listing when the user belongs to no teams", async () => {
    repo.task.listTeamIdsForUser.mockResolvedValue([])

    const result = await taskService.list({
      workspaceId: "ws-1",
      page: 1,
      perPage: 20,
      teamMemberUserId: "7",
    })

    expect(result).toEqual({ data: [], pageCount: 0 })
    expect(repo.task.list).not.toHaveBeenCalled()
  })

  test("passes assigneeTeamIds from listTeamIdsForUser", async () => {
    repo.task.listTeamIdsForUser.mockResolvedValue(["5"])
    repo.task.list.mockResolvedValue({ rows: [], total: 0 })

    await taskService.list({
      workspaceId: "ws-1",
      page: 1,
      perPage: 20,
      teamMemberUserId: "7",
    })

    expect(repo.task.listTeamIdsForUser).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      userId: "7",
    })
    expect(repo.task.list).toHaveBeenCalledWith({
      filter: expect.objectContaining({ assigneeTeamIds: ["5"] }),
      limit: 20,
      offset: 0,
    })
  })
})

describe("taskService.count", () => {
  test("uses the same filter as list and returns repository total", async () => {
    repo.task.findWorkspace.mockResolvedValue({
      ownerId: "u-owner",
      timezone: "UTC",
    })
    repo.task.count.mockResolvedValue(4)
    const now = new Date("2026-10-23T10:00:00Z")

    const result = await taskService.count({
      workspaceId: "ws-1",
      due: "overdue",
      now,
    })

    expect(repo.task.count).toHaveBeenCalledWith({
      filter: {
        workspaceId: "ws-1",
        statuses: ["todo", "in_progress"],
        dueBefore: now,
      },
    })
    expect(result).toEqual({ total: 4 })
  })
})

describe("taskService.take", () => {
  test("rejects when the task has no assignee team", async () => {
    repo.task.findById.mockResolvedValue(
      storedTask({ assigneeTeamId: null, assigneeUserId: "u-1" }),
    )

    await expect(
      taskService.take({
        workspaceId: "ws-1",
        id: "t-1",
        userId: "u-taker",
        actor: { kind: "user", userId: "u-taker", isOwner: false },
      }),
    ).rejects.toThrow("Task is not assigned to a team")
    expect(repo.task.update).not.toHaveBeenCalled()
  })

  test("rejects when the user is not in the assignee team", async () => {
    repo.teamMembers.listUserIdsByTeamId.mockResolvedValue(["u-other"])

    await expect(
      taskService.take({
        workspaceId: "ws-1",
        id: "t-1",
        userId: "u-taker",
        actor: { kind: "user", userId: "u-taker", isOwner: false },
      }),
    ).rejects.toThrow("Member is not in the assignee team")
    expect(repo.task.update).not.toHaveBeenCalled()
  })

  test("forbids a member taking for someone else", async () => {
    await expect(
      taskService.take({
        workspaceId: "ws-1",
        id: "t-1",
        userId: "u-taker",
        actor: { kind: "user", userId: "u-mate", isOwner: false },
      }),
    ).rejects.toThrow("You are not allowed to change this task")
    expect(repo.task.update).not.toHaveBeenCalled()
  })

  test("assigns the task to the user via update", async () => {
    const updateSpy = vi
      .spyOn(taskService, "update")
      .mockResolvedValue({} as never)

    await taskService.take({
      workspaceId: "ws-1",
      id: "t-1",
      userId: "u-taker",
      actor: { kind: "user", userId: "u-taker", isOwner: false },
    })

    expect(updateSpy).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      id: "t-1",
      actor: { kind: "user", userId: "u-taker", isOwner: false },
      patch: { assignee: { type: "user", userId: "u-taker" } },
    })
  })
})

describe("taskService.create messageId validation", () => {
  test("rejects when the message is not in the conversation", async () => {
    const createdAt = new Date("2026-01-01T00:00:00Z")
    repo.task.findConversation.mockResolvedValue({
      id: "conv-1",
      contactId: "c-1",
      createdAt,
    })
    repo.message.findTriggerMessage.mockResolvedValue(null)

    await expect(
      taskService.create({
        workspaceId: "ws-1",
        actor: { kind: "api", label: "Hermes" },
        title: "x",
        assignee: { type: "user", userId: "u-1" },
        targets: { conversationId: "conv-1", messageId: "m-1" },
      }),
    ).rejects.toThrow("Message not found")

    expect(repo.message.findTriggerMessage).toHaveBeenCalledWith({
      id: "m-1",
      conversationId: "conv-1",
      workspaceId: "ws-1",
      sinceTime: createdAt,
      requireCompleteResults: true,
    })
    expect(repo.task.insertTask).not.toHaveBeenCalled()
  })
})

describe("task views stage 2", () => {
  test("contact label and hideTargets", async () => {
    repo.task.list.mockResolvedValue({
      rows: [
        storedTask({
          targets: [
            {
              id: "1",
              taskId: "t-1",
              contactId: "c-1",
              conversationId: null,
              messageId: null,
              createdAt: new Date(),
              updatedAt: new Date(),
              contact: { fullName: "Иван" },
            },
          ],
        }),
      ],
      total: 1,
    })

    const unrestricted = await taskService.list({
      workspaceId: "ws-1",
      page: 1,
      perPage: 20,
    })
    expect(unrestricted.data[0]?.targets[0]).toEqual({
      type: "contact",
      id: "c-1",
      hidden: false,
      label: "Иван",
    })
    repo.task.list.mockResolvedValue({
      rows: [
        storedTask({
          targets: [
            {
              id: "1",
              taskId: "t-1",
              contactId: "c-1",
              conversationId: null,
              messageId: null,
              createdAt: new Date(),
              updatedAt: new Date(),
              contact: { fullName: "Иван" },
            },
          ],
        }),
      ],
      total: 1,
    })
    repo.task.listVisibleTargetIds.mockResolvedValue({
      contactIds: [],
      conversationIds: [],
    })
    const hidden = await taskService.list({
      workspaceId: "ws-1",
      page: 1,
      perPage: 20,
      accessScope: { restrictToAssignedUserId: "u-1" },
    })
    expect(hidden.data[0]?.targets[0]).toEqual({
      type: "contact",
      id: null,
      hidden: true,
      label: null,
    })

    repo.task.list.mockResolvedValue({
      rows: [storedTask({ targets: [] })],
      total: 1,
    })
    const hideTargets = await taskService.list({
      workspaceId: "ws-1",
      page: 1,
      perPage: 20,
      accessScope: { hideTargets: true },
    })
    expect(hideTargets.data[0]?.targets).toEqual([])
  })
})
