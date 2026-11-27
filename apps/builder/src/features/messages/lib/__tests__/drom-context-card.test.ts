import { describe, expect, test } from "vitest"
import { dromCardsByMessageId, getDromContextCard } from "../drom-context-card"

const listingContext = (listing: Record<string, unknown>) => ({
  dromContext: { deal: null, dialogId: "1984079877", listing },
})

const dealContext = (deal: Record<string, unknown>, listing?: unknown) => ({
  dromContext: { deal, dialogId: "1983970237", listing: listing ?? null },
})

// The real record the DROM integration stored for a card-first dialog: the
// header carried no price, so the plate has to stand on title and link alone.
const magentisListing = {
  price: null,
  title: "Бампер передний KIA Magentis 06-08 865112G002 Jord Jorden",
  url: "https://baza.drom.ru/ni/g16961810801.html",
}

const zzvfDeal = {
  buyerName: "Цуран сергей михайлов",
  dealId: "31212861",
  items: [
    {
      article: "ZVTP229",
      brand: "ZZVF",
      price: 4270,
      qty: 1,
      title: "Трубка топливная ZZVF ZVTP229",
      url: "https://baza.drom.ru/dealview/31212861/good/18504707495",
    },
  ],
  orderUrl: "https://baza.drom.ru/deal/31212861",
}

describe("getDromContextCard", () => {
  test("builds a listing card from the stored ad context", () => {
    expect(getDromContextCard(listingContext(magentisListing))).toEqual({
      href: "https://baza.drom.ru/ni/g16961810801.html",
      kind: "listing",
      price: null,
      title: "Бампер передний KIA Magentis 06-08 865112G002 Jord Jorden",
    })
  })

  test("builds a deal card with the order total", () => {
    expect(getDromContextCard(dealContext(zzvfDeal))).toEqual({
      href: "https://baza.drom.ru/deal/31212861",
      itemsCount: 1,
      kind: "deal",
      price: 4270,
      title: "Трубка топливная ZZVF ZVTP229",
    })
  })

  test("prefers the deal over the order-header listing that rides with it", () => {
    const card = getDromContextCard(
      dealContext(zzvfDeal, {
        price: null,
        title: "Заказ &bull; 4 270₽ &bull; Трубка топливная ZZVF ZVTP229",
        url: null,
      }),
    )

    expect(card?.kind).toBe("deal")
    expect(card?.href).toBe("https://baza.drom.ru/deal/31212861")
  })

  test("multiplies quantity into the total and keeps a partial price out", () => {
    const card = getDromContextCard(
      dealContext({
        ...zzvfDeal,
        items: [
          { price: 4270, qty: 2, title: "Трубка" },
          { price: 1000, qty: 3, title: "Хомут" },
        ],
      }),
    )

    expect(card?.price).toBe(11_540)

    const unpriced = getDromContextCard(
      dealContext({
        ...zzvfDeal,
        items: [{ price: 4270, qty: 1, title: "Трубка" }, { title: "Хомут" }],
      }),
    )

    expect(unpriced?.price).toBeNull()
  })

  test("rebuilds the order link from a numeric deal id", () => {
    const card = getDromContextCard(
      dealContext({ dealId: "31212861", items: [{ title: "Трубка" }] }),
    )

    expect(card?.href).toBe("https://baza.drom.ru/deal/31212861")
  })

  test("drops any link that does not point at baza.drom.ru", () => {
    for (const url of [
      "https://evil.example.com/ni/g1.html",
      "javascript:alert(1)",
      "http://baza.drom.ru/ni/g1.html",
      "",
    ]) {
      expect(
        getDromContextCard(
          listingContext({ title: "Бампер", url, price: 100 }),
        ),
      ).toBeNull()
    }

    expect(
      getDromContextCard(
        dealContext({
          dealId: "31212861",
          orderUrl: "//evil.example.com",
          items: [],
        }),
      )?.href,
    ).toBe("https://baza.drom.ru/deal/31212861")
  })

  test("returns nothing for messages without DROM context", () => {
    for (const attributes of [
      undefined,
      null,
      {},
      { type: "template" },
      { dromContext: null },
      { dromContext: { deal: null, listing: null } },
      // A listing without a URL has nothing to open.
      listingContext({
        price: 5800,
        title: "Турбокомпрессор Krauf",
        url: null,
      }),
    ]) {
      expect(getDromContextCard(attributes)).toBeNull()
    }
  })
})

describe("dromCardsByMessageId", () => {
  test("anchors each card to the earliest message that carries it", () => {
    const cards = dromCardsByMessageId([
      {
        contentAttributes: listingContext(magentisListing),
        createdAt: "2026-11-10T17:09:00Z",
        id: "3",
      },
      {
        contentAttributes: listingContext(magentisListing),
        createdAt: "2026-11-10T17:07:46Z",
        id: "1",
      },
      { contentAttributes: null, createdAt: "2026-11-10T17:10:00Z", id: "2" },
      {
        contentAttributes: listingContext(magentisListing),
        createdAt: "2026-11-10T17:11:00Z",
        id: "4",
      },
    ])

    expect([...cards.keys()]).toEqual(["1"])
    expect(cards.get("1")?.kind).toBe("listing")
  })

  test("keeps one plate per distinct ad or order", () => {
    const cards = dromCardsByMessageId([
      {
        contentAttributes: listingContext(magentisListing),
        createdAt: "2026-11-10T17:07:46Z",
        id: "1",
      },
      {
        contentAttributes: dealContext(zzvfDeal),
        createdAt: "2026-11-10T18:00:00Z",
        id: "2",
      },
      {
        contentAttributes: listingContext({
          price: 5800,
          title: "Турбокомпрессор Krauf",
          url: "https://baza.drom.ru/ni/g16961810802.html",
        }),
        createdAt: "2026-11-10T19:00:00Z",
        id: "3",
      },
    ])

    expect([...cards.keys()].sort()).toEqual(["1", "2", "3"])
  })

  test("accepts Date timestamps and ignores messages that carry no card", () => {
    const cards = dromCardsByMessageId([
      {
        contentAttributes: undefined,
        createdAt: new Date("2026-11-10T17:07:00Z"),
        id: "1",
      },
      {
        contentAttributes: listingContext(magentisListing),
        createdAt: new Date("2026-11-10T17:08:00Z"),
        id: "2",
      },
      {
        contentAttributes: listingContext(magentisListing),
        createdAt: new Date("2026-11-10T17:09:00Z"),
        id: "3",
      },
    ])

    expect([...cards.keys()]).toEqual(["2"])
  })
})
