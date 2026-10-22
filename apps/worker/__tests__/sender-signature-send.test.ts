import { beforeEach, describe, expect, test, vi } from "vitest"
import {
  sendFlowStepToChannel,
  sendMessageToChannel,
} from "../src/chat/handlers/send-message"

const {
  mockResolveIntegrationContextFromContactInbox,
  mockRunChannelHandler,
  mockGetRuntime,
  mockFindNameAndEmail,
  mockRecordOutboundMessageSent,
  mockCreateMessageRepository,
} = vi.hoisted(() => {
  const updateSourceId = vi.fn().mockResolvedValue(undefined)
  const updateSendError = vi.fn().mockResolvedValue(undefined)
  return {
    mockResolveIntegrationContextFromContactInbox: vi.fn(),
    mockRunChannelHandler: vi
      .fn()
      .mockResolvedValue({ messageIds: ["mid-1"], sentCount: 1 }),
    mockGetRuntime: vi.fn(),
    mockFindNameAndEmail: vi.fn(),
    mockRecordOutboundMessageSent: vi.fn().mockResolvedValue(undefined),
    mockCreateMessageRepository: vi.fn().mockResolvedValue({
      updateSourceId,
      updateSendError,
      findById: vi.fn().mockResolvedValue(null),
    }),
  }
})

vi.mock("@chatbotx.io/analytics", () => ({
  commentAutomationAnalyticsService: { settleEvent: vi.fn() },
}))

vi.mock("@chatbotx.io/business", () => ({
  contactInboxService: {
    recordOutboundMessageSent: mockRecordOutboundMessageSent,
    recordSendFailure: vi.fn(),
  },
  contactService: { unblockIfBlocked: vi.fn().mockResolvedValue(null) },
  conversationService: {
    markReadByOutbound: vi.fn().mockResolvedValue(true),
  },
  broadcastToWorkspaceParty: vi.fn(),
  publishToWorkspaceParty: vi.fn(),
  whatsappCallPermissionService: { recordPermanentGrant: vi.fn() },
  whatsappFlowService: { findSourceId: vi.fn() },
  threadControlService: {
    // The current row is the job's row: no routing state to refresh.
    refreshForRouting: ({ contactInbox }: { contactInbox: unknown }) =>
      Promise.resolve(contactInbox),
  },
  externalAgentService: { getRuntime: mockGetRuntime },
  userService: { findNameAndEmail: mockFindNameAndEmail },
}))

vi.mock("@chatbotx.io/database/client", () => ({
  db: { update: vi.fn() },
  eq: vi.fn(),
}))

vi.mock("@chatbotx.io/database/schema", () => ({
  messageModel: { id: "id", sourceId: "sourceId" },
  whatsappFlowModel: { id: "id", sourceId: "sourceId" },
}))

vi.mock("@chatbotx.io/database/repositories", () => ({
  createMessageRepository: mockCreateMessageRepository,
}))

vi.mock("@chatbotx.io/event-bus", () => ({
  emit: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@chatbotx.io/sdk", () => ({
  ChannelError: class ChannelError extends Error {},
  ChannelErrorCategory: { PERMISSION_DENIED: "permission_denied" },
  parseSdkError: vi.fn().mockResolvedValue({ message: "sdk error" }),
}))

