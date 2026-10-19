import { describe, expect, test } from "vitest"
import { parseMaxUpdate } from "../src/handlers/parse-update"
import botStarted from "./fixtures/bot-started.json"
import callback from "./fixtures/callback.json"
import file from "./fixtures/message-file.json"
import fromBot from "./fixtures/message-from-bot.json"
import group from "./fixtures/message-group.json"
import image from "./fixtures/message-image.json"
import text from "./fixtures/message-text.json"

describe("parseMaxUpdate", () => {
  test("text message from a user", () => {
    expect(parseMaxUpdate(text)).toEqual({
      kind: "message",
      sourceId: "mid.1",
      contact: {
        sourceId: "555",
        firstName: "Иван",
        lastName: "Петров",
        locale: "ru",
      },
      text: "Есть ли поршень на КамАЗ?",
      media: [],
    })
  })

  test("image attachment becomes image media by URL", () => {
    const parsed = parseMaxUpdate(image)
    expect(parsed?.kind).toBe("message")
    expect(parsed && "media" in parsed ? parsed.media : []).toEqual([
      { kind: "image", url: "https://i.max.ru/p/1.jpg" },
    ])
  })

  test("file attachment keeps filename", () => {
    const parsed = parseMaxUpdate(file)
    expect(parsed && "media" in parsed ? parsed.media : []).toEqual([
      { kind: "file", url: "https://f.max.ru/1", filename: "счёт.pdf" },
    ])
  })

  test("bot and group traffic is skipped", () => {
    expect(parseMaxUpdate(fromBot)).toBeNull()
    expect(parseMaxUpdate(group)).toBeNull()
  })

  test("callback carries the button payload", () => {
    expect(parseMaxUpdate(callback)).toEqual({
      kind: "callback",
      sourceId: "cb.1",
      contact: { sourceId: "555", firstName: "Иван" },
      payload: "flow:abc:btn1",
    })
  })

  test("bot_started carries the start ref", () => {
    expect(parseMaxUpdate(botStarted)).toEqual({
      kind: "started",
      sourceId: "bot_started:555:1760700002000",
      contact: { sourceId: "555", firstName: "Иван" },
      ref: "ad42",
    })
  })

  test("unknown update types and malformed payloads are skipped", () => {
    expect(
      parseMaxUpdate({ update_type: "chat_title_changed", timestamp: 1 }),
    ).toBeNull()
    expect(parseMaxUpdate("not an update")).toBeNull()
  })
})
