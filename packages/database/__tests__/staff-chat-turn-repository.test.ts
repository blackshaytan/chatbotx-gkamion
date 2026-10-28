import { expect, test, vi } from "vitest"

vi.mock("../src/client", () => ({
  db: {},
  and: (...conditions: unknown[]) => ({ and: conditions }),
  eq: (column: unknown, value: unknown) => ({ eq: [column, value] }),
  gte: (column: unknown, value: unknown) => ({ gte: [column, value] }),
  isNull: (column: unknown) => ({ isNull: column }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings: [...strings],
    values,
  }),
}))
vi.mock("../src/schema", () => ({
  internalMessageModel: {
    workspaceId: "workspace",
    threadId: "thread",
    authorUserId: "author",
    kind: "kind",
    deletedAt: "deleted",
    createdAt: "created",
    id: "id",
  },
  internalThreadModel: {},
  internalThreadMemberModel: {},
  userModel: {},
  workspaceMemberModel: {},
}))
const { chatRepository } = await import("../src/repositories/chat/repository")

test("scopes pending messages by workspace, chat, employee and cursor", async () => {
  const limit = vi.fn().mockResolvedValue([])
  const orderBy = vi.fn(() => ({ limit }))
  const where = vi.fn(() => ({ orderBy }))
  const tx = { select: () => ({ from: () => ({ where }) }) } as never
  const cursorAt = new Date("2026-01-01T00:00:00Z")
  await chatRepository.listStaffEmployeeMessagesAfter({
    workspaceId: "ws",
    threadId: "chat",
    userId: "user",
    since: cursorAt,
    cursorAt,
    cursorMessageId: "42",
    limit: 100,
    tx,
  })
  expect(where).toHaveBeenCalledWith({
    and: expect.arrayContaining([
      { eq: ["workspace", "ws"] },
      { eq: ["thread", "chat"] },
      { eq: ["author", "user"] },
      { eq: ["kind", "comment"] },
      { isNull: "deleted" },
      expect.objectContaining({ values: ["created", "id", cursorAt, "42"] }),
    ]),
  })
  expect(orderBy).toHaveBeenCalledWith("created", "id")
  expect(limit).toHaveBeenCalledWith(100)
})
