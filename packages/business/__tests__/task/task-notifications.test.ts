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
