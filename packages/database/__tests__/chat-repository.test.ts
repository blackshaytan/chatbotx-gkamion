import { describe, expect, test, vi } from "vitest"
import { chatRepository } from "../src/repositories/chat/repository"

const thread = {
  id: "10",
  workspaceId: "1",
  type: "direct",
  title: null,
  directKey: "1:2",
  lastMessageAt: null,
} as never

const insertTx = () => {
  const memberValues = vi.fn().mockResolvedValue(undefined)
  const memberInsert = vi.fn(() => ({ values: memberValues }))
  const threadValues = vi.fn(() => ({
    onConflictDoNothing: () => ({
      returning: vi.fn().mockResolvedValue([thread]),
    }),
  }))
  return {
    tx: {
      insert: vi
        .fn()
        .mockImplementationOnce(() => ({ values: threadValues }))
        .mockImplementationOnce(memberInsert),
    } as never,
    memberValues,
  }
}

describe("chatRepository.getOrCreate", () => {
  test("creates members with a database read timestamp for the winning insert", async () => {
    const { tx, memberValues } = insertTx()

    const result = await chatRepository.getOrCreate({
      workspaceId: "1",
      type: "direct",
      directKey: "1:2",
      title: null,
      memberUserIds: ["1", "2"],
      tx,
    })

    expect(result).toEqual({ thread, created: true })
    expect(memberValues).toHaveBeenCalledWith([
      expect.objectContaining({ threadId: "10", userId: "1" }),
      expect.objectContaining({ threadId: "10", userId: "2" }),
    ])
  })
})
