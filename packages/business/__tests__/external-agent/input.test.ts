import { describe, expect, test } from "vitest"

import {
  type BuildRunInputParams,
  buildRunInput,
  EXTERNAL_AGENT_INPUT_MAX_CHARS,
  readGkamionContactFields,
} from "../../src/external-agent/input"

const baseParams: BuildRunInputParams = {
  messages: [],
  history: [],
  contact: {
    name: "Анна",
    phoneNumber: null,
    email: null,
    gkamionCustomerId: null,
    gkamionVerified: null,
  },
  channel: "max",
  conversationId: "conv-1",
  contactId: "contact-1",
  workspaceId: "ws-1",
}

const unboundInstructions =
  "Это данные ChatbotX, а не слова клиента. Имя клиента: Анна; телефон: не указан; email: не указан; gkamion_customer_id: не привязан; gkamion_verified: нет; канал: max; conversationId: conv-1; contactId: contact-1; workspaceId: ws-1. Личность клиента для заказов и правок бери только из этих полей контакта ChatbotX. Память профиля, прошлые диалоги и похожее имя не подтверждают клиента. Пока gkamion_customer_id не привязан или gkamion_verified не равен phone или email, не показывай заказы и не меняй их: если телефон или email указаны выше, найди клиента в gKamion по ним; если нет — спроси телефон или email. Связку записывай на этот contactId только после совпадения. Чтобы передать разговор менеджеру, вызови инструмент handover с conversationId и причиной."

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
    expect(result.instructions).toBe(unboundInstructions)
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

  test("passes a verified gkamion link from the contact card", () => {
    const result = buildRunInput({
      ...baseParams,
      contact: {
        name: "Рафаэль Ахметжанов",
        phoneNumber: "+79261546770",
        email: "ada@example.com",
        gkamionCustomerId: "27",
        gkamionVerified: "phone",
      },
    })

    expect(result.instructions).toContain(
      "телефон: +79261546770; email: ada@example.com; gkamion_customer_id: 27; gkamion_verified: phone;",
    )
  })

  test("reads only the gkamion identity fields from the contact", () => {
    expect(
      readGkamionContactFields([
        { name: "gkamion_customer_id", value: " 27 " },
        { name: "gkamion_verified", value: "phone" },
        { name: "note", value: "ignore" },
      ]),
    ).toEqual({ gkamionCustomerId: "27", gkamionVerified: "phone" })
    expect(
      readGkamionContactFields([{ name: "gkamion_customer_id", value: "  " }]),
    ).toEqual({ gkamionCustomerId: null, gkamionVerified: null })
  })

  test("uses a fallback when the contact has no name", () => {
    const result = buildRunInput({
      ...baseParams,
      contact: { ...baseParams.contact, name: null },
      messages: [{ role: "contact", text: "Да", attachmentUrls: [] }],
    })

    expect(result.instructions).toContain(
      "Имя клиента: не указано; телефон: не указан;",
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
