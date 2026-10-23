import { beforeEach, describe, expect, test, vi } from "vitest"

type RouteConfig = {
  method: string
  path: string
  successStatus?: number
  spec?: unknown
}
type CapturedProcedure = {
  route: RouteConfig
  handler?: (...args: never[]) => unknown
}

const { workspaceTokenAuthAPIForScope, capturedProcedures } = vi.hoisted(() => {
  const capturedProcedures: CapturedProcedure[] = []
  const makeProcedure = (route: RouteConfig) => {
    const record: CapturedProcedure = { route }
    capturedProcedures.push(record)
    const chain = {
      input: vi.fn(() => chain),
      output: vi.fn(() => chain),
      errors: vi.fn(() => chain),
      handler: vi.fn((fn: CapturedProcedure["handler"]) => {
        record.handler = fn
        return { handler: fn }
      }),
    }
    return chain
  }
  const api = { route: vi.fn((config: RouteConfig) => makeProcedure(config)) }
  return {
    workspaceTokenAuthAPIForScope: vi.fn((_scope: string) => api),
    capturedProcedures,
  }
})

vi.mock("@/orpc", () => ({ workspaceTokenAuthAPIForScope }))

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

await import("@/features/tasks/api/public")

const scopeAtImport = workspaceTokenAuthAPIForScope.mock.calls[0]?.[0]

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

const call = (method: string, path: string, input: object) =>
  (
    procedureFor(method, path).handler as unknown as (args: {
      context: { workspace: { id: string }; apiToken: { name: string } }
      input: object
    }) => Promise<unknown>
  )({
    context: { workspace: { id: "ws-1" }, apiToken: { name: "Hermes" } },
    input,
  })

beforeEach(() => {
  vi.clearAllMocks()
})

test("every procedure sits under the tasks scope", () => {
  expect(scopeAtImport).toBe("tasks")
})

describe("registered operations", () => {
  test.each([
    ["GET", "/v1/tasks"],
    ["GET", "/v1/tasks/count"],
    ["POST", "/v1/tasks"],
    ["GET", "/v1/tasks/{id}"],
    ["PATCH", "/v1/tasks/{id}"],
    ["POST", "/v1/tasks/{id}/complete"],
    ["POST", "/v1/tasks/{id}/take"],
    ["DELETE", "/v1/tasks/{id}"],
    ["POST", "/v1/tasks/{id}/watchers"],
    ["DELETE", "/v1/tasks/{id}/watchers/{userId}"],
    ["GET", "/v1/tasks/{id}/comments"],
    ["POST", "/v1/tasks/{id}/comments"],
  ])("%s %s", (method, path) => {
    expect(procedureFor(method, path)).toBeDefined()
  })

  test("creates answer 201, deletes 204, list and create are default MCP tools", () => {
    expect(procedureFor("POST", "/v1/tasks").route.successStatus).toBe(201)
    expect(
      procedureFor("POST", "/v1/tasks/{id}/comments").route.successStatus,
    ).toBe(201)
    expect(procedureFor("DELETE", "/v1/tasks/{id}").route.successStatus).toBe(
      204,
    )
    expect(
      procedureFor("DELETE", "/v1/tasks/{id}/watchers/{userId}").route
        .successStatus,
    ).toBe(204)
    expect(procedureFor("GET", "/v1/tasks").route.spec).toBeTypeOf("function")
    expect(procedureFor("GET", "/v1/tasks/count").route.spec).toBeTypeOf(
      "function",
    )
    expect(procedureFor("POST", "/v1/tasks").route.spec).toBeTypeOf("function")
  })

  test("count route is registered before get so count is not captured by {id}", () => {
    const countIndex = capturedProcedures.findIndex(
      (procedure) =>
        procedure.route.method === "GET" &&
        procedure.route.path === "/v1/tasks/count",
    )
    const getIndex = capturedProcedures.findIndex(
      (procedure) =>
        procedure.route.method === "GET" &&
        procedure.route.path === "/v1/tasks/{id}",
    )
    expect(countIndex).toBeGreaterThanOrEqual(0)
    expect(getIndex).toBeGreaterThan(countIndex)
  })
})

describe("handlers", () => {
  test("create acts as the token and maps assignee and links", async () => {
    taskService.create.mockResolvedValue({ id: "t-1" })
    await call("POST", "/v1/tasks", {
      title: "Проверить наличие",
      assigneeTeamId: "team-1",
      conversationId: "conv-1",
      messageId: "m-1",
    })
    expect(taskService.create).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      actor: { kind: "api", label: "Hermes" },
      title: "Проверить наличие",
      description: undefined,
      priority: undefined,
      dueAt: undefined,
      remindAt: undefined,
      assignee: { type: "team", teamId: "team-1" },
      watcherUserIds: undefined,
      targets: {
        contactId: undefined,
        conversationId: "conv-1",
        messageId: "m-1",
      },
    })
  })

  test("create without an assignee is a validation error", async () => {
    await expect(call("POST", "/v1/tasks", { title: "x" })).rejects.toThrow(
      "Set assigneeUserId or assigneeTeamId",
    )
    await expect(
      call("POST", "/v1/tasks", {
        title: "x",
        assigneeUserId: "u-1",
        assigneeTeamId: "t-1",
      }),
    ).rejects.toThrow("Set only one of assigneeUserId or assigneeTeamId")
  })

  test("list is scoped to the token's workspace and never member-scoped", async () => {
    taskService.list.mockResolvedValue({ data: [], pageCount: 0 })
    await call("GET", "/v1/tasks", { page: 1, perPage: 50, status: "open" })
    expect(taskService.list).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      page: 1,
      perPage: 50,
      status: "open",
    })
  })

  test("list forwards teamMemberUserId filter", async () => {
    taskService.list.mockResolvedValue({ data: [], pageCount: 0 })
    await call("GET", "/v1/tasks", {
      page: 1,
      perPage: 50,
      teamMemberUserId: "u-7",
    })
    expect(taskService.list).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      page: 1,
      perPage: 50,
      teamMemberUserId: "u-7",
    })
  })

  test("count applies filters on the workspace", async () => {
    taskService.count.mockResolvedValue({ total: 3 })
    await call("GET", "/v1/tasks/count", { status: "open", due: "overdue" })
    expect(taskService.count).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      status: "open",
      due: "overdue",
    })
  })

  test("take uses request userId and api token actor", async () => {
    taskService.take.mockResolvedValue({ id: "t-1" })
    await call("POST", "/v1/tasks/{id}/take", { id: "t-1", userId: "u-2" })
    expect(taskService.take).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      id: "t-1",
      userId: "u-2",
      actor: { kind: "api", label: "Hermes" },
    })
  })

  test("update passes only the given fields", async () => {
    taskService.update.mockResolvedValue({ id: "t-1" })
    await call("PATCH", "/v1/tasks/{id}", {
      id: "t-1",
      status: "in_progress",
      dueAt: null,
    })
    expect(taskService.update).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      id: "t-1",
      actor: { kind: "api", label: "Hermes" },
      patch: { status: "in_progress", dueAt: null },
    })
  })

  test("comments are written as the token", async () => {
    taskService.addComment.mockResolvedValue({ id: "m-1" })
    await call("POST", "/v1/tasks/{id}/comments", {
      id: "t-1",
      text: "Нет на складе",
    })
    expect(taskService.addComment).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      id: "t-1",
      text: "Нет на складе",
      actor: { kind: "api", label: "Hermes" },
    })
  })
})
