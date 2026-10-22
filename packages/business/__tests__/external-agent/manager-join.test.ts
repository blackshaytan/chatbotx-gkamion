import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { conversationService } from "../../src/conversation/service"

const mocks = vi.hoisted(() => ({
  findConversation: vi.fn(),
  findManyConversations: vi.fn(),
  updateSet: vi.fn(),
  updateWhere: vi.fn(),
  updateReturning: vi.fn(),
  findRecentByContactId: vi.fn(),
  findActiveForInbox: vi.fn(),
  claimManagerJoinedAt: vi.fn(),
  findNameAndEmail: vi.fn(),
  findMember: vi.fn(),
  findTeam: vi.fn(),
  chatQueueAdd: vi.fn(),
  notificationQueueAddBulk: vi.fn(),
  invalidateCacheByTags: vi.fn(),
  cancelQuickReplyFollowUps: vi.fn(),
  emit: vi.fn(),
  loggerError: vi.fn(),
}))

vi.mock("@chatbotx.io/database/client", () => ({
  db: {
    query: {
      conversationModel: {
        findFirst: mocks.findConversation,
        findMany: mocks.findManyConversations,
      },
    },
    update: () => ({
      set: (values: unknown) => {
        mocks.updateSet(values)
        return {
          where: (cond: unknown) => {
            mocks.updateWhere(cond)
            return Object.assign(Promise.resolve(undefined), {
              returning: () => mocks.updateReturning(),
            })
          },
        }
      },
    }),
    transaction: vi.fn(),
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
  assignTargetIfUnassigned: vi.fn(),
  claimManagerJoinedAt: mocks.claimManagerJoinedAt,
  externalAgentRepository: {
    findResumePolicyForConversations: vi.fn(async () => []),
    findActiveForInbox: mocks.findActiveForInbox,
  },
  externalAgentStateRepository: {
    resetForResume: vi.fn(async () => undefined),
  },
}))

vi.mock("@chatbotx.io/redis", () => ({
  withCache: vi.fn((_key: string, loader: () => unknown) => loader()),
  invalidateCacheByTags: mocks.invalidateCacheByTags,
}))

vi.mock("@chatbotx.io/worker-config", () => ({
  // Transitive service imports read other job actions at module load.
  IntegrationJobAction: new Proxy({}, { get: (_target, key) => String(key) }),
  ChatJobAction: { sendChatMessage: "sendChatMessage" },
  NotificationJobAction: {
    notifyConversationAssigned: "notifyConversationAssigned",
  },
  chatQueue: { add: mocks.chatQueueAdd },
  notificationQueue: { addBulk: mocks.notificationQueueAddBulk },
}))

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
  emit: mocks.emit,
}))

vi.mock("@chatbotx.io/events", () => ({
  emitConversationArchived: vi.fn(),
  emitConversationAssigned: vi.fn(),
  emitConversationFollowUp: vi.fn(),
  emitConversationTransferredToBot: vi.fn(),
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
  contactInboxService: { findRecentByContactId: mocks.findRecentByContactId },
}))

vi.mock("../../src/workspace-member/service", () => ({
  workspaceMemberService: { findByWorkspaceIdAndUserId: mocks.findMember },
}))

vi.mock("../../src/enterprise/inbox-team/service", () => ({
  inboxTeamService: { findByIdOrFail: mocks.findTeam, exists: vi.fn() },
}))

vi.mock("../../src/smart-delay/service", () => ({
  smartDelayService: {
    cancelQuickReplyFollowUps: mocks.cancelQuickReplyFollowUps,
  },
}))

vi.mock("../../src/user/service", () => ({
  userService: { findNameAndEmail: mocks.findNameAndEmail },
}))

vi.mock("../../src/logger", () => ({
  logger: { warn: vi.fn(), error: mocks.loggerError, info: vi.fn() },
}))

const NOW = new Date("2026-10-22T10:00:00.000Z")
const WORKSPACE_ID = "ws-1"
const CONVERSATION_ID = "conv-1"
const MANAGER_ID = "user-1"
const NOTICE_TEXT = "Вам отвечает менеджер Анна"

const TRIGGER_CONTEXT = {
  triggerSource: "api",
  triggerHandler: "assignConversation",
} as const

