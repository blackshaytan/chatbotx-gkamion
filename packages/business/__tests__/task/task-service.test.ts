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
    deleteWatcher: vi.fn(),
    insertTargets: vi.fn(),
    findById: vi.fn(),
    list: vi.fn(),
    update: vi.fn(),
    deleteWithThread: vi.fn(),
    listAssignedToUser: vi.fn(),
    listAssignedToTeams: vi.fn(),
    assignToUser: vi.fn(),
  },
  thread: {
    insertThread: vi.fn(),
    insertMembers: vi.fn(),
    deleteMember: vi.fn(),
    insertMessages: vi.fn(),
    listMessages: vi.fn(),
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

const API = { kind: "api", label: "Hermes" } as const
const storedTask = (overrides: Record<string, unknown> = {}) => ({
  id: "t-1",
  workspaceId: "ws-1",
  title: "Check stock",
  description: null,
  status: "todo",
  priority: "normal",
  dueAt: null,
  remindAt: null,
  assigneeUserId: "u-1",
  assigneeTeamId: null,
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
  repo.thread.insertThread.mockResolvedValue({ id: "th-1" })
  repo.task.insertTask.mockResolvedValue({ id: "t-1" })
  repo.task.findById.mockResolvedValue(storedTask())
  repo.task.listMemberUserIds.mockImplementation(
    async ({ userIds }: { userIds: string[] }) =>
      userIds.filter((id) => id !== "u-stranger"),
  )
  repo.task.listTeamIds.mockImplementation(
    async ({ teamIds }: { teamIds: string[] }) => teamIds,
  )
  repo.teamMembers.listUserIdsByTeamId.mockResolvedValue([])
})

describe("taskService.create", () => {
  test("creates thread, task, watchers, targets and a created event in one transaction", async () => {
    repo.task.findConversation.mockResolvedValue({
      id: "conv-1",
      contactId: "c-1",
      createdAt: new Date("2026-01-01T00:00:00Z"),
    })
    repo.message.findTriggerMessage.mockResolvedValue({ id: "m-1" })

    await taskService.create({
      workspaceId: "ws-1",
      actor: API,
      title: "Check stock",
      assignee: { type: "user", userId: "u-1" },
      watcherUserIds: ["u-2"],
      targets: { conversationId: "conv-1", messageId: "m-1" },
    })

    expect(repo.task.insertTask).toHaveBeenCalledWith({
      values: expect.objectContaining({
        workspaceId: "ws-1",
        threadId: "th-1",
        assigneeUserId: "u-1",
        assigneeTeamId: null,
        createdByUserId: null,
        createdBySource: "api",
        createdByLabel: "Hermes",
      }),
      tx: "tx",
    })
    expect(repo.task.insertWatchers).toHaveBeenCalledWith({
      rows: [
        { taskId: "t-1", userId: "u-2" },
        { taskId: "t-1", userId: "u-1" },
      ],
      tx: "tx",
    })
    expect(repo.thread.insertMembers).toHaveBeenCalledWith({
      rows: [
        { threadId: "th-1", userId: "u-2" },
        { threadId: "th-1", userId: "u-1" },
      ],
      tx: "tx",
    })
    expect(repo.task.insertTargets).toHaveBeenCalledWith({
      rows: [
        { taskId: "t-1", contactId: "c-1" },
        { taskId: "t-1", conversationId: "conv-1" },
        { taskId: "t-1", messageId: "m-1" },
      ],
      tx: "tx",
    })
    expect(repo.thread.insertMessages).toHaveBeenCalledWith({
      rows: [
        expect.objectContaining({
          kind: "system",
          authorLabel: "Hermes",
          systemEvent: {
            type: "created",
            from: null,
            to: null,
            byUserId: null,
          },
        }),
      ],
      tx: "tx",
    })
  })

  test("a user author becomes a watcher and is recorded as creator", async () => {
    await taskService.create({
      workspaceId: "ws-1",
      actor: { kind: "user", userId: "u-author", isOwner: false },
      title: "Call back",
      assignee: { type: "team", teamId: "team-1" },
    })

    expect(repo.task.insertTask).toHaveBeenCalledWith({
      values: expect.objectContaining({
        createdByUserId: "u-author",
        createdBySource: "user",
        createdByLabel: null,
        assigneeUserId: null,
        assigneeTeamId: "team-1",
      }),
      tx: "tx",
    })
    expect(repo.task.insertWatchers).toHaveBeenCalledWith({
      rows: [{ taskId: "t-1", userId: "u-author" }],
      tx: "tx",
    })
  })

  test("rejects an assignee who is not a member", async () => {
    await expect(
      taskService.create({
        workspaceId: "ws-1",
        actor: API,
        title: "x",
        assignee: { type: "user", userId: "u-stranger" },
      }),
    ).rejects.toThrow("Assignee is not a member of this workspace")
    expect(repo.task.insertTask).not.toHaveBeenCalled()
  })

  test("rejects a message link without its conversation", async () => {
    await expect(
      taskService.create({
        workspaceId: "ws-1",
        actor: API,
        title: "x",
        assignee: { type: "user", userId: "u-1" },
        targets: { messageId: "m-1" },
      }),
    ).rejects.toThrow("messageId requires conversationId")
  })

  test("rejects a conversation of another contact", async () => {
    repo.task.findConversation.mockResolvedValue({
      id: "conv-1",
      contactId: "c-2",
    })
    await expect(
      taskService.create({
        workspaceId: "ws-1",
        actor: API,
        title: "x",
        assignee: { type: "user", userId: "u-1" },
        targets: { contactId: "c-1", conversationId: "conv-1" },
      }),
    ).rejects.toThrow("Conversation belongs to another contact")
  })
})

describe("taskService.update", () => {
  test("writes the changed columns and one system message per change", async () => {
    await taskService.update({
      workspaceId: "ws-1",
      id: "t-1",
      actor: { kind: "user", userId: "u-1", isOwner: false },
      patch: { status: "done", priority: "high" },
    })

    expect(repo.task.update).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      id: "t-1",
      set: expect.objectContaining({
        status: "done",
        priority: "high",
        completedAt: expect.any(Date),
      }),
      tx: "tx",
    })
    expect(repo.thread.insertMessages).toHaveBeenCalledWith({
      rows: [
        expect.objectContaining({
          systemEvent: {
            type: "status",
            from: "todo",
            to: "done",
            byUserId: "u-1",
          },
        }),
        expect.objectContaining({
          systemEvent: {
            type: "priority",
            from: "normal",
            to: "high",
            byUserId: "u-1",
          },
        }),
      ],
      tx: "tx",
    })
  })

  test("forbids a member who is neither author, assignee nor owner", async () => {
    await expect(
      taskService.update({
        workspaceId: "ws-1",
        id: "t-1",
        actor: { kind: "user", userId: "u-stranger", isOwner: false },
        patch: { status: "done" },
      }),
    ).rejects.toThrow("You are not allowed to change this task")
    expect(repo.task.update).not.toHaveBeenCalled()
  })

  test("lets a member of the assignee team change it", async () => {
    repo.task.findById.mockResolvedValue(
      storedTask({ assigneeUserId: null, assigneeTeamId: "team-1" }),
    )
    repo.teamMembers.listUserIdsByTeamId.mockResolvedValue(["u-mate"])
    await taskService.update({
      workspaceId: "ws-1",
      id: "t-1",
      actor: { kind: "user", userId: "u-mate", isOwner: false },
      patch: { status: "in_progress" },
    })
    expect(repo.task.update).toHaveBeenCalled()
  })

  test("returns hidden targets when accessScope hides them", async () => {
    repo.task.findById.mockResolvedValue(
      storedTask({
        targets: [
          {
            id: "1",
            taskId: "t-1",
            contactId: "c-1",
            conversationId: null,
            messageId: null,
            contact: { fullName: "Alice" },
          },
        ],
      }),
    )
    const view = await taskService.update({
      workspaceId: "ws-1",
      id: "t-1",
      actor: API,
      patch: {},
      accessScope: { hideTargets: true },
    })
    expect(view.targets).toEqual([
      { type: "contact", id: null, hidden: true, label: null },
    ])
  })

  test("a new user assignee becomes a watcher", async () => {
    await taskService.update({
      workspaceId: "ws-1",
      id: "t-1",
      actor: API,
      patch: { assignee: { type: "user", userId: "u-2" } },
    })
    expect(repo.task.insertWatchers).toHaveBeenCalledWith({
      rows: [{ taskId: "t-1", userId: "u-2" }],
      tx: "tx",
    })
  })

  test("404 for a task of another workspace", async () => {
    repo.task.findById.mockResolvedValue(undefined)
    await expect(
      taskService.update({
        workspaceId: "ws-2",
        id: "t-1",
        actor: API,
        patch: {},
      }),
    ).rejects.toThrow("Task not found")
  })
})

