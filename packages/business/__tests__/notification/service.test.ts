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
    claimDueReminders: vi.fn(),
    claimOverdue: vi.fn(),
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
  repo.member.updateNotificationTypes.mockResolvedValue(1)
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
              actorLabel: null,
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

  test("picks the highest-priority enabled type per user", async () => {
    repo.task.listWatcherUserIds.mockResolvedValue(["2"])
    repo.member.listNotificationTypesByUserIds.mockResolvedValue([
      {
        userId: "2",
        notificationTypes: {
          notifyAdmin: true,
          newMessageToHuman: true,
          newOrder: true,
          taskAssigned: false,
          taskCommented: true,
        },
      },
    ])

    await notificationService.notifyTask({
      ...notifyInput,
      actor: { kind: "user", userId: "9", isOwner: false },
      events: [{ kind: "assigned", userIds: ["2"] }, { kind: "commented" }],
    })

    expect(repo.notification.insertMany).toHaveBeenCalledWith(
      expect.objectContaining({
        rows: [
          expect.objectContaining({
            userId: "2",
            type: "taskCommented",
          }),
        ],
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

describe("notificationService.processDueTaskNotifications", () => {
  const dueTask = (id: string) => ({
    id,
    workspaceId: "ws-1",
    title: "Due task",
    assigneeUserId: "u-assignee",
    assigneeTeamId: null,
    createdByUserId: "u-creator",
  })
  const runGuard = vi.fn(
    async (_workspaceId: string, fn: () => Promise<void>) => {
      await fn()
    },
  )
  const scan = (guard = runGuard) =>
    notificationService.processDueTaskNotifications({
      now: new Date("2026-10-23T12:00:00.000Z"),
      batchSize: 2,
      maxBatches: 3,
      guard,
    })

  beforeEach(() => {
    repo.task.claimDueReminders.mockResolvedValue([])
    repo.task.claimOverdue.mockResolvedValue([])
  })

  test("notifies claimed reminders and overdue tasks", async () => {
    const reminder = vi
      .spyOn(notificationService, "notifyTaskReminder")
      .mockResolvedValue()
    const overdue = vi
      .spyOn(notificationService, "notifyTaskOverdue")
      .mockResolvedValue()
    repo.task.claimDueReminders.mockResolvedValueOnce([dueTask("t-1")])
    repo.task.claimOverdue.mockResolvedValueOnce([dueTask("t-2")])

    const result = await scan()

    expect(result).toEqual({ reminders: 1, overdue: 1 })
    expect(reminder).toHaveBeenCalledTimes(1)
    expect(overdue).toHaveBeenCalledTimes(1)
  })

  test("skips delivery when the guard does not run the callback", async () => {
    const reminder = vi
      .spyOn(notificationService, "notifyTaskReminder")
      .mockResolvedValue()
    repo.task.claimDueReminders.mockResolvedValueOnce([dueTask("t-1")])
    const blockedGuard = vi.fn(async () => undefined)

    await scan(blockedGuard)

    expect(blockedGuard).toHaveBeenCalledWith("ws-1", expect.any(Function))
    expect(reminder).not.toHaveBeenCalled()
  })

  test("stops after maxBatches full batches", async () => {
    vi.spyOn(notificationService, "notifyTaskReminder").mockResolvedValue()
    repo.task.claimDueReminders.mockResolvedValue([
      dueTask("t-1"),
      dueTask("t-2"),
    ])

    const result = await scan()

    expect(repo.task.claimDueReminders).toHaveBeenCalledTimes(3)
    expect(result.reminders).toBe(6)
  })

  test("a failing notification does not stop the scan", async () => {
    vi.spyOn(notificationService, "notifyTaskReminder").mockRejectedValue(
      new Error("boom"),
    )
    repo.task.claimDueReminders.mockResolvedValueOnce([
      dueTask("t-1"),
      dueTask("t-2"),
    ])

    const result = await scan()

    expect(result.reminders).toBe(2)
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

  test("rejects when no workspace member row was updated", async () => {
    repo.member.findNotificationTypes.mockResolvedValue({})
    repo.member.updateNotificationTypes.mockResolvedValue(0)

    await expect(
      notificationService.updatePreferences({
        workspaceId: "ws-1",
        userId: "u-1",
        patch: { taskMentioned: false },
      }),
    ).rejects.toMatchObject({ code: "validation" })
  })
})
