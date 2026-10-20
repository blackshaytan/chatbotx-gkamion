import { describe, expect, test } from "vitest"
import { makeZzapMessageId, makeZzapOutgoingId } from "../src/lib/ids"
import { isAllowedZzapFileUrl, parseZzapMedia } from "../src/lib/media"
import { formatMoscowDate } from "../src/lib/moscow-time"
import { extractOrderCodes } from "../src/lib/orders"

const MESSAGE_ID_PATTERN = /^zzap:[0-9a-f]{24}$/
const OUTGOING_ID_PATTERN = /^zzap-out:[0-9a-f]{16}$/

describe("parseZzapMedia", () => {
  test("extracts an [img] tag", () => {
    expect(
      parseZzapMedia("Вот фото [img]https://zzap.ru/a/b.jpg[/img]"),
    ).toEqual({
      text: "Вот фото",
      media: {
        url: "https://zzap.ru/a/b.jpg",
        filename: "b.jpg",
        kind: "image",
      },
    })
  })

  test("extracts a [file] tag and detects non-images", () => {
    const parsed = parseZzapMedia(
      "[file]счет.pdf; https://koj.blob.core.windows.net/zzap-upload/x.pdf[/file]",
    )
    expect(parsed.text).toBe("")
    expect(parsed.media).toEqual({
      url: "https://koj.blob.core.windows.net/zzap-upload/x.pdf",
      filename: "счет.pdf",
      kind: "file",
    })
  })

  test("leaves plain text alone", () => {
    expect(parseZzapMedia("  просто текст ")).toEqual({
      text: "просто текст",
      media: null,
    })
  })
})

describe("isAllowedZzapFileUrl", () => {
  test.each([
    ["https://zzap.ru/x.jpg", true],
    ["https://img.zzap.pro/x.jpg", true],
    ["https://acc.blob.core.windows.net/zzap-upload/x.jpg", true],
    ["https://acc.blob.core.windows.net/other/x.jpg", false],
    ["http://zzap.ru/x.jpg", false],
    ["https://evil.example/x.jpg", false],
    ["https://zzap.ru.evil.example/x.jpg", false],
    ["not a url", false],
  ])("%s → %s", (url, allowed) => {
    expect(isAllowedZzapFileUrl(url)).toBe(allowed)
  })
})

describe("ids", () => {
  const input = {
    userKey: "u",
    messageDate: "2026-10-19T10:00:00",
    senderKey: "u",
    message: "hi",
  }

  test("message id is stable and sensitive to every field", () => {
    const id = makeZzapMessageId(input)
    expect(id).toMatch(MESSAGE_ID_PATTERN)
    expect(makeZzapMessageId(input)).toBe(id)
    expect(makeZzapMessageId({ ...input, message: "hi!" })).not.toBe(id)
    expect(makeZzapMessageId({ ...input, messageDate: "x" })).not.toBe(id)
  })

  test("outgoing id has the Geka prefix", () => {
    expect(makeZzapOutgoingId(input)).toMatch(OUTGOING_ID_PATTERN)
  })
})

describe("formatMoscowDate", () => {
  test("formats Moscow wall time without offset", () => {
    expect(formatMoscowDate(new Date("2026-10-19T07:00:05Z"))).toBe(
      "2026-10-19T10:00:05",
    )
  })
})

describe("extractOrderCodes", () => {
  test("finds explicit and #-prefixed codes", () => {
    expect(extractOrderCodes("по заказу 12345678 и #87654321")).toEqual([
      "12345678",
      "87654321",
    ])
  })

  test("finds lists after an order heading", () => {
    expect(extractOrderCodes("Заказы: 11111111, 22222222")).toEqual([
      "11111111",
      "22222222",
    ])
  })

  test("ignores numbers without an order context", () => {
    expect(extractOrderCodes("телефон 89991234567")).toEqual([])
  })
})
