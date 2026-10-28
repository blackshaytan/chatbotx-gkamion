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
