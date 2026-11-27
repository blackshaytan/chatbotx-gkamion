import { beforeEach, describe, expect, test, vi } from "vitest"

const {
  mockBulkCreateAttachments,
  mockChatQueueAdd,
  mockContactInboxFindBy,
  mockConversationFindByOrFail,
  mockDeleteAttachmentsByMessageId,
  mockFindById,
  mockPublishMessageEvent,
  mockUpdateMessageText,
} = vi.hoisted(() => ({
  mockBulkCreateAttachments: vi.fn().mockResolvedValue(undefined),
  mockChatQueueAdd: vi.fn().mockResolvedValue(undefined),
  mockContactInboxFindBy: vi.fn(),
  mockConversationFindByOrFail: vi.fn(),
  mockDeleteAttachmentsByMessageId: vi.fn().mockResolvedValue(undefined),
  mockFindById: vi.fn(),
  mockPublishMessageEvent: vi.fn().mockResolvedValue(undefined),
  mockUpdateMessageText: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@chatbotx.io/business", () => ({
  publishMessageEvent: mockPublishMessageEvent,
  contactInboxService: { findBy: mockContactInboxFindBy },
  conversationService: { findByOrFail: mockConversationFindByOrFail },
}))

vi.mock("@chatbotx.io/business/errors", () => ({
  ChatbotXException: class ChatbotXException extends Error {},
}))

vi.mock("@chatbotx.io/database/repositories", () => ({
  createMessageRepository: vi.fn().mockResolvedValue({
    findById: mockFindById,
    updateMessageText: mockUpdateMessageText,
    deleteAttachmentsByMessageId: mockDeleteAttachmentsByMessageId,
    bulkCreateAttachments: mockBulkCreateAttachments,
  }),
}))

vi.mock("@chatbotx.io/filesystem", () => ({
  getImageDimensions: vi.fn(),
  uploader: { getObject: vi.fn() },
}))

vi.mock("@chatbotx.io/partysocket-config", () => ({
  RealtimeEventType: { messageUpdated: "messageUpdated" },
}))

vi.mock("@chatbotx.io/worker-config", () => ({
  ChatJobAction: { editChannelMessage: "editChannelMessage" },
  chatQueue: { add: mockChatQueueAdd },
}))

vi.mock("@/lib/safe-action", () => ({
  workspaceActionClient: {
    bindArgsSchemas: () => ({
      inputSchema: () => ({
        action: (fn: (...args: any[]) => any) => fn,
      }),
    }),
  },
}))

const { editMessage } = await import(
  "../src/features/messages/actions/edit-message.action"
)

const createdAt = new Date("2026-01-01T00:00:00Z")

describe("editMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPublishMessageEvent.mockResolvedValue(undefined)
    mockConversationFindByOrFail.mockResolvedValue({
      id: "conv-1",
      workspaceId: "ws-1",
    })
    mockContactInboxFindBy.mockResolvedValue({ id: "ci-1", inboxId: "inbox-1" })
    mockFindById.mockResolvedValue({
      id: "msg-1",
      conversationId: "conv-1",
      createdAt,
      messageType: "outgoing",
      type: "comment",
      contactInboxId: "ci-1",
    })
  })

  test("broadcasts messageUpdated with the new text and no attachment change", async () => {
    await editMessage({
      workspaceId: "ws-1",
      conversationId: "conv-1",
      parsedInput: {
        messageId: "msg-1",
        createdAt,
        newText: "updated text",
      } as never,
    })

    expect(mockPublishMessageEvent).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      inboxId: "inbox-1",
      event: {
        eventType: "messageUpdated",
        data: {
          messageId: "msg-1",
          newText: "updated text",
          newAttachmentPath: null,
          newAttachmentPublicUrl: null,
          newAttachmentMimeType: null,
          newAttachmentWidth: 0,
          newAttachmentHeight: 0,
          removedAttachment: false,
        },
      },
    })
  })

  test("broadcasts removedAttachment: true when the caller removes the attachment", async () => {
    await editMessage({
      workspaceId: "ws-1",
      conversationId: "conv-1",
      parsedInput: {
        messageId: "msg-1",
        createdAt,
        newText: "updated text",
        removeAttachment: true,
      } as never,
    })

    expect(mockPublishMessageEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws-1",
        inboxId: "inbox-1",
        event: expect.objectContaining({
          eventType: "messageUpdated",
          data: expect.objectContaining({ removedAttachment: true }),
        }),
      }),
    )
  })

  test("throws and does not broadcast when the message is not an editable comment", async () => {
    mockFindById.mockResolvedValue({
      id: "msg-1",
      conversationId: "conv-1",
      createdAt,
      messageType: "outgoing",
      type: "text",
      contactInboxId: "ci-1",
    })

    await expect(
      editMessage({
        workspaceId: "ws-1",
        conversationId: "conv-1",
        parsedInput: {
          messageId: "msg-1",
          createdAt,
          newText: "updated text",
        } as never,
      }),
    ).rejects.toThrow()

    expect(mockPublishMessageEvent).not.toHaveBeenCalled()
  })
})
