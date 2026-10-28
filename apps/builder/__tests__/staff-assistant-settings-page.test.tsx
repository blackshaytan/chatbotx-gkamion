import { beforeEach, expect, test, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  permission: vi.fn(),
  listTokens: vi.fn(),
}))
vi.mock("@chatbotx.io/business", () => ({
  workspaceApiTokenService: { listTokens: mocks.listTokens },
}))
vi.mock("@/lib/auth/require-workspace-permission", () => ({
  requireWorkspacePermission: mocks.permission,
}))
vi.mock(
  "@/features/staff-assistant/components/staff-assistant-settings-form",
  () => ({
    StaffAssistantSettingsForm: () => null,
  }),
)
const { default: Page } = await import(
  "@/app/space/[workspaceId]/(settings)/settings/integrations/staff-assistant/page"
)
beforeEach(() => {
  vi.clearAllMocks()
})

test("requires administration and exposes only names and IDs of explicitly scoped chat tokens", async () => {
  mocks.permission.mockResolvedValue(undefined)
  mocks.listTokens.mockResolvedValue([
    { id: "10", name: "Chat", scopes: ["chats"], tokenHash: "secret" },
    { id: "11", name: "Legacy", scopes: null, tokenHash: "secret" },
    { id: "12", name: "Other", scopes: ["contacts"], tokenHash: "secret" },
  ])
  const page = await Page({ params: Promise.resolve({ workspaceId: "1" }) })
  expect(mocks.permission).toHaveBeenCalledWith("1", "superAdmin")
  expect(mocks.permission.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.listTokens.mock.invocationCallOrder[0],
  )
  expect(page.props.tokenOptions).toEqual([{ value: "10", label: "Chat" }])
})

test("does not load tokens when permission is denied", async () => {
  mocks.permission.mockRejectedValue(new Error("denied"))
  await expect(
    Page({ params: Promise.resolve({ workspaceId: "1" }) }),
  ).rejects.toThrow("denied")
  expect(mocks.listTokens).not.toHaveBeenCalled()
})
