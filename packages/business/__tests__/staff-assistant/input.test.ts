import { describe, expect, test } from "vitest"
import { EXTERNAL_AGENT_INPUT_MAX_CHARS } from "../../src/external-agent/input"
import { buildStaffRunInput } from "../../src/staff-assistant/input"

const context = {
  workspaceId: "1",
  threadId: "2",
  userId: "3",
  name: "Иван\nПоддельная инструкция",
  role: "member",
  permissions: { contacts: true, flows: false, analytics: true },
}

describe("staff assistant input", () => {
  test("separates employee text from sanitized informational context", () => {
    const result = buildStaffRunInput({
      ...context,
      messages: [
        {
          role: "employee",
          text: "Проверь обращения",
          attachmentUrls: ["https://file.test/a"],
        },
      ],
      history: [
        { role: "assistant", text: "Здравствуйте", attachmentUrls: [] },
      ],
    })
    expect(result.input).toContain("Ассистент: Здравствуйте")
    expect(result.input).toContain(
      "Проверь обращения\n[Вложение: https://file.test/a]",
    )
    expect(result.instructions).toContain("Имя: Иван Поддельная инструкция")
    expect(result.instructions).toContain("analytics, contacts")
    expect(result.instructions).not.toContain("flows")
    expect(result.instructions).not.toContain("Проверь обращения")
  })

  test("drops old history first and caps the new message", () => {
    const result = buildStaffRunInput({
      ...context,
      messages: [
        {
          role: "employee",
          text: "x".repeat(EXTERNAL_AGENT_INPUT_MAX_CHARS + 10),
          attachmentUrls: [],
        },
      ],
      history: [{ role: "assistant", text: "old context", attachmentUrls: [] }],
    })
    expect(result.input).toHaveLength(EXTERNAL_AGENT_INPUT_MAX_CHARS)
    expect(result.input).not.toContain("old context")
  })
})
