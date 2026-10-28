import { expect, test } from "vitest"
import { chatMessagePublicResource } from "@/features/chats/schema/public"

test("exposes structured assistant failures in chat messages", () => {
  const result = chatMessagePublicResource.safeParse({
    id: "1",
    kind: "system",
    authorUserId: null,
    authorLabel: "Assistant",
    text: null,
    attachments: [],
    systemEvent: { type: "assistantFailed", reason: "timeout" },
    deleted: false,
    editedAt: null,
    createdAt: new Date(),
  })
  expect(result.success).toBe(true)
})

test("accepts PostgreSQL timestamp strings in chat message output", () => {
  const result = chatMessagePublicResource.safeParse({
    id: "1",
    kind: "comment",
    authorUserId: null,
    authorLabel: "Assistant",
    text: "A reply",
    attachments: [],
    systemEvent: null,
    deleted: false,
    editedAt: null,
    createdAt: "2026-10-28T10:00:00.000Z",
  })

  expect(result.success).toBe(true)
  if (result.success) {
    expect(result.data.createdAt).toBeInstanceOf(Date)
  }
})
