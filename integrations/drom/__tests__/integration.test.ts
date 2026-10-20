import { describe, expect, test, vi } from "vitest"
import { DromSessionExpiredException } from "../src/exception"
import { integration, toDromAuth } from "../src/integration"

const mocks = vi.hoisted(() => ({ getInboxConfig: vi.fn() }))

vi.mock("../src/apis/inbox", () => ({ getInboxConfig: mocks.getInboxConfig }))

const { connection } = integration
const COOKIES = JSON.stringify([{ name: "ring", value: "abc" }])

describe("DROM integration definition", () => {
  test("starts paused and polls at the configured interval", () => {
    expect(connection?.startsPaused).toBe(true)
    const auth = toDromAuth({ secretText: COOKIES, sellerLogin: "seller" })
    expect(connection?.poll?.intervalSeconds(auth)).toBe(30)
  })

  test("turns cookies into a header and clamps the settings", () => {
    expect(
      toDromAuth({
        secretText: COOKIES,
        sellerLogin: " seller ",
        pollIntervalSeconds: 5,
        maxDialogsPerPoll: 0,
        requestMinIntervalSeconds: -1,
      }),
    ).toEqual({
      authType: "secretText",
      secretText: "ring=abc",
      sellerLogin: "seller",
      pollIntervalSeconds: 15,
      maxDialogsPerPoll: 1,
      requestMinIntervalSeconds: 0,
    })
  })

  test("fromCredentials probes the cookies and describes the seller", async () => {
    mocks.getInboxConfig.mockResolvedValue({
      hasDialogs: true,
      unreadDialogs: 0,
    })
    const auth = await connection?.fromCredentials?.({
      secretText: COOKIES,
      sellerLogin: "seller",
    })
    expect(mocks.getInboxConfig).toHaveBeenCalledWith(
      expect.objectContaining({ secretText: "ring=abc" }),
    )
    expect(auth && connection?.describe(auth)).toEqual({
      sourceId: "seller",
      displayName: "DROM seller",
    })
  })

  test("fromCredentials rejects expired cookies and garbage", async () => {
    mocks.getInboxConfig.mockRejectedValue(
      new DromSessionExpiredException("DROM answered HTML instead of JSON"),
    )
    await expect(
      connection?.fromCredentials?.({ secretText: COOKIES, sellerLogin: "s" }),
    ).rejects.toBeInstanceOf(DromSessionExpiredException)
    await expect(
      connection?.fromCredentials?.({ secretText: "hello", sellerLogin: "s" }),
    ).rejects.toThrow("cookies")
  })

  test("expired cookies count as a revoked token", () => {
    expect(
      connection?.isRevokedTokenError?.(new DromSessionExpiredException("x")),
    ).toBe(true)
  })
})
