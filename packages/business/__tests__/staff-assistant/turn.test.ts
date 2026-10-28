import { beforeEach, expect, test, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  findChat: vi.fn(),
  listMembers: vi.fn(),
  findState: vi.fn(),
  recent: vi.fn(),
  pending: vi.fn(),
  membership: vi.fn(),
  runtime: vi.fn(),
}))
vi.mock("@chatbotx.io/database/repositories", () => ({
  chatRepository: {
    findAccessible: mocks.findChat,
    listMembers: mocks.listMembers,
    listRecentStaffMessages: mocks.recent,
    listStaffEmployeeMessagesAfter: mocks.pending,
  },
  externalAgentChatStateRepository: { find: mocks.findState },
}))
vi.mock("../../src/workspace-member/service", () => ({
  workspaceMemberService: { findMembership: mocks.membership },
}))
vi.mock("../../src/staff-assistant/service", () => ({
  staffAssistantService: { getRuntime: mocks.runtime },
}))
const { loadStaffAssistantTurn } = await import(
  "../../src/staff-assistant/turn"
)
const input = { workspaceId: "ws", threadId: "chat" }
const message = {
  id: "1",
  kind: "comment",
  authorUserId: "user",
  deletedAt: null,
  createdAt: new Date(),
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.findChat.mockResolvedValue({
    thread: { type: "agent", directKey: "agent:user:staff" },
  })
  mocks.listMembers.mockResolvedValue([
    { userId: "user", name: "User", isWorkspaceMember: true },
  ])
  mocks.findState.mockResolvedValue(undefined)
  mocks.membership.mockResolvedValue({
    role: "member",
    permissions: { contacts: true },
  })
  mocks.runtime.mockResolvedValue({ client: {}, agent: {} })
  mocks.recent.mockResolvedValue([message])
})

test("loads a staff turn only for the chat's real workspace member", async () => {
  const result = await loadStaffAssistantTurn(input)
  expect(result).toMatchObject({
    userId: "user",
    role: "member",
    newMessages: [message],
  })
  expect(mocks.membership).toHaveBeenCalledWith({
    workspaceId: "ws",
    userId: "user",
  })
  expect(mocks.recent).toHaveBeenCalledWith(
    expect.objectContaining({ ...input, limit: 30 }),
  )
  mocks.membership.mockResolvedValue(undefined)
  expect(await loadStaffAssistantTurn(input)).toBeNull()
})

test("fetches pending employee messages oldest-first after the cursor", async () => {
  const cursorAt = new Date("2026-01-01T00:00:00Z")
  mocks.findState.mockResolvedValue({ cursorAt, cursorMessageId: "1" })
  mocks.pending.mockResolvedValue([
    { ...message, id: "2", createdAt: cursorAt },
  ])
  const result = await loadStaffAssistantTurn(input)
  expect(result?.newMessages.map(({ id }) => id)).toEqual(["2"])
  expect(mocks.pending).toHaveBeenCalledWith(
    expect.objectContaining({
      ...input,
      userId: "user",
      cursorAt,
      cursorMessageId: "1",
      limit: 100,
    }),
  )
})

test("rejects unrelated agent chats before resolving a runtime", async () => {
  mocks.findChat.mockResolvedValue({
    thread: { type: "agent", directKey: "agent:user:token:2" },
  })
  expect(await loadStaffAssistantTurn(input)).toBeNull()
  expect(mocks.runtime).not.toHaveBeenCalled()
})
