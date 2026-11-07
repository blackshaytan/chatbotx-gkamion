import { describe, expect, test } from "vitest"
import {
  isChatbotXOutgoing,
  isSameZzapHistoryEcho,
} from "../zzap-history-echo"

describe("zzap history echo", () => {
  test("treats a ruble sign and dropped blank lines as the same send", () => {
    const stored = [
      "Здравствуйте, Кириллов Кирилл Валерьевич!",
      "",
      "Предоплата — 224 руб.",
      "",
      "Цена 7 855 ₽.",
    ].join("\n")
    const echoed = [
      "Здравствуйте, Кириллов Кирилл Валерьевич!",
      "Предоплата — 224 руб.",
      "Цена 7 855 ?.",
    ].join("\n")

    expect(isSameZzapHistoryEcho(stored, echoed)).toBe(true)
  })

  test("keeps a different seller reply", () => {
    expect(isSameZzapHistoryEcho("Заказ собран", "Заказ отменён")).toBe(false)
    expect(isSameZzapHistoryEcho("   ", " ")).toBe(false)
  })

  test("recognises ChatbotX sends and ignores an imported echo", () => {
    expect(isChatbotXOutgoing({ senderType: "bot", senderId: null })).toBe(
      true,
    )
    expect(
      isChatbotXOutgoing({ senderType: "user", senderId: "agent-1" }),
    ).toBe(true)
    expect(isChatbotXOutgoing({ senderType: "user", senderId: null })).toBe(
      false,
    )
  })
})
