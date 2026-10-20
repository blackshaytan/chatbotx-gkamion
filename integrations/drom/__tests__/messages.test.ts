import type { Context, MessageHandlers } from "@chatbotx.io/sdk"
import { ChannelError, ChannelErrorCategory } from "@chatbotx.io/sdk"
import { HttpResponse, http, server } from "@chatbotx.io/vitest-config/msw"
import { beforeEach, describe, expect, test, vi } from "vitest"
import { receiveMessage } from "../src/handlers/message/incoming-message"
import {
  sendFlowStep,
  sendMessage,
} from "../src/handlers/message/outgoing-message"
import type { DromAuthValue } from "../src/schema"
import { DROM_BASE, dromAuth } from "./fixtures"
import { dialogView } from "./views"

const OUTGOING_ID = /^drom-out:100:/
const VIEW_URL = `${DROM_BASE}/personal/messaging/view`
const STORAGE = "https://storage.test"

const putObject = vi.fn(async () => undefined)
const ctx = {
  auth: dromAuth,
  storagePrefix: "ws/1",
  uploader: { putObject },
} as unknown as Context<DromAuthValue>

type SendProps = Parameters<MessageHandlers<DromAuthValue>["sendMessage"]>[0]
type FlowProps = Parameters<MessageHandlers<DromAuthValue>["sendFlowStep"]>[0]

const deal = {
  dealId: "10000001",
  orderUrl: "https://baza.drom.ru/deal/10000001",
  buyerName: "Иван Тестов",
  phone: "+7 900 000-00-01",
  email: "buyer@example.test",
  city: "Тестоград",
  deliveryMethod: "Самовывоз",
  pickupAddress: "",
  items: [],
}

const event = (extra: Record<string, unknown> = {}) => ({
  kind: "message",
  sourceId: "drom:100:5",
  dialogId: "100",
  messageId: "5",
  interlocutor: "buyer-login",
  text: "Есть в наличии?",
  images: [],
  isDealSystem: false,
  listing: { title: "Клапан", url: null, price: 3534 },
  deal: null,
  ...extra,
})

const receive = (payload: unknown) =>
  receiveMessage({
    ctx,
    data: { integrationType: "drom", integrationIdentifier: "s", payload },
  })

/** Captures every send form; the view always reports one older message. */
const captureSends = () => {
  const forms: Record<string, string>[] = []
  let next = 10
  server.use(
    http.get(VIEW_URL, () =>
      HttpResponse.json(dialogView("100", [{ id: "5", text: "Hi" }])),
    ),
    http.post(VIEW_URL, async ({ request }) => {
      forms.push(Object.fromEntries(new URLSearchParams(await request.text())))
      next += 1
      return HttpResponse.json(
        dialogView("100", [{ id: String(next), text: "x", direction: "out" }]),
      )
    }),
  )
  return forms
}

const serveStoredPhotos = (count: number) => {
  let uploads = 0
  server.use(
    http.get(
      `${STORAGE}/:name`,
      () =>
        new HttpResponse(new Uint8Array([1, 2]), {
          headers: { "Content-Type": "image/jpeg" },
        }),
    ),
    http.post(`${DROM_BASE}/upload-image-jquery`, () => {
      uploads += 1
      return HttpResponse.json({ items: [{ id: `img${uploads}` }] })
    }),
  )
  return Array.from({ length: count }, (_, i) => ({
    url: `${STORAGE}/p${i}.jpg`,
    name: `p${i}.jpg`,
  }))
}

beforeEach(() => {
  putObject.mockClear()
})

