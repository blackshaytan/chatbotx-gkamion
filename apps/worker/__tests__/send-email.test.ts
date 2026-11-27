// @vitest-environment node
import { BROADCAST_PAYLOAD_TYPE } from "@chatbotx.io/flow-config"
import { beforeEach, describe, expect, test, vi } from "vitest"

// ── analytics mock (the key subject of this test) ──────────────────────────
const createRecipient = vi.fn().mockResolvedValue({ token: "test-token-xyz" })
const markDelivered = vi.fn().mockResolvedValue(undefined)
const markFailed = vi.fn().mockResolvedValue(undefined)
const broadcastOnDelivered = vi.fn().mockResolvedValue(undefined)
const broadcastOnFailed = vi.fn().mockResolvedValue(undefined)

vi.mock("@chatbotx.io/analytics", () => ({
  emailTopicAnalyticsService: { createRecipient, markDelivered, markFailed },
  broadcastAnalyticsService: {
    onDelivered: broadcastOnDelivered,
    onFailed: broadcastOnFailed,
  },
}))

// ── business services ───────────────────────────────────────────────────────
const runAction = vi.fn().mockResolvedValue(undefined)
const mockContactFindBy = vi.fn().mockResolvedValue({ emailOptIn: true })

vi.mock("@chatbotx.io/business", () => ({
  buildContext: vi.fn().mockResolvedValue({ ctx: true }),
  buildUnsubscribeUrl: vi
    .fn()
    .mockResolvedValue("https://app.test/unsubscribe?token=unsub"),
  contactService: {
    findBy: mockContactFindBy,
  },
  inboxService: { find: vi.fn().mockResolvedValue(undefined) },
  integrationSmtpService: {
    find: vi.fn().mockResolvedValue({
      id: "smtp-1",
      name: "SMTP",
      auth: {
        authType: "custom",
        host: "smtp.test",
        port: 587,
        fromAddress: "from@test.com",
      },
    }),
  },
  resolveTenantSettings: vi
    .fn()
    .mockResolvedValue({ appUrl: "https://app.test" }),
  signEmailClickUrl: vi.fn().mockResolvedValue("signed-token"),
  workspaceService: {
    findById: vi.fn().mockResolvedValue({ id: "ws-1", name: "WS" }),
  },
}))

vi.mock("@chatbotx.io/integration-smtp", () => ({
  integration: { runAction },
  smtpAuthSchema: {
    parse: vi.fn((v) => v),
  },
}))

const renderDynamicEmailHtmlMock = vi.fn().mockReturnValue("<html/>")

vi.mock("@chatbotx.io/mail/dynamic", () => ({
  renderDynamicEmailHtml: renderDynamicEmailHtmlMock,
}))

vi.mock("@chatbotx.io/variables", () => ({
  contactVariableService: {
    getAll: vi.fn().mockResolvedValue([]),
    replaceAll: vi.fn(({ text }: { text: string }) => Promise.resolve(text)),
  },
}))

vi.mock("../../src/lib/convert-button", () => ({
  resolveButtonUrl: vi.fn().mockReturnValue("https://resolved-url.com/page"),
}))

vi.mock("../../src/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const { sendEmail } = await import("../../src/integration/handlers/send-email")

// ── shared fixture ──────────────────────────────────────────────────────────
function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    conversation: {
      id: "conv-1",
      workspaceId: "ws-1",
      contactId: "contact-1",
    },
    contactInbox: {
      id: "ci-1",
      inboxId: "inbox-1",
      channel: "smtp",
      sourceId: "user@example.com",
    },
    flowVersion: { flowId: "flow-1" },
    step: {
      integrationSmtpId: "smtp-1",
      to: "user@example.com",
      subject: "Hello",
      preheader: "preview",
      from: "from@test.com",
      elements: [],
      topicId: "topic-1",
      ...overrides,
    },
    metadata: {},
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  createRecipient.mockResolvedValue({ token: "test-token-xyz" })
  markDelivered.mockResolvedValue(undefined)
  markFailed.mockResolvedValue(undefined)
  broadcastOnDelivered.mockResolvedValue(undefined)
  broadcastOnFailed.mockResolvedValue(undefined)
  runAction.mockResolvedValue(undefined)
  renderDynamicEmailHtmlMock.mockReturnValue("<html/>")
  mockContactFindBy.mockResolvedValue({
    emailOptIn: true,
  })
})