const handedOver = {
  id: CONVERSATION_ID,
  workspaceId: WORKSPACE_ID,
  contactId: "contact-1",
  botEnabled: false,
  handedOverAt: NOW,
  managerJoinedAt: null,
}
const claimed = { ...handedOver, managerJoinedAt: NOW }
const contactInbox = {
  id: "ci-1",
  inboxId: "inbox-1",
  contactId: "contact-1",
  channel: "messenger",
}

const announceInput = {
  workspaceId: WORKSPACE_ID,
  conversationId: CONVERSATION_ID,
  userId: MANAGER_ID,
}

const noticeJobs = () =>
  mocks.chatQueueAdd.mock.calls.filter(([name]) => name === "sendChatMessage")

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(NOW)
  mocks.findConversation.mockResolvedValue(handedOver)
  mocks.findManyConversations.mockResolvedValue([handedOver])
  mocks.updateReturning.mockResolvedValue([handedOver])
  mocks.findRecentByContactId.mockResolvedValue(contactInbox)
  mocks.findActiveForInbox.mockResolvedValue({
    id: "agent-1",
    announceManager: true,
    signMessages: false,
    botName: "Гека",
  })
  mocks.claimManagerJoinedAt.mockResolvedValue([claimed])
  mocks.findNameAndEmail.mockResolvedValue({
    name: "Анна",
    email: "anna@example.com",
  })
  mocks.findMember.mockResolvedValue({ userId: MANAGER_ID })
  mocks.findTeam.mockResolvedValue({ id: "team-1" })
  mocks.chatQueueAdd.mockResolvedValue(undefined)
  mocks.notificationQueueAddBulk.mockResolvedValue(undefined)
  mocks.invalidateCacheByTags.mockResolvedValue(undefined)
  mocks.cancelQuickReplyFollowUps.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.useRealTimers()
})

describe("conversationService.announceManagerJoined", () => {
  test("claims the notice and queues it with the manager's name", async () => {
    await conversationService.announceManagerJoined(announceInput)

    expect(mocks.claimManagerJoinedAt).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      conversationId: CONVERSATION_ID,
      at: NOW,
    })
    expect(mocks.chatQueueAdd).toHaveBeenCalledTimes(1)
    expect(mocks.chatQueueAdd).toHaveBeenCalledWith("sendChatMessage", {
      type: "sendChatMessage",
      data: {
        conversation: claimed,
        contactInbox,
        text: NOTICE_TEXT,
      },
    })
  })

  test("a second manager reply after the notice sends nothing", async () => {
    mocks.findConversation
      .mockResolvedValueOnce(handedOver)
      .mockResolvedValueOnce(claimed)

    await conversationService.announceManagerJoined(announceInput)
    await conversationService.announceManagerJoined(announceInput)

    expect(mocks.claimManagerJoinedAt).toHaveBeenCalledTimes(1)
    expect(noticeJobs()).toHaveLength(1)
  })

  test("a claim that loses the race enqueues no notice", async () => {
    mocks.claimManagerJoinedAt.mockResolvedValue([])

    await conversationService.announceManagerJoined(announceInput)

    expect(mocks.claimManagerJoinedAt).toHaveBeenCalledTimes(1)
    expect(mocks.chatQueueAdd).not.toHaveBeenCalled()
  })

  test("a conversation that was never handed over gets no notice", async () => {
    mocks.findConversation.mockResolvedValue({
      ...handedOver,
      handedOverAt: null,
    })

    await conversationService.announceManagerJoined(announceInput)

    expect(mocks.findActiveForInbox).not.toHaveBeenCalled()
    expect(mocks.claimManagerJoinedAt).not.toHaveBeenCalled()
    expect(mocks.chatQueueAdd).not.toHaveBeenCalled()
  })

  test("an already announced handover gets no second notice", async () => {
    mocks.findConversation.mockResolvedValue(claimed)

    await conversationService.announceManagerJoined(announceInput)

    expect(mocks.claimManagerJoinedAt).not.toHaveBeenCalled()
    expect(mocks.chatQueueAdd).not.toHaveBeenCalled()
  })

  test("an inbox whose agent has announceManager off gets no notice", async () => {
    mocks.findActiveForInbox.mockResolvedValue({
      id: "agent-1",
      announceManager: false,
      signMessages: true,
      botName: "Гека",
    })

    await conversationService.announceManagerJoined(announceInput)

    expect(mocks.claimManagerJoinedAt).not.toHaveBeenCalled()
    expect(mocks.chatQueueAdd).not.toHaveBeenCalled()
  })

  test("an inbox without an enabled agent gets no notice", async () => {
    mocks.findActiveForInbox.mockResolvedValue(null)

    await conversationService.announceManagerJoined(announceInput)

    expect(mocks.claimManagerJoinedAt).not.toHaveBeenCalled()
    expect(mocks.chatQueueAdd).not.toHaveBeenCalled()
  })

  test("a manager without a name gets the notice without a name", async () => {
    mocks.findNameAndEmail.mockResolvedValue({
      name: null,
      email: "anna@example.com",
    })

    await conversationService.announceManagerJoined(announceInput)

    expect(mocks.chatQueueAdd).toHaveBeenCalledWith(
      "sendChatMessage",
      expect.objectContaining({
        data: expect.objectContaining({
          text: "Вам отвечает менеджер",
        }),
      }),
    )
  })

  test("a failed enqueue is logged and never thrown to the caller", async () => {
    const failure = new Error("redis down")
    mocks.chatQueueAdd.mockRejectedValue(failure)

    await expect(
      conversationService.announceManagerJoined(announceInput),
    ).resolves.toBeUndefined()

    expect(mocks.loggerError).toHaveBeenCalledWith(
      {
        err: failure,
        workspaceId: WORKSPACE_ID,
        conversationId: CONVERSATION_ID,
      },
      "External agent: unable to announce the manager",
    )
  })
})

