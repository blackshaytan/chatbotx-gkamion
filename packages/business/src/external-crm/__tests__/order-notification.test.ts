import { describe, expect, test } from "vitest"
import {
  classifyChannelFailure,
  decideOrderEvent,
  flowMatchesOrderStatus,
  isCancelableNotificationWait,
  nextCascadeAction,
  notificationLogExpired,
  orderConditionGroupMatches,
  planCascadeCandidates,
  renderOrderNotificationText,
  runNotificationCascade,
} from "../order-notification"

const at = (iso: string) => new Date(iso)

describe("decideOrderEvent", () => {
  test("rejects an unlinked customer with no phone and no email, before anything is stored", () => {
    expect(
      decideOrderEvent({
        linked: false,
        hasPhoneOrEmail: false,
        existing: null,
        latestAcceptedAt: null,
        occurredAt: at("2026-11-05T10:00:00.000Z"),
      }),
    ).toEqual({ kind: "reject" })
  })

  test("a repeated event id does not reset a wait and does not send again", () => {
    expect(
      decideOrderEvent({
        linked: true,
        hasPhoneOrEmail: true,
        existing: { runsCreated: true },
        latestAcceptedAt: null,
        occurredAt: at("2026-11-05T10:00:00.000Z"),
      }),
    ).toEqual({ kind: "duplicate" })
  })

  test("a repeated event id only creates the runs when they were not created", () => {
    expect(
      decideOrderEvent({
        linked: true,
        hasPhoneOrEmail: false,
        existing: { runsCreated: false },
        latestAcceptedAt: null,
        occurredAt: at("2026-11-05T10:00:00.000Z"),
      }),
    ).toEqual({ kind: "resume" })
  })

  test("an older event stays in history and does not start a flow", () => {
    expect(
      decideOrderEvent({
        linked: true,
        hasPhoneOrEmail: true,
        existing: null,
        latestAcceptedAt: at("2026-11-05T12:00:00.000Z"),
        occurredAt: at("2026-11-05T10:00:00.000Z"),
      }),
    ).toEqual({ kind: "history" })
  })

  test("accepts a newer event for a linked customer", () => {
    expect(
      decideOrderEvent({
        linked: true,
        hasPhoneOrEmail: false,
        existing: null,
        latestAcceptedAt: at("2026-11-05T09:00:00.000Z"),
        occurredAt: at("2026-11-05T10:00:00.000Z"),
      }),
    ).toEqual({ kind: "accept" })
  })
})

describe("flow subscription", () => {
  const nodes = [
    {
      data: {
        details: {
          steps: [
            {
              stepType: "sendOrderNotification",
              subject: "order",
              statusIds: [21, 22, 23],
            },
          ],
        },
      },
    },
    {
      data: {
        details: {
          steps: [
            {
              stepType: "sendOrderNotification",
              subject: "item",
              statusIds: [16],
            },
          ],
        },
      },
    },
  ]

  test("pickup statuses 21, 22 and 23 match an order flow and do not match an item flow", () => {
    expect(
      flowMatchesOrderStatus(nodes, { subject: "order", statusId: 22 }),
    ).toBe(true)
    expect(
      flowMatchesOrderStatus(nodes, { subject: "item", statusId: 22 }),
    ).toBe(false)
  })

  test("delivery status 16 matches only the item or order flow that lists it", () => {
    expect(
      flowMatchesOrderStatus(nodes, { subject: "item", statusId: 16 }),
    ).toBe(true)
    expect(
      flowMatchesOrderStatus(nodes, { subject: "order", statusId: 16 }),
    ).toBe(false)
  })
})

describe("order conditions", () => {
  const orderPackage = {
    deliveryMethod: "delivery" as const,
    hasDebt: true,
    amount: 1500,
  }

  test("pickup, delivery, debt and an amount threshold let the run through or skip it", () => {
    expect(
      orderConditionGroupMatches(
        {
          operator: "and",
          conditions: [
            { field: "deliveryMethod", operator: "is", value: "delivery" },
            { field: "hasDebt", operator: "is", value: "true" },
            { field: "amount", operator: "gt", value: "1000" },
          ],
        },
        orderPackage,
      ),
    ).toBe(true)
    expect(
      orderConditionGroupMatches(
        {
          operator: "and",
          conditions: [
            { field: "deliveryMethod", operator: "is", value: "pickup" },
          ],
        },
        orderPackage,
      ),
    ).toBe(false)
  })

  test("a missing field does not match, so the message is not sent", () => {
    expect(
      orderConditionGroupMatches(
        {
          operator: "and",
          conditions: [{ field: "hasDebt", operator: "is", value: "false" }],
        },
        { deliveryMethod: "pickup" },
      ),
    ).toBe(false)
  })

  test("checks in one branch are combined with and", () => {
    expect(
      orderConditionGroupMatches(
        {
          operator: "and",
          conditions: [
            { field: "deliveryMethod", operator: "is", value: "delivery" },
            { field: "amount", operator: "lt", value: "1000" },
          ],
        },
        orderPackage,
      ),
    ).toBe(false)
  })
})

