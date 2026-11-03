// @vitest-environment node

import { call } from "@orpc/server"
import { beforeEach, describe, expect, test, vi } from "vitest"
import { voiceAgentPublicRouter } from "@/features/voice-agent/api/public"
import { POLICY_CHECK_PATH } from "@/features/voice-agent/lib/api-paths"

const {
  findWorkspaceByTokenHash,
  isWorkspaceScheduledForDeletion,
  getAccessState,
  isAtLimit,
  assertApiNotRateLimited,
  resolveVoiceCallPolicy,
  setAiCallOptOut,
} = vi.hoisted(() => ({
  findWorkspaceByTokenHash: vi.fn(),
  isWorkspaceScheduledForDeletion: vi.fn(),
  getAccessState: vi.fn(),
  isAtLimit: vi.fn(),
  assertApiNotRateLimited: vi.fn(),
  resolveVoiceCallPolicy: vi.fn(),
  setAiCallOptOut: vi.fn(),
}))

vi.mock("@chatbotx.io/business", () => ({
  resolveVoiceCallPolicy,
  voiceAgentService: { setAiCallOptOut },
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

// `@/orpc` also exports `authorizedAPI`, which pulls in the full better-auth
// stack via `authMiddleware` — irrelevant to workspace-token scope
// enforcement and heavy/unsafe to initialize in a unit test. Stub it so
// importing `@/orpc` for `workspaceTokenAuthAPIForScope` stays lightweight.
vi.mock("@/middlewares/auth", () => ({
  authMiddleware: vi.fn(),
}))

const TOKEN_HEADERS = new Headers({ Authorization: "Bearer cbx_ws_fixture" })

const authResult = (
  scopes: string[] | null,
  permission: "full" | "read_only" = "full",
) => ({
  workspace: { id: "ws-1", ownerId: "owner-1" },
  apiToken: { id: "token-1", permission, scopes },
})

beforeEach(() => {
  vi.clearAllMocks()
  isWorkspaceScheduledForDeletion.mockReturnValue(false)
  getAccessState.mockResolvedValue({ blocked: false })
  isAtLimit.mockResolvedValue(false)
  assertApiNotRateLimited.mockResolvedValue(undefined)
})

describe("voice agent public API", () => {
  test("registers two procedures on the expected methods and paths", () => {
    expect(Object.keys(voiceAgentPublicRouter)).toEqual([
      "checkPolicy",
      "optOut",
    ])
    expect(voiceAgentPublicRouter.checkPolicy["~orpc"].route).toMatchObject({
      method: "POST",
      path: POLICY_CHECK_PATH,
    })
    expect(voiceAgentPublicRouter.optOut["~orpc"].route).toMatchObject({
      method: "POST",
      path: "/v1/voice-agent/opt-out",
    })
  })

  test("is mounted under voiceAgent in the public router", async () => {
    const fs = await import("node:fs")
    const path = await import("node:path")

    const source = fs.readFileSync(
      path.join(process.cwd(), "src/routers/public.ts"),
      "utf8",
    )
    expect(source).toContain("voiceAgent: voiceAgentPublicRouter")
  })

  test("token without voiceAgent scope is denied checkPolicy with FORBIDDEN", async () => {
    findWorkspaceByTokenHash.mockResolvedValue(authResult(["contacts"]))

    await expect(
      call(
        voiceAgentPublicRouter.checkPolicy,
        { phone: "+79990000000" },
        { context: { headers: TOKEN_HEADERS } },
      ),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Token is not authorized for the 'voiceAgent' scope",
    })
    expect(resolveVoiceCallPolicy).not.toHaveBeenCalled()
  })

  test("read_only token with voiceAgent scope can read policy", async () => {
    findWorkspaceByTokenHash.mockResolvedValue(
      authResult(["voiceAgent"], "read_only"),
    )
    resolveVoiceCallPolicy.mockResolvedValue({
      canCall: true,
      contactIds: [],
    })

    const result = await call(
      voiceAgentPublicRouter.checkPolicy,
      { phone: "+79990000000" },
      { context: { headers: TOKEN_HEADERS } },
    )

    expect(resolveVoiceCallPolicy).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      phone: "+79990000000",
    })
    expect(result).toMatchObject({ canCall: true, contactIds: [] })
  })

  test("read_only token with voiceAgent scope cannot opt out", async () => {
    findWorkspaceByTokenHash.mockResolvedValue(
      authResult(["voiceAgent"], "read_only"),
    )

    await expect(
      call(
        voiceAgentPublicRouter.optOut,
        { phone: "+79990000000", reason: "не звоните мне" },
        { context: { headers: TOKEN_HEADERS } },
      ),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Read-only token cannot perform this operation",
    })
    expect(setAiCallOptOut).not.toHaveBeenCalled()
  })

  test("optOut passes clientCall source and workspaceId to service", async () => {
    findWorkspaceByTokenHash.mockResolvedValue(authResult(["voiceAgent"]))
    setAiCallOptOut.mockResolvedValue({
      contactIds: ["contact-1"],
      alreadySet: false,
    })

    await call(
      voiceAgentPublicRouter.optOut,
      { phone: "+79990000000", reason: "не звоните мне" },
      { context: { headers: TOKEN_HEADERS } },
    )

    expect(setAiCallOptOut).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws-1",
        phone: "+79990000000",
        source: "clientCall",
        reason: "не звоните мне",
      }),
    )
  })
})
