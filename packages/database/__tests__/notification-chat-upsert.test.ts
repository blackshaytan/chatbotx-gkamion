import { PgDialect } from "drizzle-orm/pg-core"
import { expect, test, vi } from "vitest"
import { notificationRepository } from "../src/repositories/notification/repository"

const numericId = /^\d+$/

test("chat notification upsert supplies an ID for every raw SQL insert", async () => {
  const execute = vi.fn().mockResolvedValue({ rows: [] })
  const payload = {
    actorUserId: null,
    actorLabel: "Assistant",
    excerpt: "Test",
    count: 1,
    lastMessageId: "20",
    lastMessageAt: new Date().toISOString(),
  }
  await notificationRepository.upsertChatUnread({
    rows: [
      {
        workspaceId: "1",
        userId: "2",
        entityId: "4",
        entityType: "chat",
        type: "chatMessage",
        payload,
      },
      {
        workspaceId: "1",
        userId: "3",
        entityId: "4",
        entityType: "chat",
        type: "chatMessage",
        payload,
      },
    ],
    tx: { execute } as never,
  })
  const query = new PgDialect().sqlToQuery(execute.mock.calls[0][0])
  expect(query.sql).toContain('INSERT INTO "Notification" ("id", "workspaceId"')
  expect(query.params).toHaveLength(12)
  expect(query.params[0]).toMatch(numericId)
  expect(query.params[6]).toMatch(numericId)
  expect(query.params[0]).not.toBe(query.params[6])
  expect(query.sql).toContain(
    'ON CONFLICT ("workspaceId", "userId", "entityId")',
  )
})
