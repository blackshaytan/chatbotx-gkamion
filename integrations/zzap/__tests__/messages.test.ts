import type { Context, MessageHandlers } from "@chatbotx.io/sdk"
import { ChannelError } from "@chatbotx.io/sdk"
import { HttpResponse, http, server } from "@chatbotx.io/vitest-config/msw"
import { describe, expect, test, vi } from "vitest"
import { receiveMessage } from "../src/handlers/message/incoming-message"
import {
  sendFlowStep,
  sendMessage,
} from "../src/handlers/message/outgoing-message"
import type { ZzapAuthValue } from "../src/schema"
import { ZZAP_BASE, zzapAuth } from "./fixtures"

vi.mock("../src/constants", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/constants")>()),
  ZZAP_MIN_REQUEST_INTERVAL_SECONDS: 0,
}))

const OUTGOING_ID = /^zzap-out:/

const putObject = vi.fn(async () => undefined)
const ctx = {
  auth: zzapAuth,
  storagePrefix: "ws/1",
  uploader: { putObject },
} as unknown as Context<ZzapAuthValue>

const captureSends = (): string[] => {
  const texts: string[] = []
  server.use(
    http.post(`${ZZAP_BASE}/messages`, async ({ request }) => {
      const body = (await request.json()) as { message: string }
      texts.push(body.message)
      return HttpResponse.json({ success: true, result: {} })
    }),
  )
  return texts
}

const event = (text: string, extra: Record<string, unknown> = {}) => ({
  kind: "message",
  sourceId: "zzap:abc",
  userKey: "A",
  userName: "Buyer A",
  messageDate: "2026-10-19T11:58:00",
  text,
  buyer: null,
  ...extra,
})

describe("sending", () => {
  test("sendFlowStep posts each text chunk to the buyer", async () => {
    const texts = captureSends()
    const result = await sendFlowStep({
      ctx,
      data: {
        contact: { sourceId: "A" },
        flowId: "f1",
        step: { stepType: "sendText", text: "Здравствуйте", buttons: [] },
        quickReplies: [
          { label: "Цена", buttonType: "postback", postback: "p" },
        ],
      },
    } as unknown as Parameters<
      MessageHandlers<ZzapAuthValue>["sendFlowStep"]
    >[0])

    expect(texts).toEqual(["Здравствуйте\n\n1. Цена"])
    expect(result.messageIds).toHaveLength(1)
    expect(result.messageIds[0]).toMatch(OUTGOING_ID)
  })

  test("sendMessage sends text and attachment links", async () => {
    const texts = captureSends()
    await sendMessage({
      ctx,
      data: {
        contact: { sourceId: "A" },
        message: {
          text: "Счёт",
          attachments: [{ url: "https://cdn/inv.pdf", name: "inv.pdf" }],
        },
      },
    } as unknown as Parameters<
      MessageHandlers<ZzapAuthValue>["sendMessage"]
    >[0])

    expect(texts).toEqual(["Счёт\n\n📎 inv.pdf\nhttps://cdn/inv.pdf"])
  })

  test("maps an auth failure to a ChannelError", async () => {
    server.use(
      http.post(`${ZZAP_BASE}/messages`, () =>
        HttpResponse.json(
          { success: false, errors: "bad key" },
          { status: 401 },
        ),
      ),
    )
    const error = await sendMessage({
      ctx,
      data: { contact: { sourceId: "A" }, message: { text: "x" } },
    } as unknown as Parameters<
      MessageHandlers<ZzapAuthValue>["sendMessage"]
    >[0]).catch((err: unknown) => err)
    expect(error).toBeInstanceOf(ChannelError)
  })
})

describe("receiveMessage", () => {
  const receive = (payload: unknown) =>
    receiveMessage({
      ctx,
      data: { integrationType: "zzap", integrationIdentifier: "42", payload },
    })

  test("maps a buyer message and contact", async () => {
    const result = await receive(
      event("Есть в наличии?", {
        buyer: { name: "Иван", phone: "+79990000000", email: "i@x.ru" },
      }),
    )
    expect(result.message).toMatchObject({
      sourceId: "zzap:abc",
      text: "Есть в наличии?",
      attachments: [],
    })
    expect(result.contact).toEqual({
      sourceId: "A",
      firstName: "Иван",
      phoneNumber: "+79990000000",
      email: "i@x.ru",
    })
  })

  test("stores an image hosted by ZZAP", async () => {
    server.use(
      http.get("https://zzap.ru/a.jpg", () =>
        HttpResponse.arrayBuffer(new Uint8Array([1, 2]).buffer, {
          headers: { "content-type": "image/jpeg" },
        }),
      ),
    )
    const result = await receive(event("Вот [img]https://zzap.ru/a.jpg[/img]"))
    expect(result.message?.text).toBe("Вот")
    expect(result.message?.attachments).toHaveLength(1)
    expect(putObject).toHaveBeenCalled()
  })

  test("keeps a foreign media URL as text without downloading it", async () => {
    const result = await receive(event("[img]https://evil.example/a.jpg[/img]"))
    expect(result.message?.attachments).toEqual([])
    expect(result.message?.text).toBe("📎 a.jpg\nhttps://evil.example/a.jpg")
  })

  test("rejects a malformed payload", async () => {
    await expect(receive({ kind: "other" })).rejects.toThrow("malformed")
  })
})
