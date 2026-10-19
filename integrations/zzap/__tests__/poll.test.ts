import { beforeEach, describe, expect, test, vi } from "vitest"
import { ZzapAPIException, ZzapRateLimitException } from "../src/exception"
import type { ZzapInboundEvent } from "../src/handlers/event"
import { pollZzap } from "../src/handlers/poll"
import { makeZzapMessageId } from "../src/lib/ids"
import type { ZzapMessage, ZzapThread } from "../src/schema"
import { zzapAuth } from "./fixtures"

const mocks = vi.hoisted(() => ({
  listThreads: vi.fn(),
  listMessages: vi.fn(),
  getBuyer: vi.fn(),
  getOrderBuyer: vi.fn(),
}))

vi.mock("../src/apis/threads", () => ({ listThreads: mocks.listThreads }))
vi.mock("../src/apis/messages", () => ({ listMessages: mocks.listMessages }))
vi.mock("../src/apis/buyers", () => ({
  getBuyer: mocks.getBuyer,
  getOrderBuyer: mocks.getOrderBuyer,
}))
vi.mock("../src/lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

// 12:00:00 Moscow → since = 11:55:00
const now = new Date("2026-10-19T09:00:00Z")
const DAY = "2026-10-19"

const thread = (userKey: string, extra: Partial<ZzapThread> = {}) => ({
  user_key: userKey,
  user_name: `Buyer ${userKey}`,
  message_last: "last",
  message_last_date: `${DAY}T11:58:00`,
  unread_count: 1,
  ...extra,
})

const buyerMessage = (
  userKey: string,
  time: string,
  text = `hi at ${time}`,
): ZzapMessage => ({
  user_key: userKey,
  message: text,
  message_date: `${DAY}T${time}`,
})

const shopMessage = (time: string): ZzapMessage => ({
  user_key: "shop",
  message: "ответ магазина",
  message_date: `${DAY}T${time}`,
})

const payloads = (result: Awaited<ReturnType<typeof pollZzap>>) =>
  result.events.map((event) => event.payload as ZzapInboundEvent)

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getBuyer.mockResolvedValue({ name: "Иван", phone: "+79990000000" })
  mocks.getOrderBuyer.mockResolvedValue({})
})

