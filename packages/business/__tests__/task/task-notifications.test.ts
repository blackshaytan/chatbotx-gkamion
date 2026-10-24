import { beforeEach, describe, expect, test, vi } from "vitest"

const repo = vi.hoisted(() => ({
  task: {
    findById: vi.fn(),
    listMemberUserIds: vi.fn(),
    listTeamIds: vi.fn(),
    insertTask: vi.fn(),
    insertWatchers: vi.fn(),
    insertTargets: vi.fn(),
    update: vi.fn(),
    deleteWithThread: vi.fn(),
    listWatcherUserIds: vi.fn(),
  },
  thread: {
    insertThread: vi.fn(),
    insertMembers: vi.fn(),
    insertMessages: vi.fn(),
    findMessage: vi.fn(),
    updateMessage: vi.fn(),
  },
  teamMembers: { listUserIdsByTeamId: vi.fn() },
  notification: {
    insertMany: vi.fn(),
    deleteByEntity: vi.fn(),
  },
  member: {
    listNotificationTypesByUserIds: vi.fn(),
  },
}))

vi.mock("@chatbotx.io/database/client", () => ({
  db: { transaction: async (fn: (tx: unknown) => unknown) => await fn("tx") },
}))
vi.mock("@chatbotx.io/database/repositories", () => ({
  taskRepository: repo.task,
  internalThreadRepository: repo.thread,
  inboxTeamMemberRepository: repo.teamMembers,
  notificationRepository: repo.notification,
  workspaceMemberRepository: repo.member,
  createMessageRepository: vi.fn(),
  getSafeSinceTime: vi.fn(),
}))
vi.mock("@chatbotx.io/redis", () => ({ invalidateCacheByTags: vi.fn() }))
vi.mock("../../src/audit/dispatcher", () => ({ dispatchAuditRecord: vi.fn() }))

const { taskService } = await import("../../src/task/service")
const { notificationService } = await import("../../src/notification/service")
const { internalThreadService } = await import(
  "../../src/internal-thread/service"
)
const storedTask = () => ({
  id: "t-1",
  workspaceId: "ws-1",
  title: "Task title",
  description: null,
  status: "todo",
  priority: "normal",
  dueAt: null,
  remindAt: null,
  assigneeUserId: "u-2",
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
  watchers: [{ userId: "u-2" }, { userId: "w-1" }],
  targets: [],
})

beforeEach(() => {
  vi.clearAllMocks()
  repo.thread.insertThread.mockResolvedValue({ id: "th-1" })
  repo.task.insertTask.mockResolvedValue({ id: "t-1" })
  repo.task.findById.mockResolvedValue(storedTask())
  repo.task.listMemberUserIds.mockImplementation(
    async ({ userIds }: { userIds: string[] }) => userIds,
  )
  repo.task.listWatcherUserIds.mockResolvedValue(["u-2", "w-1"])
  repo.member.listNotificationTypesByUserIds.mockResolvedValue([
    {
      userId: "w-1",
      notificationTypes: {
        notifyAdmin: true,
        newMessageToHuman: true,
        newOrder: true,
      },
    },
  ])
  repo.notification.insertMany.mockResolvedValue([{ id: "n-1", userId: "w-1" }])
  repo.task.listTeamIds.mockImplementation(
    async ({ teamIds }: { teamIds: string[] }) => teamIds,
  )
})

describe("taskService notifications", () => {
  test("delete removes task notifications in the same transaction", async () => {
    await taskService.delete({
      workspaceId: "ws-1",
      id: "t-1",
      actor: { kind: "api", label: "Hermes" },
    })

    expect(repo.notification.deleteByEntity).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      entityType: "task",
      entityId: "t-1",
      tx: "tx",
    })
  })

  test("addComment still succeeds when mention expansion fails", async () => {
    repo.thread.insertMessages.mockResolvedValue([
      {
        id: "m-1",
        kind: "comment",
        authorUserId: "u-2",
        authorLabel: null,
        text: "hello @team",
        mentions: { userIds: [], teamIds: ["team-1"] },
        attachments: [],
        systemEvent: null,
        editedAt: null,
        deletedAt: null,
        createdAt: new Date(),
      },
    ])
    repo.teamMembers.listUserIdsByTeamId.mockRejectedValueOnce(
      new Error("team lookup failed"),
    )

    const comment = await taskService.addComment({
      workspaceId: "ws-1",
      id: "t-1",
      text: "hello @team",
      actor: { kind: "user", userId: "u-2", isOwner: false },
    })

    expect(comment.id).toBe("m-1")
    expect(repo.notification.insertMany).not.toHaveBeenCalled()
  })

  test("create still succeeds when assignee expansion fails", async () => {
    repo.teamMembers.listUserIdsByTeamId.mockRejectedValueOnce(
      new Error("team lookup failed"),
    )

    const created = await taskService.create({
      workspaceId: "ws-1",
      title: "Task title",
      assignee: { type: "team", teamId: "team-1" },
      actor: { kind: "user", userId: "u-1", isOwner: true },
    })

    expect(created.id).toBe("t-1")
    expect(repo.teamMembers.listUserIdsByTeamId).toHaveBeenCalled()
    expect(repo.notification.insertMany).not.toHaveBeenCalled()
  })

  test("updateComment scopes the previous message lookup to the task thread", async () => {
    repo.thread.findMessage.mockResolvedValue(null)
    vi.spyOn(internalThreadService, "editComment").mockResolvedValueOnce({
      id: "m-1",
      mentions: { userIds: [], teamIds: [] },
    } as never)

    await taskService.updateComment({
      workspaceId: "ws-1",
      id: "t-1",
      commentId: "m-1",
      text: "edited",
      actor: { kind: "user", userId: "u-2", isOwner: false },
    })

    expect(repo.thread.findMessage).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      threadId: "th-1",
      id: "m-1",
    })
  })

  test("addComment still succeeds when notifyTask throws", async () => {
    vi.spyOn(notificationService, "notifyTask").mockRejectedValueOnce(
      new Error("notify failed"),
    )
    repo.thread.insertMessages.mockResolvedValue([
      {
        id: "m-1",
        kind: "comment",
        authorUserId: "u-2",
        authorLabel: null,
        text: "hello",
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
      text: "hello",
      actor: { kind: "user", userId: "u-2", isOwner: false },
    })

    expect(comment.id).toBe("m-1")
  })

  test("addComment notifies watchers except the actor", async () => {
    repo.thread.insertMessages.mockResolvedValue([
      {
        id: "m-1",
        kind: "comment",
        authorUserId: "u-2",
        authorLabel: null,
        text: "ping",
        mentions: { userIds: [], teamIds: [] },
        attachments: [],
        systemEvent: null,
        editedAt: null,
        deletedAt: null,
        createdAt: new Date(),
      },
    ])

    await taskService.addComment({
      workspaceId: "ws-1",
      id: "t-1",
      text: "ping",
      actor: { kind: "user", userId: "u-2", isOwner: false },
    })

    expect(repo.notification.insertMany).toHaveBeenCalledWith(
      expect.objectContaining({
        rows: [
          expect.objectContaining({
            userId: "w-1",
            type: "taskCommented",
          }),
        ],
      }),
    )
  })
})
