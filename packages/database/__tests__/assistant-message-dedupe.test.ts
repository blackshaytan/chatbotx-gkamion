import { expect, test, vi } from "vitest"

vi.mock("../src/client", () => ({
  db: {},
  and: vi.fn(),
  eq: vi.fn(),
  inArray: vi.fn(),
  isNull: vi.fn(),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings: [...strings],
    values,
  }),
}))
vi.mock("../src/schema", () => ({
  internalMessageModel: { threadId: "thread", dedupeKey: "dedupe" },
  internalThreadModel: {},
  internalThreadMemberModel: {},
}))
const { internalThreadRepository } = await import(
  "../src/repositories/internal-thread/repository"
)

test("uses the partial thread and dedupe key index when inserting once", async () => {
  const returning = vi.fn().mockResolvedValue([])
  const onConflictDoNothing = vi.fn(() => ({ returning }))
  const tx = {
    insert: () => ({ values: () => ({ onConflictDoNothing }) }),
  } as never
  await expect(
    internalThreadRepository.insertDeduplicatedMessage({
      row: {
        workspaceId: "ws",
        threadId: "thread",
        dedupeKey: "run:final",
      } as never,
      tx,
    }),
  ).resolves.toBeUndefined()
  expect(onConflictDoNothing).toHaveBeenCalledWith({
    target: ["thread", "dedupe"],
    where: { strings: ["", " IS NOT NULL"], values: ["dedupe"] },
  })
})
