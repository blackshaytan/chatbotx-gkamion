import { beforeEach, describe, expect, test, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  findAccessible: vi.fn(),
  listMembers: vi.fn(),
  touchLastMessage: vi.fn(),
  postComment: vi.fn(),
  available: vi.fn(),
}))
vi.mock("@chatbotx.io/database/client", () => ({
  db: { transaction: mocks.transaction },
}))
vi.mock("@chatbotx.io/database/repositories", () => ({
  chatRepository: {
    findAccessible: mocks.findAccessible,
    listMembers: mocks.listMembers,
    touchLastMessage: mocks.touchLastMessage,
  },
}))
vi.mock("../../src/internal-thread/attachments", () => ({
  resolveChatAttachments: vi.fn().mockResolvedValue([]),
  uploadChatAttachment: vi.fn(),
}))
vi.mock("../../src/internal-thread/service", () => ({
  internalThreadService: { postComment: mocks.postComment },
}))
vi.mock("../../src/notification/service", () => ({ notificationService: {} }))
vi.mock("../../src/staff-assistant/availability", () => ({
  isStaffAssistantAvailable: mocks.available,
}))

const { chatService } = await import("../../src/chat/service")
const TX = { tx: true }
const input = {
  workspaceId: "ws",
  threadId: "chat",
  text: "Hello",
  attachments: [],
  actor: { kind: "user" as const, userId: "1" },
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.transaction.mockImplementation((fn) => fn(TX))
  mocks.findAccessible.mockResolvedValue({
    thread: { type: "agent", directKey: "agent:1:staff" },
  })
  mocks.listMembers.mockResolvedValue([
    { userId: "1", isWorkspaceMember: true },
  ])
  mocks.postComment.mockResolvedValue({ id: "message" })
})

describe("staff assistant chat sending", () => {
  test("rejects the member's message if the assistant is unavailable", async () => {
    mocks.available.mockResolvedValue(false)
    await expect(chatService.send(input)).rejects.toMatchObject({
      code: "staffAssistantUnavailable",
      httpStatusCode: 400,
    })
    expect(mocks.available).toHaveBeenCalledWith("ws", TX)
    expect(mocks.postComment).not.toHaveBeenCalled()
  })

  test("allows an available assistant chat and ordinary token chats", async () => {
    mocks.available.mockResolvedValue(true)
    await chatService.send(input)
    expect(mocks.postComment).toHaveBeenCalledTimes(1)
    mocks.findAccessible.mockResolvedValue({
      thread: { type: "agent", directKey: "agent:1:token:2" },
    })
    mocks.available.mockClear()
    await chatService.send(input)
    expect(mocks.available).not.toHaveBeenCalled()
    expect(mocks.postComment).toHaveBeenCalledTimes(2)
  })
})
