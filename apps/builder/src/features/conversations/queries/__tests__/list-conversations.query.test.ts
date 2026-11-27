// @vitest-environment node

import { beforeEach, describe, expect, test, vi } from "vitest"
import type { ContactFilterCriteria } from "@/features/contact-filter/schema"

vi.mock("@chatbotx.io/business", () => ({
  conversationService: {
    findManyQuery: vi.fn(),
    findWithFullRelations: vi.fn(),
  },
  // Mirrors packages/business/src/inbox/smtp-ownership.ts (pure helper).
  hiddenContactInboxIds: (
    contactInboxes: { id: string; inboxId: string }[],
    hiddenInboxIds?: string[],
  ) =>
    contactInboxes
      .filter((contactInbox) => hiddenInboxIds?.includes(contactInbox.inboxId))
      .map((contactInbox) => contactInbox.id),
}))
vi.mock("@chatbotx.io/business/errors", () => ({
  notFoundException: vi.fn((message: string) => new Error(message)),
}))
vi.mock("@chatbotx.io/database/client", () => ({
  sql: vi.fn(() => "agentLastReadAtSql"),
}))
vi.mock("@chatbotx.io/database/queries", () => ({
  applyContactFilter: vi.fn(() => ({})),
  buildSmartKeywordWhere: vi.fn(
    (keyword: string, options?: { includeEmailAndPhone?: boolean }) => ({
      OR: [
        { firstName: { ilike: `%${keyword}%` } },
        { lastName: { ilike: `%${keyword}%` } },
        ...(options?.includeEmailAndPhone === false
          ? []
          : [{ email: { ilike: `%${keyword}%` } }]),
      ],
    }),
  ),
  conversationUnreadWhere: { sharedUnreadPredicate: true },
  parseConversationAssigneeValues: vi.fn((values: string[]) => ({
    hasUnassigned: values.includes("unassigned"),
    inboxTeamIds: values
      .filter((value) => value.startsWith("t_"))
      .map((value) => value.slice(2)),
    userIds: values
      .filter((value) => value.startsWith("u_"))
      .map((value) => value.slice(2)),
  })),
  pruneEmailPhoneFilterConditions: (
    contactFilter:
      | { operator: "and" | "or"; conditions: unknown[] }
      | undefined,
    canViewEmailAndPhone: boolean,
  ) =>
    canViewEmailAndPhone || !contactFilter
      ? contactFilter
      : {
          operator: contactFilter.operator,
          conditions: contactFilter.conditions.filter((condition) => {
            const field =
              typeof condition === "object" && condition !== null
                ? (condition as { field?: unknown }).field
                : undefined
            return ![
              "email",
              "phone",
              "hasContactInfo",
              "emailWasVerified",
              "optedInForEmail",
              "existingContact",
            ].includes(String(field))
          }),
        },
  UNASSIGNED_ASSIGNEE_VALUE: "unassigned",
}))
vi.mock("@chatbotx.io/database/repositories", () => ({
  contactInboxOperationalColumns: {},
  createMessageRepository: vi.fn(),
  getSafeSinceTime: vi.fn((date: Date) => date),
}))
vi.mock("@/lib/auth/utils", () => ({
  assertCurrentUserCanAccessChatbot: vi.fn(),
}))
vi.mock("@/lib/pagination", () => ({
  decodeCursor: vi.fn(),
  encodeCursor: vi.fn(),
}))

const { appendUnreadWhere, buildConversationWhere } = await import(
  "../build-conversation-where"
)
const { findConversation, listConversations } = await import(
  "../list-conversations.query"
)
const { conversationService } = await import("@chatbotx.io/business")
const { createMessageRepository } = await import(
  "@chatbotx.io/database/repositories"
)
const { applyContactFilter, buildSmartKeywordWhere } = await import(
  "@chatbotx.io/database/queries"
)
const { conversationUnreadWhere } = await import(
  "@chatbotx.io/database/queries"
)

