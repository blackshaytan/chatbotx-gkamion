import { afterEach, describe, expect, test, vi } from "vitest"

const loadEnv = async (vars: Record<string, string | undefined>) => {
  vi.resetModules()
  vi.stubEnv("SKIP_ENV_CHECK", "true")
  for (const [key, value] of Object.entries(vars)) {
    vi.stubEnv(key, value)
  }
  if (typeof window !== "undefined") {
    window.__ENV = { ...window.__ENV, ...vars }
  }
  return await import("../src/env")
}

describe("canRestrictMemberPermissions", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  test("is off on community by default", async () => {
    const { canRestrictMemberPermissions } = await loadEnv({
      NEXT_PUBLIC_EDITION: "community",
      NEXT_PUBLIC_RESTRICTED_MEMBER_PERMISSIONS: undefined,
    })
    expect(canRestrictMemberPermissions()).toBe(false)
  })

  test("is on for community when the self-hosted opt-in is true", async () => {
    const { canRestrictMemberPermissions } = await loadEnv({
      NEXT_PUBLIC_EDITION: "community",
      NEXT_PUBLIC_RESTRICTED_MEMBER_PERMISSIONS: "true",
    })
    expect(canRestrictMemberPermissions()).toBe(true)
  })

  test("is always on outside community", async () => {
    const { canRestrictMemberPermissions } = await loadEnv({
      NEXT_PUBLIC_EDITION: "enterprise",
      NEXT_PUBLIC_RESTRICTED_MEMBER_PERMISSIONS: "false",
    })
    expect(canRestrictMemberPermissions()).toBe(true)
  })
})
