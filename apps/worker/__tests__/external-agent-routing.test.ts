import { describe, expect, test, vi } from "vitest"

const { resolveIncomingTextRouting } = await import(
  "../src/integration/routing"
)
const { aiAgentQueue, enqueueExternalAgentReply, enqueueExternalAgentWatch } =
  await import("@chatbotx.io/worker-config")

const WATCH_JOB_ID_PATTERN = /^externalAgentWatch-conversation-1-run_abc-\d+$/

const conversation = {
  id: "conversation-1",
  workspaceId: "workspace-1",
  additionalAttributes: {},
}

const challengeConversation = {
  ...conversation,
  additionalAttributes: {
    challenge: { type: "step", data: { stepId: "step-1" } },
  },
}

const route = (props: {
  conversation?: typeof conversation
  hasActionableInput?: boolean
  hasText?: boolean
  isExternalAgentInbox?: boolean
  active?: boolean
}) =>
  resolveIncomingTextRouting({
    conversation: (props.conversation ?? conversation) as never,
    hasActionableInput: props.hasActionableInput ?? true,
    hasText: props.hasText ?? true,
    isExternalAgentInbox: props.isExternalAgentInbox,
    isConversationActive: vi.fn(async () => props.active ?? true),
  })

describe("resolveIncomingTextRouting with an external agent inbox", () => {
  test("routes a text message to the external agent", async () => {
    await expect(route({ isExternalAgentInbox: true })).resolves.toEqual({
      type: "externalAgent",
      conversation,
    })
  })

  test("routes a photo without text to the external agent", async () => {
    await expect(
      route({ isExternalAgentInbox: true, hasText: false }),
    ).resolves.toEqual({ type: "externalAgent", conversation })
  })

  test("a pending challenge keeps priority over the external agent", async () => {
    await expect(
      route({
        conversation: challengeConversation,
        isExternalAgentInbox: true,
      }),
    ).resolves.toEqual({
      type: "challenge",
      conversation: challengeConversation,
      challenge: challengeConversation.additionalAttributes.challenge,
    })
  })

  test("a paused bot never routes to the external agent", async () => {
    await expect(
      route({ isExternalAgentInbox: true, active: false }),
    ).resolves.toEqual({ type: "handoffReentry", conversation })
    await expect(
      route({ isExternalAgentInbox: true, active: false, hasText: false }),
    ).resolves.toEqual({ type: "none" })
  })

  test("no actionable input routes nowhere", async () => {
    await expect(
      route({
        isExternalAgentInbox: true,
        hasActionableInput: false,
        hasText: false,
      }),
    ).resolves.toEqual({ type: "none" })
  })

  test("without an external agent the routing is unchanged", async () => {
    await expect(route({ isExternalAgentInbox: false })).resolves.toEqual({
      type: "automatedResponse",
      conversation,
    })
    await expect(route({})).resolves.toEqual({
      type: "automatedResponse",
      conversation,
    })
    await expect(
      route({ isExternalAgentInbox: false, hasText: false }),
    ).resolves.toEqual({ type: "none" })
  })
})

describe("external agent enqueue helpers", () => {
  const replyData = {
    workspaceId: "workspace-1",
    conversationId: "conversation-1",
    contactInboxId: "contact-inbox-1",
    messageId: "message-1",
  }

  test("debounces replies per conversation without a fixed job id", async () => {
    const addSpy = vi.spyOn(aiAgentQueue, "add")

    await enqueueExternalAgentReply(replyData)

    expect(addSpy).toHaveBeenCalledWith(
      "externalAgentReply",
      { type: "externalAgentReply", data: replyData },
      {
        delay: 5000,
        deduplication: {
          id: "externalAgentReply-conversation-1",
          ttl: 5000,
          extend: true,
          replace: true,
          keepLastIfActive: true,
        },
        attempts: 4,
        backoff: { type: "exponential", delay: 30_000 },
        removeOnComplete: true,
        removeOnFail: 100,
      },
    )
    const options = addSpy.mock.calls[0]?.[2] as
      | { jobId?: string; deduplication: { id: string } }
      | undefined
    expect(options?.jobId).toBeUndefined()
    expect(options?.deduplication.id).not.toContain(":")
    addSpy.mockRestore()
  })

  test("queues a run watch with a unique, colon-free job id", async () => {
    const addSpy = vi.spyOn(aiAgentQueue, "add")
    const watchData = {
      workspaceId: "workspace-1",
      conversationId: "conversation-1",
      contactInboxId: "contact-inbox-1",
      runId: "run_abc",
    }

    await enqueueExternalAgentWatch(watchData, 5000)

    expect(addSpy).toHaveBeenCalledWith(
      "externalAgentWatch",
      { type: "externalAgentWatch", data: watchData },
      expect.objectContaining({
        delay: 5000,
        attempts: 3,
        backoff: { type: "exponential", delay: 10_000 },
        removeOnComplete: true,
        removeOnFail: 100,
      }),
    )
    const options = addSpy.mock.calls[0]?.[2] as { jobId: string } | undefined
    expect(options?.jobId).toMatch(WATCH_JOB_ID_PATTERN)
    expect(options?.jobId).not.toContain(":")
    addSpy.mockRestore()
  })
})
