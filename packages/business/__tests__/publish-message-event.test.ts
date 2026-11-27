// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  publishToWorkspaceParty: vi.fn(),
  sendToWorkspaceMember: vi.fn().mockResolvedValue(undefined),
  resolveAudienceUserIds: vi.fn(),
  loggerError: vi.fn(),
}))

vi.mock("@chatbotx.io/logger", () => ({
  getChildLogger: () => ({ error: mocks.loggerError, warn: vi.fn() }),
}))

vi.mock("../src/platform/realtime-broadcast", () => ({
  publishToWorkspaceParty: mocks.publishToWorkspaceParty,
  sendToWorkspaceMember: mocks.sendToWorkspaceMember,
}))

vi.mock("../src/inbox/smtp-ownership", () => ({
  smtpOwnershipService: {
    resolveAudienceUserIds: mocks.resolveAudienceUserIds,
  },
}))

const { publishMessageEvent } = await import(
  "../src/platform/publish-message-event"
)

const event = {
  eventType: "messageCreated",
  data: { id: "msg-1" },
} as never

describe("publishMessageEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.sendToWorkspaceMember.mockResolvedValue(undefined)
  })

  test("shared inbox fans out to the workspace party", async () => {
    mocks.resolveAudienceUserIds.mockResolvedValue(null)

    await publishMessageEvent({
      workspaceId: "ws-1",
      inboxId: "i-shared",
      event,
    })

    expect(mocks.publishToWorkspaceParty).toHaveBeenCalledOnce()
    expect(mocks.publishToWorkspaceParty).toHaveBeenCalledWith("ws-1", event)
    expect(mocks.sendToWorkspaceMember).not.toHaveBeenCalled()
  })

  test("personal SMTP targets owner and admins only", async () => {
    mocks.resolveAudienceUserIds.mockResolvedValue(["u1", "u3"])

    await publishMessageEvent({
      workspaceId: "ws-1",
      inboxId: "i-personal",
      event,
    })

    expect(mocks.publishToWorkspaceParty).not.toHaveBeenCalled()
    expect(mocks.sendToWorkspaceMember).toHaveBeenCalledTimes(2)
    expect(mocks.sendToWorkspaceMember).toHaveBeenCalledWith(
      { workspaceId: "ws-1", userId: "u1" },
      event,
    )
    expect(mocks.sendToWorkspaceMember).toHaveBeenCalledWith(
      { workspaceId: "ws-1", userId: "u3" },
      event,
    )
  })

  test("null inboxId publishes to the workspace party without resolving audience", async () => {
    await publishMessageEvent({
      workspaceId: "ws-1",
      inboxId: null,
      event,
    })

    expect(mocks.resolveAudienceUserIds).not.toHaveBeenCalled()
    expect(mocks.publishToWorkspaceParty).toHaveBeenCalledOnce()
    expect(mocks.sendToWorkspaceMember).not.toHaveBeenCalled()
  })

  test("audience resolution failure fails closed with no workspace publish", async () => {
    mocks.resolveAudienceUserIds.mockRejectedValue(new Error("redis down"))

    await publishMessageEvent({
      workspaceId: "ws-1",
      inboxId: "i-personal",
      event,
    })

    expect(mocks.publishToWorkspaceParty).not.toHaveBeenCalled()
    expect(mocks.sendToWorkspaceMember).not.toHaveBeenCalled()
    expect(mocks.loggerError).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      "Failed to resolve message event audience",
    )
  })
})
