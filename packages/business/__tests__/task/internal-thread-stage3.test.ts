import { beforeEach, describe, expect, test, vi } from "vitest"

const repo = vi.hoisted(() => ({
  task: {
    listMemberUserIds: vi.fn(),
    listTeamIds: vi.fn(),
  },
  thread: {
    insertMessages: vi.fn(),
    findMessage: vi.fn(),
    updateMessage: vi.fn(),
    markRead: vi.fn(),
    countUnreadByThreads: vi.fn(),
  },
}))

vi.mock("@chatbotx.io/database/repositories", () => ({
  taskRepository: repo.task,
  internalThreadRepository: repo.thread,
}))

const { internalThreadService } = await import(
  "../../src/internal-thread/service"
)

const storedMessage = (overrides: Record<string, unknown> = {}) => ({
  id: "m-1",
  threadId: "th-1",
  workspaceId: "ws-1",
  kind: "comment",
  authorUserId: "u-1",
  authorLabel: null,
  text: "hello",
  mentions: { userIds: [], teamIds: [] },
  attachments: [],
  systemEvent: null,
  editedAt: null,
  deletedAt: null,
  createdAt: new Date("2026-10-23T10:00:00Z"),
  updatedAt: new Date(),
  ...overrides,
})

beforeEach(() => {
  vi.clearAllMocks()
  repo.task.listMemberUserIds.mockImplementation(
    async ({ userIds }: { userIds: string[] }) =>
      userIds.filter((id) => id !== "999"),
  )
  repo.task.listTeamIds.mockImplementation(
    async ({ teamIds }: { teamIds: string[] }) => teamIds,
  )
})

describe("internalThreadService.postComment", () => {
  test("filters mentions to workspace members and teams", async () => {
    repo.thread.insertMessages.mockResolvedValue([
      storedMessage({
        text: "@[A](user:1) @[B](user:999) @[T](team:2)",
        mentions: { userIds: ["1"], teamIds: ["2"] },
      }),
    ])
    await internalThreadService.postComment({
      workspaceId: "ws-1",
      threadId: "th-1",
      text: "@[A](user:1) @[B](user:999) @[T](team:2)",
      attachments: [],
      actor: { kind: "user", userId: "u-1", isOwner: false },
    })
    expect(repo.task.listMemberUserIds).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      userIds: ["1", "999"],
    })
    expect(repo.thread.insertMessages).toHaveBeenCalledWith({
      rows: [
        expect.objectContaining({
          mentions: { userIds: ["1"], teamIds: ["2"] },
        }),
      ],
      tx: undefined,
    })
  })

  test("writes empty mentions without querying task members when disabled", async () => {
    repo.thread.insertMessages.mockResolvedValue([storedMessage()])

    await internalThreadService.postComment({
      workspaceId: "ws-1",
      threadId: "th-1",
      text: "@[A](user:1)",
      attachments: [],
      actor: { kind: "user", userId: "u-1", isOwner: false },
      parseMentions: false,
    })

    expect(repo.task.listMemberUserIds).not.toHaveBeenCalled()
    expect(repo.task.listTeamIds).not.toHaveBeenCalled()
    expect(repo.thread.insertMessages).toHaveBeenCalledWith({
      rows: [
        expect.objectContaining({
          mentions: { userIds: [], teamIds: [] },
        }),
      ],
      tx: undefined,
    })
  })

  test("allows empty text when attachments exist", async () => {
    repo.thread.insertMessages.mockResolvedValue([storedMessage({ text: "" })])
    await internalThreadService.postComment({
      workspaceId: "ws-1",
      threadId: "th-1",
      text: "",
      attachments: [
        {
          key: "k",
          name: "f",
          size: 1,
          mimeType: "text/plain",
        },
      ],
      actor: { kind: "user", userId: "u-1", isOwner: false },
    })
    expect(repo.thread.insertMessages).toHaveBeenCalled()
  })

  test("rejects empty text without attachments", async () => {
    await expect(
      internalThreadService.postComment({
        workspaceId: "ws-1",
        threadId: "th-1",
        text: "   ",
        attachments: [],
        actor: { kind: "user", userId: "u-1", isOwner: false },
      }),
    ).rejects.toMatchObject({ code: "validation" })
  })
})

describe("internalThreadService edit/delete", () => {
  const now = new Date("2026-10-23T12:00:00Z")

  test("edit updates text and editedAt", async () => {
    repo.thread.findMessage.mockResolvedValue(storedMessage())
    repo.thread.updateMessage.mockResolvedValue(
      storedMessage({ text: "updated", editedAt: now }),
    )
    const view = await internalThreadService.editComment({
      workspaceId: "ws-1",
      threadId: "th-1",
      id: "m-1",
      text: "updated",
      actor: { kind: "user", userId: "u-1", isOwner: false },
      now,
    })
    expect(repo.thread.updateMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        set: expect.objectContaining({ text: "updated", editedAt: now }),
      }),
    )
    expect(view.text).toBe("updated")
  })

  test("forbidden when editing another user's comment", async () => {
    repo.thread.findMessage.mockResolvedValue(
      storedMessage({ authorUserId: "u-2" }),
    )
    await expect(
      internalThreadService.editComment({
        workspaceId: "ws-1",
        threadId: "th-1",
        id: "m-1",
        text: "nope",
        actor: { kind: "user", userId: "u-1", isOwner: false },
        now,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" })
  })

  test("soft-deletes comment", async () => {
    repo.thread.findMessage.mockResolvedValue(storedMessage())
    repo.thread.updateMessage.mockResolvedValue(
      storedMessage({ deletedAt: now, text: "hello" }),
    )
    const view = await internalThreadService.deleteComment({
      workspaceId: "ws-1",
      threadId: "th-1",
      id: "m-1",
      actor: { kind: "user", userId: "u-1", isOwner: false },
      isOwner: false,
      now,
    })
    expect(repo.thread.updateMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        set: expect.objectContaining({ deletedAt: now }),
      }),
    )
    expect(view.deleted).toBe(true)
    expect(view.attachments).toEqual([])
  })
})

describe("internalThreadService read state", () => {
  test("markRead delegates to repository", async () => {
    repo.thread.markRead.mockResolvedValue(true)
    await internalThreadService.markRead({
      threadId: "th-1",
      userId: "u-1",
      at: new Date(),
    })
    expect(repo.thread.markRead).toHaveBeenCalled()
  })

  test("countUnread delegates to repository", async () => {
    const map = new Map([["th-1", 2]])
    repo.thread.countUnreadByThreads.mockResolvedValue(map)
    const result = await internalThreadService.countUnread({
      workspaceId: "ws-1",
      userId: "u-1",
      threadIds: ["th-1"],
    })
    expect(result).toBe(map)
  })
})
