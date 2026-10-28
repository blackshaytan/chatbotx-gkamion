import { describe, expect, test, vi } from "vitest"

vi.mock("../src/client", () => ({
  db: {},
  and: (...conditions: unknown[]) => ({ and: conditions }),
  eq: (column: unknown, value: unknown) => ({ eq: [column, value] }),
  inArray: vi.fn(),
  notInArray: vi.fn(),
}))

vi.mock("../src/schema", () => ({
  externalAgentModel: { workspaceId: "workspace", purpose: "purpose" },
  externalAgentInboxModel: {},
  externalAgentConversationStateModel: {},
  internalThreadModel: { id: "threadId", workspaceId: "threadWorkspace" },
  externalAgentChatStateModel: {
    threadId: "thread",
    workspaceId: "workspace",
    runId: "run",
  },
  contactInboxModel: {},
  conversationModel: {},
}))

const { externalAgentRepository } = await import(
  "../src/repositories/external-agent/repository"
)
const { externalAgentChatStateRepository } = await import(
  "../src/repositories/external-agent/chat-state"
)

describe("external agent profile isolation", () => {
  test("reads only the requested profile within the workspace", async () => {
    const findFirst = vi.fn().mockResolvedValue(undefined)
    const tx = { query: { externalAgentModel: { findFirst } } } as never
    await externalAgentRepository.findByWorkspace("workspace-1", "staff", tx)
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: "workspace-1", purpose: "staff" },
      }),
    )
  })

  test("updates health only for the requested purpose", async () => {
    const where = vi.fn().mockResolvedValue(undefined)
    const tx = { update: () => ({ set: () => ({ where }) }) } as never
    await externalAgentRepository.updateCheck(
      {
        workspaceId: "workspace-1",
        purpose: "staff",
        status: "ok",
        error: null,
        checkedAt: new Date(),
      },
      tx,
    )
    expect(where).toHaveBeenCalledWith({
      and: [{ eq: ["workspace", "workspace-1"] }, { eq: ["purpose", "staff"] }],
    })
  })

  test("uses workspace and purpose as the upsert conflict key", async () => {
    const returning = vi.fn().mockResolvedValue([{ id: "agent" }])
    const onConflictDoUpdate = vi.fn(() => ({ returning }))
    const values = vi.fn(() => ({ onConflictDoUpdate }))
    const tx = { insert: () => ({ values }) } as never
    await externalAgentRepository.upsert(
      { workspaceId: "workspace-1", purpose: "staff", values: {} as never },
      tx,
    )
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: "staff" }),
    )
    expect(onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ target: ["workspace", "purpose"] }),
    )
  })
})

describe("staff assistant run state", () => {
  test("guards patches by workspace, thread and expected run", async () => {
    const returning = vi.fn().mockResolvedValue([{ threadId: "thread-1" }])
    const where = vi.fn(() => ({ returning }))
    const tx = { update: () => ({ set: () => ({ where }) }) } as never
    await externalAgentChatStateRepository.patch(
      {
        workspaceId: "workspace-1",
        threadId: "thread-1",
        expectedRunId: "run-1",
        values: { runId: null },
      },
      tx,
    )
    expect(where).toHaveBeenCalledWith({
      and: [
        { eq: ["thread", "thread-1"] },
        { eq: ["workspace", "workspace-1"] },
        { eq: ["run", "run-1"] },
      ],
    })
  })

  test("rejects a conflicting state owned by another workspace", async () => {
    const returning = vi.fn().mockResolvedValue([])
    const onConflictDoUpdate = vi.fn(() => ({ returning }))
    const where = vi.fn(() => ({
      for: vi.fn().mockResolvedValue([{ id: "thread-1" }]),
    }))
    const tx = {
      select: () => ({ from: () => ({ where }) }),
      insert: () => ({ values: () => ({ onConflictDoUpdate }) }),
    } as never
    await expect(
      externalAgentChatStateRepository.upsert(
        {
          workspaceId: "workspace-1",
          threadId: "thread-1",
          includeHistory: true,
          lastEventSeq: -1,
          failureCount: 0,
          updatedAt: new Date(),
        },
        tx,
      ),
    ).rejects.toThrow("different workspace")
    expect(onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        setWhere: { eq: ["workspace", "workspace-1"] },
      }),
    )
    expect(where).toHaveBeenCalledWith({
      and: [
        { eq: ["threadId", "thread-1"] },
        { eq: ["threadWorkspace", "workspace-1"] },
      ],
    })
  })

  test("rejects a thread from another workspace before inserting", async () => {
    const insert = vi.fn()
    const tx = {
      select: () => ({
        from: () => ({ where: () => ({ for: vi.fn().mockResolvedValue([]) }) }),
      }),
      insert,
    } as never
    await expect(
      externalAgentChatStateRepository.upsert(
        {
          workspaceId: "wrong-workspace",
          threadId: "thread-1",
          includeHistory: true,
          lastEventSeq: -1,
          failureCount: 0,
          updatedAt: new Date(),
        },
        tx,
      ),
    ).rejects.toThrow("does not belong to workspace")
    expect(insert).not.toHaveBeenCalled()
  })
})
