import { beforeEach, describe, expect, test, vi } from "vitest"
import { resolveSignedMessage } from "../src/chat/lib/resolve-sender-signature"
import {
  applySenderSignature,
  isSignableMessage,
} from "../src/chat/lib/sender-signature"

const { mockGetRuntime, mockFindNameAndEmail, mockLoggerWarn } = vi.hoisted(
  () => ({
    mockGetRuntime: vi.fn(),
    mockFindNameAndEmail: vi.fn(),
    mockLoggerWarn: vi.fn(),
  }),
)

vi.mock("@chatbotx.io/business", () => ({
  externalAgentService: { getRuntime: mockGetRuntime },
  userService: { findNameAndEmail: mockFindNameAndEmail },
}))

vi.mock("../src/lib/logger", () => ({
  logger: { warn: mockLoggerWarn, error: vi.fn(), info: vi.fn() },
}))

const plainText = (text: string | null) => ({
  text,
  type: "message" as const,
  contentAttributes: null,
})

describe("isSignableMessage", () => {
  test("signs a plain text message", () => {
    expect(isSignableMessage(plainText("Здравствуйте"))).toBe(true)
  })

  test("skips an attachment-only message with no text", () => {
    expect(isSignableMessage(plainText(null))).toBe(false)
    expect(isSignableMessage(plainText(""))).toBe(false)
    expect(isSignableMessage(plainText("   "))).toBe(false)
  })

  test("skips comment replies, including private replies", () => {
    expect(
      isSignableMessage({
        text: "Спасибо!",
        type: "comment",
        contentAttributes: null,
      }),
    ).toBe(false)
    expect(
      isSignableMessage({
        text: "Напишите в директ",
        type: "comment",
        contentAttributes: { isPrivateReply: true },
      }),
    ).toBe(false)
  })

  test("skips a channel template", () => {
    expect(
      isSignableMessage({
        text: "Ваш заказ готов",
        type: "message",
        contentAttributes: { type: "template" },
      }),
    ).toBe(false)
  })
})

describe("applySenderSignature", () => {
  test("prefixes the text with the name", () => {
    expect(applySenderSignature("Привет", "Гека")).toBe("Гека: Привет")
  })

  test("returns the text unchanged for a missing or blank name", () => {
    expect(applySenderSignature("Привет", null)).toBe("Привет")
    expect(applySenderSignature("Привет", undefined)).toBe("Привет")
    expect(applySenderSignature("Привет", "   ")).toBe("Привет")
  })

  test("collapses line breaks and runs of spaces in the name", () => {
    expect(applySenderSignature("Привет", " Анна\n  Петрова ")).toBe(
      "Анна Петрова: Привет",
    )
  })

  test("keeps the text itself untouched", () => {
    expect(applySenderSignature("  строка\nвторая  ", "Гека")).toBe(
      "Гека:   строка\nвторая  ",
    )
  })
})

const agentRuntime = (
  overrides: { signMessages?: boolean; botName?: string | null } = {},
) => ({
  agent: {
    signMessages: overrides.signMessages ?? true,
    botName: overrides.botName === undefined ? "Гека" : overrides.botName,
  },
  client: {},
})

const botMessage = {
  id: "msg-1",
  text: "Ответ агента",
  type: "message" as const,
  contentAttributes: null,
  senderType: "bot",
  senderId: null,
}

const managerMessage = {
  ...botMessage,
  senderType: "user",
  senderId: "user-1",
}

const input = {
  workspaceId: "ws-1",
  inboxId: "inbox-1",
}

