import { describe, expect, test } from "vitest"
import {
  splitMaxText,
  toKeyboard,
} from "../src/handlers/message/to-max-messages"

describe("splitMaxText", () => {
  test("keeps short text as one chunk", () => {
    expect(splitMaxText("привет")).toEqual(["привет"])
  })

  test("splits at 4000 chars preferring a newline", () => {
    const first = `${"а".repeat(3990)}\n`
    const chunks = splitMaxText(`${first}${"б".repeat(20)}`)
    expect(chunks).toEqual([first.trimEnd(), "б".repeat(20)])
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(4000)
    }
  })
})

describe("toKeyboard", () => {
  test("rows of three, callback and link buttons", () => {
    const keyboard = toKeyboard([
      { type: "callback", text: "1", payload: "a" },
      { type: "callback", text: "2", payload: "b" },
      { type: "callback", text: "3", payload: "c" },
      { type: "link", text: "Сайт", url: "https://gkamion.ru" },
    ])
    expect(keyboard).toEqual({
      type: "inline_keyboard",
      payload: {
        buttons: [
          [
            { type: "callback", text: "1", payload: "a" },
            { type: "callback", text: "2", payload: "b" },
            { type: "callback", text: "3", payload: "c" },
          ],
          [{ type: "link", text: "Сайт", url: "https://gkamion.ru" }],
        ],
      },
    })
  })

  test("no buttons → no keyboard", () => {
    expect(toKeyboard([])).toBeUndefined()
  })
})
