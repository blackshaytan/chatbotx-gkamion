// @vitest-environment node

import { beforeEach, describe, expect, test, vi } from "vitest"

const mocks = vi.hoisted(() => {
  const repo = {
    findLastByConversation: vi.fn().mockResolvedValue([]),
    countUnreadIncomingByConversations: vi.fn().mockResolvedValue(new Map()),
  }
  return {
    buildConversationWhere: vi.fn().mockReturnValue({}),
    createMessageRepository: vi.fn().mockResolvedValue(repo),
    findManyQuery: vi.fn().mockResolvedValue([]),
    findWithFullRelations: vi.fn().mockResolvedValue(null),
    getSafeSinceTime: vi.fn((value: Date | undefined) => value),
    notFoundException: (message: string) => new Error(message),
    resolveContactAvatarUrl: vi.fn().mockResolvedValue(null),
    repo,
  }
})

vi.mock("@chatbotx.io/business", () => ({
  conversationService: {
    findManyQuery: mocks.findManyQuery,
    findWithFullRelations: mocks.findWithFullRelations,
  },
  resolveContactAvatarUrl: mocks.resolveContactAvatarUrl,
}))

vi.mock("@chatbotx.io/business/errors", () => ({
  notFoundException: mocks.notFoundException,
}))

vi.mock("@chatbotx.io/database/repositories", () => ({
  contactInboxOperationalColumns: { sourceIdentityHistory: false },
  createMessageRepository: mocks.createMessageRepository,
  getSafeSinceTime: mocks.getSafeSinceTime,
}))

vi.mock(
  "../src/features/conversations/queries/build-conversation-where",
  () => ({
    buildConversationWhere: mocks.buildConversationWhere,
  }),
)

const { listConversations, findConversation, UNREAD_COUNT_CAP } = await import(
  "../src/features/conversations/queries/list-conversations.query"
)
const { encodeCursor } = await import("../src/lib/pagination")

const makeConversation = (
  id: string,
  overrides: Record<string, unknown> = {},
) => ({
  id,
  workspaceId: "ws-1",
  contactId: `contact-${id}`,
  lastActivityAt: new Date("2026-10-21T12:00:00Z"),
  inboxActivityAt: new Date("2026-10-21T10:00:00Z"),
  agentLastReadAt: null,
  handoverCategory: null,
  handedOverAt: null,
  contactInboxes: [],
  contact: null,
  assignedUser: null,
  assignedInboxTeam: null,
  ...overrides,
})

const decode = (cursor: string | null) =>
  cursor ? JSON.parse(Buffer.from(cursor, "base64").toString()) : null

type OrderByFn = (
  table: Record<string, string>,
  helpers: {
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => unknown
    desc: (column: string) => unknown
  },
) => unknown[]

const renderOrderBy = (orderBy: OrderByFn) =>
  orderBy(
    {
      inboxActivityAt: "inboxActivityAt",
      lastActivityAt: "lastActivityAt",
      id: "id",
    },
    {
      sql: (strings, ...values) =>
        strings.reduce(
          (text, part, index) =>
            `${text}${part}${index < values.length ? String(values[index]) : ""}`,
          "",
        ),
      desc: (column) => `${column} DESC`,
    },
  )

beforeEach(() => {
  vi.clearAllMocks()
  mocks.createMessageRepository.mockResolvedValue(mocks.repo)
  mocks.repo.findLastByConversation.mockResolvedValue([])
  mocks.repo.countUnreadIncomingByConversations.mockResolvedValue(new Map())
  mocks.buildConversationWhere.mockReturnValue({})
  mocks.findManyQuery.mockResolvedValue([])
  mocks.findWithFullRelations.mockResolvedValue(null)
})

