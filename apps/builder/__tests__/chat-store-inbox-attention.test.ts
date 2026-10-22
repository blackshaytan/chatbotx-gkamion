import { beforeEach, describe, expect, test, vi } from "vitest"

vi.mock("@/lib/orpc/orpc", () => ({
  client: {
    conversationsAPI: {
      findConversationAuthenticatedAPI: vi.fn(),
      listConversationsByPOSTAuthenticatedAPI: vi.fn(),
    },
    messagesAPI: {
      listMessagesAuthenticatedAPI: vi.fn(),
    },
  },
}))

vi.mock("@/lib/log", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

const { createChatStore } = await import(
  "../src/features/chat/store/chat-store"
)

type TestConversation = {
  id: string
  workspaceId: string
  contactId: string
  messages: unknown[]
  lastActivityAt: Date | null
  inboxActivityAt: Date | null
  agentLastReadAt: Date | null
  adminRepliedAt: Date | null
  unreadCount: number
}

type TestMessage = {
  id: string
  workspaceId: string
  conversationId: string
  createdAt: Date
  messageType: "incoming" | "outgoing" | "activity"
  senderType: "bot" | "contact" | "user" | "api" | "system"
  senderId: string | null
  type: "message" | "comment"
  contentAttributes: Record<string, unknown> | null
}

const READ_AT = new Date("2026-01-01T00:00:00Z")

const makeConversation = (id: string, activityAt: Date): TestConversation => ({
  id,
  workspaceId: "ws-1",
  contactId: `contact-${id}`,
  messages: [],
  lastActivityAt: activityAt,
  inboxActivityAt: activityAt,
  agentLastReadAt: READ_AT,
  adminRepliedAt: null,
  unreadCount: 0,
})

const makeMessage = (
  conversationId: string,
  createdAt: Date,
  overrides: Partial<TestMessage> = {},
): TestMessage => ({
  id: `msg-${conversationId}-${createdAt.toISOString()}`,
  workspaceId: "ws-1",
  conversationId,
  createdAt,
  messageType: "incoming",
  senderType: "contact",
  senderId: null,
  type: "message",
  contentAttributes: null,
  ...overrides,
})

const makeHandoverNote = (
  conversationId: string,
  createdAt: Date,
  { category }: { category?: string },
): TestMessage =>
  makeMessage(conversationId, createdAt, {
    messageType: "activity",
    senderType: "system",
    senderId: null,
    contentAttributes: {
      type: "externalAgent",
      event: "handover",
      reason: "Customer asks for a refund",
      ...(category ? { category } : {}),
    },
  })

const OLDER = new Date("2026-01-01T01:00:00Z")
const OTHER_OLDER = new Date("2026-01-01T00:30:00Z")
const NEW_AT = new Date("2026-01-03T00:00:00Z")

describe("chat store inbox attention", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test("a bot send refreshes the preview but neither lifts the conversation nor advances attention", () => {
    const store = createChatStore()
    const top = makeConversation("conv-top", OLDER)
    const target = makeConversation("conv-target", OTHER_OLDER)
    store.setState({ conversations: [top, target] as never })

    const botMessage = makeMessage("conv-target", NEW_AT, {
      messageType: "outgoing",
      senderType: "bot",
    })
    store.getState().handleNewMessages([botMessage as never])

    const [first, second] = store.getState().conversations
    expect(first?.id).toBe("conv-top")
    expect(second?.id).toBe("conv-target")
    expect(second?.messages).toEqual([botMessage])
    expect(second?.inboxActivityAt).toBe(OTHER_OLDER)
    expect(second?.unreadCount).toBe(0)
    expect(second?.agentLastReadAt).toBe(READ_AT)
  })

  test("a client message lifts the conversation, advances attention and counts one unread", () => {
    const store = createChatStore()
    const top = makeConversation("conv-top", OLDER)
    const target = makeConversation("conv-target", OTHER_OLDER)
    store.setState({ conversations: [top, target] as never })

    store
      .getState()
      .handleNewMessages([makeMessage("conv-target", NEW_AT) as never])

    const [first] = store.getState().conversations
    expect(first?.id).toBe("conv-target")
    expect(first?.inboxActivityAt).toEqual(NEW_AT)
    expect(first?.unreadCount).toBe(1)
  })

  test("client messages accumulate the unread count", () => {
    const store = createChatStore()
    const target = makeConversation("conv-target", OTHER_OLDER)
    store.setState({ conversations: [target] as never })

    store
      .getState()
      .handleNewMessages([
        makeMessage("conv-target", new Date("2026-01-02T00:00:00Z")) as never,
        makeMessage("conv-target", new Date("2026-01-02T00:01:00Z")) as never,
      ])

    expect(store.getState().conversations[0]?.unreadCount).toBe(2)
  })

  test("a comment lifts the conversation but does not count as unread", () => {
    const store = createChatStore()
    const top = makeConversation("conv-top", OLDER)
    const target = makeConversation("conv-target", OTHER_OLDER)
    store.setState({ conversations: [top, target] as never })

    store
      .getState()
      .handleNewMessages([
        makeMessage("conv-target", NEW_AT, { type: "comment" }) as never,
      ])

    const [first] = store.getState().conversations
    expect(first?.id).toBe("conv-target")
    expect(first?.inboxActivityAt).toEqual(NEW_AT)
    expect(first?.unreadCount).toBe(0)
  })

  test("a manager reply lifts the conversation and clears the unread count", () => {
    const store = createChatStore()
    const target = {
      ...makeConversation("conv-target", OTHER_OLDER),
      unreadCount: 4,
    }
    store.setState({ conversations: [target] as never })

    store.getState().handleNewMessages([
      makeMessage("conv-target", NEW_AT, {
        messageType: "outgoing",
        senderType: "user",
        senderId: "user-1",
      }) as never,
    ])

    const [updated] = store.getState().conversations
    expect(updated?.inboxActivityAt).toEqual(NEW_AT)
    expect(updated?.agentLastReadAt).toEqual(NEW_AT)
    expect(updated?.unreadCount).toBe(0)
  })

  test("a duplicate delivery of the newest client message is not counted twice", () => {
    const store = createChatStore()
    const message = makeMessage("conv-target", NEW_AT)
    const target = makeConversation("conv-target", OTHER_OLDER)
    store.setState({ conversations: [target] as never })

    store.getState().handleNewMessages([message as never])
    store.getState().handleNewMessages([message as never])

    expect(store.getState().conversations[0]?.unreadCount).toBe(1)
  })

  test("marking the conversation read through a realtime read clears the unread count", () => {
    const store = createChatStore()
    const target = {
      ...makeConversation("conv-target", NEW_AT),
      unreadCount: 3,
    }
    store.setState({ conversations: [target] as never })

    store.getState().applyAgentLastReadAt(["conv-target"], NEW_AT)

    const [updated] = store.getState().conversations
    expect(updated?.agentLastReadAt).toEqual(NEW_AT)
    expect(updated?.unreadCount).toBe(0)
  })

  test("a handover note turns the bot off and awaits a manager without marking the conversation read", () => {
    const store = createChatStore()
    const target = {
      ...makeConversation("conv-target", OTHER_OLDER),
      botEnabled: true,
      botResumeAt: null,
      handoverCategory: null,
      handedOverAt: null,
    }
    store.setState({ conversations: [target] as never })

    store.getState().handleNewMessages([
      makeHandoverNote("conv-target", NEW_AT, {
        category: "payment",
      }) as never,
    ])

    const [updated] = store.getState().conversations
    expect(updated?.botEnabled).toBe(false)
    expect(updated?.botResumeAt).toBeNull()
    expect(updated?.handoverCategory).toBe("payment")
    expect(updated?.handedOverAt).toEqual(NEW_AT)
    expect(updated?.agentLastReadAt).toBe(READ_AT)
    expect(updated?.inboxActivityAt).toBe(OTHER_OLDER)
    expect(updated?.unreadCount).toBe(0)
  })

  test("a handover note without a category is filed under other", () => {
    const store = createChatStore()
    const target = {
      ...makeConversation("conv-target", OTHER_OLDER),
      botEnabled: true,
      botResumeAt: null,
      handoverCategory: null,
      handedOverAt: null,
    }
    store.setState({ conversations: [target] as never })

    store.getState().handleNewMessages([
      makeHandoverNote("conv-target", NEW_AT, {
        category: undefined,
      }) as never,
    ])

    expect(store.getState().conversations[0]?.handoverCategory).toBe("other")
  })

  test("a handover note for a conversation whose bot is already off changes nothing", () => {
    const store = createChatStore()
    const target = {
      ...makeConversation("conv-target", OTHER_OLDER),
      botEnabled: false,
      botResumeAt: null,
      handoverCategory: "urgent",
      handedOverAt: OTHER_OLDER,
    }
    store.setState({ conversations: [target] as never })

    store.getState().handleNewMessages([
      makeHandoverNote("conv-target", NEW_AT, {
        category: "payment",
      }) as never,
    ])

    const [updated] = store.getState().conversations
    expect(updated?.handoverCategory).toBe("urgent")
    expect(updated?.handedOverAt).toBe(OTHER_OLDER)
  })

  test("a non-handover activity note leaves the bot state alone", () => {
    const store = createChatStore()
    const target = {
      ...makeConversation("conv-target", OTHER_OLDER),
      botEnabled: true,
    }
    store.setState({ conversations: [target] as never })

    store.getState().handleNewMessages([
      makeMessage("conv-target", NEW_AT, {
        messageType: "activity",
        senderType: "system",
        contentAttributes: {
          type: "externalAgent",
          event: "timeout",
        },
      }) as never,
    ])

    const [updated] = store.getState().conversations
    expect(updated?.botEnabled).toBe(true)
    expect(updated?.handedOverAt).toBeUndefined()
  })

  test("an optimistic manager reply lifts the conversation and advances attention", () => {
    const store = createChatStore()
    const top = makeConversation("conv-top", OLDER)
    const target = {
      ...makeConversation("conv-target", OTHER_OLDER),
      unreadCount: 2,
    }
    store.setState({ conversations: [top, target] as never })

    const reply = makeMessage("conv-target", NEW_AT, {
      messageType: "outgoing",
      senderType: "user",
      senderId: "user-1",
    })
    store.getState().updateConversationViaMessage(reply as never)

    const [first] = store.getState().conversations
    expect(first?.id).toBe("conv-target")
    expect(first?.inboxActivityAt).toEqual(NEW_AT)
    expect(first?.unreadCount).toBe(0)
  })
})
