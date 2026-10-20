import { readFileSync } from "node:fs"
import type { PollCursor } from "@chatbotx.io/sdk"
import { HttpResponse, http, server } from "@chatbotx.io/vitest-config/msw"
import { describe, expect, test } from "vitest"
import { DromSessionExpiredException } from "../src/exception"
import type { DromInboundEvent } from "../src/handlers/event"
import { type DromCursor, pollDrom } from "../src/handlers/poll"
import { DROM_BASE, dromAuth } from "./fixtures"
import { brief, dealLine, dialogView, orderHeader } from "./views"

const NOW = new Date("2026-10-20T10:00:00Z")
const DAY_MS = 24 * 60 * 60 * 1000
const DEAL_HTML = readFileSync(
  new URL("./fixtures/deal-cdek.html", import.meta.url),
  "utf8",
)

type View = ReturnType<typeof dialogView>

const mockDrom = (
  briefs: ReturnType<typeof brief>[],
  views: Record<string, View | number>,
  dealStatus = 200,
) => {
  const viewed: string[] = []
  const deals: string[] = []
  server.use(
    http.get(`${DROM_BASE}/personal/messaging/inbox-list`, () =>
      HttpResponse.json({ briefs }),
    ),
    http.get(`${DROM_BASE}/personal/messaging/view`, ({ request }) => {
      const dialogId = new URL(request.url).searchParams.get("dialogId") ?? ""
      viewed.push(dialogId)
      const view = views[dialogId]
      return typeof view === "number" || view === undefined
        ? new HttpResponse(null, { status: view ?? 404 })
        : HttpResponse.json(view)
    }),
    http.get(`${DROM_BASE}/deal/:id`, ({ params }) => {
      deals.push(String(params.id))
      return dealStatus === 200
        ? new HttpResponse(DEAL_HTML, {
            headers: { "Content-Type": "text/html; charset=utf-8" },
          })
        : new HttpResponse(null, { status: dealStatus })
    }),
  )
  return { viewed, deals }
}

const poll = async (cursor: PollCursor | null, auth = dromAuth) => {
  const result = await pollDrom({ auth, cursor, now: NOW })
  return {
    events: result.events.map((e) => e.payload as DromInboundEvent),
    cursor: result.cursor as DromCursor,
  }
}

const knownDialog = (
  lastInboundId: string,
  overrides: Partial<DromCursor["dialogs"][string]> = {},
): DromCursor["dialogs"][string] => ({
  lastInboundId,
  lastMessageDate: 1_699_999_000,
  seenDealIds: [],
  fetchedDealUrls: [],
  updatedAt: NOW.getTime() - DAY_MS,
  ...overrides,
})

