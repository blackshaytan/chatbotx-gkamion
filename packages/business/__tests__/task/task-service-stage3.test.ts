import { beforeEach, describe, expect, test, vi } from "vitest"

const repo = vi.hoisted(() => ({
  task: {
    findById: vi.fn(),
    listMemberUserIds: vi.fn(),
    listTeamIds: vi.fn(),
    insertWatchers: vi.fn(),
  },
  thread: {
    insertMessages: vi.fn(),
    insertMembers: vi.fn(),
    findMessage: vi.fn(),
    updateMessage: vi.fn(),
    markRead: vi.fn(),
    countUnreadByThreads: vi.fn(),
  },
}))

const uploader = vi.hoisted(() => ({
  headObject: vi.fn(),
  putObject: vi.fn(),
}))

vi.mock("@chatbotx.io/database/client", () => ({
  db: { transaction: async (fn: (tx: unknown) => unknown) => await fn("tx") },
}))
vi.mock("@chatbotx.io/database/repositories", () => ({
  taskRepository: repo.task,
  internalThreadRepository: repo.thread,
  inboxTeamMemberRepository: { listUserIdsByTeamId: vi.fn() },
  createMessageRepository: vi.fn(),
  getSafeSinceTime: vi.fn(),
}))
vi.mock("@chatbotx.io/filesystem", () => ({ uploader }))
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

const storedTask = () => ({
  id: "t-1",
  workspaceId: "ws-1",
  threadId: "th-1",
  title: "Task",
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
  completedAt: null,
  remindedAt: null,
  overdueNotifiedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  watchers: [{ userId: "u-1" }],
  targets: [],
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
})

describe("taskService.addComment watchers", () => {
  test("mentioned members become watchers", async () => {
    repo.thread.insertMessages.mockResolvedValue([
      {
        id: "m-1",
        kind: "comment",
        authorUserId: "u-1",
        authorLabel: null,
        text: "@[Bob](user:2)",
        mentions: { userIds: ["2"], teamIds: [] },
        attachments: [],
        systemEvent: null,
        editedAt: null,
        deletedAt: null,
        createdAt: new Date(),
      },
    ])
    uploader.headObject.mockResolvedValue({
      ContentLength: 1,
      ContentType: "text/plain",
    })

    await taskService.addComment({
      workspaceId: "ws-1",
      id: "t-1",
      text: "@[Bob](user:2)",
      actor: { kind: "user", userId: "u-1", isOwner: false },
    })

    expect(repo.task.insertWatchers).toHaveBeenCalledWith({
      rows: [{ taskId: "t-1", userId: "2" }],
      tx: "tx",
    })
    expect(repo.thread.insertMembers).toHaveBeenCalledWith({
      rows: [{ threadId: "th-1", userId: "2" }],
      tx: "tx",
    })
  })
})

describe("taskService unreadCount", () => {
  test("get includes unreadCount when viewerUserId is set", async () => {
    repo.thread.countUnreadByThreads.mockResolvedValue(new Map([["th-1", 3]]))

    const task = await taskService.get({
      workspaceId: "ws-1",
      id: "t-1",
      viewerUserId: "u-viewer",
    })

    expect(repo.thread.countUnreadByThreads).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      userId: "u-viewer",
      threadIds: ["th-1"],
    })
    expect(task.unreadCount).toBe(3)
  })
})
