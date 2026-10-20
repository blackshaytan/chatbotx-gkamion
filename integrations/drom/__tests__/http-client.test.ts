import { HttpResponse, http, server } from "@chatbotx.io/vitest-config/msw"
import { describe, expect, test, vi } from "vitest"
import { DromAPIException, DromSessionExpiredException } from "../src/exception"
import { isRevokedTokenError } from "../src/lib/error-mapper"
import { createDromClient } from "../src/lib/http-client"
import { DROM_BASE, dromAuth } from "./fixtures"

vi.mock("../src/constants", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/constants")>()),
  DROM_MAX_IMAGE_BYTES: 4,
}))

const ORDER_1251 = new Uint8Array([0xc7, 0xe0, 0xea, 0xe0, 0xe7])
const MULTIPART = /^multipart\/form-data; boundary=/

const html = (bytes: Uint8Array, contentType: string) =>
  new HttpResponse(bytes, { headers: { "Content-Type": contentType } })

describe("DROM http client", () => {
  test("getJson sends the session headers and parses JSON", async () => {
    let seen: Request | undefined
    server.use(
      http.get(`${DROM_BASE}/personal/messaging/inbox-list`, ({ request }) => {
        seen = request
        return HttpResponse.json({ briefs: [] })
      }),
    )
    const client = createDromClient(dromAuth)
    await expect(
      client.getJson("/personal/messaging/inbox-list"),
    ).resolves.toEqual({ briefs: [] })
    expect(seen?.headers.get("cookie")).toBe(dromAuth.secretText)
    expect(seen?.headers.get("user-agent")).toContain("Chrome/120")
    expect(seen?.headers.get("x-requested-with")).toBe("XMLHttpRequest")
    expect(seen?.headers.get("origin")).toBe(DROM_BASE)
    expect(seen?.headers.get("referer")).toBe(
      `${DROM_BASE}/personal/messaging-modal?switchPosition=dialogs`,
    )
  })

  test("getJson on a login page means the cookies expired", async () => {
    server.use(
      http.get(`${DROM_BASE}/personal/messaging/inbox-list`, () =>
        HttpResponse.html("<html><body>Вход</body></html>"),
      ),
    )
    const error = await createDromClient(dromAuth)
      .getJson("/personal/messaging/inbox-list")
      .catch((err: unknown) => err)
    expect(error).toBeInstanceOf(DromSessionExpiredException)
    expect(isRevokedTokenError(error)).toBe(true)
  })

  test.each([401, 403])("HTTP %i means the cookies expired", async (status) => {
    server.use(
      http.get(
        `${DROM_BASE}/personal/messaging/inbox-config`,
        () => new HttpResponse(null, { status }),
      ),
    )
    await expect(
      createDromClient(dromAuth).getJson("/personal/messaging/inbox-config"),
    ).rejects.toBeInstanceOf(DromSessionExpiredException)
  })

  test("HTTP 500 is an API error with its status", async () => {
    server.use(
      http.get(
        `${DROM_BASE}/personal/messaging/inbox-config`,
        () => new HttpResponse(null, { status: 500 }),
      ),
    )
    const error = await createDromClient(dromAuth)
      .getJson("/personal/messaging/inbox-config")
      .catch((err: unknown) => err)
    expect(error).toBeInstanceOf(DromAPIException)
    expect(error).not.toBeInstanceOf(DromSessionExpiredException)
    expect((error as DromAPIException).httpStatusCode).toBe(500)
    expect(isRevokedTokenError(error)).toBe(false)
  })

  test("getHtml decodes windows-1251, by header or by default", async () => {
    server.use(
      http.get(`${DROM_BASE}/deal/1`, () =>
        html(ORDER_1251, "text/html; charset=windows-1251"),
      ),
      http.get(`${DROM_BASE}/deal/2`, () => html(ORDER_1251, "text/html")),
      http.get(`${DROM_BASE}/deal/3`, () =>
        html(new TextEncoder().encode("Заказ"), "text/html; charset=utf-8"),
      ),
    )
    const client = createDromClient(dromAuth)
    await expect(client.getHtml(`${DROM_BASE}/deal/1`)).resolves.toBe("Заказ")
    await expect(client.getHtml(`${DROM_BASE}/deal/2`)).resolves.toBe("Заказ")
    await expect(client.getHtml(`${DROM_BASE}/deal/3`)).resolves.toBe("Заказ")
  })

  test("a redirect to the sign-in page means the cookies expired", async () => {
    server.use(
      http.get(
        `${DROM_BASE}/deal/9`,
        () =>
          new HttpResponse(null, {
            status: 302,
            headers: { Location: "https://my.drom.ru/sign?return=deal" },
          }),
      ),
      http.get("https://my.drom.ru/sign", () =>
        HttpResponse.html("<form>sign in</form>"),
      ),
    )
    await expect(
      createDromClient(dromAuth).getHtml(`${DROM_BASE}/deal/9`),
    ).rejects.toBeInstanceOf(DromSessionExpiredException)
  })

  test("postForm sends a urlencoded UTF-8 form", async () => {
    let seen: Request | undefined
    let body = ""
    server.use(
      http.post(`${DROM_BASE}/personal/messaging/view`, async ({ request }) => {
        seen = request
        body = await request.text()
        return HttpResponse.json({ ok: true })
      }),
    )
    await createDromClient(dromAuth).postForm(
      "/personal/messaging/view?dialogId=5",
      { message: "Привет", "images[7]": "1" },
      { utfFields: "message" },
    )
    expect(seen?.headers.get("content-type")).toBe(
      "application/x-www-form-urlencoded; charset=UTF-8",
    )
    expect(seen?.headers.get("x-utf-fields")).toBe("message")
    expect(body).toBe(
      "message=%D0%9F%D1%80%D0%B8%D0%B2%D0%B5%D1%82&images%5B7%5D=1",
    )
  })

  test("postMultipart sends the file under the given field", async () => {
    let seen: Request | undefined
    let file: FormDataEntryValue | null = null
    server.use(
      http.post(`${DROM_BASE}/upload-image-jquery`, async ({ request }) => {
        seen = request.clone()
        file = (await request.formData()).get("up[]")
        return HttpResponse.json({ items: [{ id: 7 }] })
      }),
    )
    await expect(
      createDromClient(dromAuth).postMultipart("/upload-image-jquery", "up[]", {
        name: "photo.jpg",
        mime: "image/jpeg",
        bytes: new Uint8Array([1, 2]),
      }),
    ).resolves.toEqual({ items: [{ id: 7 }] })
    expect(seen?.headers.get("content-type")).toMatch(MULTIPART)
    expect((file as unknown as File).name).toBe("photo.jpg")
  })

  test("getBinary returns bytes and mime, and rejects big files", async () => {
    server.use(
      http.get(
        "https://static.baza.drom.ru/small.jpg",
        () =>
          new HttpResponse(new Uint8Array([1, 2, 3]), {
            headers: { "Content-Type": "image/jpeg; q=1" },
          }),
      ),
      http.get(
        "https://static.baza.drom.ru/big.jpg",
        () => new HttpResponse(new Uint8Array([1, 2, 3, 4, 5])),
      ),
    )
    const client = createDromClient(dromAuth)
    await expect(
      client.getBinary("https://static.baza.drom.ru/small.jpg"),
    ).resolves.toEqual({ bytes: new Uint8Array([1, 2, 3]), mime: "image/jpeg" })
    await expect(
      client.getBinary("https://static.baza.drom.ru/big.jpg"),
    ).rejects.toBeInstanceOf(DromAPIException)
  })
})