const baseInput = {
  perPage: 20,
  cursor: undefined,
  keyword: "",
  botCategory: "all" as const,
  assignedId: "all",
  tags: [],
}

describe("buildConversationWhere channel filter", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test("does not restrict by contactInboxes when channel is the omnichannel sentinel", () => {
    const where = buildConversationWhere(
      "1",
      { ...baseInput, channel: "omnichannel" },
      null,
    )

    expect(where.contactInboxes).toBeUndefined()
  })

  test("restricts by contactInboxes when a real channel is selected", () => {
    const where = buildConversationWhere(
      "1",
      { ...baseInput, channel: "messenger" },
      null,
    )

    expect(where.contactInboxes).toEqual({ channel: "messenger" })
  })

  test("composes keyword and contact filter OR branches without overwriting either", () => {
    vi.mocked(applyContactFilter).mockReturnValueOnce({
      OR: [{ email: { ilike: "%ada%" } }],
    })

    const where = buildConversationWhere(
      "1",
      {
        ...baseInput,
        keyword: "ada",
        contactFilter: { operator: "or", conditions: [] },
      },
      null,
    )

    expect(where.contact).toEqual({
      AND: [
        { blockedAt: { isNull: true } },
        {
          OR: [
            { firstName: { ilike: "%ada%" } },
            { lastName: { ilike: "%ada%" } },
            { email: { ilike: "%ada%" } },
          ],
        },
        { OR: [{ email: { ilike: "%ada%" } }] },
      ],
    })
  })

  // The inbox hides blocked contacts by default. A contact filter that names
  // `blocked` is the user overriding that default, so the hidden predicate must
  // step aside instead of AND-ing into `IS NULL AND IS NOT NULL` (zero rows).
  test("drops the hidden blocked-contact default when the contact filter targets blocked", () => {
    vi.mocked(applyContactFilter).mockReturnValueOnce({
      AND: [{ blockedAt: { isNotNull: true } }],
    })

    const where = buildConversationWhere(
      "1",
      {
        ...baseInput,
        contactFilter: {
          operator: "and",
          conditions: [{ field: "blocked", operator: "eq", value: "true" }],
        },
      },
      null,
    )

    expect(where.contact).toEqual({
      AND: [{ blockedAt: { isNotNull: true } }],
    })
  })

  test("keeps hiding blocked contacts when the contact filter does not mention blocked", () => {
    vi.mocked(applyContactFilter).mockReturnValueOnce({
      AND: [{ fullName: { ilike: "%ada%" } }],
    })

    const where = buildConversationWhere(
      "1",
      {
        ...baseInput,
        contactFilter: {
          operator: "and",
          conditions: [
            { field: "fullName", operator: "contains", value: "ada" },
          ],
        },
      },
      null,
    )

    expect(where.contact).toEqual({
      AND: [{ blockedAt: { isNull: true } }, { fullName: { ilike: "%ada%" } }],
    })
  })

  test("lifts the hidden default for an `or` filter too, so the inbox matches the contacts page", () => {
    vi.mocked(applyContactFilter).mockReturnValueOnce({
      OR: [
        { blockedAt: { isNotNull: true } },
        { fullName: { ilike: "%ada%" } },
      ],
    })

    const where = buildConversationWhere(
      "1",
      {
        ...baseInput,
        contactFilter: {
          operator: "or",
          conditions: [
            { field: "blocked", operator: "eq", value: "true" },
            { field: "fullName", operator: "contains", value: "ada" },
          ],
        },
      },
      null,
    )

    expect(where.contact).toEqual({
      OR: [
        { blockedAt: { isNotNull: true } },
        { fullName: { ilike: "%ada%" } },
      ],
    })
  })

  test("lifts the hidden default for a single-condition `or` filter on blocked", () => {
    vi.mocked(applyContactFilter).mockReturnValueOnce({
      OR: [{ blockedAt: { isNotNull: true } }],
    })

    const where = buildConversationWhere(
      "1",
      {
        ...baseInput,
        contactFilter: {
          operator: "or",
          conditions: [{ field: "blocked", operator: "eq", value: "true" }],
        },
      },
      null,
    )

    expect(where.contact).toEqual({
      OR: [{ blockedAt: { isNotNull: true } }],
    })
  })

  test("forwards a restricted email/phone scope to the smart keyword search", () => {
    buildConversationWhere("1", { ...baseInput, keyword: "ada@x.com" }, null, {
      includeEmailAndPhone: false,
    })

    expect(vi.mocked(buildSmartKeywordWhere)).toHaveBeenCalledWith(
      "ada@x.com",
      {
        includeEmailAndPhone: false,
      },
    )
  })

  test("prunes email/phone contact-filter conditions when emailAndPhone is denied", () => {
    const contactFilter = {
      operator: "and" as const,
      conditions: [
        { field: "email", operator: "eq", value: "ada@example.com" },
        { field: "hasContactInfo", operator: "in", value: ["phone"] },
        { field: "fullName", operator: "contains", value: "Ada" },
      ],
    } satisfies ContactFilterCriteria

    buildConversationWhere("1", { ...baseInput, contactFilter }, null, {
      includeEmailAndPhone: false,
    })

    expect(vi.mocked(applyContactFilter)).toHaveBeenCalledWith(
      {
        operator: "and",
        conditions: [{ field: "fullName", operator: "contains", value: "Ada" }],
      },
      "1",
    )
  })

  test("defaults to including email/phone when no scope is provided", () => {
    buildConversationWhere("1", { ...baseInput, keyword: "ada" }, null)

    expect(vi.mocked(buildSmartKeywordWhere)).toHaveBeenCalledWith("ada", {
      includeEmailAndPhone: true,
    })
  })
})