describe("taskService.delete", () => {
  test("only the author or owner may delete", async () => {
    await expect(
      taskService.delete({
        workspaceId: "ws-1",
        id: "t-1",
        actor: { kind: "user", userId: "u-1", isOwner: false },
      }),
    ).rejects.toThrow("You are not allowed to change this task")

    await taskService.delete({ workspaceId: "ws-1", id: "t-1", actor: API })
    expect(repo.task.deleteWithThread).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      id: "t-1",
      threadId: "th-1",
      tx: "tx",
    })
  })
})

describe("taskService.list", () => {
  test("overdue narrows to open statuses and uses the due window", async () => {
    repo.task.findWorkspace.mockResolvedValue({
      ownerId: "u-owner",
      timezone: "UTC",
    })
    repo.task.list.mockResolvedValue({ rows: [storedTask()], total: 3 })
    const now = new Date("2026-10-23T10:00:00Z")

    const result = await taskService.list({
      workspaceId: "ws-1",
      page: 1,
      perPage: 2,
      due: "overdue",
      now,
    })

    expect(repo.task.list).toHaveBeenCalledWith({
      filter: {
        workspaceId: "ws-1",
        statuses: ["todo", "in_progress"],
        dueBefore: now,
      },
      limit: 2,
      offset: 0,
    })
    expect(result.pageCount).toBe(2)
  })

  test("overdue with a closed status returns nothing without querying", async () => {
    repo.task.findWorkspace.mockResolvedValue({
      ownerId: "u-owner",
      timezone: "UTC",
    })
    const result = await taskService.list({
      workspaceId: "ws-1",
      page: 1,
      perPage: 20,
      status: "done",
      due: "overdue",
    })
    expect(result).toEqual({ data: [], pageCount: 0 })
    expect(repo.task.list).not.toHaveBeenCalled()
  })

  test("a restricted member gets hidden contact targets", async () => {
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

    const result = await taskService.list({
      workspaceId: "ws-1",
      page: 1,
      perPage: 20,
      accessScope: { restrictToAssignedUserId: "u-1" },
    })

    expect(result.data[0]?.targets).toEqual([
      { type: "contact", id: null, hidden: true, label: null },
    ])
  })
})

describe("taskService comments", () => {
  test("a comment goes to the task's thread", async () => {
    repo.thread.insertMessages.mockResolvedValue([
      {
        id: "m-1",
        kind: "comment",
        authorUserId: null,
        authorLabel: "Hermes",
        text: "Нет на складе",
        mentions: { userIds: [], teamIds: [] },
        attachments: [],
        systemEvent: null,
        editedAt: null,
        deletedAt: null,
        createdAt: new Date(),
      },
    ])
    const comment = await taskService.addComment({
      workspaceId: "ws-1",
      id: "t-1",
      text: "Нет на складе",
      actor: API,
    })
    expect(repo.thread.insertMessages).toHaveBeenCalledWith({
      rows: [
        expect.objectContaining({
          threadId: "th-1",
          kind: "comment",
          text: "Нет на складе",
        }),
      ],
      tx: "tx",
    })
    expect(comment).toMatchObject({
      id: "m-1",
      authorLabel: "Hermes",
      deleted: false,
    })
  })
})
