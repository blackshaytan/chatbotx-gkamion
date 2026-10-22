import { PgDialect } from "drizzle-orm/pg-core"
import { describe, expect, test } from "vitest"
import { conversationUnreadWhere } from "../src/queries/conversation-unread"

describe("conversationUnreadWhere", () => {
  test("matches the canonical unread semantics for never-read and newer-activity conversations", () => {
    expect(conversationUnreadWhere.OR[0]).toEqual({
      agentLastReadAt: { isNull: true },
      inboxActivityAt: { isNotNull: true },
    })
    expect(conversationUnreadWhere.OR[1].inboxActivityAt).toHaveProperty("gt")

    const query = new PgDialect().sqlToQuery(
      conversationUnreadWhere.OR[1].inboxActivityAt.gt,
    )
    expect(query.sql).toBe('"agentLastReadAt"')
    expect(query.params).toEqual([])
  })

  test("also treats a conversation handed to a manager as unread until it is read", () => {
    const handedOverBranch = conversationUnreadWhere.OR[2]
    expect(handedOverBranch.handedOverAt).toEqual({ isNotNull: true })
    expect(handedOverBranch.OR[0]).toEqual({
      agentLastReadAt: { isNull: true },
    })
    expect(handedOverBranch.OR[1].handedOverAt).toHaveProperty("gt")

    const query = new PgDialect().sqlToQuery(
      handedOverBranch.OR[1].handedOverAt.gt,
    )
    expect(query.sql).toBe('"agentLastReadAt"')
    expect(query.params).toEqual([])
  })
})