describe("pollZzap", () => {
  test("first run imports only messages newer than now minus the margin", async () => {
    mocks.listThreads.mockResolvedValue([thread("A")])
    mocks.listMessages.mockResolvedValue([
      buyerMessage("A", "11:50:00"),
      buyerMessage("A", "11:58:00"),
    ])

    const result = await pollZzap({ auth: zzapAuth, cursor: null, now })

    expect(payloads(result).map((event) => event.messageDate)).toEqual([
      `${DAY}T11:58:00`,
    ])
    expect(result.cursor).toMatchObject({
      since: `${DAY}T11:55:00`,
      threads: { A: { lastDate: `${DAY}T11:58:00`, lastPreview: "last" } },
    })
  })

  test("builds the Geka-compatible sourceId and buyer contact", async () => {
    mocks.listThreads.mockResolvedValue([thread("A")])
    mocks.listMessages.mockResolvedValue([
      buyerMessage("A", "11:58:00", "Есть фильтр?"),
    ])

    const [event] = payloads(
      await pollZzap({ auth: zzapAuth, cursor: null, now }),
    )

    expect(event).toEqual({
      kind: "message",
      sourceId: makeZzapMessageId({
        userKey: "A",
        messageDate: `${DAY}T11:58:00`,
        senderKey: "A",
        message: "Есть фильтр?",
      }),
      userKey: "A",
      userName: "Buyer A",
      messageDate: `${DAY}T11:58:00`,
      text: "Есть фильтр?",
      buyer: { name: "Иван", phone: "+79990000000" },
    })
  })

  test("never turns shop messages into events", async () => {
    mocks.listThreads.mockResolvedValue([thread("A")])
    mocks.listMessages.mockResolvedValue([shopMessage("11:59:00")])

    const result = await pollZzap({ auth: zzapAuth, cursor: null, now })

    expect(result.events).toEqual([])
    expect(result.cursor).toMatchObject({
      threads: { A: { lastDate: `${DAY}T11:59:00` } },
    })
  })

  test("skips unchanged threads and records a baseline for new quiet ones", async () => {
    const cursor = {
      since: `${DAY}T11:50:00`,
      threads: { A: { lastDate: `${DAY}T11:58:00`, lastPreview: "last" } },
      buyers: {},
    }
    mocks.listThreads.mockResolvedValue([
      thread("A", { unread_count: 0 }),
      thread("B", {
        unread_count: 0,
        message_last_date: `${DAY}T09:00:00`,
        message_last: "old",
      }),
      thread("R", { read_only: true }),
    ])

    const result = await pollZzap({ auth: zzapAuth, cursor, now })

    expect(mocks.listMessages).not.toHaveBeenCalled()
    expect(result.cursor).toMatchObject({
      threads: {
        A: { lastDate: `${DAY}T11:58:00` },
        B: { lastDate: `${DAY}T09:00:00`, lastPreview: "old" },
      },
    })
    expect((result.cursor.threads as Record<string, unknown>).R).toBeUndefined()
  })

  test("only emits messages after the thread's last seen date", async () => {
    const cursor = {
      since: `${DAY}T11:00:00`,
      threads: { A: { lastDate: `${DAY}T11:30:00`, lastPreview: "older" } },
      buyers: { A: now.toISOString() },
    }
    mocks.listThreads.mockResolvedValue([thread("A", { unread_count: 0 })])
    mocks.listMessages.mockResolvedValue([
      buyerMessage("A", "11:20:00"),
      buyerMessage("A", "11:30:00"),
      buyerMessage("A", "11:45:00"),
    ])

    const result = await pollZzap({ auth: zzapAuth, cursor, now })

    expect(payloads(result).map((event) => event.messageDate)).toEqual([
      `${DAY}T11:30:00`,
      `${DAY}T11:45:00`,
    ])
    expect(mocks.getBuyer).not.toHaveBeenCalled()
    expect(payloads(result)[0]?.buyer).toBeNull()
  })

  test("fetches the most unread threads first and defers the rest", async () => {
    mocks.listThreads.mockResolvedValue([
      thread("A", { unread_count: 1 }),
      thread("B", { unread_count: 5 }),
      thread("C", { unread_count: 3 }),
    ])
    mocks.listMessages.mockResolvedValue([])

    const result = await pollZzap({ auth: zzapAuth, cursor: null, now })

    expect(mocks.listMessages.mock.calls.map((call) => call[1])).toEqual([
      "B",
      "C",
    ])
    expect(result.cursor).toMatchObject({
      threads: { A: { lastDate: `${DAY}T11:55:00`, lastPreview: "" } },
    })
  })

  test("stops early on a rate limit and keeps the events found so far", async () => {
    mocks.listThreads.mockResolvedValue([
      thread("A", { unread_count: 2 }),
      thread("B", { unread_count: 1 }),
    ])
    mocks.listMessages
      .mockResolvedValueOnce([buyerMessage("A", "11:58:00")])
      .mockRejectedValueOnce(new ZzapRateLimitException())

    const result = await pollZzap({ auth: zzapAuth, cursor: null, now })

    expect(payloads(result).map((event) => event.userKey)).toEqual(["A"])
    expect(mocks.getBuyer).not.toHaveBeenCalled()
    expect(result.cursor).toMatchObject({
      threads: { B: { lastDate: `${DAY}T11:55:00`, lastPreview: "" } },
    })
  })

  test("fails the whole poll on other API errors", async () => {
    mocks.listThreads.mockResolvedValue([thread("A")])
    mocks.listMessages.mockRejectedValue(new ZzapAPIException("boom", 500))

    await expect(
      pollZzap({ auth: zzapAuth, cursor: null, now }),
    ).rejects.toThrow("boom")
  })

  test("falls back to the order mentioned in chat for buyer contacts", async () => {
    mocks.getBuyer.mockResolvedValue({ name: "Иван" })
    mocks.getOrderBuyer.mockResolvedValue({
      name: "Иван Петров",
      phone: "+79991112233",
      email: "ivan@example.com",
    })
    mocks.listThreads.mockResolvedValue([thread("A")])
    mocks.listMessages.mockResolvedValue([
      buyerMessage("A", "11:58:00", "по заказу 12345678 когда отправка?"),
    ])

    const [event] = payloads(
      await pollZzap({ auth: zzapAuth, cursor: null, now }),
    )

    expect(mocks.getOrderBuyer).toHaveBeenCalledWith(zzapAuth, "12345678")
    expect(event?.buyer).toEqual({
      name: "Иван",
      phone: "+79991112233",
      email: "ivan@example.com",
    })
  })

  test("ignores enrichment failures", async () => {
    mocks.getBuyer.mockRejectedValue(new ZzapAPIException("nope", 404))
    mocks.listThreads.mockResolvedValue([thread("A")])
    mocks.listMessages.mockResolvedValue([buyerMessage("A", "11:58:00")])

    const result = await pollZzap({ auth: zzapAuth, cursor: null, now })

    expect(payloads(result)[0]?.buyer).toBeNull()
    expect((result.cursor.buyers as Record<string, string>).A).toBeUndefined()
  })

  test("prunes thread entries older than 30 days", async () => {
    const cursor = {
      since: `${DAY}T11:00:00`,
      threads: {
        OLD: { lastDate: "2026-09-01T10:00:00", lastPreview: "x" },
        NEW: { lastDate: `${DAY}T10:00:00`, lastPreview: "y" },
      },
      buyers: { OLD: "2026-09-01T07:00:00.000Z" },
    }
    mocks.listThreads.mockResolvedValue([])

    const result = await pollZzap({ auth: zzapAuth, cursor, now })

    expect(Object.keys(result.cursor.threads as object)).toEqual(["NEW"])
    expect(result.cursor.buyers).toEqual({})
  })
})
