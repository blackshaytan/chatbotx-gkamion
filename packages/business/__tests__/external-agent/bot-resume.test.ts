import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  updateSet: vi.fn(),
  updateWhere: vi.fn(),
  transaction: vi.fn(),
  findResumePolicyForConversations: vi.fn(),
  resetForResume: vi.fn(),
  cancelQuickReplyFollowUps: vi.fn(),
  invalidateCacheByTags: vi.fn(),
  emitConversationTransferredToBot: vi.fn(),
  loggerError: vi.fn(),
}))

vi.mock("@chatbotx.io/database/client", () => ({
  db: {
    update: () => ({
      set: (values: unknown) => {
        mocks.updateSet(values)
        return {
          where: (cond: unknown) => {
            mocks.updateWhere(cond)
            return Promise.resolve()
          },
        }
      },
    }),
    transaction: mocks.transaction,
  },
  and: (...args: unknown[]) => ({ and: args }),
  eq: (a: unknown, b: unknown) => ({ eq: [a, b] }),
  inArray: (col: unknown, vals: unknown) => ({ inArray: [col, vals] }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings: Array.from(strings),
    values,
  }),
}))

// Plain object stubs only — importing the real schema opens a database
// connection through the sharding client.
vi.mock("@chatbotx.io/database/schema", () => ({
  contactInboxModel: {},
  workspaceUsageModel: {},
  userQuotaModel: {},
  questionnaireSubmissionModel: {},
  adsConversionEventModel: {},
  refLinkStatModel: {},
  contactsOnSequenceModel: {},
  contactsOnBroadcastsModel: {},
  contactsToTagsModel: {},
  contactModel: {},
  conversationModel: {},
  inboxModel: {},
}))

vi.mock("@chatbotx.io/database/repositories", () => ({
  createMessageRepository: vi.fn(),
  getSafeSinceTime: vi.fn(),
  assignUserIfUnassigned: vi.fn(),
  externalAgentRepository: {
    findResumePolicyForConversations: mocks.findResumePolicyForConversations,
  },
  externalAgentStateRepository: { resetForResume: mocks.resetForResume },
}))

vi.mock("@chatbotx.io/redis", () => ({
  withCache: vi.fn((_key: string, loader: () => unknown) => loader()),
  invalidateCacheByTags: mocks.invalidateCacheByTags,
}))

vi.mock("@chatbotx.io/worker-config", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@chatbotx.io/worker-config")>()
  return { ...actual, notificationQueue: { addBulk: vi.fn() } }
})

vi.mock("@chatbotx.io/partysocket-config", () => ({
  RealtimeEventType: {
    conversationCreated: "conversationCreated",
    conversationUpdated: "conversationUpdated",
    conversationAssigned: "conversationAssigned",
  },
}))

vi.mock("@chatbotx.io/analytics", () => ({
  macAnalyticsService: {},
}))

vi.mock("@chatbotx.io/event-bus", () => ({
  emit: vi.fn(),
}))

vi.mock("@chatbotx.io/events", () => ({
  emitConversationArchived: vi.fn(),
  emitConversationAssigned: vi.fn(),
  emitConversationFollowUp: vi.fn(),
  emitConversationTransferredToBot: mocks.emitConversationTransferredToBot,
  emitConversationTransferredToHuman: vi.fn(),
  emitConversationUnassigned: vi.fn(),
}))

vi.mock("../../src/platform/realtime-broadcast", () => ({
  broadcastToWorkspaceParty: vi.fn(),
  publishToWorkspaceParty: vi.fn(),
}))

vi.mock("../../src/thread-control/service", () => ({
  threadControlService: { releaseOwnedThreadsForContacts: vi.fn() },
}))

vi.mock("../../src/contact-inbox/service", () => ({
  contactInboxService: {},
}))

vi.mock("../../src/workspace-member/service", () => ({
  workspaceMemberService: {},
}))

vi.mock("../../src/enterprise/inbox-team/service", () => ({
  inboxTeamService: {},
}))

vi.mock("../../src/smart-delay/service", () => ({
  smartDelayService: {
    cancelQuickReplyFollowUps: mocks.cancelQuickReplyFollowUps,
  },
}))

vi.mock("../../src/logger", () => ({
  logger: { warn: vi.fn(), error: mocks.loggerError, info: vi.fn() },
}))

const { db } = await import("@chatbotx.io/database/client")
const { BOT_DISABLE_DURATION_MS, conversationService } = await import(
  "../../src/conversation/service"
)

const NOW = new Date("2026-10-21T10:00:00.000Z")
const HOUR_MS = 3_600_000
const WORKSPACE_ID = "ws-1"
const TRIGGER_CONTEXT = {
  triggerSource: "system",
  triggerHandler: "test",
  triggerType: "bot_auto_resume",
} as const

