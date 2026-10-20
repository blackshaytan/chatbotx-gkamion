import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ getMe: vi.fn() }))

vi.mock("../src/apis/bot", () => ({
  getMe: mocks.getMe,
  sendTypingOn: vi.fn(),
}))

import { resolveMaxAuth } from "../src/integration"

const HEX_SECRET = /^[0-9a-f]{48}$/

beforeEach(() => {
  mocks.getMe.mockReset()
  mocks.getMe.mockResolvedValue({ user_id: 42, username: "geka_bot" })
})

describe("resolveMaxAuth", () => {
  it("builds the auth from GET /me and keeps a given webhook secret", async () => {
    await expect(
      resolveMaxAuth({ secretText: "token", webhookSecret: "hook" }),
    ).resolves.toEqual({
      authType: "secretText",
      secretText: "token",
      botId: "42",
      botName: "@geka_bot",
      webhookSecret: "hook",
    })
    expect(mocks.getMe).toHaveBeenCalledWith("token")
  })

  it("mints a random webhook secret and falls back to the bot name", async () => {
    mocks.getMe.mockResolvedValue({ user_id: 7, name: "Гека" })

    const auth = await resolveMaxAuth({ secretText: "token" })

    expect(auth.botName).toBe("Гека")
    expect(auth.webhookSecret).toMatch(HEX_SECRET)
  })
})