describe("notification waits", () => {
  test("an order event cancels only waiting pauses of that order", () => {
    expect(
      isCancelableNotificationWait({
        metadata: {
          type: "orderNotification",
          subject: "order",
          externalOrderId: "778",
          flowRunId: "run-1",
        },
        subject: "order",
        externalOrderId: "778",
        sendStartedRunIds: new Set(),
      }),
    ).toBe(true)
    expect(
      isCancelableNotificationWait({
        metadata: {
          type: "orderNotification",
          subject: "order",
          externalOrderId: "779",
          flowRunId: "run-2",
        },
        subject: "order",
        externalOrderId: "778",
        sendStartedRunIds: new Set(),
      }),
    ).toBe(false)
  })

  test("an item event cancels only pauses of that item", () => {
    expect(
      isCancelableNotificationWait({
        metadata: {
          type: "orderNotification",
          subject: "item",
          externalOrderId: "778",
          externalOrderItemId: "item-9",
          flowRunId: "run-3",
        },
        subject: "item",
        externalOrderId: "778",
        externalOrderItemId: "item-9",
        sendStartedRunIds: new Set(),
      }),
    ).toBe(true)
    expect(
      isCancelableNotificationWait({
        metadata: {
          type: "orderNotification",
          subject: "order",
          externalOrderId: "778",
          flowRunId: "run-1",
        },
        subject: "item",
        externalOrderId: "778",
        externalOrderItemId: "item-9",
        sendStartedRunIds: new Set(),
      }),
    ).toBe(false)
  })

  test("a run that already entered the send step is not cancelled", () => {
    expect(
      isCancelableNotificationWait({
        metadata: {
          type: "orderNotification",
          subject: "order",
          externalOrderId: "778",
          flowRunId: "run-1",
        },
        subject: "order",
        externalOrderId: "778",
        sendStartedRunIds: new Set(["run-1"]),
      }),
    ).toBe(false)
  })
})

describe("notification text", () => {
  test("a missing package field leaves an empty place and the message still renders", () => {
    expect(
      renderOrderNotificationText(
        "Заказ {{orderNumber}}: {{itemSummary}} на {{amount}}. {{billUrl}}",
        { orderNumber: "A-1", amount: 0 },
      ),
    ).toBe("Заказ A-1:  на 0. ")
  })
})

