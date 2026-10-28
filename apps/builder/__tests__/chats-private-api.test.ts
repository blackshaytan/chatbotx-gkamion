// @vitest-environment node

import { beforeEach, describe, expect, test, vi } from "vitest"

type RouteConfig = { method: string; path: string }
type CapturedProcedure = {
  handler?: (...args: never[]) => unknown
  protected?: boolean
  route: RouteConfig
}

const { authorizedAPI, capturedProcedures, workspaceAuthorizedMidddleware } =
  vi.hoisted(() => {
    const capturedProcedures: CapturedProcedure[] = []
    const makeProcedure = (route: RouteConfig) => {
      const record: CapturedProcedure = { route }
      capturedProcedures.push(record)
      const chain = {
        input: vi.fn(() => chain),
        output: vi.fn(() => chain),
        use: vi.fn(() => {
          record.protected = true
          return chain
        }),
        handler: vi.fn((handler: CapturedProcedure["handler"]) => {
          record.handler = handler
          return { handler }
        }),
      }
      return chain
    }
    return {
      authorizedAPI: {
        route: vi.fn((route: RouteConfig) => makeProcedure(route)),
      },
      capturedProcedures,
      workspaceAuthorizedMidddleware: vi.fn(),
    }
  })

vi.mock("@/orpc", () => ({ authorizedAPI }))
vi.mock("@/middlewares/auth", () => ({ workspaceAuthorizedMidddleware }))

const chatService = {
  countUnreadTotal: vi.fn(),
  deleteMessage: vi.fn(),
  edit: vi.fn(),
  get: vi.fn(),
  list: vi.fn(),
  listMessages: vi.fn(),
  markRead: vi.fn(),
  open: vi.fn(),
  send: vi.fn(),
  uploadAttachment: vi.fn(),
}
const workspacePresenceService = { listOnlineMembers: vi.fn() }
const staffAssistantService = { get: vi.fn(), openForEmployee: vi.fn() }
vi.mock("@chatbotx.io/business", () => ({
  chatService,
  staffAssistantService,
  workspacePresenceService,
}))
vi.mock("@/features/chats/lib/attachment-url", () => ({
  withChatAttachmentUrls: vi.fn(async (_workspaceId, messages) => messages),
  withSingleChatAttachmentUrls: vi.fn(async (_workspaceId, message) => message),
}))
vi.mock("@/features/chats/lib/chat-url", () => ({
  withChatUrl: vi.fn(async (_workspaceId, chat) => ({
    ...chat,
    url: "https://app.test/chat",
  })),
  withChatUrls: vi.fn(async (_workspaceId, chats) =>
    chats.map((chat: object) => ({ ...chat, url: "https://app.test/chat" })),
  ),
}))
const deliverChatMessage = vi.fn()
const publishChatChanged = vi.fn()
vi.mock("@/features/chats/lib/chat-realtime", () => ({
  deliverChatMessage,
  publishChatChanged,
}))

await import("@/features/chats/api/private")

const procedureFor = (method: string, path: string) => {
  const procedure = capturedProcedures.find(
    (candidate) =>
      candidate.route.method === method && candidate.route.path === path,
  )
  if (!procedure?.handler) {
    throw new Error(`No procedure for ${method} ${path}`)
  }
  return procedure.handler as unknown as (args: {
    context: { isSupportSession?: boolean; user: { id: string } }
    input: Record<string, unknown>
  }) => Promise<unknown>
}

const call = (
  method: string,
  path: string,
  input: Record<string, unknown>,
  isSupportSession = false,
) =>
  procedureFor(
    method,
    path,
  )({
    context: { isSupportSession, user: { id: "member-1" } },
    input,
  })

beforeEach(() => vi.clearAllMocks())

