// @vitest-environment node

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { call } from "@orpc/server"
import { beforeEach, describe, expect, test, vi } from "vitest"
import { externalAgentAPI } from "@/features/external-agent/api"
import { externalAgentPublicRouter } from "@/features/external-agent/api/public"
import { externalAgentOutputSchema } from "@/features/external-agent/schema"

const {
  externalAgentService,
  findWorkspaceByTokenHash,
  isWorkspaceScheduledForDeletion,
  getAccessState,
  isAtLimit,
  assertApiNotRateLimited,
  memberPermissions,
} = vi.hoisted(() => ({
  externalAgentService: {
    get: vi.fn(),
    update: vi.fn(),
    test: vi.fn(),
    handover: vi.fn(),
  },
  findWorkspaceByTokenHash: vi.fn(),
  isWorkspaceScheduledForDeletion: vi.fn(),
  getAccessState: vi.fn(),
  isAtLimit: vi.fn(),
  assertApiNotRateLimited: vi.fn(),
  memberPermissions: { current: {} as Record<string, boolean> },
}))

vi.mock("@chatbotx.io/business", () => ({
  externalAgentService,
  workspaceApiTokenService: { findWorkspaceByTokenHash },
  isWorkspaceScheduledForDeletion,
  userQuotaService: { getAccessState },
  quotaEnforcementService: { isAtLimit },
}))

vi.mock("@/lib/log", () => ({
  logger: { warn: vi.fn(), error: vi.fn() },
}))

vi.mock("@/lib/rate-limit/api-rate-limit", () => ({
  assertApiNotRateLimited,
}))

vi.mock("@/lib/rate-limit/guest-rate-limit", () => ({
  getGuestClientIp: () => "203.0.113.9",
}))

vi.mock("@/env", () => ({ isCloud: () => true }))

// The session gates are stubbed as pass-throughs. The workspace member's
// permissions come from `memberPermissions`, so the handler's real
// `superAdmin` check still runs.
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
        workspaceMember: { permissions: memberPermissions.current },
      },
    }),
}))

const TOKEN_HEADERS = new Headers({ Authorization: "Bearer cbx_ws_fixture" })

const authResult = (scopes: string[] | null) => ({
  workspace: { id: "ws-1", ownerId: "owner-1" },
  apiToken: { id: "token-1", permission: "full", scopes },
})

const settings = {
  enabled: true,
  provider: "hermes" as const,
  baseUrl: "https://agent.example.test",
  hasApiKey: true,
  inboxIds: ["5"],
  resumeAfterHours: null,
  maxRunMinutes: 30,
  progressMessage: "Working on it",
  lastCheckedAt: new Date("2026-10-21T00:00:00Z"),
  lastCheckStatus: "ok" as const,
  lastCheckError: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  isWorkspaceScheduledForDeletion.mockReturnValue(false)
  getAccessState.mockResolvedValue({ blocked: false })
  isAtLimit.mockResolvedValue(false)
  assertApiNotRateLimited.mockResolvedValue(undefined)
  memberPermissions.current = {}
})

