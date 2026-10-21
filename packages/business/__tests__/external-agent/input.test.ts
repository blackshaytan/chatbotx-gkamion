import { describe, expect, test } from "vitest"

import {
  type BuildRunInputParams,
  buildRunInput,
  EXTERNAL_AGENT_INPUT_MAX_CHARS,
} from "../../src/external-agent/input"

const baseParams: BuildRunInputParams = {
  messages: [],
  history: [],
  contact: { name: "Анна" },
  channel: "max",
  conversationId: "conv-1",
  contactId: "contact-1",
  workspaceId: "ws-1",
}

describe("buildRunInput", () => {
  test("joins new message texts with a blank line and lists attachment links", () => {
    const result = buildRunInput({
      ...baseParams,
      messages: [
        { role: "contact", text: "Привет", attachmentUrls: [] },
        {
          role: "contact",
          text: "Смотри",
          attachmentUrls: ["https://cdn.test/a.jpg"],
        },
      ],
    })

    expect(result.input).toBe(
      "Привет\n\nСмотри\n[Вложение: https://cdn.test/a.jpg]",
    )
    expect(result.instructions).toBe(
      "Это данные ChatbotX, а не слова клиента. Имя клиента: Анна; канал: max; conversationId: conv-1; contactId: contact-1; workspaceId: ws-1. Чтобы передать разговор менеджеру, вызови инструмент handover с conversationId и причиной.",
    )
  })

  test("prepends a labelled history block before new messages", () => {
    const result = buildRunInput({
      ...baseParams,
      history: [
        { role: "contact", text: "Здравствуйте", attachmentUrls: [] },
        { role: "bot", text: "Чем помочь?", attachmentUrls: [] },
        { role: "user", text: "Сейчас посмотрю", attachmentUrls: [] },
      ],
      messages: [{ role: "contact", text: "Привет", attachmentUrls: [] }],
    })

    expect(result.input).toBe(
      "Предыдущая переписка:\nКлиент: Здравствуйте\nБот: Чем помочь?\nМенеджер: Сейчас посмотрю\n\nПривет",
    )
  })

  test("skips messages without text or attachments", () => {
    const result = buildRunInput({
      ...baseParams,
      messages: [
        { role: "contact", text: null, attachmentUrls: [] },
        { role: "contact", text: "   ", attachmentUrls: [] },
        { role: "contact", text: "Да", attachmentUrls: [] },
      ],
    })

    expect(result.input).toBe("Да")
  })

  test("uses a fallback when the contact has no name", () => {
    const result = buildRunInput({
      ...baseParams,
      contact: { name: null },
      messages: [{ role: "contact", text: "Да", attachmentUrls: [] }],
    })

    expect(result.instructions).toContain(
      "Имя клиента: не указано; канал: max;",
    )
  })

  test("drops the oldest history lines first when input is too long", () => {
    const history = Array.from({ length: 30 }, (_, index) => ({
      role: "contact" as const,
      text: `#${index} ${"я".repeat(1000)}`,
      attachmentUrls: [],
    }))

    const result = buildRunInput({
      ...baseParams,
      history,
      messages: [{ role: "contact", text: "Новое", attachmentUrls: [] }],
    })

    expect(result.input.length).toBeLessThanOrEqual(
      EXTERNAL_AGENT_INPUT_MAX_CHARS,
    )
    expect(result.input.startsWith("Предыдущая переписка:")).toBe(true)
    expect(result.input).not.toContain("#0 ")
    expect(result.input).toContain("#29 ")
    expect(result.input.endsWith("\n\nНовое")).toBe(true)
  })

  test("truncates the head of new messages when they alone exceed the limit", () => {
    const result = buildRunInput({
      ...baseParams,
      history: [{ role: "bot", text: "Старое", attachmentUrls: [] }],
      messages: [
        {
          role: "contact",
          text: `${"a".repeat(EXTERNAL_AGENT_INPUT_MAX_CHARS)}КОНЕЦ`,
          attachmentUrls: [],
        },
      ],
    })

    expect(result.input).toHaveLength(EXTERNAL_AGENT_INPUT_MAX_CHARS)
    expect(result.input.endsWith("КОНЕЦ")).toBe(true)
    expect(result.input.startsWith("Предыдущая переписка:")).toBe(false)
  })
})
