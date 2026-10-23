// @vitest-environment node

import { beforeEach, describe, expect, test, vi } from "vitest"

vi.mock("@chatbotx.io/database/client", () => {
  const proxy: unknown = new Proxy(() => proxy, { get: () => proxy })
  return { db: proxy, sql: proxy }
})

type RouteConfig = {
  method: string
  path: string
  successStatus?: number
}
type CapturedProcedure = {
  route: RouteConfig
  handler?: (...args: never[]) => unknown
}

const { authorizedAPI, workspaceAuthorizedMidddleware, capturedProcedures } =
  vi.hoisted(() => {
    const capturedProcedures: CapturedProcedure[] = []
    const makeProcedure = (route: RouteConfig) => {
      const record: CapturedProcedure = { route }
      capturedProcedures.push(record)
      const chain = {
        input: vi.fn(() => chain),
        output: vi.fn(() => chain),
        errors: vi.fn(() => chain),
        use: vi.fn(() => chain),
        handler: vi.fn((fn: CapturedProcedure["handler"]) => {
          record.handler = fn
          return { handler: fn }
        }),
      }
      return chain
    }
    return {
      authorizedAPI: {
        route: vi.fn((config: RouteConfig) => makeProcedure(config)),
      },
      workspaceAuthorizedMidddleware: vi.fn(),
      capturedProcedures,
    }
  })

vi.mock("@/orpc", () => ({ authorizedAPI }))
vi.mock("@/middlewares/auth", () => ({ workspaceAuthorizedMidddleware }))

vi.mock("@/features/contacts/permissions", () => ({
  buildContactPermissionScope: ({
    permissions,
    userId,
  }: {
    permissions: Record<string, boolean | undefined>
    userId: string
  }) => {
    if (!(permissions.contacts || permissions.onlyAssignedContacts)) {
      return null
    }
    return {
      canViewEmailAndPhone: false,
      restrictToAssignedUserId: permissions.onlyAssignedContacts
        ? userId
        : undefined,
    }
  },
}))

const taskService = {
  list: vi.fn(),
  count: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  complete: vi.fn(),
  take: vi.fn(),
  delete: vi.fn(),
  addWatcher: vi.fn(),
  removeWatcher: vi.fn(),
  listComments: vi.fn(),
  addComment: vi.fn(),
}
vi.mock("@chatbotx.io/business", () => ({ taskService }))

await import("@/features/tasks/api/private")

const procedureFor = (method: string, path: string) => {
  const found = capturedProcedures.find(
    (procedure) =>
      procedure.route.method === method && procedure.route.path === path,
  )
  if (!found?.handler) {
    throw new Error(`No procedure registered for ${method} ${path}`)
  }
  return found
}

const sessionContext = {
  user: { id: "member-7" },
  workspace: { ownerId: "owner-1" },
  workspaceMember: {
    permissions: { contacts: true, onlyAssignedContacts: true },
  },
}

const call = (method: string, path: string, input: object) =>
  (
    procedureFor(method, path).handler as unknown as (args: {
      context: typeof sessionContext
      input: object
    }) => Promise<unknown>
  )({
    context: sessionContext,
    input,
  })

beforeEach(() => {
  vi.clearAllMocks()
})

describe("registered operations", () => {
  test.each([
    ["GET", "/workspaces/{workspaceId}/tasks"],
    ["GET", "/workspaces/{workspaceId}/tasks/count"],
    ["GET", "/workspaces/{workspaceId}/tasks/{id}"],
    ["POST", "/workspaces/{workspaceId}/tasks"],
    ["PATCH", "/workspaces/{workspaceId}/tasks/{id}"],
    ["POST", "/workspaces/{workspaceId}/tasks/{id}/complete"],
    ["POST", "/workspaces/{workspaceId}/tasks/{id}/take"],
    ["DELETE", "/workspaces/{workspaceId}/tasks/{id}"],
    ["POST", "/workspaces/{workspaceId}/tasks/{id}/watchers"],
    ["DELETE", "/workspaces/{workspaceId}/tasks/{id}/watchers/{userId}"],
    ["GET", "/workspaces/{workspaceId}/tasks/{id}/comments"],
    ["POST", "/workspaces/{workspaceId}/tasks/{id}/comments"],
  ])("%s %s", (method, path) => {
    expect(procedureFor(method, path)).toBeDefined()
  })

  test("create returns 201 and delete returns 204", () => {
    expect(
      procedureFor("POST", "/workspaces/{workspaceId}/tasks").route
        .successStatus,
    ).toBe(201)
    expect(
      procedureFor("DELETE", "/workspaces/{workspaceId}/tasks/{id}").route
        .successStatus,
    ).toBe(204)
    expect(
      procedureFor(
        "DELETE",
        "/workspaces/{workspaceId}/tasks/{id}/watchers/{userId}",
      ).route.successStatus,
    ).toBe(204)
  })
})

describe("handlers", () => {
  test("list with tab mine applies assignee filter and session access scope", async () => {
    taskService.list.mockResolvedValue({ data: [], pageCount: 0 })
    await call("GET", "/workspaces/{workspaceId}/tasks", {
      workspaceId: "ws-1",
      tab: "mine",
      page: 1,
      perPage: 20,
    })
    expect(taskService.list).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      page: 1,
      perPage: 20,
      assigneeUserId: "member-7",
      accessScope: { restrictToAssignedUserId: "member-7" },
    })
  })

  test("create uses session actor", async () => {
    taskService.create.mockResolvedValue({ id: "t-1" })
    await call("POST", "/workspaces/{workspaceId}/tasks", {
      workspaceId: "ws-1",
      title: "Follow up",
      assigneeUserId: "member-7",
    })
    expect(taskService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws-1",
        actor: { kind: "user", userId: "member-7", isOwner: false },
        title: "Follow up",
        assignee: { type: "user", userId: "member-7" },
      }),
    )
  })

  test("take assigns to the signed-in member", async () => {
    taskService.take.mockResolvedValue({ id: "t-1" })
    await call("POST", "/workspaces/{workspaceId}/tasks/{id}/take", {
      workspaceId: "ws-1",
      id: "t-1",
    })
    expect(taskService.take).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      id: "t-1",
      userId: "member-7",
      actor: { kind: "user", userId: "member-7", isOwner: false },
    })
  })
})
