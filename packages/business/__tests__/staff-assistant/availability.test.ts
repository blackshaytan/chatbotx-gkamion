import { beforeEach, expect, test, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  find: vi.fn(),
  lockProfile: vi.fn(),
  findToken: vi.fn(),
}))
vi.mock("@chatbotx.io/database/repositories", () => ({
  externalAgentRepository: {
    findByWorkspace: mocks.find,
    findStaffAvailability: mocks.lockProfile,
  },
  workspaceApiTokenRepository: { findScopesForWorkspace: mocks.findToken },
}))
const { isStaffAssistantAvailable } = await import(
  "../../src/staff-assistant/availability"
)
const profile = {
  enabled: true,
  botName: "Assistant",
  baseUrl: "https://agent.test",
  apiKey: {},
  apiTokenId: "token",
}
const TX = { tx: true } as never

beforeEach(() => {
  vi.clearAllMocks()
  mocks.find.mockResolvedValue(profile)
  mocks.findToken.mockResolvedValue({ scopes: ["chats"] })
  mocks.lockProfile.mockResolvedValue(profile)
})

test("locks the token before the profile and checks the binding again", async () => {
  await expect(isStaffAssistantAvailable("ws", TX)).resolves.toBe(true)
  expect(mocks.findToken).toHaveBeenCalledWith(
    { workspaceId: "ws", id: "token", lock: true },
    TX,
  )
  expect(mocks.findToken.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.lockProfile.mock.invocationCallOrder[0],
  )
  mocks.lockProfile.mockResolvedValue({ ...profile, apiTokenId: "other" })
  await expect(isStaffAssistantAvailable("ws", TX)).resolves.toBe(false)
})

test("fails closed on a missing chat scope", async () => {
  mocks.findToken.mockResolvedValue({ scopes: null })
  await expect(isStaffAssistantAvailable("ws", TX)).resolves.toBe(false)
  expect(mocks.lockProfile).not.toHaveBeenCalled()
})
