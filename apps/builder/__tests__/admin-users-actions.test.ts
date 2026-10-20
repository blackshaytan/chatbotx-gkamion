import { beforeEach, describe, expect, test, vi } from "vitest"

const { provisionPlatformAccount, resetPlatformAccountPassword, usedClients } =
  vi.hoisted(() => ({
    provisionPlatformAccount: vi.fn(),
    resetPlatformAccountPassword: vi.fn(),
    usedClients: [] as string[],
  }))

vi.mock("@chatbotx.io/auth/provisioning", () => ({
  provisionPlatformAccount,
  resetPlatformAccountPassword,
}))

vi.mock("@chatbotx.io/business/errors", () => ({
  ChatbotXException: class ChatbotXException extends Error {
    code?: string
    constructor(message: string, code?: string) {
      super(message)
      this.code = code
    }
  },
}))

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => `t:${key}`,
}))

vi.mock("@/lib/safe-action", () => {
  const makeClient = (name: string) => {
    const chain: Record<string, unknown> = {}
    chain.inputSchema = () => chain
    chain.action = (fn: unknown) => {
      usedClients.push(name)
      return fn
    }
    return chain
  }
  return {
    authActionClient: makeClient("auth"),
    platformAdminActionClient: makeClient("platformAdmin"),
    superAdminActionClient: makeClient("superAdmin"),
  }
})

type Action = (props: unknown) => Promise<unknown>

const { ChatbotXException } = await import("@chatbotx.io/business/errors")
const { createAdminUserAction } = await import(
  "../src/features/admin-users/actions/create-admin-user.action"
)
const { resetAdminUserPasswordAction } = await import(
  "../src/features/admin-users/actions/reset-admin-user-password.action"
)

const adminCtx = { user: { id: "admin-1" } }

beforeEach(() => {
  vi.clearAllMocks()
})

describe("admin users actions", () => {
  test("are gated on the platform super admin client, not the reseller one", () => {
    expect(usedClients).toEqual(["superAdmin", "superAdmin"])
  })

  test("createAdminUserAction returns the one-time temporary password", async () => {
    provisionPlatformAccount.mockResolvedValueOnce({
      userId: "user-1",
      temporaryPassword: "Temp123",
    })

    await expect(
      (createAdminUserAction as Action)({
        ctx: adminCtx,
        parsedInput: { name: "Manager", email: "m@example.com" },
      }),
    ).resolves.toEqual({ userId: "user-1", temporaryPassword: "Temp123" })
    expect(provisionPlatformAccount).toHaveBeenCalledWith({
      name: "Manager",
      email: "m@example.com",
    })
  })

  test("createAdminUserAction translates the duplicate-email error", async () => {
    provisionPlatformAccount.mockRejectedValueOnce(
      new ChatbotXException("exists", "userAlreadyExists"),
    )

    await expect(
      (createAdminUserAction as Action)({
        ctx: adminCtx,
        parsedInput: { name: "A", email: "a@example.com" },
      }),
    ).rejects.toMatchObject({
      message: "t:platformAdmin.users.userAlreadyExists",
      code: "userAlreadyExists",
    })
  })

  test("resetAdminUserPasswordAction resets another user's password", async () => {
    resetPlatformAccountPassword.mockResolvedValueOnce({
      userId: "user-2",
      temporaryPassword: "Temp456",
    })

    await expect(
      (resetAdminUserPasswordAction as Action)({
        ctx: adminCtx,
        parsedInput: { userId: "user-2" },
      }),
    ).resolves.toEqual({ userId: "user-2", temporaryPassword: "Temp456" })
    expect(resetPlatformAccountPassword).toHaveBeenCalledWith({
      userId: "user-2",
    })
  })

  test("resetAdminUserPasswordAction refuses the admin's own account", async () => {
    await expect(
      (resetAdminUserPasswordAction as Action)({
        ctx: adminCtx,
        parsedInput: { userId: "admin-1" },
      }),
    ).rejects.toMatchObject({ code: "cannotResetOwnPassword" })
    expect(resetPlatformAccountPassword).not.toHaveBeenCalled()
  })
})
