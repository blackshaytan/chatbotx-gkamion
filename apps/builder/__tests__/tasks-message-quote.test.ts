import { describe, expect, test } from "vitest"
import {
  canCreateTaskFromChatMessage,
  canCreateTaskFromMessage,
  toMarkdownQuote,
  toTaskDescriptionFromChatMessage,
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
    expect(result).toBe("> a")
  })

  test("preserves Russian text", () => {
    expect(toMarkdownQuote("Привет\nмир")).toBe("> Привет\n> мир")
  })
})

describe("toTaskDescriptionFromChatMessage", () => {
  test("adds a quote and attribution within the description limit", () => {
    expect(
      toTaskDescriptionFromChatMessage({
        author: "Ada",
        date: "Oct 28, 2026, 12:00 PM",
        text: "Follow up with the customer",
      }),
    ).toBe("> Follow up with the customer\n\n— Ada, Oct 28, 2026, 12:00 PM")
  })

  test("keeps attribution when an attachment-only message has no text", () => {
    expect(
      toTaskDescriptionFromChatMessage({
        author: "Ada",
        date: "Oct 28",
        text: "",
      }),
    ).toBe("— Ada, Oct 28")
  })

  test("truncates the quote before its attribution", () => {
    const result = toTaskDescriptionFromChatMessage({
      author: "Ada",
      date: "Oct 28",
      maxLength: 20,
      text: "A message that is too long",
    })

    expect(result).toBe("> A m\n\n— Ada, Oct 28")
    expect(result).toHaveLength(20)
  })

  test("keeps the attribution within the limit when no quote separator fits", () => {
    expect(
      toTaskDescriptionFromChatMessage({
        author: "Ada",
        date: "Oct 28",
        maxLength: 14,
        text: "A message that is too long",
      }),
    ).toBe("— Ada, Oct 28")
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

  test("allows an incoming message without deletedAt", () => {
    expect(
      canCreateTaskFromMessage({
        messageType: "incoming",
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

describe("canCreateTaskFromChatMessage", () => {
  test("allows an undeleted chat comment", () => {
    expect(
      canCreateTaskFromChatMessage({ deleted: false, kind: "comment" }),
    ).toBe(true)
  })

  test.each([
    { deleted: true, kind: "comment" as const },
    { deleted: false, kind: "system" as const },
  ])("rejects unavailable chat messages", (message) => {
    expect(canCreateTaskFromChatMessage(message)).toBe(false)
  })
})