type WhereClause = { and: [unknown, { inArray: [unknown, string[]] }] }

const updatesByConversation = (): Map<string, unknown> => {
  const byId = new Map<string, unknown>()
  for (const [index, call] of mocks.updateSet.mock.calls.entries()) {
    const values = call[0] as { botResumeAt: unknown }
    const where = mocks.updateWhere.mock.calls[index]?.[0] as WhereClause
    for (const id of where.and[1].inArray[1]) {
      byId.set(id, values.botResumeAt)
    }
  }
  return byId
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(NOW)
  mocks.findResumePolicyForConversations.mockResolvedValue([])
  mocks.resetForResume.mockResolvedValue(undefined)
  mocks.cancelQuickReplyFollowUps.mockResolvedValue(undefined)
  mocks.invalidateCacheByTags.mockResolvedValue(undefined)
  mocks.transaction.mockImplementation(
    async (fn: (client: unknown) => Promise<unknown>) => await fn(db),
  )
})

afterEach(() => {
  vi.useRealTimers()
})

describe("conversationService.updateBotEnabled resume policy", () => {
  test("agent conversation with resumeAfterHours null never resumes; others pause for 24h", async () => {
    mocks.findResumePolicyForConversations.mockResolvedValue([
      { conversationId: "a", resumeAfterHours: null },
    ])

    await conversationService.updateBotEnabled({
      workspaceId: WORKSPACE_ID,
      ids: ["a", "b"],
      botEnabled: false,
    })

    expect(mocks.findResumePolicyForConversations).toHaveBeenCalledWith(
      { workspaceId: WORKSPACE_ID, conversationIds: ["a", "b"] },
      db,
    )
    expect(mocks.updateSet).toHaveBeenCalledTimes(2)
    const byId = updatesByConversation()
    expect(byId.get("a")).toBeNull()
    expect(byId.get("b")).toEqual(
      new Date(NOW.getTime() + BOT_DISABLE_DURATION_MS),
    )
    expect(mocks.cancelQuickReplyFollowUps).toHaveBeenCalledTimes(1)
    expect(mocks.cancelQuickReplyFollowUps).toHaveBeenCalledWith(
      expect.objectContaining({ conversationIds: ["a", "b"] }),
    )
    expect(mocks.invalidateCacheByTags).toHaveBeenCalledTimes(1)
  })

  test("agent conversation with resumeAfterHours 6 resumes after 6h", async () => {
    mocks.findResumePolicyForConversations.mockResolvedValue([
      { conversationId: "a", resumeAfterHours: 6 },
    ])

    await conversationService.updateBotEnabled({
      workspaceId: WORKSPACE_ID,
      ids: ["a", "b"],
      botEnabled: false,
    })

    const byId = updatesByConversation()
    expect(byId.get("a")).toEqual(new Date(NOW.getTime() + 6 * HOUR_MS))
    expect(byId.get("b")).toEqual(
      new Date(NOW.getTime() + BOT_DISABLE_DURATION_MS),
    )
  })

  test("without agent conversations a single update keeps the 24h pause", async () => {
    await conversationService.updateBotEnabled({
      workspaceId: WORKSPACE_ID,
      ids: ["a", "b"],
      botEnabled: false,
    })

    expect(mocks.updateSet).toHaveBeenCalledTimes(1)
    const byId = updatesByConversation()
    expect(byId.get("a")).toEqual(
      new Date(NOW.getTime() + BOT_DISABLE_DURATION_MS),
    )
    expect(byId.get("b")).toEqual(byId.get("a"))
  })

  test("an explicit botResumeAt wins and skips the policy lookup", async () => {
    const explicit = new Date(NOW.getTime() + 2 * HOUR_MS)

    await conversationService.updateBotEnabled({
      workspaceId: WORKSPACE_ID,
      ids: ["a", "b"],
      botEnabled: false,
      botResumeAt: explicit,
    })

    expect(mocks.findResumePolicyForConversations).not.toHaveBeenCalled()
    expect(mocks.updateSet).toHaveBeenCalledTimes(1)
    expect(updatesByConversation().get("a")).toEqual(explicit)
  })

  test("noAutoResume keeps the bot off with botResumeAt null despite the policy", async () => {
    mocks.findResumePolicyForConversations.mockResolvedValue([
      { conversationId: "a", resumeAfterHours: 6 },
    ])

    await conversationService.updateBotEnabled({
      workspaceId: WORKSPACE_ID,
      ids: ["a", "b"],
      botEnabled: false,
      noAutoResume: true,
    })

    expect(mocks.findResumePolicyForConversations).not.toHaveBeenCalled()
    expect(mocks.updateSet).toHaveBeenCalledTimes(1)
    const byId = updatesByConversation()
    expect(byId.get("a")).toBeNull()
    expect(byId.get("b")).toBeNull()
  })

  test("a handover category is written with the handover time", async () => {
    await conversationService.disableBotState({
      workspaceId: WORKSPACE_ID,
      conversations: [{ id: "a", contactId: "contact-a" }],
      triggerContext: TRIGGER_CONTEXT,
      noAutoResume: true,
      handoverCategory: "payment",
    })

    expect(mocks.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        botEnabled: false,
        botResumeAt: null,
        handoverCategory: "payment",
        handedOverAt: NOW,
      }),
    )
  })

  test("a pause without a handover category leaves the handover columns alone", async () => {
    await conversationService.updateBotEnabled({
      workspaceId: WORKSPACE_ID,
      ids: ["a"],
      botEnabled: false,
    })

    const values = mocks.updateSet.mock.calls[0]?.[0] as object
    expect(values).not.toHaveProperty("handoverCategory")
    expect(values).not.toHaveProperty("handedOverAt")
  })

  test("enabling the bot skips the policy lookup", async () => {
    await conversationService.updateBotEnabled({
      workspaceId: WORKSPACE_ID,
      ids: ["a"],
      botEnabled: true,
    })

    expect(mocks.findResumePolicyForConversations).not.toHaveBeenCalled()
    expect(updatesByConversation().get("a")).toBeNull()
  })
})

