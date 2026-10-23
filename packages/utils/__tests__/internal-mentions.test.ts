import { describe, expect, test } from "vitest"
import {
  parseInternalMentions,
  splitInternalMentionText,
} from "../src/internal-mentions"

describe("parseInternalMentions", () => {
  test("empty text yields no ids", () => {
    expect(parseInternalMentions("")).toEqual({ userIds: [], teamIds: [] })
    expect(parseInternalMentions("hello")).toEqual({
      userIds: [],
      teamIds: [],
    })
  })

  test("parses users and teams in appearance order, deduped", () => {
    const text =
      "Hi @[Alice](user:12) and @[Sales](team:3), again @[Alice](user:12)"
    expect(parseInternalMentions(text)).toEqual({
      userIds: ["12"],
      teamIds: ["3"],
    })
  })

  test("ignores malformed tokens", () => {
    expect(parseInternalMentions("@[a](user:abc) @[x](team:2)")).toEqual({
      userIds: [],
      teamIds: ["2"],
    })
  })

  test("does not match mentions split across lines", () => {
    expect(parseInternalMentions("@[Bob](user:\n5)")).toEqual({
      userIds: [],
      teamIds: [],
    })
  })
})

describe("splitInternalMentionText", () => {
  test("plain text only", () => {
    expect(splitInternalMentionText("hello")).toEqual([
      { type: "text", text: "hello" },
    ])
  })

  test("interleaved text and mentions", () => {
    expect(
      splitInternalMentionText("Hi @[Alice](user:1)! @[Team](team:2)"),
    ).toEqual([
      { type: "text", text: "Hi " },
      { type: "mention", kind: "user", id: "1", label: "Alice" },
      { type: "text", text: "! " },
      { type: "mention", kind: "team", id: "2", label: "Team" },
    ])
  })
})
