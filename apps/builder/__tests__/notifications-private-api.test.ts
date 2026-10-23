// @vitest-environment node

import { beforeEach, describe, expect, test, vi } from "vitest"

type RouteConfig = {
  method: string
  path: string
  successStatus?: number
}
type CapturedProcedure = {
  route: RouteConfig
  handler?: (...args: never[]) => unknown
  protected?: boolean
}

const { authorizedAPI, capturedProcedures, workspaceAuthorizedMidddleware } =
  vi.hoisted(() => {
    const capturedProcedures: CapturedProcedure[] = []
    const makeProcedure = (route: RouteConfig) => {
      const record: CapturedProcedure = { route }
      capturedProcedures.push(record)
      const chain = {
        input: vi.fn(() => chain),
        output: vi.fn(() => chain),
        use: vi.fn(() => {
          record.protected = true
          return chain
        }),
        handler: vi.fn((handler: CapturedProcedure["handler"]) => {
          record.handler = handler
          return { handler }
        }),
      }
      return chain
    }
    return {
      authorizedAPI: {
        route: vi.fn((route: RouteConfig) => makeProcedure(route)),
      },
      capturedProcedures,
      workspaceAuthorizedMidddleware: vi.fn(),
    }
  })

vi.mock("@/orpc", () => ({ authorizedAPI }))
vi.mock("@/middlewares/auth", () => ({ workspaceAuthorizedMidddleware }))

const notificationService = {
  listForUser: vi.fn(),
  countUnread: vi.fn(),
  markRead: vi.fn(),
  markAllRead: vi.fn(),
  getPreferences: vi.fn(),
  updatePreferences: vi.fn(),
}
const resolveTenantSettings = vi.fn(async () => ({
  appUrl: "https://app.test",
}))
vi.mock("@chatbotx.io/business", () => ({
  notificationService,
  onNotificationsCreated: vi.fn(),
  resolveTenantSettings,
  sendToWorkspaceMember: vi.fn(),
}))

await import("@/features/notifications/api/private")

const procedureFor = (method: string, path: string) => {
  const procedure = capturedProcedures.find(
    (candidate) =>
      candidate.route.method === method && candidate.route.path === path,
  )
  if (!procedure?.handler) {
    throw new Error(`No procedure registered for ${method} ${path}`)
  }
  return procedure
}

const call = (method: string, path: string, input: object) =>
  (
    procedureFor(method, path).handler as unknown as (args: {
      context: { user: { id: string } }
      input: object
    }) => Promise<unknown>
  )({
    context: { user: { id: "user-7" } },
    input,
  })

beforeEach(() => {
  vi.clearAllMocks()
})

describe("notification private API", () => {
  test("list uses the signed-in user and adds task URLs", async () => {
    notificationService.listForUser.mockResolvedValue([
      {
        id: "notification-1",
        type: "taskAssigned",
        entityId: "task-3",
        payload: {
          taskTitle: "Call customer",
          actorUserId: null,
          actorLabel: "Automation",
          excerpt: null,
        },
        readAt: null,
        createdAt: new Date("2026-10-23T10:00:00Z"),
      },
    ])

    const result = (await call(
      "GET",
      "/workspaces/{workspaceId}/notifications",
      { workspaceId: "workspace-2", limit: 20 },
    )) as { data: { taskId: string; url: string }[] }

    expect(notificationService.listForUser).toHaveBeenCalledWith({
      workspaceId: "workspace-2",
      userId: "user-7",
      limit: 20,
      unreadOnly: undefined,
    })
    expect(resolveTenantSettings).toHaveBeenCalledTimes(1)
    expect(result.data[0]).toEqual(
      expect.objectContaining({
        taskId: "task-3",
        url: "https://app.test/space/workspace-2/tasks/task-3",
      }),
    )
  })

  test("mutations always scope service calls to the signed-in user", async () => {
    await call("POST", "/workspaces/{workspaceId}/notifications/read", {
      workspaceId: "workspace-2",
      ids: ["notification-1"],
    })
    await call("POST", "/workspaces/{workspaceId}/notifications/read-all", {
      workspaceId: "workspace-2",
    })

    expect(notificationService.markRead).toHaveBeenCalledWith({
      workspaceId: "workspace-2",
      userId: "user-7",
      ids: ["notification-1"],
    })
    expect(notificationService.markAllRead).toHaveBeenCalledWith({
      workspaceId: "workspace-2",
      userId: "user-7",
    })
  })

  test("workspace middleware protects every procedure", () => {
    expect(capturedProcedures).toHaveLength(6)
    expect(capturedProcedures.every((procedure) => procedure.protected)).toBe(
      true,
    )
    expect(
      procedureFor("POST", "/workspaces/{workspaceId}/notifications/read").route
        .successStatus,
    ).toBe(204)
    expect(
      procedureFor("POST", "/workspaces/{workspaceId}/notifications/read-all")
        .route.successStatus,
    ).toBe(204)
  })
})
