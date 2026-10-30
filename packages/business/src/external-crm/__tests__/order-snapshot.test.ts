import { describe, expect, test } from "vitest"
import { toContactOrderSnapshot } from "../order-snapshot"

const occurredAt = new Date("2026-10-30T11:03:19.149Z")

describe("toContactOrderSnapshot", () => {
  test("keeps the known snapshot fields", () => {
    expect(
      toContactOrderSnapshot({
        externalOrderId: "8722",
        externalCustomerId: "27",
        status: "ПВЗ 25",
        lastEventAt: occurredAt,
        data: {
          itemSummary: "Фильтр × 1",
          amount: 2021,
          currency: "RUB",
          paymentStatus: "unpaid",
          deliveryMethod: "Самовывоз",
          secret: "drop-me",
        },
      }),
    ).toEqual({
      externalOrderId: "8722",
      externalCustomerId: "27",
      status: "ПВЗ 25",
      lastEventAt: occurredAt,
      itemSummary: "Фильтр × 1",
      amount: 2021,
      currency: "RUB",
      paymentStatus: "unpaid",
      deliveryMethod: "Самовывоз",
    })
  })

  test("omits optional fields when the snapshot is empty", () => {
    expect(
      toContactOrderSnapshot({
        externalOrderId: "1",
        externalCustomerId: "2",
        status: "Новый",
        lastEventAt: occurredAt,
        data: {},
      }),
    ).toEqual({
      externalOrderId: "1",
      externalCustomerId: "2",
      status: "Новый",
      lastEventAt: occurredAt,
    })
  })

  test("drops an invalid amount and blank text", () => {
    expect(
      toContactOrderSnapshot({
        externalOrderId: "1",
        externalCustomerId: "2",
        status: "Новый",
        lastEventAt: occurredAt,
        data: {
          amount: Number.NaN,
          itemSummary: "  ",
          currency: "",
        },
      }),
    ).toEqual({
      externalOrderId: "1",
      externalCustomerId: "2",
      status: "Новый",
      lastEventAt: occurredAt,
    })
  })

  test("ignores a non-object snapshot", () => {
    expect(
      toContactOrderSnapshot({
        externalOrderId: "1",
        externalCustomerId: "2",
        status: "Новый",
        lastEventAt: occurredAt,
        data: "not-an-object",
      }).amount,
    ).toBeUndefined()
  })
})
