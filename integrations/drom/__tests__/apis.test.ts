import { readFileSync } from "node:fs"
import { HttpResponse, http, server } from "@chatbotx.io/vitest-config/msw"
import { describe, expect, test } from "vitest"
import { fetchDeal } from "../src/apis/deal"
import { sendDromMessage, viewDialog } from "../src/apis/dialog"
import { getInboxConfig, listBriefs } from "../src/apis/inbox"
import { downloadDromImage, uploadDromImage } from "../src/apis/media"
import { DromAPIException, DromException } from "../src/exception"
import { DROM_BASE, dromAuth } from "./fixtures"
import { brief, dialogView } from "./views"

const VIEW_URL = `${DROM_BASE}/personal/messaging/view`
const UPLOAD_URL = `${DROM_BASE}/upload-image-jquery`
const photo = { name: "a.jpg", mime: "image/jpeg", bytes: new Uint8Array([1]) }

describe("inbox", () => {
  test("getInboxConfig reads the unread counter", async () => {
    server.use(
      http.get(`${DROM_BASE}/personal/messaging/inbox-config`, () =>
        HttpResponse.json({
          hasDialogs: true,
          eventCounts: { unreadDialogs: 3 },
        }),
      ),
    )
    await expect(getInboxConfig(dromAuth)).resolves.toEqual({
      hasDialogs: true,
      unreadDialogs: 3,
    })
  })

  test("listBriefs parses briefs", async () => {
    server.use(
      http.get(`${DROM_BASE}/personal/messaging/inbox-list`, () =>
        HttpResponse.json({ briefs: [brief("100", { isUnread: true })] }),
      ),
    )
    const [first] = await listBriefs(dromAuth)
    expect(first).toMatchObject({ dialogId: "100", isUnread: true })
  })
})

describe("dialog", () => {
  test("viewDialog asks for the JSON view of one dialog", async () => {
    let query: URLSearchParams | undefined
    let referer: string | null = null
    server.use(
      http.get(VIEW_URL, ({ request }) => {
        query = new URL(request.url).searchParams
        referer = request.headers.get("referer")
        return HttpResponse.json(dialogView("100", [{ id: "5", text: "Hi" }]))
      }),
    )
    const view = await viewDialog(dromAuth, "100")
    expect(view.messages[0]?.text).toBe("Hi")
    expect(Object.fromEntries(query ?? [])).toEqual({
      dialogId: "100",
      json: "true",
      "flat-layout": "false",
      ajax: "1",
    })
    expect(referer).toBe(`${DROM_BASE}/personal/messaging-modal/dialog-100`)
  })

  test("sendDromMessage posts with the latest id and returns the new one", async () => {
    let query: URLSearchParams | undefined
    let body = ""
    server.use(
      http.get(VIEW_URL, () =>
        HttpResponse.json(dialogView("100", [{ id: "5", text: "Hi" }])),
      ),
      http.post(VIEW_URL, async ({ request }) => {
        query = new URL(request.url).searchParams
        body = await request.text()
        return HttpResponse.json(
          dialogView("100", [
            { id: "5", text: "Hi" },
            { id: "6", text: "Ответ", direction: "out" },
          ]),
        )
      }),
    )
    await expect(
      sendDromMessage(dromAuth, {
        dialogId: "100",
        text: "Ответ",
        imageIds: ["7", "0", " "],
      }),
    ).resolves.toEqual({ latestMessageId: "6" })
    expect(query?.get("latestMessageId")).toBe("5")
    expect(query?.get("dialogId")).toBe("100")
    expect(body).toBe("message=%D0%9E%D1%82%D0%B2%D0%B5%D1%82&images%5B7%5D=1")
  })

  test("sendDromMessage without a new id in the answer returns null", async () => {
    server.use(
      http.get(VIEW_URL, () =>
        HttpResponse.json(dialogView("100", [{ id: "5", text: "Hi" }])),
      ),
      http.post(VIEW_URL, () => HttpResponse.json({ ok: true })),
    )
    await expect(
      sendDromMessage(dromAuth, { dialogId: "100", text: "x" }),
    ).resolves.toEqual({ latestMessageId: null })
  })

  test("sendDromMessage rejects an empty message", async () => {
    await expect(
      sendDromMessage(dromAuth, { dialogId: "100", text: "  " }),
    ).rejects.toBeInstanceOf(DromException)
  })
})

describe("media", () => {
  test("uploadDromImage reads items[0].id or id", async () => {
    server.use(
      http.post(UPLOAD_URL, () => HttpResponse.json({ items: [{ id: 12 }] })),
    )
    await expect(uploadDromImage(dromAuth, photo)).resolves.toEqual({
      imageId: "12",
    })
    server.use(http.post(UPLOAD_URL, () => HttpResponse.json({ id: "13" })))
    await expect(uploadDromImage(dromAuth, photo)).resolves.toEqual({
      imageId: "13",
    })
  })

  test("uploadDromImage fails on an error or a missing id", async () => {
    server.use(
      http.post(UPLOAD_URL, () => HttpResponse.json({ error: "too big" })),
    )
    await expect(uploadDromImage(dromAuth, photo)).rejects.toBeInstanceOf(
      DromAPIException,
    )
    server.use(http.post(UPLOAD_URL, () => HttpResponse.json({ items: [] })))
    await expect(uploadDromImage(dromAuth, photo)).rejects.toThrow(
      "no_image_id",
    )
  })

  test("downloadDromImage refuses foreign URLs", async () => {
    await expect(
      downloadDromImage(dromAuth, "https://evil.test/p-img/x"),
    ).rejects.toThrow("not allowed")
  })

  test("downloadDromImage names the file after the path", async () => {
    server.use(
      http.get(
        "https://baza.drom.ru/p-img/drom/1_default",
        () =>
          new HttpResponse(new Uint8Array([1, 2]), {
            headers: { "Content-Type": "image/jpeg" },
          }),
      ),
    )
    await expect(
      downloadDromImage(
        dromAuth,
        "https://baza.drom.ru/p-img/drom/1_default?sign=1",
      ),
    ).resolves.toEqual({
      bytes: new Uint8Array([1, 2]),
      mime: "image/jpeg",
      filename: "1_default",
    })
  })
})

describe("deal", () => {
  test("fetchDeal normalizes the URL and parses the page", async () => {
    const html = readFileSync(
      new URL("./fixtures/deal-cdek.html", import.meta.url),
      "utf8",
    )
    server.use(
      http.get(
        `${DROM_BASE}/deal/10000001`,
        () =>
          new HttpResponse(html, {
            headers: { "Content-Type": "text/html; charset=utf-8" },
          }),
      ),
    )
    await expect(fetchDeal(dromAuth, "10000001")).resolves.toMatchObject({
      dealId: "10000001",
      buyerName: "Иван Тестов",
    })
  })

  test("fetchDeal rejects an empty page", async () => {
    server.use(
      http.get(`${DROM_BASE}/deal/10000001`, () =>
        HttpResponse.html("<html></html>"),
      ),
    )
    await expect(fetchDeal(dromAuth, "10000001")).rejects.toThrow(
      "empty_order_html",
    )
  })
})
