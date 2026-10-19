import { HttpResponse, http, server } from "@chatbotx.io/vitest-config/msw"
import { describe, expect, test, vi } from "vitest"
import { getBuyer } from "../src/apis/buyers"
import { sendZzapMessage } from "../src/apis/messages"
import { listThreads } from "../src/apis/threads"
import { ZzapAPIException, ZzapRateLimitException } from "../src/exception"
import { isRevokedTokenError } from "../src/lib/error-mapper"
import { ZZAP_BASE, zzapAuth } from "./fixtures"

const OUTGOING_ID_PATTERN = /^zzap-out:/

vi.mock("../src/constants", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/constants")>()),
  ZZAP_MIN_REQUEST_INTERVAL_SECONDS: 0,
}))

describe("ZZAP http client", () => {
  test("sends the api key and object params", async () => {
    let seen: Request | undefined
    server.use(
      http.get(`${ZZAP_BASE}/messages`, ({ request }) => {
        seen = request
        return HttpResponse.json({
          success: true,
          result: { data: [{ user_key: "A" }] },
        })
      }),
    )
    await expect(listThreads(zzapAuth)).resolves.toEqual([{ user_key: "A" }])
    const url = new URL(seen?.url ?? "")
    expect(seen?.headers.get("zzap-api-key")).toBe("test-api-key")
    expect(url.searchParams.get("code_object")).toBe("42")
    expect(url.searchParams.get("type_object")).toBe("1")
  })

  test("retries a 429 and then succeeds", async () => {
    let calls = 0
    server.use(
      http.get(`${ZZAP_BASE}/messages`, () => {
        calls += 1
        return calls < 3
          ? new HttpResponse(null, { status: 429 })
          : HttpResponse.json({ success: true, result: { data: [] } })
      }),
    )
    await expect(listThreads(zzapAuth)).resolves.toEqual([])
    expect(calls).toBe(3)
  })

  test("gives up with ZzapRateLimitException after the retries", async () => {
    server.use(
      http.get(
        `${ZZAP_BASE}/messages`,
        () => new HttpResponse(null, { status: 429 }),
      ),
    )
    await expect(listThreads(zzapAuth)).rejects.toBeInstanceOf(
      ZzapRateLimitException,
    )
  })

  test("maps an error envelope to ZzapAPIException", async () => {
    server.use(
      http.get(`${ZZAP_BASE}/messages`, () =>
        HttpResponse.json(
          { success: false, errors: { error: "bad key" } },
          { status: 401 },
        ),
      ),
    )
    const error = await listThreads(zzapAuth).catch((err: unknown) => err)
    expect(error).toBeInstanceOf(ZzapAPIException)
    expect((error as ZzapAPIException).message).toBe("bad key")
    expect(isRevokedTokenError(error)).toBe(true)
  })

  test("treats success:false with HTTP 200 as an error", async () => {
    server.use(
      http.get(`${ZZAP_BASE}/messages`, () =>
        HttpResponse.json({ success: false, message: "denied" }),
      ),
    )
    await expect(listThreads(zzapAuth)).rejects.toThrow("denied")
  })

  test("posts a reply with test flag and Moscow message_date", async () => {
    let body: Record<string, unknown> = {}
    let url: URL | undefined
    server.use(
      http.post(`${ZZAP_BASE}/messages`, async ({ request }) => {
        url = new URL(request.url)
        body = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({ success: true, result: {} })
      }),
    )
    const result = await sendZzapMessage(
      { ...zzapAuth, testMode: true },
      {
        userKey: "A",
        text: "Здравствуйте",
        now: new Date("2026-10-19T07:00:00Z"),
      },
    )
    expect(body).toEqual({
      user_key: "A",
      message: "Здравствуйте",
      message_date: "2026-10-19T10:00:00",
      is_online: false,
    })
    expect(url?.searchParams.get("test")).toBe("true")
    expect(result.messageId).toMatch(OUTGOING_ID_PATTERN)
  })

  test("reads buyer contacts from snake or camel case", async () => {
    server.use(
      http.get(`${ZZAP_BASE}/user/A`, () =>
        HttpResponse.json({
          success: true,
          result: { classUser: "Иван", phone1: "+79990000000", email: "" },
        }),
      ),
    )
    await expect(getBuyer(zzapAuth, "A")).resolves.toEqual({
      name: "Иван",
      phone: "+79990000000",
      email: undefined,
    })
  })
})
