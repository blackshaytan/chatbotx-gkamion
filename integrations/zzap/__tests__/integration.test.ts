import { describe, expect, test, vi } from "vitest"
import { ZzapAPIException } from "../src/exception"
import { integration, toZzapAuth } from "../src/integration"

const mocks = vi.hoisted(() => ({ listThreads: vi.fn() }))

vi.mock("../src/apis/threads", () => ({ listThreads: mocks.listThreads }))

const { connection } = integration

describe("ZZAP integration definition", () => {
  test("starts paused and polls at the configured interval", () => {
    expect(connection?.startsPaused).toBe(true)
    const auth = toZzapAuth({
      secretText: " key ",
      codeObject: "42",
      typeObject: "1",
    })
    expect(connection?.poll?.intervalSeconds(auth)).toBe(180)
  })

  test("applies defaults and floors the request interval", () => {
    expect(
      toZzapAuth({
        secretText: " key ",
        codeObject: " 42 ",
        typeObject: "1",
        maxThreadsPerPoll: 0,
        requestMinIntervalSeconds: 1,
      }),
    ).toEqual({
      authType: "secretText",
      secretText: "key",
      codeObject: "42",
      typeObject: "1",
      testMode: false,
      pollIntervalSeconds: 180,
      maxThreadsPerPoll: 1,
      requestMinIntervalSeconds: 3,
    })
  })

  test("fromCredentials probes the key and describes the shop", async () => {
    mocks.listThreads.mockResolvedValue([])
    const auth = await connection?.fromCredentials?.({
      secretText: "key",
      codeObject: "42",
      typeObject: "1",
    })
    expect(mocks.listThreads).toHaveBeenCalledWith(
      expect.objectContaining({ secretText: "key" }),
      { pageSize: 1 },
    )
    expect(auth && connection?.describe(auth)).toEqual({
      sourceId: "42",
      displayName: "ZZAP 42",
    })
  })

  test("fromCredentials rejects a refused key", async () => {
    mocks.listThreads.mockRejectedValue(new ZzapAPIException("bad key", 401))
    await expect(
      connection?.fromCredentials?.({
        secretText: "key",
        codeObject: "42",
        typeObject: "1",
      }),
    ).rejects.toThrow("bad key")
  })
})
