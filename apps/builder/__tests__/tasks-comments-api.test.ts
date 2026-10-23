// @vitest-environment node

import { beforeEach, describe, expect, test, vi } from "vitest"

const { publishTaskChanged, publishTaskCommentsAndTaskChanged } = vi.hoisted(
  () => ({
    publishTaskChanged: vi.fn(),
    publishTaskCommentsAndTaskChanged: vi.fn(),
  }),
)

vi.mock("@/features/tasks/lib/task-realtime", () => ({
  publishTaskChanged,
  publishTaskCommentsAndTaskChanged,
}))

vi.mock("@/features/tasks/lib/attachment-url", () => ({
  withCommentAttachmentUrls: vi.fn(async (_ws: string, data: unknown[]) =>
    data.map((row) => ({
      ...(row as object),
      attachments: (
        row as { attachments: { index: number; name: string }[] }
      ).attachments.map((attachment) => ({
        ...attachment,
        url: "https://app.test/media/task-attachment/token",
      })),
    })),
  ),
  withSingleCommentAttachmentUrls: vi.fn(
    async (_ws: string, data: unknown) => ({
      ...(data as object),
      attachments: (
        data as { attachments: { index: number; name: string }[] }
      ).attachments.map((attachment) => ({
        ...attachment,
        url: "https://app.test/media/task-attachment/token",
      })),
    }),
  ),
}))

type RouteConfig = {
  method: string
  path: string
  successStatus?: number
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
  addComment: vi.fn(),
  updateComment: vi.fn(),
  deleteComment: vi.fn(),
  uploadAttachment: vi.fn(),
}
vi.mock("@chatbotx.io/business", () => ({
  taskService,
  onNotificationsCreated: vi.fn(),
  sendToWorkspaceMember: vi.fn(),
}))

await import("@/features/tasks/api/public")

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

const sampleComment = {
  id: "c-1",
  kind: "comment" as const,
  authorUserId: null,
  authorLabel: "Hermes",
  text: "Hello",
  mentions: { userIds: [], teamIds: [] },
  attachments: [],
  systemEvent: null,
  deleted: false,
  editedAt: null,
  createdAt: new Date("2026-10-01T00:00:00.000Z"),
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("task comment public API", () => {
  test("create forwards attachments and publishes realtime", async () => {
    taskService.addComment.mockResolvedValue(sampleComment)
    await call("POST", "/v1/tasks/{id}/comments", {
      id: "t-1",
      text: "Hi",
      attachments: [{ key: "private/space/ws-1/tasks/t-1/k1", name: "a.pdf" }],
    })
    expect(taskService.addComment).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      id: "t-1",
      text: "Hi",
      attachments: [{ key: "private/space/ws-1/tasks/t-1/k1", name: "a.pdf" }],
      actor: { kind: "api", label: "Hermes" },
    })
    expect(publishTaskCommentsAndTaskChanged).toHaveBeenCalledWith(
      "ws-1",
      "t-1",
    )
  })

  test("update publishes realtime", async () => {
    taskService.updateComment.mockResolvedValue({
      ...sampleComment,
      text: "Edited",
    })
    await call("PATCH", "/v1/tasks/{id}/comments/{commentId}", {
      id: "t-1",
      commentId: "c-1",
      text: "Edited",
    })
    expect(taskService.updateComment).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      id: "t-1",
      commentId: "c-1",
      text: "Edited",
      actor: { kind: "api", label: "Hermes" },
    })
    expect(publishTaskCommentsAndTaskChanged).toHaveBeenCalledWith(
      "ws-1",
      "t-1",
    )
  })

  test("delete returns 204 and publishes realtime", async () => {
    taskService.deleteComment.mockResolvedValue(undefined)
    await call("DELETE", "/v1/tasks/{id}/comments/{commentId}", {
      id: "t-1",
      commentId: "c-1",
    })
    expect(taskService.deleteComment).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      id: "t-1",
      commentId: "c-1",
      actor: { kind: "api", label: "Hermes" },
    })
    expect(publishTaskCommentsAndTaskChanged).toHaveBeenCalledWith(
      "ws-1",
      "t-1",
    )
  })

  test("attachments.upload calls service with file", async () => {
    taskService.uploadAttachment.mockResolvedValue({
      key: "private/space/ws-1/tasks/t-1/f1",
      name: "doc.pdf",
      size: 100,
      mimeType: "application/pdf",
    })
    const file = new File(["x"], "doc.pdf", { type: "application/pdf" })
    const result = (await call("POST", "/v1/tasks/{id}/attachments", {
      id: "t-1",
      file,
    })) as { key: string }
    expect(taskService.uploadAttachment).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      id: "t-1",
      file,
    })
    expect(result.key).toContain("private/space/ws-1/tasks/t-1/")
  })
})
