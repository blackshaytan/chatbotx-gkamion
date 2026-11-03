import { voiceAgentService } from "@chatbotx.io/business"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { applyVoiceOptOut } from "../src/integration/handlers/voice-opt-out"

vi.mock("@chatbotx.io/business", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@chatbotx.io/business")>()
  return {
    ...actual,
    voiceAgentService: {
      ...actual.voiceAgentService,
      setAiCallOptOut: vi.fn(),
    },
  }
})

describe("applyVoiceOptOut", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  it("входящее с фразой ставит флаг clientChat", async () => {
    const result = await applyVoiceOptOut({
      workspaceId: "1",
      contactId: "a",
      messageType: "incoming",
      text: "Больше не звоните",
      senderIsContact: true,
    })

    expect(result.optedOut).toBe(true)
    expect(voiceAgentService.setAiCallOptOut).toHaveBeenCalledWith({
      workspaceId: "1",
      contactId: "a",
      source: "clientChat",
      reason: "Больше не звоните",
    })
  })

  it.each([
    ["outgoing", "не звоните мне", true],
    ["incoming", "спасибо", true],
    ["incoming", "не звоните мне", false],
    ["incoming", null, true],
  ])("не ставит: %s / %s / contact=%s", async (messageType, text, senderIsContact) => {
    const result = await applyVoiceOptOut({
      workspaceId: "1",
      contactId: "a",
      messageType,
      text,
      senderIsContact,
    })

    expect(result).toEqual({ optedOut: false })
    expect(voiceAgentService.setAiCallOptOut).not.toHaveBeenCalled()
  })

  it("ошибка сервиса не роняет обработку сообщения", async () => {
    ;(
      voiceAgentService.setAiCallOptOut as ReturnType<typeof vi.fn>
    ).mockRejectedValueOnce(new Error("db down"))

    const result = await applyVoiceOptOut({
      workspaceId: "1",
      contactId: "a",
      messageType: "incoming",
      text: "не звоните мне",
      senderIsContact: true,
    })

    expect(result).toEqual({ optedOut: false })
  })
})
