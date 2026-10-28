// @vitest-environment node
import { call } from "@orpc/server"
import { beforeEach, expect, test, vi } from "vitest"
import { staffAssistantAPI } from "@/features/staff-assistant/api"
import { staffAssistantPublicRouter } from "@/features/staff-assistant/api/public"
import { tokenPublicRouter } from "@/features/token/api/public"

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  update: vi.fn(),
  test: vi.fn(),
  findToken: vi.fn(),
  deletion: vi.fn(),
  access: vi.fn(),
  limit: vi.fn(),
  rate: vi.fn(),
  permissions: { current: {} as Record<string, boolean> },
}))
vi.mock("@chatbotx.io/business", () => ({
  staffAssistantService: {
    get: mocks.get,
    update: mocks.update,
    test: mocks.test,
  },
  workspaceApiTokenService: { findWorkspaceByTokenHash: mocks.findToken },
  isWorkspaceScheduledForDeletion: mocks.deletion,
  userQuotaService: { getAccessState: mocks.access },
  quotaEnforcementService: { isAtLimit: mocks.limit },
}))
vi.mock("@/lib/log", () => ({ logger: { warn: vi.fn(), error: vi.fn() } }))
vi.mock("@/lib/rate-limit/api-rate-limit", () => ({
  assertApiNotRateLimited: mocks.rate,
}))
vi.mock("@/lib/rate-limit/guest-rate-limit", () => ({
  getGuestClientIp: () => "203.0.113.9",
}))
vi.mock("@/env", () => ({ isCloud: () => true }))
type MiddlewareOptions = {
  context: object
  next: (options: { context: object }) => Promise<unknown>
}
vi.mock("@/middlewares/auth", () => ({
  authMiddleware: async ({ context, next }: MiddlewareOptions) =>
    await next({ context }),
  workspaceAuthorizedMidddleware: async ({
    context,
    next,
  }: MiddlewareOptions) =>
    await next({
      context: {
        ...context,
        workspaceMember: { permissions: mocks.permissions.current },
      },
    }),
}))
const headers = new Headers({ Authorization: "Bearer cbx_ws_fixture" })
const authResult = (scopes: string[] | null) => ({
  workspace: { id: "1", ownerId: "2" },
  apiToken: { id: "10", permission: "full", scopes },
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.deletion.mockReturnValue(false)
  mocks.access.mockResolvedValue({ blocked: false })
  mocks.limit.mockResolvedValue(false)
  mocks.rate.mockResolvedValue(undefined)
  mocks.permissions.current = {}
})

test("public settings reject tokens without the settings scope", async () => {
  mocks.findToken.mockResolvedValue(authResult(["contacts"]))
  await expect(
    call(staffAssistantPublicRouter.update, {}, { context: { headers } }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" })
  expect(mocks.update).not.toHaveBeenCalled()
})

test("private settings require superAdmin", async () => {
  await expect(
    call(
      staffAssistantAPI.update,
      { workspaceId: "1" },
      { context: { headers } },
    ),
  ).rejects.toMatchObject({ code: "FORBIDDEN" })
  expect(mocks.update).not.toHaveBeenCalled()
})

test("public and private updates call the same workspace-scoped service", async () => {
  const settings = {
    enabled: false,
    baseUrl: "https://agent.test",
    hasApiKey: true,
    botName: "Assistant",
    maxRunMinutes: 30,
    apiTokenId: "10",
    tokenHasChatsScope: true,
    available: false,
    lastCheckedAt: null,
    lastCheckStatus: null,
    lastCheckError: null,
  }
  mocks.update.mockResolvedValue(settings)
  mocks.findToken.mockResolvedValue(authResult(["settings"]))
  mocks.permissions.current = { superAdmin: true }
  await call(
    staffAssistantPublicRouter.update,
    { enabled: false },
    { context: { headers } },
  )
  await call(
    staffAssistantAPI.update,
    { workspaceId: "1", enabled: false },
    { context: { headers } },
  )
  expect(mocks.update).toHaveBeenNthCalledWith(1, "1", { enabled: false })
  expect(mocks.update).toHaveBeenNthCalledWith(2, "1", { enabled: false })
})

test("token.get returns the calling token id", async () => {
  mocks.findToken.mockResolvedValue(authResult(["contacts"]))
  await expect(
    call(tokenPublicRouter.get, {}, { context: { headers } }),
  ).resolves.toMatchObject({ id: "10", workspaceId: "1" })
})

test("staff settings reject inbox fields", async () => {
  const { updateStaffAssistantSchema } = await import(
    "@/features/staff-assistant/schema"
  )
  expect(
    updateStaffAssistantSchema.safeParse({ inboxIds: ["1"] }).success,
  ).toBe(false)
})