describe("receiving", () => {
  test("maps the deal to the contact and keeps the DROM context", async () => {
    const result = await receive(event({ deal }))
    expect(result.contact).toEqual({
      sourceId: "100",
      firstName: "Иван Тестов",
      sourceUsername: "buyer-login",
      phoneNumber: "+7 900 000-00-01",
      email: "buyer@example.test",
    })
    expect(result.message).toMatchObject({
      sourceId: "drom:100:5",
      text: "Есть в наличии?",
      contentAttributes: {
        dromContext: {
          dialogId: "100",
          listing: { title: "Клапан", url: null, price: 3534 },
          deal,
        },
      },
    })
  })

  test("a numeric interlocutor is a name, not a login", async () => {
    const result = await receive(event({ interlocutor: "10000009" }))
    expect(result.contact).toEqual({ sourceId: "100", firstName: "10000009" })
  })

  test("stores chat photos with the seller cookies", async () => {
    let cookie: string | null = null
    server.use(
      http.get("https://baza.drom.ru/p-img/drom/1_default", ({ request }) => {
        cookie = request.headers.get("cookie")
        return new HttpResponse(new Uint8Array([1, 2, 3]), {
          headers: { "Content-Type": "image/jpeg" },
        })
      }),
    )
    const url = "https://baza.drom.ru/p-img/drom/1_default"
    const result = await receive(
      event({ text: "📷 Фото", images: [{ url, origUrl: url }] }),
    )
    expect(cookie).toBe(dromAuth.secretText)
    expect(putObject).toHaveBeenCalledTimes(1)
    expect(result.message?.attachments).toEqual([
      expect.objectContaining({ mimeType: "image/jpeg", size: 3 }),
    ])
  })

  test("a photo that cannot be downloaded becomes a link", async () => {
    const url = "https://static.baza.drom.ru/drom/gone"
    server.use(http.get(url, () => new HttpResponse(null, { status: 404 })))
    const result = await receive(
      event({ text: "📷 Фото", images: [{ url, origUrl: url }] }),
    )
    expect(result.message?.attachments).toEqual([])
    expect(result.message?.text).toBe(`📷 Фото\n📎 ${url}`)
  })

  test("rejects a malformed event", async () => {
    await expect(receive({ kind: "message" })).rejects.toThrow("malformed")
  })
})

describe("sending", () => {
  test("text with quick replies goes out as one numbered message", async () => {
    const forms = captureSends()
    const result = await sendFlowStep({
      ctx,
      data: {
        contact: { sourceId: "100" },
        flowId: "f1",
        step: { stepType: "sendText", text: "Здравствуйте", buttons: [] },
        quickReplies: [
          { label: "Цена", buttonType: "postback", postback: "p" },
        ],
      },
    } as unknown as FlowProps)
    expect(forms).toEqual([{ message: "Здравствуйте\n\n1. Цена" }])
    expect(result).toEqual({ messageIds: ["drom-out:100:11"], sentCount: 1 })
  })

  test("photos are uploaded and sent with the first text", async () => {
    const forms = captureSends()
    const attachments = serveStoredPhotos(2)
    const result = await sendMessage({
      ctx,
      data: {
        contact: { sourceId: "100" },
        message: { text: "Вот фото", attachments },
      },
    } as unknown as SendProps)
    expect(forms).toEqual([
      { message: "Вот фото", "images[img1]": "1", "images[img2]": "1" },
    ])
    expect(result.messageIds[0]).toMatch(OUTGOING_ID)
  })

  test("more than 8 photos: the rest go out as links", async () => {
    const forms = captureSends()
    const attachments = serveStoredPhotos(9)
    await sendMessage({
      ctx,
      data: { contact: { sourceId: "100" }, message: { attachments } },
    } as unknown as SendProps)
    expect(forms).toHaveLength(1)
    const form = forms[0] ?? {}
    expect(
      Object.keys(form).filter((key) => key.startsWith("images[")),
    ).toHaveLength(8)
    expect(form.message).toBe(`📎 p8.jpg\n${STORAGE}/p8.jpg`)
  })

  test("expired cookies surface as an auth failure", async () => {
    server.use(http.get(VIEW_URL, () => HttpResponse.html("<html>Вход</html>")))
    const error = await sendMessage({
      ctx,
      data: { contact: { sourceId: "100" }, message: { text: "x" } },
    } as unknown as SendProps).catch((err: unknown) => err)
    expect(error).toBeInstanceOf(ChannelError)
    expect((error as ChannelError).category).toBe(
      ChannelErrorCategory.AUTH_FAILED,
    )
  })
})
