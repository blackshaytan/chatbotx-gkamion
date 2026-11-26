import { beforeEach, describe, expect, test, vi } from "vitest"

const mocks = vi.hoisted(() => {
  const deleteWhere = vi.fn()
  return {
    decrement: vi.fn(),
    deleteWhere,
    dispatchAuditRecord: vi.fn(),
    findFirst: vi.fn(),
    reassignFromMember: vi.fn(),
    deleteNotificationsForUser: vi.fn(),
    clearOwnerForUser: vi.fn(),
    transactionClient: {} as Record<string, unknown>,
  }
})

const makeClient = () => ({
  query: {
    workspaceMemberModel: { findFirst: mocks.findFirst },
  },
  delete: vi.fn(() => ({ where: mocks.deleteWhere })),
})

Object.assign(mocks.transactionClient, makeClient())

vi.mock("../src/audit/dispatcher", () => ({
  dispatchAuditRecord: mocks.dispatchAuditRecord,
}))

vi.mock("../src/workspace-usage/service", () => ({
  workspaceUsageService: {
    decrement: mocks.decrement,
    increment: vi.fn(async () => undefined),
  },
}))

vi.mock("../src/task/service", () => ({
  taskService: {
    reassignFromMember: mocks.reassignFromMember,
  },
}))

vi.mock("@chatbotx.io/database/client", () => ({
  and: (...args: unknown[]) => ({ and: args }),
  db: {
    ...makeClient(),
    transaction: vi.fn((run: (tx: unknown) => unknown) =>
      run(mocks.transactionClient),
    ),
  },
  eq: (...args: unknown[]) => ({ eq: args }),
}))

vi.mock("@chatbotx.io/database/partials", () => ({
  workspaceMemberRoles: { enum: { owner: "owner" } },
}))

vi.mock("@chatbotx.io/database/schema", () => ({
  workspaceMemberModel: {
    id: "workspaceMember.id",
    workspaceId: "workspaceMember.workspaceId",
  },
}))

vi.mock("@chatbotx.io/database/repositories", () => ({
  notificationRepository: {
    deleteForUser: mocks.deleteNotificationsForUser,
  },
  inboxRepository: {
    clearOwnerForUser: mocks.clearOwnerForUser,
  },
}))

vi.mock("@chatbotx.io/redis", () => ({
  withCache: vi.fn(),
  invalidateCacheByTags: vi.fn(async () => undefined),
}))

const { workspaceMemberService } = await import(
  "../src/workspace-member/service"
)

beforeEach(() => {
  vi.clearAllMocks()
  mocks.decrement.mockResolvedValue(undefined)
  mocks.findFirst.mockResolvedValue({
    id: "member-1",
    userId: "user-ada",
    user: { name: "Ada", email: "ada@example.com" },
  })
})

describe("workspaceMemberService.delete clears personal smtp ownership", () => {
  test("clears the removed member's inbox owner in the delete transaction", async () => {
    await workspaceMemberService.delete({
      id: "member-1",
      workspaceId: "workspace-1",
    })

    expect(mocks.clearOwnerForUser).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      userId: "user-ada",
      tx: mocks.transactionClient,
    })
  })

  test("uses the caller-owned transaction when one is supplied", async () => {
    const tx = makeClient()

    await workspaceMemberService.delete({
      id: "member-1",
      workspaceId: "workspace-1",
      tx: tx as never,
    })

    expect(mocks.clearOwnerForUser).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      userId: "user-ada",
      tx,
    })
  })

  test("does not touch inbox ownership when the member does not exist", async () => {
    mocks.findFirst.mockResolvedValue(undefined)

    await workspaceMemberService.delete({
      id: "missing-member",
      workspaceId: "workspace-1",
    })

    expect(mocks.clearOwnerForUser).not.toHaveBeenCalled()
  })
})