vi.mock("../src/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

vi.mock("../src/services/integrations", () => ({
  allIntegrations: {},
  resolveIntegrationContextFromContactInbox:
    mockResolveIntegrationContextFromContactInbox,
}))

vi.mock("@chatbotx.io/worker-config", () => ({
  ChatJobAction: { broadcastEvent: "broadcastEvent" },
  chatQueue: { add: vi.fn() },
}))

const conversation = {
  id: "conv-1",
  workspaceId: "ws-1",
  contactId: "contact-1",
}

const contactInbox = {
  id: "ci-1",
  inboxId: "inbox-1",
  channel: "messenger",
  contactId: "contact-1",
  sourceId: "psid-1",
  source: "messenger",
}

const SIGNED_AGENT_RUNTIME = {
  agent: { signMessages: true, botName: "Гека" },
  client: {},
}

const outgoing = (overrides: Record<string, unknown> = {}) => ({
  id: "msg-1",
  workspaceId: "ws-1",
  conversationId: "conv-1",
  contactInboxId: "ci-1",
  contentType: "text",
  messageType: "outgoing",
  senderType: "bot",
  senderId: null,
  type: "message",
  text: "Здравствуйте",
  contentAttributes: null,
  parentId: null,
  createdAt: new Date("2026-10-22T10:00:00.000Z"),
  ...overrides,
})

/** The message the channel handler received, i.e. the text that reaches the client. */
const channelText = (): string | null | undefined => {
  const handlerData = mockRunChannelHandler.mock.calls[0]?.[2] as
    | { data: { message: { text: string | null } } }
    | undefined
  return handlerData?.data.message.text
}

describe("sender signature on the channel send", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRunChannelHandler.mockResolvedValue({
      messageIds: ["mid-1"],
      sentCount: 1,
    })
    mockResolveIntegrationContextFromContactInbox.mockResolvedValue({
      ctx: { workspaceId: "ws-1" },
      integration: { runChannelHandler: mockRunChannelHandler },
    })
    mockGetRuntime.mockResolvedValue(SIGNED_AGENT_RUNTIME)
    mockFindNameAndEmail.mockResolvedValue({
      name: "Анна",
      email: "anna@example.com",
    })
  })

  test("an AI agent reply is prefixed with the bot name", async () => {
    await sendMessageToChannel({
      conversation: conversation as never,
      contactInbox: contactInbox as never,
      message: outgoing() as never,
      signAs: "externalAgent",
    })

    expect(mockGetRuntime).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      inboxId: "inbox-1",
    })
    expect(mockRunChannelHandler).toHaveBeenCalledWith(
      "message",
      "sendMessage",
      expect.anything(),
    )
    expect(channelText()).toBe("Гека: Здравствуйте")
  })

  test("a manager reply is prefixed with the manager's name", async () => {
    await sendMessageToChannel({
      conversation: conversation as never,
      contactInbox: contactInbox as never,
      message: outgoing({
        senderType: "user",
        senderId: "user-1",
      }) as never,
    })

    expect(mockFindNameAndEmail).toHaveBeenCalledWith("user-1")
    expect(channelText()).toBe("Анна: Здравствуйте")
  })

  test("the stored message keeps its original text", async () => {
    const message = outgoing({ senderType: "user", senderId: "user-1" })

    await sendMessageToChannel({
      conversation: conversation as never,
      contactInbox: contactInbox as never,
      message: message as never,
    })

    expect(channelText()).toBe("Анна: Здравствуйте")
    expect(message.text).toBe("Здравствуйте")
  })

  test("a private comment reply is sent without a prefix", async () => {
    await sendMessageToChannel({
      conversation: conversation as never,
      contactInbox: contactInbox as never,
      message: outgoing({
        senderType: "user",
        senderId: "user-1",
        type: "comment",
        contentAttributes: { isPrivateReply: true },
      }) as never,
    })

    expect(mockRunChannelHandler).toHaveBeenCalledWith(
      "comment",
      "sendPrivateReply",
      expect.anything(),
    )
    expect(
      (
        mockRunChannelHandler.mock.calls[0]?.[2] as {
          data: { message: { text: string } }
        }
      ).data.message.text,
    ).toBe("Здравствуйте")
  })

  test("a public comment reply is sent without a prefix", async () => {
    await sendMessageToChannel({
      conversation: conversation as never,
      contactInbox: contactInbox as never,
      message: outgoing({
        senderType: "user",
        senderId: "user-1",
        type: "comment",
      }) as never,
    })

    expect(mockRunChannelHandler).toHaveBeenCalledWith(
      "comment",
      "sendComment",
      expect.anything(),
    )
    expect(channelText()).toBe("Здравствуйте")
    expect(mockFindNameAndEmail).not.toHaveBeenCalled()
  })

  test("an attachment-only manager message gets no prefix", async () => {
    await sendMessageToChannel({
      conversation: conversation as never,
      contactInbox: contactInbox as never,
      message: outgoing({
        senderType: "user",
        senderId: "user-1",
        text: null,
      }) as never,
    })

    expect(channelText()).toBeNull()
    expect(mockGetRuntime).not.toHaveBeenCalled()
  })

  test("an API send is never prefixed", async () => {
    await sendMessageToChannel({
      conversation: conversation as never,
      contactInbox: contactInbox as never,
      message: outgoing({ senderType: "api" }) as never,
    })

    expect(channelText()).toBe("Здравствуйте")
    expect(mockGetRuntime).not.toHaveBeenCalled()
  })

  test("a handover confirmation without the agent marker is never prefixed", async () => {
    await sendMessageToChannel({
      conversation: conversation as never,
      contactInbox: contactInbox as never,
      message: outgoing({ senderType: "bot" }) as never,
    })

    expect(channelText()).toBe("Здравствуйте")
    expect(mockGetRuntime).not.toHaveBeenCalled()
  })

  test("a flow step is never prefixed", async () => {
    await sendFlowStepToChannel({
      conversation: conversation as never,
      contactInbox: contactInbox as never,
      flowId: "flow-1",
      step: {
        id: "step-1",
        nodeId: "node-1",
        stepType: "sendText",
        text: "Шаг потока",
        buttons: [],
      } as never,
      botSentAnalytics: {
        triggerHandler: "sendFlowStep",
        triggerType: "flow",
      },
    })

    const handlerData = mockRunChannelHandler.mock.calls[0]?.[2] as {
      data: { step: { text: string } }
    }
    expect(handlerData.data.step.text).toBe("Шаг потока")
    expect(mockGetRuntime).not.toHaveBeenCalled()
  })

  test("nothing is prefixed when the agent's signMessages setting is off", async () => {
    mockGetRuntime.mockResolvedValue({
      agent: { signMessages: false, botName: "Гека" },
      client: {},
    })

    await sendMessageToChannel({
      conversation: conversation as never,
      contactInbox: contactInbox as never,
      message: outgoing({ senderType: "user", senderId: "user-1" }) as never,
    })
    await sendMessageToChannel({
      conversation: conversation as never,
      contactInbox: contactInbox as never,
      message: outgoing() as never,
      signAs: "externalAgent",
    })

    expect(channelText()).toBe("Здравствуйте")
    expect(mockRunChannelHandler).toHaveBeenNthCalledWith(
      2,
      "message",
      "sendMessage",
      expect.objectContaining({
        data: expect.objectContaining({
          message: expect.objectContaining({ text: "Здравствуйте" }),
        }),
      }),
    )
  })

  test("a manager without a name is sent without a prefix", async () => {
    mockFindNameAndEmail.mockResolvedValue({
      name: null,
      email: "anna@example.com",
    })

    await sendMessageToChannel({
      conversation: conversation as never,
      contactInbox: contactInbox as never,
      message: outgoing({ senderType: "user", senderId: "user-1" }) as never,
    })

    expect(channelText()).toBe("Здравствуйте")
  })

  test("an agent without a bot name is sent without a prefix", async () => {
    mockGetRuntime.mockResolvedValue({
      agent: { signMessages: true, botName: null },
      client: {},
    })

    await sendMessageToChannel({
      conversation: conversation as never,
      contactInbox: contactInbox as never,
      message: outgoing() as never,
      signAs: "externalAgent",
    })

    expect(channelText()).toBe("Здравствуйте")
  })

  test("the send still goes out unsigned when the name lookup fails", async () => {
    mockFindNameAndEmail.mockRejectedValue(new Error("db down"))

    const result = await sendMessageToChannel({
      conversation: conversation as never,
      contactInbox: contactInbox as never,
      message: outgoing({ senderType: "user", senderId: "user-1" }) as never,
    })

    expect(result).toEqual({ messageIds: ["mid-1"], sentCount: 1 })
    expect(channelText()).toBe("Здравствуйте")
  })
})