describe("listConversations sort and cursor", () => {
  test("orders by inboxActivityAt DESC NULLS LAST, then id DESC — never by lastActivityAt", async () => {
    await listConversations(
      { workspaceId: "ws-1" },
      { includeEmailAndPhone: true },
    )

    const { orderBy } = mocks.findManyQuery.mock.calls[0][0]
    expect(renderOrderBy(orderBy)).toEqual([
      "inboxActivityAt DESC NULLS LAST",
      "id DESC",
    ])
  })

  test("encodes the next cursor from the last row's inboxActivityAt and id", async () => {
    const first = makeConversation("2")
    const last = makeConversation("1", {
      inboxActivityAt: new Date("2026-10-20T08:00:00Z"),
      lastActivityAt: new Date("2026-10-21T23:00:00Z"),
    })
    mocks.findManyQuery.mockResolvedValue([first, last, makeConversation("0")])

    const result = await listConversations(
      { workspaceId: "ws-1", perPage: 2 },
      { includeEmailAndPhone: true },
    )

    expect(decode(result.nextCursor)).toEqual({
      inboxActivityAt: "2026-10-20T08:00:00.000Z",
      id: "1",
    })
  })

  test("keeps a null inboxActivityAt in the cursor so the NULLS LAST tail paginates by id", async () => {
    mocks.findManyQuery.mockResolvedValue([
      makeConversation("5", { inboxActivityAt: null }),
      makeConversation("4", { inboxActivityAt: null }),
    ])

    const result = await listConversations(
      { workspaceId: "ws-1", perPage: 1 },
      { includeEmailAndPhone: true },
    )

    expect(decode(result.nextCursor)).toEqual({
      inboxActivityAt: null,
      id: "5",
    })
  })

  test("decodes an inboxActivityAt cursor and hands it to the where builder", async () => {
    const cursor = encodeCursor({
      inboxActivityAt: "2026-10-20T08:00:00.000Z",
      id: "1",
    })

    await listConversations(
      { workspaceId: "ws-1", cursor },
      { includeEmailAndPhone: true },
    )

    expect(mocks.buildConversationWhere).toHaveBeenCalledWith(
      "ws-1",
      expect.anything(),
      { inboxActivityAt: new Date("2026-10-20T08:00:00.000Z"), id: "1" },
      { includeEmailAndPhone: true },
    )
  })

  test("treats a legacy lastActivityAt cursor as no cursor", async () => {
    const cursor = encodeCursor({
      lastActivityAt: "2026-10-20T08:00:00.000Z",
      id: "1",
    })

    await listConversations(
      { workspaceId: "ws-1", cursor },
      { includeEmailAndPhone: true },
    )

    expect(mocks.buildConversationWhere).toHaveBeenCalledWith(
      "ws-1",
      expect.anything(),
      null,
      { includeEmailAndPhone: true },
    )
  })

  test("forwards the handoverCategory filter to the where builder", async () => {
    await listConversations(
      { workspaceId: "ws-1", handoverCategory: ["urgent", "payment"] },
      { includeEmailAndPhone: true },
    )

    expect(mocks.buildConversationWhere).toHaveBeenCalledWith(
      "ws-1",
      expect.objectContaining({ handoverCategory: ["urgent", "payment"] }),
      null,
      { includeEmailAndPhone: true },
    )
  })
})

describe("unreadCount", () => {
  test("counts unread client messages for the whole page in one repository call", async () => {
    const readAt = new Date("2026-10-21T09:00:00Z")
    mocks.findManyQuery.mockResolvedValue([
      makeConversation("1", { agentLastReadAt: readAt }),
      makeConversation("2"),
    ])
    mocks.repo.countUnreadIncomingByConversations.mockResolvedValue(
      new Map([["1", 3]]),
    )

    const result = await listConversations(
      { workspaceId: "ws-1" },
      { includeEmailAndPhone: true },
    )

    expect(mocks.repo.countUnreadIncomingByConversations).toHaveBeenCalledTimes(
      1,
    )
    expect(mocks.repo.countUnreadIncomingByConversations).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      conversations: [
        { id: "1", agentLastReadAt: readAt },
        { id: "2", agentLastReadAt: null },
      ],
      limit: UNREAD_COUNT_CAP,
    })
    expect(result.data.map((item) => item.unreadCount)).toEqual([3, 0])
  })

  test("never counts a conversation without inboxActivityAt, which is never unread", async () => {
    mocks.findManyQuery.mockResolvedValue([
      makeConversation("1"),
      makeConversation("2", { inboxActivityAt: null }),
    ])
    mocks.repo.countUnreadIncomingByConversations.mockResolvedValue(
      new Map([["1", 4]]),
    )

    const result = await listConversations(
      { workspaceId: "ws-1" },
      { includeEmailAndPhone: true },
    )

    expect(
      mocks.repo.countUnreadIncomingByConversations.mock.calls[0][0]
        .conversations,
    ).toEqual([{ id: "1", agentLastReadAt: null }])
    expect(result.data.map((item) => item.unreadCount)).toEqual([4, 0])
  })

  test("caps at 100", () => {
    expect(UNREAD_COUNT_CAP).toBe(100)
  })

  test("does not count the extra row fetched to detect the next page", async () => {
    mocks.findManyQuery.mockResolvedValue([
      makeConversation("2"),
      makeConversation("1"),
    ])

    await listConversations(
      { workspaceId: "ws-1", perPage: 1 },
      { includeEmailAndPhone: true },
    )

    expect(
      mocks.repo.countUnreadIncomingByConversations.mock.calls[0][0]
        .conversations,
    ).toEqual([{ id: "2", agentLastReadAt: null }])
  })

  test("findConversation returns the conversation's unreadCount and handover fields", async () => {
    const handedOverAt = new Date("2026-10-21T11:00:00Z")
    mocks.findWithFullRelations.mockResolvedValue(
      makeConversation("7", {
        handoverCategory: "delivery",
        handedOverAt,
      }),
    )
    mocks.repo.countUnreadIncomingByConversations.mockResolvedValue(
      new Map([["7", 100]]),
    )

    const result = await findConversation({ id: "7", workspaceId: "ws-1" })

    expect(mocks.repo.countUnreadIncomingByConversations).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      conversations: [{ id: "7", agentLastReadAt: null }],
      limit: UNREAD_COUNT_CAP,
    })
    expect(result.data).toMatchObject({
      unreadCount: 100,
      handoverCategory: "delivery",
      handedOverAt,
      inboxActivityAt: new Date("2026-10-21T10:00:00Z"),
    })
  })
})
