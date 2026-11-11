import { describe, expect, test } from "vitest"
import { buildDromContextInstructions } from "../src/external-agent/drom-context"

const contactMessage = (dromContext: unknown) => ({
  role: "contact",
  contentAttributes: { dromContext },
})

describe("buildDromContextInstructions", () => {
  test("carries the shop's own dialog lines as history data", () => {
    const text = buildDromContextInstructions("drom", [
      contactMessage({
        dialogId: "1983180936",
        deal: null,
        listing: {
          title: "Мотор стеклоподъёмника BMW 1 (E81)/(E87) Meatdoria",
          url: "https://baza.drom.ru/x.html",
          price: 5928,
        },
        history: [
          { direction: "in", time: "14:15", text: "подойдёт?" },
          {
            direction: "out",
            time: "15:52",
            text: "5 928 р., под заказ 3 дня",
          },
        ],
      }),
    ])
    expect(text).toContain("История диалога ДРОМ")
    expect(text).toContain("клиент 14:15: подойдёт?")
    expect(text).toContain("магазин 15:52: 5 928 р., под заказ 3 дня")
    expect(text).toContain('"price":5928')
  })

  test("omits the history block when the event carries none", () => {
    const text = buildDromContextInstructions("drom", [
      contactMessage({ dialogId: "1", deal: null, listing: null }),
    ])
    expect(text).not.toContain("История диалога ДРОМ")
  })

  test("other channels get no DROM block", () => {
    expect(buildDromContextInstructions("telegram", [])).toBe("")
  })
})
