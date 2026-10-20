import { readFileSync } from "node:fs"
import { describe, expect, test } from "vitest"
import {
  isDromImageUrl,
  normalizeOrderUrl,
  parseBriefs,
  parseDeal,
  parseMessageImages,
  parsePriceFromTitle,
  parseView,
  spanInnersByClass,
  stripTags,
} from "../src/parse"

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8")

const DEAL_THEN_CHAT = `
<div class="bzr-dialog" data-dialog-id="1000000001" data-latest-msg-id="10">
<div class="bzr-dialog__msg-container" data-hash="aaaa1111">
<div class="bzr-dialog__deal">
<span class="bzr-dialog__deal-dt">12:13</span>
 Покупатель выбрал Клапан ТНВД за 3 534₽
</div>
</div>
<div class="bzr-dialog__msg-container" data-message-id="10">
<div class="bzr-dialog__message bzr-dialog__message_out">
<span class="bzr-dialog__message-dt">12:13</span>
<span class="bzr-dialog__text">Здравствуйте! Запчасти только под заказ</span>
</div>
</div>
</div>
`

const UNKNOWN_DIRECTION_CHAT = `
<div class="bzr-dialog" data-dialog-id="1000000001" data-latest-msg-id="11">
<div class="bzr-dialog__msg-container" data-message-id="11">
<div class="bzr-dialog__message">
<span class="bzr-dialog__message-dt">12:14</span>
<span class="bzr-dialog__text">Сообщение без направления</span>
</div>
</div>
</div>
`

const NESTED_OEM_SPAN = `
<div class="bzr-dialog" data-dialog-id="1000000001" data-latest-msg-id="12">
<div class="bzr-dialog__msg-container" data-message-id="12">
<div class="bzr-dialog__message bzr-dialog__message_out">
<span class="bzr-dialog__message-dt">12:41</span>
<span class="bzr-dialog__text">"Администратор": <span class="bull-item">0A0000001</span> - этот номер вы откуда взяли?</span>
</div>
</div>
</div>
`

const LISTING_HEADER = `
<h3 class="bzr-dialog-header__sub-title">
  <a href="https://baza.drom.ru/test/sell_spare_parts/turbo-test.html">23 264 р. • Турбокомпрессор Тест</a>
</h3>
`

const ORDER_HEADER = `
<h3 class="bzr-dialog-header__sub-title">
  <a href="https://baza.drom.ru/deal/10000001">Заказ</a> • 3 534 р. • Клапан ТНВД
</h3>
`

const PHOTO_CHAT = `
<div class="bzr-dialog" data-dialog-id="1" data-latest-msg-id="9">
<div class="bzr-dialog__msg-container" data-message-id="9">
<div class="bzr-dialog__message bzr-dialog__message_in">
<span class="bzr-dialog__message-dt">10:23</span>
<div class="bzr-dialog__body-copy">
<span class="bzr-dialog__text"></span>
<ul class="light-gallery-image-list bzr-dialog__image-list">
<li><img src="https://baza.drom.ru/p-img/drom/1_hugeBlock?sign=1.abc" data-orig-src="https://baza.drom.ru/p-img/drom/1_default?sign=1.def"/></li>
<li><img src="https://baza.drom.ru/p-img/drom/1_hugeBlock?sign=1.abc" data-orig-src="https://baza.drom.ru/p-img/drom/1_default?sign=1.def"/></li>
<li><img src="https://evil.test/p-img/x.jpg"/></li>
<li><img src="https://static.baza.drom.ru/drom/2_hugeBlock"/></li>
</ul>
</div>
</div>
</div>
</div>
`

describe("html helpers", () => {
  test("stripTags turns <br> into line breaks and decodes entities", () => {
    expect(stripTags("a<br/>b &laquo;c&raquo;&nbsp;&#8381; <b>d</b>")).toBe(
      "a\nb «c»\u00a0₽ d",
    )
  })

  test("spanInnersByClass keeps nested spans", () => {
    expect(
      spanInnersByClass(
        '<span class="x y">a <span>b</span> c</span><span class="x">d</span>',
        "x",
      ),
    ).toEqual(["a <span>b</span> c", "d"])
  })
})

