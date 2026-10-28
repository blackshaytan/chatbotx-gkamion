import { beforeEach, expect, test, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  notify: vi.fn(),
  warn: vi.fn(),
}))
vi.mock("../../src/platform/realtime-broadcast", () => ({
  sendToWorkspaceMember: mocks.send,
}))
vi.mock("../../src/notification/service", () => ({
  notificationService: { notifyChatMessage: mocks.notify },
}))
vi.mock("../../src/logger", () => ({ logger: { warn: mocks.warn } }))
const { deliverStaffChatMessage, publishStaffChatChanged } = await import(
  "../../src/chat-delivery"
)

beforeEach(() => {
  vi.clearAllMocks()
  mocks.send.mockResolvedValue(undefined)
  mocks.notify.mockResolvedValue(undefined)
})

test("delivers realtime once per participant and sends the chat notification", () => {
  const message = {
    id: "message",
    authorUserId: null,
    authorLabel: "Assistant",
    text: "Hello",
    createdAt: new Date(),
  }
  deliverStaffChatMessage({
    workspaceId: "ws",
    threadId: "chat",
    memberUserIds: ["1", "1", "2"],
    message,
  })
  expect(mocks.send).toHaveBeenCalledTimes(2)
  expect(mocks.send).toHaveBeenCalledWith(
    { workspaceId: "ws", userId: "1" },
    expect.objectContaining({ data: { threadId: "chat" } }),
  )
  expect(mocks.notify).toHaveBeenCalledWith(
    expect.objectContaining({
      workspaceId: "ws",
      threadId: "chat",
      messageId: "message",
      actorLabel: "Assistant",
    }),
  )
})

test("system changes can publish realtime without a notification", () => {
  publishStaffChatChanged({
    workspaceId: "ws",
    threadId: "chat",
    memberUserIds: ["1"],
  })
  expect(mocks.send).toHaveBeenCalledTimes(1)
  expect(mocks.notify).not.toHaveBeenCalled()
})