describe("manager assignment triggers the join notice", () => {
  test("assigning a user to a handed-over conversation sends the notice", async () => {
    await conversationService.assignOne({
      workspaceId: WORKSPACE_ID,
      conversation: { id: CONVERSATION_ID, contactId: "contact-1" },
      assignedId: `u_${MANAGER_ID}`,
      triggerContext: TRIGGER_CONTEXT,
    })

    expect(mocks.claimManagerJoinedAt).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: CONVERSATION_ID }),
    )
    expect(noticeJobs()).toHaveLength(1)
  })

  test("bulk assignment of a user notifies each conversation of the contact", async () => {
    await conversationService.assignByContactIds({
      workspaceId: WORKSPACE_ID,
      contactIds: ["contact-1"],
      assignedId: `u_${MANAGER_ID}`,
      triggerContext: TRIGGER_CONTEXT,
    })

    expect(mocks.claimManagerJoinedAt).toHaveBeenCalledTimes(1)
    expect(noticeJobs()).toHaveLength(1)
  })

  test("assigning a team sends no notice", async () => {
    await conversationService.assignOne({
      workspaceId: WORKSPACE_ID,
      conversation: { id: CONVERSATION_ID, contactId: "contact-1" },
      assignedId: "t_team-1",
      triggerContext: TRIGGER_CONTEXT,
    })

    expect(mocks.claimManagerJoinedAt).not.toHaveBeenCalled()
    expect(mocks.chatQueueAdd).not.toHaveBeenCalled()
  })

  test("unassigning sends no notice", async () => {
    await conversationService.assignOne({
      workspaceId: WORKSPACE_ID,
      conversation: { id: CONVERSATION_ID, contactId: "contact-1" },
      assignedId: null,
      triggerContext: TRIGGER_CONTEXT,
    })

    expect(mocks.claimManagerJoinedAt).not.toHaveBeenCalled()
  })
})

describe("managerJoinedAt lifecycle on bot state changes", () => {
  test("turning the bot back on clears the join marker", async () => {
    await conversationService.updateBotEnabled({
      workspaceId: WORKSPACE_ID,
      ids: [CONVERSATION_ID],
      botEnabled: true,
    })

    expect(mocks.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ managerJoinedAt: null, handedOverAt: null }),
    )
  })

  test("a new handover clears the join marker and stamps the handover time", async () => {
    await conversationService.disableBotState({
      workspaceId: WORKSPACE_ID,
      conversations: [{ id: CONVERSATION_ID, contactId: "contact-1" }],
      triggerContext: TRIGGER_CONTEXT,
      noAutoResume: true,
      handoverCategory: "payment",
    })

    expect(mocks.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        handoverCategory: "payment",
        handedOverAt: NOW,
        managerJoinedAt: null,
      }),
    )
  })

  test("a plain pause without a handover keeps the join marker", async () => {
    await conversationService.updateBotEnabled({
      workspaceId: WORKSPACE_ID,
      ids: [CONVERSATION_ID],
      botEnabled: false,
    })

    const values = mocks.updateSet.mock.calls[0]?.[0] as object
    expect(values).not.toHaveProperty("managerJoinedAt")
  })
})
