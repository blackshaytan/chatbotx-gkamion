import { beforeEach, describe, expect, test, vi } from "vitest"

const { userFindFirst, inserts, updates, deletes, accountUpdateReturning } =
  vi.hoisted(() => ({
    userFindFirst: vi.fn(),
    inserts: vi.fn(),
    updates: vi.fn(),
    deletes: vi.fn(),
    accountUpdateReturning: vi.fn(),
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

vi.mock("@chatbotx.io/business", () => ({
  platformCredentialService: {},
  workspaceService: {},
  resolveTenantSettingsByOwner: vi.fn(),
}))

vi.mock("@chatbotx.io/mail", () => ({
  DEFAULT_ACCOUNT_CREDENTIALS_SUBJECT: "",
  sendAccountCredentials: vi.fn(),
}))

vi.mock("@chatbotx.io/database/schema", () => ({
  accountModel: {
    id: "Account.id",
    userId: "Account.userId",
    providerId: "Account.providerId",
  },
  sessionModel: { userId: "Session.userId" },
  userModel: { id: "User.id" },
}))

vi.mock("@chatbotx.io/database/client", () => {
  const tx = {
    insert: (model: unknown) => ({
      values: (vals: unknown) => {
        inserts(model, vals)
        return { returning: () => [{ id: "user-new" }] }
      },
    }),
    update: (model: unknown) => ({
      set: (vals: unknown) => ({
        where: () => {
          updates(model, vals)
          return { returning: () => accountUpdateReturning() }
        },
      }),
    }),
    delete: (model: unknown) => ({
      where: () => {
        deletes(model)
      },
    }),
  }
  return {
    and: (...parts: unknown[]) => parts,
    eq: (a: unknown, b: unknown) => [a, b],
    db: {
      query: { userModel: { findFirst: userFindFirst } },
      transaction: (cb: (t: typeof tx) => unknown) => cb(tx),
    },
    isUniqueViolationError: (error: unknown) =>
      (error as { code?: string } | null)?.code === "23505",
  }
})

vi.mock("better-auth/crypto", () => ({
  generateRandomString: () => "TempPass123456AB",
  hashPassword: (p: string) => Promise.resolve(`hashed:${p}`),
}))

import {
  provisionPlatformAccount,
  resetPlatformAccountPassword,
} from "../src/provisioning"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("provisionPlatformAccount", () => {
  test("creates a verified root-tenant user that must change the temporary password", async () => {
    userFindFirst.mockResolvedValueOnce(undefined)

    const result = await provisionPlatformAccount({
      email: " Manager@Example.com ",
      name: "Manager",
    })

    expect(result).toEqual({
      userId: "user-new",
      temporaryPassword: "TempPass123456AB",
    })
    expect(userFindFirst).toHaveBeenCalledWith({
      where: { email: "manager@example.com", tenantId: "1" },
      columns: { id: true },
    })
    expect(inserts).toHaveBeenCalledWith(
      { id: "User.id" },
      {
        email: "manager@example.com",
        name: "Manager",
        emailVerified: true,
        mustChangePassword: true,
        tenantId: "1",
      },
    )
    expect(inserts).toHaveBeenCalledWith(
      expect.objectContaining({ id: "Account.id" }),
      {
        accountId: "user-new",
        providerId: "credential",
        password: "hashed:TempPass123456AB",
        userId: "user-new",
        tenantId: "1",
      },
    )
  })

  test("refuses an email that already has an account", async () => {
    userFindFirst.mockResolvedValueOnce({ id: "user-1" })

    await expect(
      provisionPlatformAccount({ email: "a@example.com", name: "A" }),
    ).rejects.toMatchObject({ code: "userAlreadyExists" })
    expect(inserts).not.toHaveBeenCalled()
  })

  test("refuses the Facebook placeholder domain", async () => {
    await expect(
      provisionPlatformAccount({
        email: "fb-1@facebook.placeholder.invalid",
        name: "A",
      }),
    ).rejects.toMatchObject({ code: "invalidEmail" })
    expect(userFindFirst).not.toHaveBeenCalled()
  })
})

describe("resetPlatformAccountPassword", () => {
  test("replaces the credential password, forces a change and drops sessions", async () => {
    userFindFirst.mockResolvedValueOnce({ id: "user-1" })
    accountUpdateReturning.mockReturnValueOnce([{ id: "account-1" }])

    const result = await resetPlatformAccountPassword({ userId: "user-1" })

    expect(result).toEqual({
      userId: "user-1",
      temporaryPassword: "TempPass123456AB",
    })
    expect(userFindFirst).toHaveBeenCalledWith({
      where: { id: "user-1", tenantId: "1" },
      columns: { id: true },
    })
    expect(updates).toHaveBeenCalledWith(
      expect.objectContaining({ id: "Account.id" }),
      { password: "hashed:TempPass123456AB" },
    )
    expect(updates).toHaveBeenCalledWith(
      { id: "User.id" },
      { mustChangePassword: true },
    )
    expect(deletes).toHaveBeenCalledWith({ userId: "Session.userId" })
    expect(inserts).not.toHaveBeenCalled()
  })

  test("adds a credential account for a social-only user", async () => {
    userFindFirst.mockResolvedValueOnce({ id: "user-1" })
    accountUpdateReturning.mockReturnValueOnce([])

    await resetPlatformAccountPassword({ userId: "user-1" })

    expect(inserts).toHaveBeenCalledWith(
      expect.objectContaining({ id: "Account.id" }),
      expect.objectContaining({
        providerId: "credential",
        password: "hashed:TempPass123456AB",
        userId: "user-1",
        tenantId: "1",
      }),
    )
  })

  test("refuses a user outside the root tenant", async () => {
    userFindFirst.mockResolvedValueOnce(undefined)

    await expect(
      resetPlatformAccountPassword({ userId: "reseller-user" }),
    ).rejects.toMatchObject({ code: "notFound" })
    expect(updates).not.toHaveBeenCalled()
    expect(deletes).not.toHaveBeenCalled()
  })
})