describe("pollDrom", () => {
  test("first sight of an unread dialog emits only the latest buyer line", async () => {
    mockDrom([brief("100", { isUnread: true })], {
      "100": dialogView("100", [
        { id: "1", text: "раз" },
        { id: "2", text: "два" },
        { id: "3", text: "три" },
      ]),
    })
    const { events, cursor } = await poll(null)
    expect(events.map((e) => e.text)).toEqual(["три"])
    expect(events[0]).toMatchObject({
      sourceId: "drom:100:3",
      dialogId: "100",
      interlocutor: "buyer-login",
      isDealSystem: false,
    })
    expect(cursor.dialogs["100"]).toMatchObject({
      lastInboundId: "3",
      lastMessageDate: 1_700_000_000,
      updatedAt: NOW.getTime(),
    })
  })

  test("a known dialog emits every buyer line past the watermark, in order", async () => {
    mockDrom([brief("100", { lastMessageDate: 1_700_000_000 })], {
      "100": dialogView("100", [
        { id: "10", text: "old" },
        { id: "11", text: "new 1" },
        { id: "15", text: "reply", direction: "out" },
        { id: "12", text: "new 2" },
      ]),
    })
    const { events, cursor } = await poll({
      dialogs: { "100": knownDialog("10") },
    })
    expect(events.map((e) => e.messageId)).toEqual(["11", "12"])
    expect(cursor.dialogs["100"]?.lastInboundId).toBe("12")
  })

  test("a read dialog whose last message did not move is not viewed", async () => {
    const { viewed } = mockDrom(
      [brief("100", { lastMessageDate: 1_699_999_000 })],
      { "100": dialogView("100", [{ id: "11", text: "x" }]) },
    )
    const { events } = await poll({ dialogs: { "100": knownDialog("10") } })
    expect(events).toEqual([])
    expect(viewed).toEqual([])
  })

  test("a deal line is emitted once and its order page fetched once", async () => {
    const views = {
      "100": dialogView("100", [{ id: "5", text: "Когда отправите?" }], {
        extra: dealLine("hash1"),
        header: orderHeader("10000001"),
      }),
    }
    const { deals } = mockDrom([brief("100", { isUnread: true })], views)
    const first = await poll(null)
    expect(first.events.map((e) => e.messageId)).toEqual(["deal:hash1", "5"])
    expect(first.events[0]?.deal).toMatchObject({
      buyerName: "Иван Тестов",
      phone: "+7 900 000-00-01",
    })
    expect(first.events[1]?.listing).toEqual({
      title: "Клапан ТНВД",
      url: null,
      price: 3534,
    })
    expect(first.cursor.dialogs["100"]).toMatchObject({
      seenDealIds: ["deal:hash1"],
      fetchedDealUrls: ["https://baza.drom.ru/deal/10000001"],
    })

    views["100"] = dialogView(
      "100",
      [
        { id: "5", text: "Когда отправите?" },
        { id: "6", text: "Жду" },
      ],
      { extra: dealLine("hash1"), header: orderHeader("10000001") },
    )
    const second = await poll(first.cursor)
    expect(second.events.map((e) => e.messageId)).toEqual(["6"])
    expect(second.events[0]?.deal).toBeNull()
    expect(deals).toEqual(["10000001"])
  })

  test("a failed order page leaves the events without a deal", async () => {
    mockDrom(
      [brief("100", { isUnread: true })],
      {
        "100": dialogView("100", [{ id: "5", text: "Hi" }], {
          header: orderHeader("10000001"),
        }),
      },
      500,
    )
    const { events, cursor } = await poll(null)
    expect(events).toHaveLength(1)
    expect(events[0]?.deal).toBeNull()
    expect(cursor.dialogs["100"]?.fetchedDealUrls).toEqual([])
  })

  test("maxDialogsPerPoll caps the views; the rest wait for the next poll", async () => {
    const { viewed } = mockDrom(
      [
        brief("100", { isUnread: true, lastMessageDate: 1_700_000_000 }),
        brief("200", { isUnread: true, lastMessageDate: 1_700_000_500 }),
      ],
      {
        "100": dialogView("100", [{ id: "1", text: "a" }]),
        "200": dialogView("200", [{ id: "2", text: "b" }]),
      },
    )
    const { events, cursor } = await poll(null, {
      ...dromAuth,
      maxDialogsPerPoll: 1,
    })
    expect(viewed).toEqual(["200"])
    expect(events.map((e) => e.dialogId)).toEqual(["200"])
    expect(cursor.dialogs["100"]).toBeUndefined()
  })

  test("HTML instead of the dialog list fails with an expired session", async () => {
    server.use(
      http.get(`${DROM_BASE}/personal/messaging/inbox-list`, () =>
        HttpResponse.html("<html>Вход</html>"),
      ),
    )
    await expect(poll(null)).rejects.toBeInstanceOf(DromSessionExpiredException)
  })

  test("one failing dialog does not stop the others and keeps its cursor", async () => {
    const before = knownDialog("10", { lastMessageDate: 1 })
    mockDrom(
      [brief("100", { isUnread: true }), brief("200", { isUnread: true })],
      { "100": 500, "200": dialogView("200", [{ id: "2", text: "b" }]) },
    )
    const { events, cursor } = await poll({ dialogs: { "100": before } })
    expect(events.map((e) => e.dialogId)).toEqual(["200"])
    expect(cursor.dialogs["100"]).toEqual(before)
  })

  test("a photo-only line gets a placeholder text and keeps the photo", async () => {
    mockDrom([brief("100", { isUnread: true })], {
      "100": dialogView("100", [
        {
          id: "3",
          text: "",
          imageUrl: "https://static.baza.drom.ru/drom/1_default",
        },
      ]),
    })
    const { events } = await poll(null)
    expect(events[0]).toMatchObject({
      text: "📷 Фото",
      images: [
        {
          url: "https://static.baza.drom.ru/drom/1_default",
          origUrl: "https://static.baza.drom.ru/drom/1_default",
        },
      ],
    })
  })

  test("dialogs untouched for 61 days are pruned", async () => {
    mockDrom([], {})
    const { cursor } = await poll({
      dialogs: {
        old: knownDialog("1", { updatedAt: NOW.getTime() - 61 * DAY_MS }),
        fresh: knownDialog("1", { updatedAt: NOW.getTime() - 59 * DAY_MS }),
      },
    })
    expect(Object.keys(cursor.dialogs)).toEqual(["fresh"])
  })

  test("prefers the login over a numeric id for the interlocutor", async () => {
    mockDrom([brief("100", { isUnread: true, interlocutor: "10000009" })], {
      "100": dialogView("100", [{ id: "1", text: "a" }], {
        interlocutor: "buyer-login",
      }),
    })
    const { events } = await poll(null)
    expect(events[0]?.interlocutor).toBe("buyer-login")
  })
})