describe("parseView", () => {
  test("keeps the deal line before the chat", () => {
    const view = parseView({ dialog: DEAL_THEN_CHAT, interlocutor: "buyer" })
    expect(view.dialogId).toBe("1000000001")
    expect(view.latestMessageId).toBe("10")
    expect(view.messages.map((m) => m.messageId)).toEqual([
      "deal:aaaa1111",
      "10",
    ])
    const [deal, reply] = view.messages
    expect(deal).toMatchObject({
      direction: "in",
      time: "12:13",
      isDealSystem: true,
    })
    expect(deal?.text).toBe("Покупатель выбрал Клапан ТНВД за 3 534₽")
    expect(reply).toMatchObject({
      direction: "out",
      text: "Здравствуйте! Запчасти только под заказ",
      isDealSystem: false,
    })
  })

  test("does not duplicate a numeric message with unknown direction", () => {
    expect(parseView({ dialog: UNKNOWN_DIRECTION_CHAT }).messages).toEqual([
      {
        messageId: "11",
        direction: "unknown",
        time: "12:14",
        text: "Сообщение без направления",
        images: [],
        isDealSystem: false,
      },
    ])
  })

  test("keeps the text after a nested OEM span", () => {
    expect(parseView({ dialog: NESTED_OEM_SPAN }).messages[0]?.text).toBe(
      '"Администратор": 0A0000001 - этот номер вы откуда взяли?',
    )
  })

  test("reads the listing card from the header", () => {
    const view = parseView({ dialog: "", header: LISTING_HEADER })
    expect(view.listing).toEqual({
      title: "23 264 р. • Турбокомпрессор Тест",
      url: "https://baza.drom.ru/test/sell_spare_parts/turbo-test.html",
      price: 23_264,
    })
    expect(view.orderUrl).toBeNull()
  })

  test("reads the order link and the item from the sub-title", () => {
    const view = parseView({ dialog: "", header: ORDER_HEADER })
    expect(view.orderUrl).toBe("https://baza.drom.ru/deal/10000001")
    expect(view.listing).toEqual({
      title: "Клапан ТНВД",
      url: null,
      price: 3534,
    })
  })

  test("extracts chat photos", () => {
    const [message] = parseView({ dialog: PHOTO_CHAT }).messages
    expect(message?.text).toBe("")
    expect(message?.images).toEqual([
      {
        url: "https://baza.drom.ru/p-img/drom/1_hugeBlock?sign=1.abc",
        origUrl: "https://baza.drom.ru/p-img/drom/1_default?sign=1.def",
      },
      {
        url: "https://static.baza.drom.ru/drom/2_hugeBlock",
        origUrl: "https://static.baza.drom.ru/drom/2_hugeBlock",
      },
    ])
  })
})

describe("images", () => {
  test.each([
    ["https://static.baza.drom.ru/a.jpg", true],
    ["https://baza.drom.ru/p-img/x", true],
    ["http://baza.drom.ru/p-img/x", false],
    ["https://evil.test/p-img/x", false],
    ["https://baza.drom.ru/../x", false],
    ["https://u:p@baza.drom.ru/p-img/x", false],
    ["https://baza.drom.ru/deal/1", false],
  ])("isDromImageUrl(%s) = %s", (url, expected) => {
    expect(isDromImageUrl(url)).toBe(expected)
  })

  test("parseMessageImages decodes entities in attributes", () => {
    expect(
      parseMessageImages(
        '<img src="https://static.baza.drom.ru/a.jpg?x=1&amp;y=2">',
      ),
    ).toEqual([
      {
        url: "https://static.baza.drom.ru/a.jpg?x=1&y=2",
        origUrl: "https://static.baza.drom.ru/a.jpg?x=1&y=2",
      },
    ])
  })
})

describe("parseBriefs", () => {
  test("keeps flags and numeric dates, drops rows without a dialog id", () => {
    expect(
      parseBriefs({
        briefs: [
          {
            dialogId: 100,
            interlocutor: "buyer-1",
            isUnread: false,
            lastMessageDate: "1700000000",
            html: '<div class="dialog-brief dialog-brief_highlighted">',
          },
          { dialogId: "200", isUnread: true },
          { interlocutor: "nobody" },
          "junk",
        ],
      }),
    ).toEqual([
      {
        dialogId: "100",
        interlocutor: "buyer-1",
        lastMessageDate: 1_700_000_000,
        isUnread: false,
        highlighted: true,
      },
      {
        dialogId: "200",
        interlocutor: "",
        lastMessageDate: 0,
        isUnread: true,
        highlighted: false,
      },
    ])
    expect(parseBriefs(null)).toEqual([])
  })
})

describe("parseDeal", () => {
  test("transport-company delivery", () => {
    const deal = parseDeal(
      fixture("deal-cdek.html"),
      "https://baza.drom.ru/deal/10000001",
    )
    expect(deal).toEqual({
      dealId: "10000001",
      orderUrl: "https://baza.drom.ru/deal/10000001",
      buyerName: "Иван Тестов",
      phone: "+7 900 000-00-01",
      email: "",
      city: "Тестоград",
      deliveryMethod: "TK «СДЭК»",
      pickupAddress:
        "г.\u00a0Тестоград, Тестовая область, ул. Примерная, 1А, 2",
      items: [
        {
          title: "Сцепление TESTBRAND 000000001",
          price: 12_203,
          qty: 1,
          url: "https://baza.drom.ru/dealview/10000001/good/20000001",
          annotation: "Под заказ, Доставка в течение 1 дня, TESTBRAND",
        },
      ],
    })
  })

  test("pickup with e-mail and the contacts phone", () => {
    const deal = parseDeal(fixture("deal-pickup.html"), "")
    expect(deal).toMatchObject({
      dealId: "10000002",
      orderUrl: "https://baza.drom.ru/deal/10000002",
      buyerName: "Пётр Примеров",
      phone: "+7 900 000-00-02",
      email: "buyer@example.test",
      deliveryMethod: "Самовывоз",
      pickupAddress: "улица Тестовая 1",
    })
    expect(deal.items).toEqual([
      expect.objectContaining({ price: 1473, qty: 2 }),
    ])
  })
})

describe("small helpers", () => {
  test.each([
    "10000001",
    "/deal/10000001",
    "see https://baza.drom.ru/deal/10000001?x",
    "заказ deal/10000001",
  ])("normalizeOrderUrl(%s)", (value) => {
    expect(normalizeOrderUrl(value)).toBe("https://baza.drom.ru/deal/10000001")
  })

  test("parsePriceFromTitle", () => {
    expect(parsePriceFromTitle("23 264 р. • Турбо")).toBe(23_264)
    expect(parsePriceFromTitle("Цена 1\u00a0500 ₽")).toBe(1500)
    expect(parsePriceFromTitle("Без цены")).toBeNull()
  })
})
