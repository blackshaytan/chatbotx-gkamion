// @vitest-environment node

import { conversationUnreadWhere } from "@chatbotx.io/database/queries"
import { describe, expect, test } from "vitest"
import { isConversationUnread } from "@/features/conversations/lib/is-conversation-unread"
import { buildConversationWhere } from "@/features/conversations/queries/build-conversation-where"

describe("buildConversationWhere — inboxActivityAt cursor", () => {
  test("pages past the cursor in inboxActivityAt DESC NULLS LAST, id DESC order", () => {
    const cursor = {
      inboxActivityAt: new Date("2026-10-21T10:00:00Z"),
      id: "100",
    }

    const where = buildConversationWhere("ws-1", {}, cursor)

    expect(where.OR).toEqual([
      { inboxActivityAt: { lt: cursor.inboxActivityAt } },
      { inboxActivityAt: { isNull: true } },
      { inboxActivityAt: cursor.inboxActivityAt, id: { lt: cursor.id } },
    ])
  })

  test("stays inside the null tail once the cursor has no inboxActivityAt", () => {
    const where = buildConversationWhere(
      "ws-1",
      {},
      { inboxActivityAt: null, id: "100" },
    )

    expect(where.OR).toEqual([
      { inboxActivityAt: { isNull: true }, id: { lt: "100" } },
    ])
  })

  test("never builds the cursor from lastActivityAt", () => {
    const where = buildConversationWhere(
      "ws-1",
      {},
      { inboxActivityAt: new Date("2026-10-21T10:00:00Z"), id: "1" },
    )

    expect(JSON.stringify(where)).not.toContain("lastActivityAt")
  })
})

describe("buildConversationWhere — handoverCategory filter", () => {
  test("restricts to the selected handover categories", () => {
    const where = buildConversationWhere(
      "ws-1",
      { handoverCategory: ["urgent", "return"] },
      null,
    )

    expect(where.handoverCategory).toEqual({ in: ["urgent", "return"] })
  })

  test("adds no restriction for an empty or missing selection", () => {
    expect(
      buildConversationWhere("ws-1", { handoverCategory: [] }, null)
        .handoverCategory,
    ).toBeUndefined()
    expect(
      buildConversationWhere("ws-1", {}, null).handoverCategory,
    ).toBeUndefined()
  })

  test("composes with the unread tag", () => {
    const where = buildConversationWhere(
      "ws-1",
      { handoverCategory: ["payment"], tags: ["unread"] },
      null,
    )

    expect(where.handoverCategory).toEqual({ in: ["payment"] })
    expect(where.AND).toEqual([conversationUnreadWhere])
  })
})

describe("unread predicate is anchored on inboxActivityAt", () => {
  test("the shared relational predicate compares inboxActivityAt with agentLastReadAt", () => {
    expect(conversationUnreadWhere.OR[0]).toEqual({
      agentLastReadAt: { isNull: true },
      inboxActivityAt: { isNotNull: true },
    })
    expect(Object.keys(conversationUnreadWhere.OR[1])).toEqual([
      "inboxActivityAt",
    ])
    expect(conversationUnreadWhere.OR[1].inboxActivityAt).toHaveProperty("gt")
  })

  test("the client helper ignores bot activity that only moved lastActivityAt", () => {
    expect(
      isConversationUnread({
        inboxActivityAt: new Date("2026-10-21T09:00:00Z"),
        agentLastReadAt: new Date("2026-10-21T10:00:00Z"),
        lastActivityAt: new Date("2026-10-21T11:00:00Z"),
      } as Parameters<typeof isConversationUnread>[0]),
    ).toBe(false)
  })

  test("the client helper flags a client message after the last read", () => {
    expect(
      isConversationUnread({
        inboxActivityAt: new Date("2026-10-21T11:00:00Z"),
        agentLastReadAt: new Date("2026-10-21T10:00:00Z"),
      }),
    ).toBe(true)
  })

  test("the client helper treats a never-read conversation with inbox activity as unread", () => {
    expect(
      isConversationUnread({
        inboxActivityAt: new Date("2026-10-21T11:00:00Z"),
        agentLastReadAt: null,
      }),
    ).toBe(true)
    expect(
      isConversationUnread({ inboxActivityAt: null, agentLastReadAt: null }),
    ).toBe(false)
  })
})
