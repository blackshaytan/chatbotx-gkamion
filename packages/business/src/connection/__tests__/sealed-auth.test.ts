import { describe, expect, test } from "vitest"
import { isSealedAuth, openAuth, sealAuth } from "../sealed-auth"

const auth = {
  authType: "secretText" as const,
  secretText: "max-token",
  botId: "123",
  webhookSecret: "s3cret",
}

describe("sealed auth", () => {
  test("round-trips and hides the secret", async () => {
    const sealed = await sealAuth(auth)
    expect(isSealedAuth(sealed)).toBe(true)
    expect(JSON.stringify(sealed)).not.toContain("max-token")
    await expect(openAuth(sealed)).resolves.toEqual(auth)
  })

  test("passes plain auth through unchanged", async () => {
    await expect(openAuth(auth)).resolves.toEqual(auth)
    expect(isSealedAuth(auth)).toBe(false)
  })
})
