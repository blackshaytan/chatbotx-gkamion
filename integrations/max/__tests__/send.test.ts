import { HttpResponse, http, server } from "@chatbotx.io/vitest-config/msw"
import { afterEach, describe, expect, test, vi } from "vitest"
import { MAX_API_BASE_URL } from "../src/constants"
import { deliverMaxOutgoing } from "../src/handlers/message/outgoing-message"

const MESSAGES_URL = `${MAX_API_BASE_URL}messages`
const UPLOADS_URL = `${MAX_API_BASE_URL}uploads`
const UPLOAD_TARGET = "https://upload.max.test/u"

type CapturedRequest = {
  userId: string | null
  authorization: string | null
  body: unknown
}

const captureMessages = (
  responses: (() => Response)[] = [],
): CapturedRequest[] => {
  const captured: CapturedRequest[] = []
  server.use(
    http.post(MESSAGES_URL, async ({ request }) => {
      captured.push({
        userId: new URL(request.url).searchParams.get("user_id"),
        authorization: request.headers.get("Authorization"),
        body: await request.json(),
      })
      const next = responses.shift()
      return next
        ? next()
        : HttpResponse.json({ message: { body: { mid: "m1" } } })
    }),
  )
  return captured
}

const mockVideoUpload = (): string[] => {
  const uploadTypes: string[] = []
  server.use(
    http.post(UPLOADS_URL, ({ request }) => {
      uploadTypes.push(new URL(request.url).searchParams.get("type") ?? "")
      return HttpResponse.json({ url: UPLOAD_TARGET, token: "vt" })
    }),
    http.post(UPLOAD_TARGET, () => HttpResponse.json({})),
    http.get("https://cdn.test/v.mp4", () =>
      HttpResponse.arrayBuffer(new Uint8Array([1, 2, 3]).buffer),
    ),
  )
  return uploadTypes
}

afterEach(() => {
  vi.useRealTimers()
})

describe("deliverMaxOutgoing", () => {
  test("sends text with an inline keyboard to the user", async () => {
    const captured = captureMessages()

    const ids = await deliverMaxOutgoing({
      token: "t",
      userId: "555",
      outgoing: {
        text: "hi",
        buttons: [{ type: "callback", text: "Да", payload: "y" }],
      },
    })

    expect(ids).toEqual(["m1"])
    expect(captured).toEqual([
      {
        userId: "555",
        authorization: "t",
        body: {
          text: "hi",
          attachments: [
            {
              type: "inline_keyboard",
              payload: {
                buttons: [[{ type: "callback", text: "Да", payload: "y" }]],
              },
            },
          ],
        },
      },
    ])
  })

  test("uploads a video before sending it by token", async () => {
    const uploadTypes = mockVideoUpload()
    const captured = captureMessages()

    await deliverMaxOutgoing({
      token: "t",
      userId: "555",
      outgoing: { media: [{ kind: "video", url: "https://cdn.test/v.mp4" }] },
    })

    expect(uploadTypes).toEqual(["video"])
    expect(captured[0]?.body).toEqual({
      attachments: [{ type: "video", payload: { token: "vt" } }],
    })
  })

  test("retries while the uploaded attachment is not ready", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] })
    const captured = captureMessages([
      () =>
        HttpResponse.json(
          { code: "attachment.not.ready", message: "Not ready" },
          { status: 400 },
        ),
    ])

    const pending = deliverMaxOutgoing({
      token: "t",
      userId: "555",
      outgoing: { text: "hi" },
    })
    await vi.advanceTimersByTimeAsync(1000)

    await expect(pending).resolves.toEqual(["m1"])
    expect(captured).toHaveLength(2)
  })

  test("sends a file separately from images", async () => {
    const captured = captureMessages()
    server.use(
      http.post(UPLOADS_URL, () => HttpResponse.json({ url: UPLOAD_TARGET })),
      http.post(UPLOAD_TARGET, () => HttpResponse.json({ token: "ft" })),
      http.get("https://cdn.test/a.pdf", () =>
        HttpResponse.arrayBuffer(new Uint8Array([1]).buffer),
      ),
    )

    const ids = await deliverMaxOutgoing({
      token: "t",
      userId: "555",
      outgoing: {
        text: "docs",
        media: [
          { kind: "image", url: "https://cdn.test/p.jpg" },
          { kind: "file", url: "https://cdn.test/a.pdf", filename: "a.pdf" },
        ],
      },
    })

    expect(ids).toEqual(["m1", "m1"])
    expect(captured.map((request) => request.body)).toEqual([
      {
        attachments: [
          { type: "image", payload: { url: "https://cdn.test/p.jpg" } },
        ],
      },
      {
        text: "docs",
        attachments: [{ type: "file", payload: { token: "ft" } }],
      },
    ])
  })
})
