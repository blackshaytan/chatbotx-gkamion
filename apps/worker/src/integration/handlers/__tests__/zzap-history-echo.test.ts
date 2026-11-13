import { describe, expect, test } from "vitest"
import { isChatbotXOutgoing, isSameZzapHistoryEcho } from "../zzap-history-echo"

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

  test("treats a sender signature on the ZZAP echo as the same send", () => {
    const stored = [
      "Здравствуйте, Антон Алексеевич! Да, подбор идёт.",
      "",
      "Точную сверку могу сделать по VIN.",
    ].join("\n")
    const echoed = [
      "?? Гека: Здравствуйте, Антон Алексеевич! Да, подбор идёт.",
      "Точную сверку могу сделать по VIN.",
    ].join("\n")

    expect(isSameZzapHistoryEcho(stored, echoed)).toBe(true)
    expect(isSameZzapHistoryEcho(stored, `Гека: ${stored}`)).toBe(true)
    expect(isSameZzapHistoryEcho(stored, `Анна Петрова: ${stored}`)).toBe(true)
  })

  test("treats emoji ZZAP replaced with question marks as the same send", () => {
    const stored = [
      "✅ Ваш заказ отправлен на сборку.",
      "‼️Остаток оплаты *НАЛИЧНЫМИ*. Оплаты по картам и переводы с карты на карту не принимаем!!!",
      "⏰Ожидайте сообщение о готовности заказа к выдаче!",
    ].join("\n")
    const echoed = [
      "? Ваш заказ отправлен на сборку.",
      "!?Остаток оплаты *НАЛИЧНЫМИ*. Оплаты по картам и переводы с карты на карту не принимаем!!!",
      "?Ожидайте сообщение о готовности заказа к выдаче!",
    ].join("\n")

    expect(isSameZzapHistoryEcho(stored, echoed)).toBe(true)
    expect(isSameZzapHistoryEcho(stored, `?? Гека: ${echoed}`)).toBe(true)
  })

  test("does not treat a different reply that starts with a name as the same send", () => {
    expect(
      isSameZzapHistoryEcho(
        "Здравствуйте, Антон Алексеевич!",
        "Гека: Заказ отменён",
      ),
    ).toBe(false)
    expect(isSameZzapHistoryEcho("58", "ответ магазина 11:58")).toBe(false)
    expect(isSameZzapHistoryEcho("привет", "привет ещё раз")).toBe(false)
    expect(isSameZzapHistoryEcho("Срок: 2 дня", "2 дня")).toBe(false)
    expect(isSameZzapHistoryEcho("Готово?", "Готово")).toBe(false)
    expect(isSameZzapHistoryEcho("✅ Заказ собран.", "? Заказ отменён.")).toBe(
      false,
    )
  })

  test("recognises ChatbotX sends and ignores an imported echo", () => {
    expect(isChatbotXOutgoing({ senderType: "bot", senderId: null })).toBe(true)
    expect(
      isChatbotXOutgoing({ senderType: "user", senderId: "agent-1" }),
    ).toBe(true)
    expect(isChatbotXOutgoing({ senderType: "user", senderId: null })).toBe(
      false,
    )
  })
})