describe("chats private API", () => {
  test("uses the member scope for signed-in chat reads", async () => {
    chatService.list.mockResolvedValue({ data: [], pageCount: 0, total: 0 })

    await call("GET", "/workspaces/{workspaceId}/chats", {
      workspaceId: "workspace-1",
      page: 1,
      perPage: 50,
    })

    expect(chatService.list).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: { kind: "member", userId: "member-1" },
        workspaceId: "workspace-1",
      }),
    )
  })

  test("gives support sessions workspace-wide reads but no personal unread state", async () => {
    chatService.list.mockResolvedValue({ data: [], pageCount: 0, total: 0 })

    await call(
      "GET",
      "/workspaces/{workspaceId}/chats",
      { workspaceId: "workspace-1", page: 1, perPage: 50 },
      true,
    )
    const result = await call(
      "POST",
      "/workspaces/{workspaceId}/chats/{id}/read",
      { id: "chat-1", workspaceId: "workspace-1" },
      true,
    )

    expect(chatService.list).toHaveBeenCalledWith(
      expect.objectContaining({ scope: { kind: "workspace" } }),
    )
    expect(chatService.markRead).not.toHaveBeenCalled()
    expect(result).toEqual({ changed: false })
  })

  test("marks a member chat read through the shared service", async () => {
    chatService.markRead.mockResolvedValue({
      changed: true,
      memberUserIds: ["member-1", "member-2"],
    })

    await call("POST", "/workspaces/{workspaceId}/chats/{id}/read", {
      id: "chat-1",
      upToMessageId: "message-3",
      workspaceId: "workspace-1",
    })

    expect(chatService.markRead).toHaveBeenCalledWith({
      threadId: "chat-1",
      upToMessageId: "message-3",
      userId: "member-1",
      workspaceId: "workspace-1",
    })
    expect(publishChatChanged).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      threadId: "chat-1",
      memberUserIds: ["member-1", "member-2"],
    })
  })

  test("rejects support-session writes before they reach the service", async () => {
    await expect(
      call(
        "POST",
        "/workspaces/{workspaceId}/chats/open",
        { userIds: ["member-2"], workspaceId: "workspace-1" },
        true,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" })

    expect(chatService.open).not.toHaveBeenCalled()
  })

  test("keeps assistant status and opening private to the member", async () => {
    staffAssistantService.get.mockResolvedValue({
      available: true,
      botName: "Assistant",
    })
    await expect(
      call("GET", "/workspaces/{workspaceId}/chats/assistant-status", {
        workspaceId: "workspace-1",
      }),
    ).resolves.toEqual({ available: true, name: "Assistant" })
    await expect(
      call(
        "GET",
        "/workspaces/{workspaceId}/chats/assistant-status",
        { workspaceId: "workspace-1" },
        true,
      ),
    ).resolves.toEqual({ available: false, name: null })
    await expect(
      call(
        "POST",
        "/workspaces/{workspaceId}/chats/open-assistant",
        { workspaceId: "workspace-1" },
        true,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" })
    expect(staffAssistantService.openForEmployee).not.toHaveBeenCalled()
  })

  test("opens the assistant for the current member through the shared service", async () => {
    staffAssistantService.openForEmployee.mockResolvedValue({
      created: true,
      chat: {
        id: "1",
        type: "agent",
        title: "Assistant",
        members: [],
        lastMessageAt: null,
        lastMessage: null,
        unreadCount: 0,
        peerLastReadAt: null,
      },
    })
    await call("POST", "/workspaces/{workspaceId}/chats/open-assistant", {
      workspaceId: "workspace-1",
    })
    expect(staffAssistantService.openForEmployee).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      userId: "member-1",
    })
  })

  test("protects every private procedure with workspace middleware", () => {
    expect(capturedProcedures).toHaveLength(13)
    expect(capturedProcedures.every((procedure) => procedure.protected)).toBe(
      true,
    )
    expect(workspaceAuthorizedMidddleware).toBeDefined()
  })

  test("validates an optional read cursor as a bigint string", async () => {
    const { markChatReadPrivateRequest } = await import(
      "@/features/chats/schema/private"
    )

    expect(
      markChatReadPrivateRequest.safeParse({
        id: "1",
        upToMessageId: "not-a-bigint",
        workspaceId: "1",
      }).success,
    ).toBe(false)
  })
})
