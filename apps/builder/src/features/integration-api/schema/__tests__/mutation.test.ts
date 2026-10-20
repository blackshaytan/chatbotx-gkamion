import { describe, expect, it } from "vitest"
import { createApiRequest, updateApiRequest } from "../mutation"

describe("API channel mutation schemas", () => {
  it("treats an empty callback URL as no callback URL", () => {
    expect(
      createApiRequest.parse({ name: "GKamion", callbackUrl: "" }),
    ).toEqual({ name: "GKamion", callbackUrl: null })
    expect(updateApiRequest.parse({ callbackUrl: "" })).toEqual({
      callbackUrl: null,
    })
  })

  it("keeps a valid URL and leaves an omitted one untouched", () => {
    expect(
      createApiRequest.parse({
        name: "GKamion",
        callbackUrl: "https://example.com/hook",
      }).callbackUrl,
    ).toBe("https://example.com/hook")
    expect(updateApiRequest.parse({ name: "x" })).toEqual({ name: "x" })
  })

  it("still rejects a malformed URL", () => {
    expect(
      createApiRequest.safeParse({ name: "GKamion", callbackUrl: "not a url" })
        .success,
    ).toBe(false)
  })
})