describe("channel cascade", () => {
  const inboxes = [
    {
      id: "max-old",
      channel: "max",
      lastMessageAt: at("2026-11-01T00:00:00.000Z"),
    },
    {
      id: "max-new",
      channel: "max",
      lastMessageAt: at("2026-11-04T00:00:00.000Z"),
    },
    {
      id: "tg",
      channel: "telegram",
      lastMessageAt: at("2026-11-03T00:00:00.000Z"),
    },
    { id: "zz", channel: "zzap", lastMessageAt: null },
  ]

  test("uses the latest dialog of each channel in cascade order", () => {
    expect(
      planCascadeCandidates({
        inboxes,
        messengerText: "hello",
        emailText: "mail",
        email: "a@example.com",
        smtpInboxCount: 1,
      }).map((candidate) => [candidate.channel, candidate.contactInboxId]),
    ).toEqual([
      ["max", "max-new"],
      ["telegram", "tg"],
      ["zzap", "zz"],
      ["smtp", null],
    ])
  })

  test("an empty messenger text skips messengers and an empty mail text skips mail", () => {
    expect(
      planCascadeCandidates({
        inboxes,
        messengerText: "",
        emailText: "mail",
        email: "a@example.com",
        smtpInboxCount: 1,
      }).map((candidate) => candidate.channel),
    ).toEqual(["smtp"])
    expect(
      planCascadeCandidates({
        inboxes,
        messengerText: "hello",
        emailText: " ",
        email: "a@example.com",
        smtpInboxCount: 1,
      }).map((candidate) => candidate.channel),
    ).toEqual(["max", "telegram", "zzap"])
  })

  test("mail is skipped when there is not exactly one SMTP inbox and no mail dialog", () => {
    expect(
      planCascadeCandidates({
        inboxes,
        messengerText: "",
        emailText: "mail",
        email: "a@example.com",
        smtpInboxCount: 2,
      }),
    ).toEqual([])
  })

  test("the first channel that accepts stops the rest", async () => {
    const sent: string[] = []
    const recorded: string[] = []
    const result = await runNotificationCascade({
      candidates: [
        { channel: "max", contactInboxId: "max-new" },
        { channel: "telegram", contactInboxId: "tg" },
      ],
      attempts: [],
      messengerText: "hello",
      emailText: "",
      send: (candidate) => {
        sent.push(candidate.channel)
        return Promise.resolve(
          candidate.channel === "max"
            ? { outcome: "rejected" as const, reason: "blocked" }
            : { outcome: "accepted" as const },
        )
      },
      record: (attempt) => {
        recorded.push(`${attempt.channel}:${attempt.outcome}`)
        return Promise.resolve()
      },
    })

    expect(result).toEqual({ status: "success", reason: "accepted" })
    expect(sent).toEqual(["max", "telegram"])
    expect(recorded).toEqual(["max:rejected", "telegram:accepted"])
  })

  test("an unclear result stops the cascade and a retry does not continue it", async () => {
    const sent: string[] = []
    const first = await runNotificationCascade({
      candidates: [
        { channel: "max", contactInboxId: "1" },
        { channel: "telegram", contactInboxId: "2" },
      ],
      attempts: [],
      messengerText: "hello",
      emailText: "",
      send: (candidate) => {
        sent.push(candidate.channel)
        return Promise.resolve({
          outcome: "unclear" as const,
          reason: "timeout",
        })
      },
      record: () => Promise.resolve(),
    })
    expect(first).toEqual({ status: "error", reason: "unclear" })
    expect(sent).toEqual(["max"])

    const retry = await runNotificationCascade({
      candidates: [
        { channel: "max", contactInboxId: "1" },
        { channel: "telegram", contactInboxId: "2" },
      ],
      attempts: [
        {
          channel: "max",
          outcome: "unclear",
          reason: "timeout",
          at: "2026-11-05T10:00:00.000Z",
        },
      ],
      messengerText: "hello",
      emailText: "",
      send: () => Promise.reject(new Error("must not send")),
      record: () => Promise.resolve(),
    })
    expect(retry).toEqual({ status: "error", reason: "unclear" })
  })

  test("a channel that already accepted is not sent again", () => {
    expect(
      nextCascadeAction({
        candidates: [
          { channel: "max", contactInboxId: "1" },
          { channel: "telegram", contactInboxId: "2" },
        ],
        attempts: [
          {
            channel: "max",
            outcome: "accepted",
          },
        ],
        messengerText: "hello",
        emailText: "",
      }),
    ).toEqual({ action: "stop", status: "success", reason: "accepted" })
  })

  test("no channel left is an error and is not retried into a second send", () => {
    expect(
      nextCascadeAction({
        candidates: [{ channel: "max", contactInboxId: "1" }],
        attempts: [{ channel: "max", outcome: "rejected" }],
        messengerText: "hello",
        emailText: "",
      }),
    ).toEqual({ action: "stop", status: "error", reason: "exhausted" })
  })

  test("both texts empty is an error and writes no channel attempt", () => {
    expect(
      nextCascadeAction({
        candidates: [],
        attempts: [],
        messengerText: " ",
        emailText: "",
      }),
    ).toEqual({ action: "stop", status: "error", reason: "empty" })
  })

  test("a timeout is unclear and an explicit refusal is a rejection", () => {
    expect(classifyChannelFailure({ timedOut: true })).toBe("unclear")
    expect(classifyChannelFailure({ category: "network_error" })).toBe(
      "unclear",
    )
    expect(classifyChannelFailure({ category: "user_blocked" })).toBe(
      "rejected",
    )
  })
})

describe("notification log retention", () => {
  test("attempt records older than 30 days expire", () => {
    expect(
      notificationLogExpired(
        at("2026-10-01T00:00:00.000Z"),
        at("2026-11-01T00:00:00.000Z"),
      ),
    ).toBe(true)
    expect(
      notificationLogExpired(
        at("2026-10-20T00:00:00.000Z"),
        at("2026-11-05T00:00:00.000Z"),
      ),
    ).toBe(false)
  })
})
