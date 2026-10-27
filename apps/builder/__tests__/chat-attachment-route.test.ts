// @vitest-environment node

import { beforeEach, describe, expect, test, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  checkGuestRateLimit: vi.fn(),
  findAttachment: vi.fn(),
  getObject: vi.fn(),
  loadServableWorkspace: vi.fn(),
  resolveGuestRateLimitKey: vi.fn(),
  verifyMediaToken: vi.fn(),
}))

vi.mock("@chatbotx.io/encryption", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@chatbotx.io/encryption")>()
  return { ...actual, verifyMediaToken: mocks.verifyMediaToken }
})

vi.mock("@chatbotx.io/business", () => ({
  chatService: { findAttachment: mocks.findAttachment },
}))

vi.mock("@chatbotx.io/filesystem", () => ({
  uploader: { getObject: mocks.getObject },
}))

vi.mock("@/lib/rate-limit/guest-rate-limit", () => ({
  checkGuestRateLimit: mocks.checkGuestRateLimit,
  resolveGuestRateLimitKey: mocks.resolveGuestRateLimitKey,
}))

vi.mock("@/lib/workspace/load-servable-workspace", () => ({
  loadServableWorkspace: mocks.loadServableWorkspace,
}))

const { GET } = await import("../src/app/media/chat-attachment/[token]/route")

const tokenContext = (token = "signed-token") => ({
  params: Promise.resolve({ token }),
})

const request = () =>
  new Request("https://app.test/media/chat-attachment/signed-token")

describe("chat attachment media route", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.checkGuestRateLimit.mockResolvedValue({
      limited: false,
      retryAfter: 10,
    })
    mocks.loadServableWorkspace.mockResolvedValue({ servable: true })
    mocks.resolveGuestRateLimitKey.mockReturnValue("127.0.0.1")
  })

  test("rejects a token intended for another media route", async () => {
    mocks.verifyMediaToken.mockResolvedValue({
      workspaceId: "ws-1",
      kind: "taskAttachment",
      refId: "message-1:0",
    })

    const response = await GET(request() as never, tokenContext())

    expect(response.status).toBe(404)
    expect(mocks.findAttachment).not.toHaveBeenCalled()
  })

  test("does not reveal a missing attachment", async () => {
    mocks.verifyMediaToken.mockResolvedValue({
      workspaceId: "ws-1",
      kind: "chatAttachment",
      refId: "message-1:0",
    })
    mocks.findAttachment.mockResolvedValue(null)

    const response = await GET(request() as never, tokenContext())

    expect(response.status).toBe(404)
    expect(mocks.findAttachment).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      messageId: "message-1",
      index: 0,
    })
  })

  test("returns a safe attachment download", async () => {
    mocks.verifyMediaToken.mockResolvedValue({
      workspaceId: "ws-1",
      kind: "chatAttachment",
      refId: "message-1:0",
    })
    mocks.findAttachment.mockResolvedValue({
      key: "private/space/ws-1/chats/chat-1/object",
      name: "report.pdf",
      mimeType: "application/pdf",
      size: 4,
    })
    mocks.getObject.mockResolvedValue(Buffer.from("data"))

    const response = await GET(request() as never, tokenContext())

    expect(response.status).toBe(200)
    expect(response.headers.get("Content-Type")).toBe("application/pdf")
    expect(response.headers.get("Content-Disposition")).toBe(
      "attachment; filename*=UTF-8''report.pdf",
    )
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff")
    expect(response.headers.get("Content-Security-Policy")).toBe("sandbox")
    expect(await response.text()).toBe("data")
  })
})
