import { describe, expect, test } from "vitest"
import {
  canCreateTaskFromMessage,
  toMarkdownQuote,
} from "@/features/tasks/lib/message-quote"

const TRAILING_WHITESPACE_PATTERN = /\s$/

describe("toMarkdownQuote", () => {
  test("quotes a single line", () => {
    expect(toMarkdownQuote("Hello")).toBe("> Hello")
  })

  test("quotes multiple lines and preserves empty lines", () => {
    expect(toMarkdownQuote("a\n\nb")).toBe("> a\n>\n> b")
  })

  test("normalizes CRLF line endings", () => {
    expect(toMarkdownQuote("a\r\nb")).toBe("> a\n> b")
  })

  test.each(["", "   ", "\n\t"])("returns empty for blank text", (text) => {
    expect(toMarkdownQuote(text)).toBe("")
  })

  test("truncates to the requested length without trailing whitespace", () => {
    const result = toMarkdownQuote("a\n\nb", 6)

    expect(result.length).toBeLessThanOrEqual(6)
    expect(result).not.toMatch(TRAILING_WHITESPACE_PATTERN)
    expect(result).toBe("> a\n>")
  })

  test("preserves Russian text", () => {
    expect(toMarkdownQuote("Привет\nмир")).toBe("> Привет\n> мир")
  })
})

describe("canCreateTaskFromMessage", () => {
  test("allows an undeleted incoming message", () => {
    expect(
      canCreateTaskFromMessage({
        messageType: "incoming",
        deletedAt: null,
      }),
    ).toBe(true)
  })

  test.each([
    "outgoing",
    "activity",
    "system",
  ])("rejects %s messages", (messageType) => {
    expect(
      canCreateTaskFromMessage({
        messageType,
        deletedAt: null,
      }),
    ).toBe(false)
  })

  test("rejects deleted incoming messages", () => {
    expect(
      canCreateTaskFromMessage({
        messageType: "incoming",
        deletedAt: new Date(),
      }),
    ).toBe(false)
  })
})