describe("resolveSignedMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetRuntime.mockResolvedValue(agentRuntime())
    mockFindNameAndEmail.mockResolvedValue({
      name: "Анна",
      email: "anna@example.com",
    })
  })

  test("prefixes an agent reply with the bot name", async () => {
    const result = await resolveSignedMessage({
      ...input,
      message: botMessage,
      signAs: "externalAgent",
    })

    expect(result.text).toBe("Гека: Ответ агента")
    expect(mockGetRuntime).toHaveBeenCalledWith(input)
  })

  test("prefixes a manager reply with the manager's name", async () => {
    const result = await resolveSignedMessage({
      ...input,
      message: managerMessage,
    })

    expect(result.text).toBe("Анна: Ответ агента")
    expect(mockFindNameAndEmail).toHaveBeenCalledWith("user-1")
  })

  test("returns the same message object when the name resolves to nothing", async () => {
    mockFindNameAndEmail.mockResolvedValue({ name: null, email: null })

    const result = await resolveSignedMessage({
      ...input,
      message: managerMessage,
    })

    expect(result).toBe(managerMessage)
  })

  test("does not change the original message", async () => {
    await resolveSignedMessage({
      ...input,
      message: managerMessage,
    })

    expect(managerMessage.text).toBe("Ответ агента")
  })

  test("an agent without a bot name sends the agent reply unsigned", async () => {
    mockGetRuntime.mockResolvedValue(agentRuntime({ botName: null }))

    const result = await resolveSignedMessage({
      ...input,
      message: botMessage,
      signAs: "externalAgent",
    })

    expect(result).toBe(botMessage)
  })

  test("a manager without a name sends the reply unsigned", async () => {
    mockFindNameAndEmail.mockResolvedValue({
      name: "",
      email: "anna@example.com",
    })

    const result = await resolveSignedMessage({
      ...input,
      message: managerMessage,
    })

    expect(result).toBe(managerMessage)
  })

  test("a manager whose profile is missing sends the reply unsigned", async () => {
    mockFindNameAndEmail.mockResolvedValue(undefined)

    const result = await resolveSignedMessage({
      ...input,
      message: managerMessage,
    })

    expect(result).toBe(managerMessage)
  })

  test("nothing is signed when the agent's signMessages setting is off", async () => {
    mockGetRuntime.mockResolvedValue(agentRuntime({ signMessages: false }))

    const agentResult = await resolveSignedMessage({
      ...input,
      message: botMessage,
      signAs: "externalAgent",
    })
    const managerResult = await resolveSignedMessage({
      ...input,
      message: managerMessage,
    })

    expect(agentResult).toBe(botMessage)
    expect(managerResult).toBe(managerMessage)
  })

  test("inboxes without an enabled agent are never signed", async () => {
    mockGetRuntime.mockResolvedValue(null)

    const result = await resolveSignedMessage({
      ...input,
      message: managerMessage,
    })

    expect(result).toBe(managerMessage)
    expect(mockFindNameAndEmail).not.toHaveBeenCalled()
  })

  test("flow-step bot messages are never signed", async () => {
    const result = await resolveSignedMessage({
      ...input,
      message: botMessage,
    })

    expect(result).toBe(botMessage)
    expect(mockGetRuntime).not.toHaveBeenCalled()
  })

  test("agent-API messages are never signed", async () => {
    const result = await resolveSignedMessage({
      ...input,
      message: { ...botMessage, senderType: "api" },
    })

    expect(result.text).toBe("Ответ агента")
    expect(mockGetRuntime).not.toHaveBeenCalled()
  })

  test("public comment replies are never signed", async () => {
    const result = await resolveSignedMessage({
      ...input,
      message: { ...managerMessage, type: "comment" },
    })

    expect(result.text).toBe("Ответ агента")
    expect(mockGetRuntime).not.toHaveBeenCalled()
  })

  test("attachment-only messages are never signed", async () => {
    const result = await resolveSignedMessage({
      ...input,
      message: { ...managerMessage, text: null },
    })

    expect(result.text).toBeNull()
    expect(mockGetRuntime).not.toHaveBeenCalled()
  })

  test("a failed lookup sends the text unsigned and logs the reason", async () => {
    const failure = new Error("db down")
    mockGetRuntime.mockRejectedValue(failure)

    const result = await resolveSignedMessage({
      ...input,
      message: managerMessage,
    })

    expect(result).toBe(managerMessage)
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      {
        err: failure,
        workspaceId: "ws-1",
        inboxId: "inbox-1",
        senderType: "user",
      },
      "Sender signature skipped: unable to resolve the sender name",
    )
  })
})