describe("buildConversationWhere hidden inboxes", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test("hiddenInboxIds adds visible-contact-inbox existence", () => {
    const where = buildConversationWhere("w1", {}, null, {
      hiddenInboxIds: ["i1"],
    })

    expect(where.contactInboxes).toEqual({ inboxId: { notIn: ["i1"] } })
  })

  test("merges with channel filter", () => {
    const where = buildConversationWhere("w1", { channel: "whatsapp" }, null, {
      hiddenInboxIds: ["i1"],
    })

    expect(where.contactInboxes).toEqual({
      channel: "whatsapp",
      inboxId: { notIn: ["i1"] },
    })
  })

  test("no hidden ids → unchanged", () => {
    expect(
      buildConversationWhere("w1", {}, null, { hiddenInboxIds: [] })
        .contactInboxes,
    ).toBeUndefined()
  })
})

describe("buildConversationWhere unread filter", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test("adds the unread predicate as a top-level AND condition", () => {
    const where = buildConversationWhere(
      "1",
      { ...baseInput, tags: ["unread"] },
      null,
    )

    expect(where.AND).toEqual([conversationUnreadWhere])
  })

  test("preserves a pre-existing top-level AND condition", () => {
    const existingCondition = { assignedUserId: "user-1" }
    const where = { AND: [existingCondition] }

    appendUnreadWhere(where)

    expect(where.AND).toEqual([existingCondition, conversationUnreadWhere])
  })

  test("keeps cursor OR separate from the unread predicate", () => {
    const cursor = {
      unread: true,
      id: "100",
      inboxActivityAt: new Date("2026-09-23T10:00:00Z"),
    }
    const where = buildConversationWhere(
      "1",
      { ...baseInput, tags: ["unread"] },
      cursor,
    )

    expect(where.OR).toEqual([
      {
        AND: [
          conversationUnreadWhere,
          {
            OR: [
              { inboxActivityAt: { lt: cursor.inboxActivityAt } },
              { inboxActivityAt: { isNull: true } },
              {
                inboxActivityAt: cursor.inboxActivityAt,
                id: { lt: cursor.id },
              },
            ],
          },
        ],
      },
      { NOT: conversationUnreadWhere },
    ])
    expect(where.AND).toEqual([conversationUnreadWhere])
  })
})

