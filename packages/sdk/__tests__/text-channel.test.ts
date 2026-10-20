import type { ButtonStepProps } from "@chatbotx.io/flow-config"
import { describe, expect, test } from "vitest"
import type { SendFlowStepData } from "../src/lib/flow-step-data"
import {
  flowStepToTextOutgoing,
  fromFlowButton,
  messageToTextOutgoing,
  renderTextAndButtons,
  renderTextOutgoing,
  splitTextAtLines,
} from "../src/lib/shared/text-channel"

const LIMIT = 4000

const step = (value: Record<string, unknown>) =>
  value as unknown as SendFlowStepData

describe("renderTextOutgoing", () => {
  test("renders buttons as a numbered list under the text", () => {
    expect(
      renderTextOutgoing(
        {
          text: "Привет",
          buttons: [{ label: "Да" }, { label: "Сайт", url: "https://x.ru" }],
        },
        LIMIT,
      ),
    ).toEqual(["Привет\n\n1. Да\n2. Сайт: https://x.ru"])
  })

  test("renders media as links", () => {
    expect(
      renderTextOutgoing(
        {
          media: [
            { url: "https://cdn/a.jpg" },
            { url: "https://cdn/b.pdf", filename: "b.pdf" },
          ],
        },
        LIMIT,
      ),
    ).toEqual(["https://cdn/a.jpg\n\n📎 b.pdf\nhttps://cdn/b.pdf"])
  })

  test("returns nothing for an empty message", () => {
    expect(renderTextOutgoing({ text: "  " }, LIMIT)).toEqual([])
  })

  test("renderTextAndButtons leaves media out", () => {
    expect(
      renderTextAndButtons({ text: "Фото", buttons: [{ label: "Ок" }] }, LIMIT),
    ).toEqual(["Фото\n\n1. Ок"])
  })
})

describe("splitTextAtLines", () => {
  test("splits long text at line breaks within the limit", () => {
    const line = "x".repeat(LIMIT - 10)
    expect(splitTextAtLines(`${line}\n${line}`, LIMIT)).toEqual([line, line])
    expect(splitTextAtLines("y".repeat(LIMIT + 1), LIMIT)).toHaveLength(2)
  })
})

describe("buttons", () => {
  test("keeps website buttons' URL", () => {
    expect(
      fromFlowButton({
        label: "Каталог",
        buttonType: "openWebsite",
        beforeStep: { url: "https://shop.ru" },
      } as unknown as ButtonStepProps),
    ).toEqual({ label: "Каталог", url: "https://shop.ru" })
  })
})

describe("flowStepToTextOutgoing", () => {
  const replies = [
    { id: "q1", label: "Цена", buttonType: "postback" as const, postback: "p" },
  ]

  test("sendText adds quick replies after the step buttons", () => {
    expect(
      flowStepToTextOutgoing(
        step({
          stepType: "sendText",
          text: "Здравствуйте",
          buttons: [{ label: "Да", buttonType: "postback" }],
        }),
        replies,
      ),
    ).toEqual({
      text: "Здравствуйте",
      buttons: [{ label: "Да" }, { label: "Цена" }],
    })
  })

  test("sendImage and sendFile become media", () => {
    expect(
      flowStepToTextOutgoing(
        step({ stepType: "sendImage", url: "https://cdn/a.jpg" }),
      ),
    ).toEqual({ media: [{ url: "https://cdn/a.jpg" }], buttons: [] })
    expect(
      flowStepToTextOutgoing(
        step({ stepType: "sendFile", url: "https://cdn/b.pdf", buttons: [] }),
      ),
    ).toEqual({ media: [{ url: "https://cdn/b.pdf" }], buttons: [] })
  })

  test("sendQuickReply uses its message", () => {
    expect(
      flowStepToTextOutgoing(
        step({ stepType: "sendQuickReply", message: "Выберите", buttons: [] }),
      ),
    ).toEqual({ text: "Выберите", buttons: [] })
  })

  test("other steps are rejected", () => {
    expect(() =>
      flowStepToTextOutgoing(step({ stepType: "sendCarousel" })),
    ).toThrow("Unsupported text channel flow step: sendCarousel")
  })
})

describe("messageToTextOutgoing", () => {
  test("keeps attachments with a URL", () => {
    expect(
      messageToTextOutgoing({
        text: "Счёт",
        attachments: [{ url: "https://cdn/inv.pdf", name: "inv.pdf" }, {}],
      }),
    ).toEqual({
      text: "Счёт",
      media: [{ url: "https://cdn/inv.pdf", filename: "inv.pdf" }],
      buttons: [],
    })
  })
})
