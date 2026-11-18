import { describe, expect, test, vi } from "vitest"
import {
  postVoiceEmailCallback,
  voiceEmailCallbackRequest,
} from "../src/integration/handlers/voice-email-callback"

const ready = {
  acceptedChannel: "smtp" as const,
  statusId: 13,
  orderId: "24790",
  url: "https://n8n.example/webhook/order_status_voice",
  secret: "s3cret",
}

describe("voiceEmailCallbackRequest", () => {
  test("posts only after smtp for status 13, 16, or 22", () => {
    const request = voiceEmailCallbackRequest(ready)
    expect(request?.url).toBe(ready.url)
    expect(JSON.parse(request?.body ?? "{}")).toEqual({
      order_id: 24790,
      status_id: 13,
      email_delivered: true,
    })
    expect(voiceEmailCallbackRequest({ ...ready, statusId: 16 })).not.toBeNull()
    expect(voiceEmailCallbackRequest({ ...ready, statusId: 22 })).not.toBeNull()
  })

  test("skips messenger, other statuses, and missing configuration", () => {
    expect(voiceEmailCallbackRequest({ ...ready, acceptedChannel: "telegram" })).toBeNull()
    expect(voiceEmailCallbackRequest({ ...ready, statusId: 7 })).toBeNull()
    expect(voiceEmailCallbackRequest({ ...ready, url: "" })).toBeNull()
    expect(voiceEmailCallbackRequest({ ...ready, secret: "  " })).toBeNull()
    expect(voiceEmailCallbackRequest({ ...ready, orderId: "" })).toBeNull()
  })
})

describe("postVoiceEmailCallback", () => {
  test("sends the secret in a header and swallows transport errors", async () => {
    const fetchImpl = vi.fn(async () => new Response("ok"))
    const request = voiceEmailCallbackRequest(ready)
    if (!request) throw new Error("expected request")
    await postVoiceEmailCallback(request, fetchImpl, () => {})
    expect(fetchImpl).toHaveBeenCalledOnce()
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit
    expect((init.headers as Record<string, string>)["X-Voice-Secret"]).toBe("s3cret")

    const onError = vi.fn()
    await postVoiceEmailCallback(
      request,
      vi.fn(async () => {
        throw new Error("down")
      }),
      onError,
    )
    expect(onError).toHaveBeenCalledOnce()

    const rejected = vi.fn()
    await postVoiceEmailCallback(
      request,
      vi.fn(async () => new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })),
      rejected,
    )
    expect(String(rejected.mock.calls[0]?.[0])).toContain("unauthorized")
  })
})
