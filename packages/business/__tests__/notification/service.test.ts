import { beforeEach, describe, expect, test, vi } from "vitest"

const repo = vi.hoisted(() => ({
  notification: {
    insertMany: vi.fn(),
    listForUser: vi.fn(),
    countUnread: vi.fn(),
    markRead: vi.fn(),
    deleteByEntity: vi.fn(),
    deleteOlderThan: vi.fn(),
  },
  task: {
    listWatcherUserIds: vi.fn(),
    listMemberUserIds: vi.fn(),
  },
  member: {
    listNotificationTypesByUserIds: vi.fn(),
    findNotificationTypes: vi.fn(),
    updateNotificationTypes: vi.fn(),
  },
}))

vi.mock("@chatbotx.io/database/client", () => ({
  db: {},
}))
vi.mock("@chatbotx.io/database/repositories", () => ({
  notificationRepository: repo.notification,
  taskRepository: repo.task,
  workspaceMemberRepository: repo.member,
}))

const { notificationService } = await import("../../src/notification/service")
const { onNotificationsCreated, resetNotificationsCreatedListenersForTests } =
  await import("../../src/notification/listeners")

const notifyInput = {
  workspaceId: "ws-1",
  task: {
    id: "t-1",
    title: "Title",
    assigneeUserId: null,
    assigneeTeamId: null,
    createdByUserId: "u-1",
  },
  actor: { kind: "user" as const, userId: "u-2", isOwner: false },
  events: [{ kind: "commented" as const }],
}

beforeEach(() => {
  resetNotificationsCreatedListenersForTests()
  vi.clearAllMocks()
  repo.task.listWatcherUserIds.mockResolvedValue(["w-1"])
  repo.task.listMemberUserIds.mockImplementation(
    async ({ userIds }: { userIds: string[] }) => userIds,
  )
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

describe("notificationService.notifyTask", () => {
  test("inserts rows and notifies listeners", async () => {
    const listener = vi.fn()
    onNotificationsCreated(listener)

    await notificationService.notifyTask(notifyInput)

    expect(repo.notification.insertMany).toHaveBeenCalled()
    expect(listener).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      notifications: [{ id: "n-1", userId: "w-1" }],
    })
  })

  test("does not register the same listener twice", async () => {
    const listener = vi.fn()
    onNotificationsCreated(listener)
    onNotificationsCreated(listener)

    await notificationService.notifyTask(notifyInput)

    expect(listener).toHaveBeenCalledTimes(1)
  })

  test("notifyTaskReminder notifies the assignee with a system actor", async () => {
    await notificationService.notifyTaskReminder({
      id: "t-1",
      workspaceId: "ws-1",
      title: "Reminder",
      assigneeUserId: "u-assignee",
      assigneeTeamId: null,
      createdByUserId: "u-creator",
    })

    expect(repo.notification.insertMany).toHaveBeenCalledWith(
      expect.objectContaining({
        rows: [
          expect.objectContaining({
            type: "taskReminder",
            userId: "u-assignee",
            payload: expect.objectContaining({
              actorUserId: null,
              actorLabel: "System",
            }),
          }),
        ],
      }),
    )
  })

  test("notifyTaskOverdue notifies assignee and creator", async () => {
    repo.task.listMemberUserIds.mockResolvedValue(["u-assignee", "u-creator"])

    await notificationService.notifyTaskOverdue({
      id: "t-1",
      workspaceId: "ws-1",
      title: "Overdue",
      assigneeUserId: "u-assignee",
      assigneeTeamId: null,
      createdByUserId: "u-creator",
    })

    expect(repo.notification.insertMany).toHaveBeenCalledWith(
      expect.objectContaining({
        rows: expect.arrayContaining([
          expect.objectContaining({
            type: "taskOverdue",
            userId: "u-assignee",
          }),
          expect.objectContaining({ type: "taskOverdue", userId: "u-creator" }),
        ]),
      }),
    )
  })

  test("skips disabled notification types", async () => {
    repo.member.listNotificationTypesByUserIds.mockResolvedValue([
      {
        userId: "w-1",
        notificationTypes: {
          notifyAdmin: true,
          newMessageToHuman: true,
          newOrder: true,
          taskCommented: false,
        },
      },
    ])

    await notificationService.notifyTask({
      ...notifyInput,
      actor: { kind: "api", label: "Hermes" },
    })

    expect(repo.notification.insertMany).not.toHaveBeenCalled()
  })
})

describe("notificationService.updatePreferences", () => {
  test("merges without dropping legacy keys", async () => {
    repo.member.findNotificationTypes.mockResolvedValue({
      notifyAdmin: false,
      newMessageToHuman: true,
      newOrder: true,
      taskAssigned: true,
    })

    const prefs = await notificationService.updatePreferences({
      workspaceId: "ws-1",
      userId: "u-1",
      patch: { taskMentioned: false },
    })

    expect(repo.member.updateNotificationTypes).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      userId: "u-1",
      notificationTypes: {
        notifyAdmin: false,
        newMessageToHuman: true,
        newOrder: true,
        taskAssigned: true,
        taskMentioned: false,
      },
    })
    expect(prefs.taskMentioned).toBe(false)
    expect(prefs.taskAssigned).toBe(true)
  })
})
