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

  test("treats a supplementary emoji ZZAP split into two question marks as the same send", () => {
    const stored = [
      "ℹ️ Вы совершили покупку в магазине gkamion.ru",
      "😊 Будем благодарны, если Вы поделитесь своими впечатлениями о работе нашей компании.",
      "📝 Свой отзыв можно оставить по ссылке:",
      "https://ya.cc/t/xm1Z8jJI9h4zr2",
      "‼️ Обмен / возврат деталей надлежащего качества возможен в течение 7 дней после даты поступления заказа в наш пункт выдачи заказов (ЗЗОПП Правила интернет ТОРГОВЛИ).",
      "ℹ️ С договором офертой можете ознакомится на нашем сайте:",
      "https://gkamion.ru/informatsionnaya/dogovor-oferty.html",
    ].join("\n")
    const echoed = [
      "? Вы совершили покупку в магазине gkamion.ru",
      "?? Будем благодарны, если Вы поделитесь своими впечатлениями о работе нашей компании.",
      "?? Свой отзыв можно оставить по ссылке:",
      "https://ya.cc/t/xm1Z8jJI9h4zr2",
      "!? Обмен / возврат деталей надлежащего качества возможен в течение 7 дней после даты поступления заказа в наш пункт выдачи заказов (ЗЗОПП Правила интернет ТОРГОВЛИ).",
      "?? С договором офертой можете ознакомится на нашем сайте:",
      "https://gkamion.ru/informatsionnaya/dogovor-oferty.html",
    ].join("\n")

    expect(isSameZzapHistoryEcho(stored, echoed)).toBe(true)
    expect(isSameZzapHistoryEcho("😊?", "???")).toBe(true)
    expect(isSameZzapHistoryEcho("😊?", "??")).toBe(true)
  })

  test("treats a diameter mark ZZAP stored as a plain O as the same send", () => {
    const stored = [
      "Поняла, менеджеру не передаю.",
      "",
      "У 60772 четыре выхода: два больших (Ø38 и Ø38,4) и два малых Ø18,3 мм внизу. Версия на три выхода, другая модификация с другим артикулом, так что дело может быть как раз в ней.",
      "",
      "Как разберётесь, напишите: восстановим заказ или подберём другой вариант.",
    ].join("\n")
    const echoed = [
      "?? Geka: Поняла, менеджеру не передаю.",
      "У 60772 четыре выхода: два больших (O38 и O38,4) и два малых O18,3 мм внизу. Версия на три выхода, другая модификация с другим артикулом, так что дело может быть как раз в ней.",
      "Как разберётесь, напишите: восстановим заказ или подберём другой вариант.",
    ].join("\n")

    expect(isSameZzapHistoryEcho(stored, echoed)).toBe(true)
    expect(isSameZzapHistoryEcho("Ø38", "O38")).toBe(true)
    expect(isSameZzapHistoryEcho("ø18", "o18")).toBe(true)
    expect(isSameZzapHistoryEcho("\u230038", "O38")).toBe(true)
    expect(isSameZzapHistoryEcho("\u220538", "O38")).toBe(true)
    expect(isSameZzapHistoryEcho("Ø38", "O39")).toBe(false)
  })

  test("treats a repeated space ZZAP collapsed as the same send", () => {
    const stored = [
      "ℹ  Вы совершили покупку в магазине gkamion.ru",
      "🤗 Будем благодарны, если Вы поделитесь своими впечатлениями.",
      "Телефон:  +74951337533 доб 1",
    ].join("\n")
    const echoed = [
      "? Вы совершили покупку в магазине gkamion.ru",
      "?? Будем благодарны, если Вы поделитесь своими впечатлениями.",
      "Телефон: +74951337533 доб 1",
    ].join("\n")

    expect(isSameZzapHistoryEcho(stored, echoed)).toBe(true)
    expect(
      isSameZzapHistoryEcho(
        "заказ №23580 лежит уже 2 дня",
        "заказ №24072 лежит уже 2 дня",
      ),
    ).toBe(false)
  })

  test("treats a multiplication sign ZZAP stored as a question mark as the same send", () => {
    expect(
      isSameZzapHistoryEcho(
        "Ядро 593×478×32 мм, алюминий.",
        "?? Гека: Ядро 593?478?32 мм, алюминий.",
      ),
    ).toBe(true)
    expect(isSameZzapHistoryEcho("593×478", "593x478")).toBe(false)
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