const makeContactInbox = (id: string, inboxId: string) =>
  ({
    id,
    contactId: "contact-1",
    inboxId,
    channel: "smtp",
    source: null,
    sourceId: null,
    sourceUserId: null,
    sourceUsername: null,
    language: null,
    lastMessageAt: null,
    lastIncomingMessageAt: null,
    contactLastReadAt: null,
    inbox: { id: inboxId },
    referral: null,
  }) as never

const makeConversation = (id: string, contactInboxes: unknown[]) =>
  ({
    id,
    contact: null,
    contactInboxes,
    assignedUser: null,
    assignedInboxTeam: null,
    lastActivityAt: null,
    inboxActivityAt: null,
    agentLastReadAt: null,
    handedOverAt: null,
  }) as never

const makeMessageRepository = () => ({
  findLastByConversation: vi.fn().mockResolvedValue([]),
  countUnreadIncomingByConversations: vi.fn().mockResolvedValue(new Map()),
})

describe("listConversations and findConversation member inbox access", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test("listConversations drops hidden contact inboxes and excludes them from message lookups", async () => {
    const conversation = makeConversation("conv-1", [
      makeContactInbox("ci1", "i1"),
      makeContactInbox("ci2", "i2"),
    ])
    const messageRepository = makeMessageRepository()
    vi.mocked(conversationService.findManyQuery).mockResolvedValue([
      conversation,
    ] as never)
    vi.mocked(createMessageRepository).mockResolvedValue(
      messageRepository as never,
    )

    const result = await listConversations(
      { ...baseInput, workspaceId: "1" } as never,
      { includeEmailAndPhone: true, hiddenInboxIds: ["i1"] },
    )

    expect(result.data[0]?.contactInboxes.map((ci) => ci.id)).toEqual(["ci2"])
    expect(vi.mocked(conversationService.findManyQuery)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          contactInboxes: { inboxId: { notIn: ["i1"] } },
        }),
      }),
    )
    expect(messageRepository.findLastByConversation).toHaveBeenCalledWith(
      "conv-1",
      expect.objectContaining({ excludeContactInboxIds: ["ci1"] }),
    )
    expect(
      messageRepository.countUnreadIncomingByConversations,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ excludeContactInboxIds: ["ci1"] }),
    )
  })

  test("findConversation reports not found when every contact inbox is hidden", async () => {
    vi.mocked(conversationService.findWithFullRelations).mockResolvedValue(
      makeConversation("conv-1", [makeContactInbox("ci1", "i1")]) as never,
    )

    await expect(
      findConversation(
        { workspaceId: "1", id: "conv-1" },
        { hiddenInboxIds: ["i1"] },
      ),
    ).rejects.toThrow("Conversation not found")
    expect(createMessageRepository).not.toHaveBeenCalled()
  })

  test("findConversation keeps visible contact inboxes and excludes hidden ones from message lookups", async () => {
    const messageRepository = makeMessageRepository()
    vi.mocked(conversationService.findWithFullRelations).mockResolvedValue(
      makeConversation("conv-1", [
        makeContactInbox("ci1", "i1"),
        makeContactInbox("ci2", "i2"),
      ]) as never,
    )
    vi.mocked(createMessageRepository).mockResolvedValue(
      messageRepository as never,
    )

    const result = await findConversation(
      { workspaceId: "1", id: "conv-1" },
      { hiddenInboxIds: ["i1"] },
    )

    expect(result.data.contactInboxes.map((ci) => ci.id)).toEqual(["ci2"])
    expect(messageRepository.findLastByConversation).toHaveBeenCalledWith(
      "conv-1",
      expect.objectContaining({ excludeContactInboxIds: ["ci1"] }),
    )
  })
})