describe("external agent public API", () => {
  test("registers four procedures on the expected methods and paths", () => {
    expect(Object.keys(externalAgentPublicRouter)).toEqual([
      "get",
      "update",
      "test",
      "handover",
    ])
    expect(externalAgentPublicRouter.get["~orpc"].route).toMatchObject({
      method: "GET",
      path: "/v1/external-agent",
    })
    expect(externalAgentPublicRouter.update["~orpc"].route).toMatchObject({
      method: "PATCH",
      path: "/v1/external-agent",
    })
    expect(externalAgentPublicRouter.test["~orpc"].route).toMatchObject({
      method: "POST",
      path: "/v1/external-agent/test",
    })
    expect(externalAgentPublicRouter.handover["~orpc"].route).toMatchObject({
      method: "POST",
      path: "/v1/conversations/{conversationId}/external-agent-handover",
    })
  })

  test("is mounted under externalAgent in the public router", () => {
    const source = readFileSync(
      join(process.cwd(), "src/routers/public.ts"),
      "utf8",
    )

    expect(source).toContain("externalAgent: externalAgentPublicRouter")
  })

  test("update is refused to a token without the settings scope", async () => {
    findWorkspaceByTokenHash.mockResolvedValue(authResult(["inbox"]))

    await expect(
      call(
        externalAgentPublicRouter.update,
        {},
        { context: { headers: TOKEN_HEADERS } },
      ),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Token is not authorized for the 'settings' scope",
    })
    expect(externalAgentService.update).not.toHaveBeenCalled()
  })

  test("handover is refused to a token without the inbox scope", async () => {
    findWorkspaceByTokenHash.mockResolvedValue(authResult(["settings"]))

    await expect(
      call(
        externalAgentPublicRouter.handover,
        { conversationId: "42", reason: "Customer asked for a manager" },
        { context: { headers: TOKEN_HEADERS } },
      ),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Token is not authorized for the 'inbox' scope",
    })
    expect(externalAgentService.handover).not.toHaveBeenCalled()
  })

  test("handover passes the optional category to the service", async () => {
    findWorkspaceByTokenHash.mockResolvedValue(authResult(["inbox"]))
    externalAgentService.handover.mockResolvedValue({
      conversationId: "42",
      botEnabled: false,
    })

    await call(
      externalAgentPublicRouter.handover,
      {
        conversationId: "42",
        reason: "Customer is waiting for a refund",
        category: "return",
      },
      { context: { headers: TOKEN_HEADERS } },
    )

    expect(externalAgentService.handover).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "ws-1", category: "return" }),
    )
  })

  test("handover refuses a category outside the list", async () => {
    findWorkspaceByTokenHash.mockResolvedValue(authResult(["inbox"]))

    await expect(
      call(
        externalAgentPublicRouter.handover,
        {
          conversationId: "42",
          reason: "Customer asked for a manager",
          category: "refund" as never,
        },
        { context: { headers: TOKEN_HEADERS } },
      ),
    ).rejects.toThrow()
    expect(externalAgentService.handover).not.toHaveBeenCalled()
  })

  test("get returns the settings without an API key", async () => {
    findWorkspaceByTokenHash.mockResolvedValue(authResult(["settings"]))
    externalAgentService.get.mockResolvedValue(settings)

    const result = await call(externalAgentPublicRouter.get, undefined, {
      context: { headers: TOKEN_HEADERS },
    })

    expect(externalAgentService.get).toHaveBeenCalledWith("ws-1")
    expect(result).toMatchObject({ hasApiKey: true })
    expect(result).not.toHaveProperty("apiKey")
  })

  test("the output schema strips an API key even if one reaches it", () => {
    const parsed = externalAgentOutputSchema.parse({
      ...settings,
      apiKey: "secret-value",
    })

    expect(parsed).not.toHaveProperty("apiKey")
  })
})

describe("external agent private API", () => {
  test("update rejects a workspace member who is not a super admin with FORBIDDEN", async () => {
    memberPermissions.current = { superAdmin: false }

    await expect(
      call(
        externalAgentAPI.update,
        { workspaceId: "1", enabled: true },
        { context: { headers: TOKEN_HEADERS } },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" })
    expect(externalAgentService.update).not.toHaveBeenCalled()
  })

  test("update lets a super admin change the settings", async () => {
    memberPermissions.current = { superAdmin: true }
    externalAgentService.update.mockResolvedValue(settings)

    const result = await call(
      externalAgentAPI.update,
      { workspaceId: "1", enabled: true },
      { context: { headers: TOKEN_HEADERS } },
    )

    expect(externalAgentService.update).toHaveBeenCalledWith("1", {
      enabled: true,
    })
    expect(result).not.toHaveProperty("apiKey")
  })
})
