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
  claimDueBotResumes: vi.fn(),
  findConversations: vi.fn(),
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
    query: {
      conversationModel: {
        findMany: (...args: unknown[]) => mocks.findConversations(...args),
      },
    },
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
  claimDueBotResumes: mocks.claimDueBotResumes,
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
const { emit } = await import("@chatbotx.io/event-bus")
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
  mocks.claimDueBotResumes.mockResolvedValue([])
  mocks.findConversations.mockResolvedValue([])
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

describe("conversationService.resumeDueBots", () => {
  test("writes nothing and emits nothing when no pause is due", async () => {
    await expect(
      conversationService.resumeDueBots({ limit: 10, now: NOW }),
    ).resolves.toBe(0)

    expect(mocks.claimDueBotResumes).toHaveBeenCalledWith(
      { now: NOW, limit: 10 },
      undefined,
    )
    expect(mocks.emitConversationTransferredToBot).not.toHaveBeenCalled()
    expect(mocks.invalidateCacheByTags).not.toHaveBeenCalled()
  })

  test("resumes each claimed workspace and emits the transfer once", async () => {
    mocks.claimDueBotResumes.mockResolvedValue([
      { id: "a", workspaceId: "ws-1", contactId: "contact-a" },
      { id: "b", workspaceId: "ws-2", contactId: "contact-b" },
    ])

    await expect(
      conversationService.resumeDueBots({ limit: 10, now: NOW }),
    ).resolves.toBe(2)

    expect(mocks.emitConversationTransferredToBot).toHaveBeenCalledTimes(2)
    expect(mocks.emitConversationTransferredToBot).toHaveBeenCalledWith(
      "ws-1",
      "contact-a",
      "a",
      undefined,
    )
    expect(mocks.emitConversationTransferredToBot).toHaveBeenCalledWith(
      "ws-2",
      "contact-b",
      "b",
      undefined,
    )
    expect(emit).toHaveBeenCalledWith(
      "analytics:dashboard",
      expect.objectContaining({
        eventType: "conversation:transferred_to_bot",
        workspaceId: "ws-1",
        conversationId: "a",
        metadata: {
          triggerContext: {
            triggerSource: "system",
            triggerHandler: "resumeDueBots",
            triggerType: "bot_auto_resume",
          },
        },
      }),
    )
    expect(mocks.invalidateCacheByTags).toHaveBeenCalledTimes(2)
    expect(mocks.findResumePolicyForConversations).toHaveBeenCalledTimes(2)
  })

  test("keeps the written flag when a workspace's side effects fail", async () => {
    mocks.claimDueBotResumes.mockResolvedValue([
      { id: "a", workspaceId: "ws-1", contactId: "contact-a" },
      { id: "b", workspaceId: "ws-2", contactId: "contact-b" },
    ])
    mocks.emitConversationTransferredToBot.mockRejectedValueOnce(
      new Error("bus down"),
    )

    await expect(
      conversationService.resumeDueBots({ limit: 10, now: NOW }),
    ).resolves.toBe(2)

    expect(mocks.loggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.any(Error),
        workspaceId: "ws-1",
      }),
      "bot auto-resume side effects failed after the flag was written",
    )
    expect(mocks.emitConversationTransferredToBot).toHaveBeenCalledWith(
      "ws-2",
      "contact-b",
      "b",
      undefined,
    )
  })
})

describe("conversationService.ensureActive", () => {
  const paused = {
    id: "a",
    workspaceId: WORKSPACE_ID,
    contactId: "contact-a",
    botEnabled: false,
    botResumeAt: new Date(NOW.getTime() - HOUR_MS),
  }

  test("does not claim a bot that is already on", async () => {
    await expect(
      conversationService.ensureActive({ ...paused, botEnabled: true }),
    ).resolves.toBe(true)

    expect(mocks.claimDueBotResumes).not.toHaveBeenCalled()
  })

  test("does not claim a pause that is still in the future", async () => {
    await expect(
      conversationService.ensureActive({
        ...paused,
        botResumeAt: new Date(NOW.getTime() + HOUR_MS),
      }),
    ).resolves.toBe(false)

    expect(mocks.claimDueBotResumes).not.toHaveBeenCalled()
  })

  test("claims an expired pause and emits the transfer", async () => {
    mocks.claimDueBotResumes.mockResolvedValue([
      { id: "a", workspaceId: WORKSPACE_ID, contactId: "contact-a" },
    ])

    await expect(conversationService.ensureActive(paused)).resolves.toBe(true)

    expect(mocks.claimDueBotResumes).toHaveBeenCalledWith(
      {
        now: NOW,
        limit: 1,
        conversationId: "a",
        workspaceId: WORKSPACE_ID,
      },
      undefined,
    )
    expect(mocks.emitConversationTransferredToBot).toHaveBeenCalledWith(
      WORKSPACE_ID,
      "contact-a",
      "a",
      undefined,
    )
    expect(mocks.updateSet).not.toHaveBeenCalled()
  })

  test("treats a lost claim as already resumed when the row is enabled", async () => {
    mocks.findConversations.mockResolvedValue([
      { ...paused, botEnabled: true, botResumeAt: null },
    ])

    await expect(conversationService.ensureActive(paused)).resolves.toBe(true)

    expect(mocks.emitConversationTransferredToBot).not.toHaveBeenCalled()
  })

  test("stays off when the pause was extended before the claim", async () => {
    mocks.findConversations.mockResolvedValue([
      {
        ...paused,
        botResumeAt: new Date(NOW.getTime() + HOUR_MS),
      },
    ])

    await expect(conversationService.ensureActive(paused)).resolves.toBe(false)
  })

  test("stays active when another writer still holds the due row", async () => {
    mocks.findConversations.mockResolvedValue([paused])

    await expect(conversationService.ensureActive(paused)).resolves.toBe(true)

    expect(mocks.emitConversationTransferredToBot).not.toHaveBeenCalled()
  })
})
