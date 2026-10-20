import { describe, expect, test } from "vitest"
import { toCookieHeader } from "../src/lib/cookies"

describe("toCookieHeader", () => {
  test("Cookie-Editor JSON array", () => {
    expect(
      toCookieHeader(
        JSON.stringify([
          { name: "ring", value: "abc", domain: ".drom.ru" },
          { name: "boobs", value: "x y", domain: ".drom.ru" },
          { name: "", value: "skip" },
        ]),
      ),
    ).toBe("ring=abc; boobs=x y")
  })

  test("Playwright storage state", () => {
    expect(
      toCookieHeader(JSON.stringify({ cookies: [{ name: "a", value: "1" }] })),
    ).toBe("a=1")
  })

  test("raw Cookie header passes through trimmed", () => {
    expect(toCookieHeader("  a=1; b=2 ")).toBe("a=1; b=2")
  })

  test("garbage is rejected", () => {
    expect(() => toCookieHeader("[]")).toThrow("cookies")
    expect(() => toCookieHeader("hello")).toThrow("cookies")
    expect(() => toCookieHeader("{not json")).toThrow("cookies")
    expect(() => toCookieHeader("null")).toThrow("cookies")
  })
})