describe("with topicId", () => {
  test("calls createRecipient with conversation identifiers and resolved email", async () => {
    await sendEmail(makeProps() as never)
    expect(createRecipient).toHaveBeenCalledOnce()
    expect(createRecipient).toHaveBeenCalledWith(
      expect.objectContaining({
        topicId: "topic-1",
        workspaceId: "ws-1",
        contactId: "contact-1",
        conversationId: "conv-1",
        contactInboxId: "ci-1",
        email: "user@example.com",
      }),
    )
  })

  test("embeds token in tracking pixel URL", async () => {
    await sendEmail(makeProps() as never)
    const callArg = renderDynamicEmailHtmlMock.mock.calls[0]?.[0] as {
      elements: { type: string; url?: string }[]
    }
    const pixel = callArg?.elements.find((el) => el.type === "image")
    expect(pixel?.url).toContain("r=test-token-xyz")
    expect(pixel?.url).toContain("/email-topic/open")
  })

  test("calls markDelivered with token on send success", async () => {
    await sendEmail(makeProps() as never)
    expect(markDelivered).toHaveBeenCalledOnce()
    expect(markDelivered).toHaveBeenCalledWith("test-token-xyz")
    expect(markFailed).not.toHaveBeenCalled()
  })

  test("calls markFailed with token when runAction throws", async () => {
    runAction.mockRejectedValue(new Error("SMTP error"))
    await sendEmail(makeProps() as never)
    expect(markFailed).toHaveBeenCalledOnce()
    expect(markFailed).toHaveBeenCalledWith("test-token-xyz")
    expect(markDelivered).not.toHaveBeenCalled()
  })
})

describe("without topicId", () => {
  test("does not call any analytics methods", async () => {
    await sendEmail(makeProps({ topicId: undefined }) as never)
    expect(createRecipient).not.toHaveBeenCalled()
    expect(markDelivered).not.toHaveBeenCalled()
    expect(markFailed).not.toHaveBeenCalled()
  })

  test("still sends the email", async () => {
    await sendEmail(makeProps({ topicId: undefined }) as never)
    expect(runAction).toHaveBeenCalledOnce()
  })
})

