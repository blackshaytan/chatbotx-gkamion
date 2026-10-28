// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: never[]) => unknown>(),
  openAgentChannel: vi.fn(),
  open: vi.fn(),
  send: vi.fn(),
  resolveAgentChannel: vi.fn(),
}))

vi.mock("@/orpc", () => ({
  workspaceTokenAuthAPIForScope: () => ({
    route: ({ method, path }: { method: string; path: string }) => {
      const chain = {
        input: () => chain,
        output: () => chain,
        errors: () => chain,
        handler: (handler: (...args: never[]) => unknown) => {
          mocks.handlers.set(`${method} ${path}`, handler)
          return { handler }
        },
      }
      return chain
    },
  }),
}))
vi.mock("@chatbotx.io/business", () => ({
  chatService: {
    openAgentChannel: mocks.openAgentChannel,
    open: mocks.open,
    send: mocks.send,
  },
  staffAssistantService: { resolveAgentChannel: mocks.resolveAgentChannel },
  workspacePresenceService: {},
}))
vi.mock("@/features/chats/lib/attachment-url", () => ({
  withChatAttachmentUrls: vi.fn(async (_ws, messages) => messages),
  withSingleChatAttachmentUrls: vi.fn(async (_ws, message) => message),
}))
vi.mock("@/features/chats/lib/chat-url", () => ({
  withChatUrl: vi.fn(async (_ws, chat) => ({
    ...chat,
    url: "https://app.test/chat",
  })),
  withChatUrls: vi.fn(),
}))
vi.mock("@/features/chats/lib/chat-realtime", () => ({
  deliverChatMessage: vi.fn(),
  publishChatChanged: vi.fn(),
}))

await import("@/features/chats/api/public")

const call = (method: string, path: string, input: Record<string, unknown>) => {
  const handler = mocks.handlers.get(`${method} ${path}`)
  if (!handler) {
    throw new Error("Missing procedure")
  }
  return (handler as unknown as (args: unknown) => Promise<unknown>)({
    context: {
      workspace: { id: "workspace-1" },
      apiToken: { id: "token-1", name: "Token" },
    },
    input,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.resolveAgentChannel.mockResolvedValue({
    kind: "staff",
    title: "Assistant",
  })
})

describe("assistant public chat API", () => {
  test("opens the shared staff channel for the bound token", async () => {
    mocks.openAgentChannel.mockResolvedValue({
      created: true,
      chat: {
        id: "1",
        type: "agent",
        title: "Assistant",
        members: [],
        lastMessageAt: null,
        lastMessage: null,
      },
    })
    await call("POST", "/v1/chats/open", { userIds: ["member-1"] })
    expect(mocks.openAgentChannel).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      userId: "member-1",
      channel: { kind: "staff", title: "Assistant" },
    })
    expect(mocks.resolveAgentChannel).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      tokenId: "token-1",
      tokenName: "Token",
    })
  })

  test("uses the configured assistant name as message author", async () => {
    mocks.send.mockResolvedValue({
      message: { id: "1" },
      memberUserIds: ["member-1"],
    })
    await call("POST", "/v1/chats/{id}/messages", { id: "1", text: "Hello" })
    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({ actor: { kind: "api", label: "Assistant" } }),
    )
  })
})
