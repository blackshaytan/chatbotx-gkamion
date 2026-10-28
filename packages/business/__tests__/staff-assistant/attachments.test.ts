import { expect, test, vi } from "vitest"

const mocks = vi.hoisted(() => ({ sign: vi.fn(), settings: vi.fn() }))
vi.mock("@chatbotx.io/encryption", () => ({ signMediaToken: mocks.sign }))
vi.mock("../../src/platform/settings", () => ({
  resolveTenantSettings: mocks.settings,
}))
const { toStaffAssistantInputMessages } = await import(
  "../../src/staff-assistant/attachments"
)

test("signs workspace-scoped chat attachment links for 24 hours", async () => {
  mocks.settings.mockResolvedValue({ appUrl: "https://app.test" })
  mocks.sign.mockResolvedValue("signed")
  const result = await toStaffAssistantInputMessages({
    workspaceId: "ws",
    userId: "user",
    messages: [
      {
        id: "42",
        authorUserId: "user",
        text: "file",
        attachments: [{ name: "a" }],
      } as never,
    ],
  })
  expect(mocks.sign).toHaveBeenCalledWith(
    { workspaceId: "ws", kind: "chatAttachment", refId: "42:0" },
    86_400_000,
  )
  expect(result).toEqual([
    {
      role: "employee",
      text: "file",
      attachmentUrls: ["https://app.test/media/chat-attachment/signed"],
    },
  ])
})