describe("broadcast analytics and recipient edge cases", () => {
  test("calls broadcastAnalyticsService.onDelivered on SMTP success with broadcast metadata", async () => {
    const props = makeProps({ topicId: undefined })
    props.metadata = {
      type: BROADCAST_PAYLOAD_TYPE,
      broadcastId: "b-1",
      contactInboxId: "ci-1",
    }
    await sendEmail(props as never)

    expect(broadcastOnDelivered).toHaveBeenCalledOnce()
    expect(broadcastOnDelivered).toHaveBeenCalledWith([
      expect.objectContaining({
        context: {
          workspaceId: "ws-1",
          contactId: "contact-1",
          conversationId: "conv-1",
          contactInboxId: "ci-1",
          channel: "smtp",
        },
        metadata: {
          type: BROADCAST_PAYLOAD_TYPE,
          broadcastId: "b-1",
          contactInboxId: "ci-1",
        },
      }),
    ])
  })

  test("calls emailTopicAnalyticsService.markFailed AND broadcastAnalyticsService.onFailed on runAction throw with broadcast metadata", async () => {
    runAction.mockRejectedValue(new Error("SMTP down"))
    const props = makeProps({ topicId: "topic-1" })
    props.metadata = {
      type: BROADCAST_PAYLOAD_TYPE,
      broadcastId: "b-1",
      contactInboxId: "ci-1",
    }
    await sendEmail(props as never)

    expect(markFailed).toHaveBeenCalledOnce()
    expect(markFailed).toHaveBeenCalledWith("test-token-xyz")
    expect(broadcastOnFailed).toHaveBeenCalledOnce()
    expect(broadcastOnFailed).toHaveBeenCalledWith([
      expect.objectContaining({
        context: expect.objectContaining({
          workspaceId: "ws-1",
          contactId: "contact-1",
          conversationId: "conv-1",
          contactInboxId: "ci-1",
        }),
        errorData: { message: "SMTP down" },
        metadata: {
          type: BROADCAST_PAYLOAD_TYPE,
          broadcastId: "b-1",
          contactInboxId: "ci-1",
        },
      }),
    ])
  })

  test("post-send DB error (markDelivered or onDelivered rejects) does not call markFailed/onFailed and does not rethrow", async () => {
    markDelivered.mockRejectedValue(new Error("DB error markDelivered"))
    broadcastOnDelivered.mockRejectedValue(new Error("DB error onDelivered"))

    const props = makeProps({ topicId: "topic-1" })
    props.metadata = {
      type: BROADCAST_PAYLOAD_TYPE,
      broadcastId: "b-1",
    }

    await expect(sendEmail(props as never)).resolves.not.toThrow()

    expect(runAction).toHaveBeenCalledOnce()
    expect(markDelivered).toHaveBeenCalledOnce()
    expect(broadcastOnDelivered).toHaveBeenCalledOnce()
    expect(markFailed).not.toHaveBeenCalled()
    expect(broadcastOnFailed).not.toHaveBeenCalled()
  })

  test("failure-recording DB error (markFailed rejects) still calls onFailed and does not rethrow", async () => {
    runAction.mockRejectedValue(new Error("SMTP down"))
    markFailed.mockRejectedValue(new Error("DB error markFailed"))

    const props = makeProps({ topicId: "topic-1" })
    props.metadata = {
      type: BROADCAST_PAYLOAD_TYPE,
      broadcastId: "b-1",
    }

    await expect(sendEmail(props as never)).resolves.not.toThrow()

    expect(markFailed).toHaveBeenCalledOnce()
    expect(broadcastOnFailed).toHaveBeenCalledOnce()
  })

  test("empty step.to on SMTP contactInbox falls back to sourceId and sends", async () => {
    const props = makeProps({ to: "" })
    props.contactInbox = {
      id: "ci-1",
      inboxId: "inbox-1",
      channel: "smtp",
      sourceId: "client@example.com",
    } as never

    await sendEmail(props as never)

    expect(runAction).toHaveBeenCalledOnce()
    expect(runAction).toHaveBeenCalledWith(
      "sendMail",
      expect.objectContaining({
        to: "client@example.com",
      }),
    )
  })

  test("invalid or empty recipient skips sending and calls onFailed for broadcast", async () => {
    const props = makeProps({ to: "notanemail", topicId: "topic-1" })
    props.metadata = {
      type: BROADCAST_PAYLOAD_TYPE,
      broadcastId: "b-1",
    }
    props.contactInbox = {
      id: "ci-1",
      inboxId: "inbox-1",
      channel: "telegram",
      sourceId: "12345",
    } as never

    await sendEmail(props as never)

    expect(createRecipient).not.toHaveBeenCalled()
    expect(runAction).not.toHaveBeenCalled()
    expect(broadcastOnFailed).toHaveBeenCalledOnce()
    expect(broadcastOnFailed).toHaveBeenCalledWith([
      expect.objectContaining({
        errorData: { message: "Recipient email address is invalid or empty" },
      }),
    ])
  })

  test("contact opted out of email calls onFailed for broadcast and does not send", async () => {
    mockContactFindBy.mockResolvedValueOnce({
      emailOptIn: false,
    })

    const props = makeProps({ topicId: "topic-1" })
    props.metadata = {
      type: BROADCAST_PAYLOAD_TYPE,
      broadcastId: "b-1",
    }

    await sendEmail(props as never)

    expect(runAction).not.toHaveBeenCalled()
    expect(createRecipient).not.toHaveBeenCalled()
    expect(broadcastOnFailed).toHaveBeenCalledOnce()
    expect(broadcastOnFailed).toHaveBeenCalledWith([
      expect.objectContaining({
        errorData: { message: "Contact opted out of email" },
      }),
    ])
  })
})