describe("conversationService.enableBotState external agent reset", () => {
  test("clears the handover category and time", async () => {
    await conversationService.enableBotState({
      workspaceId: WORKSPACE_ID,
      conversations: [{ id: "a", contactId: "contact-a" }],
      triggerContext: TRIGGER_CONTEXT,
    })

    expect(mocks.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        botEnabled: true,
        botResumeAt: null,
        handoverCategory: null,
        handedOverAt: null,
      }),
    )
  })

  test("resets only conversations covered by the agent policy", async () => {
    mocks.findResumePolicyForConversations.mockResolvedValue([
      { conversationId: "a", resumeAfterHours: 6 },
    ])

    await conversationService.enableBotState({
      workspaceId: WORKSPACE_ID,
      conversations: [
        { id: "a", contactId: "contact-a" },
        { id: "b", contactId: "contact-b" },
      ],
      triggerContext: TRIGGER_CONTEXT,
    })

    expect(mocks.findResumePolicyForConversations).toHaveBeenCalledWith(
      { workspaceId: WORKSPACE_ID, conversationIds: ["a", "b"] },
      db,
    )
    expect(mocks.resetForResume).toHaveBeenCalledWith(
      { workspaceId: WORKSPACE_ID, conversationIds: ["a"], at: NOW },
      db,
    )
  })

  test("skips the reset when no conversation is covered by an agent", async () => {
    await conversationService.enableBotState({
      workspaceId: WORKSPACE_ID,
      conversations: [{ id: "b", contactId: "contact-b" }],
      triggerContext: TRIGGER_CONTEXT,
    })

    expect(mocks.findResumePolicyForConversations).toHaveBeenCalledTimes(1)
    expect(mocks.resetForResume).not.toHaveBeenCalled()
  })

  test("a failed reset is logged and never breaks enabling the bot", async () => {
    mocks.findResumePolicyForConversations.mockResolvedValue([
      { conversationId: "a", resumeAfterHours: null },
    ])
    mocks.resetForResume.mockRejectedValue(new Error("db down"))

    await expect(
      conversationService.enableBotState({
        workspaceId: WORKSPACE_ID,
        conversations: [{ id: "a", contactId: "contact-a" }],
        triggerContext: TRIGGER_CONTEXT,
      }),
    ).resolves.toBeUndefined()

    expect(mocks.loggerError).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      expect.any(String),
    )
    expect(mocks.emitConversationTransferredToBot).toHaveBeenCalledWith(
      WORKSPACE_ID,
      "contact-a",
      "a",
      undefined,
    )
  })

  test("inside a caller tx the reset runs behind a savepoint", async () => {
    const savepoint = { savepoint: true }
    const transaction = vi.fn(
      async (fn: (client: unknown) => Promise<unknown>) => await fn(savepoint),
    )
    const tx = {
      update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
      transaction,
    }
    mocks.findResumePolicyForConversations.mockResolvedValue([
      { conversationId: "a", resumeAfterHours: null },
    ])

    await conversationService.enableBotState({
      workspaceId: WORKSPACE_ID,
      conversations: [{ id: "a", contactId: "contact-a" }],
      triggerContext: TRIGGER_CONTEXT,
      tx: tx as never,
    })

    expect(transaction).toHaveBeenCalledTimes(1)
    expect(mocks.resetForResume).toHaveBeenCalledWith(
      { workspaceId: WORKSPACE_ID, conversationIds: ["a"], at: NOW },
      savepoint,
    )
  })
})
