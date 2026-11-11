import { describe, expect, test } from "vitest"
import {
  firstDromListingLink,
  readDromListingLink,
  safeDromProductUrl,
} from "../drom-listing"

const bulletin = "https://baza.drom.ru/test/sell_spare_parts/turbo-test.html"

describe("safeDromProductUrl", () => {
  test("keeps an https link on drom.ru", () => {
    expect(safeDromProductUrl(bulletin)).toBe(bulletin)
  })

  test("drops links that are not an https drom.ru page", () => {
    expect(safeDromProductUrl("http://baza.drom.ru/x")).toBeNull()
    expect(safeDromProductUrl("https://evil.test/baza.drom.ru")).toBeNull()
    expect(safeDromProductUrl("https://u:p@baza.drom.ru/x")).toBeNull()
    expect(safeDromProductUrl("not a url")).toBeNull()
  })
})

describe("readDromListingLink", () => {
  test("reads the bulletin link stored with the buyer message", () => {
    expect(
      readDromListingLink({
        dromContext: {
          listing: {
            title: "3 018 р. • Диск тормозной Tatsumi TCC1147",
            url: bulletin,
            price: 3018,
          },
          deal: null,
        },
      }),
    ).toEqual({
      title: "3 018 р. • Диск тормозной Tatsumi TCC1147",
      url: bulletin,
    })
  })

  test("uses the ordered item when the header has no bulletin link", () => {
    expect(
      readDromListingLink({
        dromContext: {
          listing: { title: "Клапан ТНВД", url: null, price: 3534 },
          deal: {
            items: [
              {
                title: "Клапан ТНВД",
                url: "https://baza.drom.ru/part/valve.html",
                price: 3534,
              },
            ],
          },
        },
      }),
    ).toEqual({
      title: "Клапан ТНВД",
      url: "https://baza.drom.ru/part/valve.html",
    })
  })

  test("returns nothing when the dialog has no product link", () => {
    expect(readDromListingLink(null)).toBeNull()
    expect(
      readDromListingLink({
        dromContext: { listing: { title: "Диск", url: null, price: null } },
      }),
    ).toBeNull()
  })
})

describe("firstDromListingLink", () => {
  test("uses the earliest message and skips a deleted one", () => {
    const older = {
      deletedAt: new Date(),
      contentAttributes: {
        dromContext: {
          listing: { title: "Старое", url: bulletin, price: 1 },
        },
      },
    }
    const newer = {
      contentAttributes: {
        dromContext: {
          listing: {
            title: "3 018 р. • Диск тормозной Tatsumi TCC1147",
            url: "https://www.drom.ru/item/1",
            price: 3018,
          },
        },
      },
    }
    expect(firstDromListingLink([older, newer])?.title).toBe(
      "3 018 р. • Диск тормозной Tatsumi TCC1147",
    )
  })
})
