import { beforeEach, describe, expect, test, vi } from "vitest"

const state = vi.hoisted(() => ({
  capturedListener: null as null | ((payload: unknown) => void | Promise<void>),
}))

const mocks = vi.hoisted(() => ({
  sendToWorkspaceMember: vi.fn().mockResolvedValue(undefined),
  onNotificationsCreated: vi.fn((listener: (payload: unknown) => void) => {
    state.capturedListener = listener
  }),
  loggerWarn: vi.fn(),
}))

vi.mock("@chatbotx.io/business", () => ({
  onNotificationsCreated: mocks.onNotificationsCreated,
  sendToWorkspaceMember: mocks.sendToWorkspaceMember,
}))

vi.mock("../src/lib/logger", () => ({
  logger: {
    warn: mocks.loggerWarn,
    error: vi.fn(),
    info: vi.fn(),
  },
}))

describe("registerNotificationRealtime", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    state.capturedListener = null
  })

  test("registers a listener that sends notificationCreated to each recipient", async () => {
    const { registerNotificationRealtime } = await import(
      "../src/lib/notification-realtime"
    )

    registerNotificationRealtime()
    expect(state.capturedListener).toBeTypeOf("function")

    await state.capturedListener?.({
      workspaceId: "ws-1",
      notifications: [
        { id: "n-1", userId: "u-1" },
        { id: "n-2", userId: "u-2" },
      ],
    })

    expect(mocks.sendToWorkspaceMember).toHaveBeenCalledTimes(2)
    expect(mocks.sendToWorkspaceMember).toHaveBeenCalledWith(
      { workspaceId: "ws-1", userId: "u-1" },
      {
        eventType: "notificationCreated",
        data: { notificationId: "n-1" },
      },
    )
  })

  test("registers only once per process", async () => {
    const { registerNotificationRealtime } = await import(
      "../src/lib/notification-realtime"
    )

    registerNotificationRealtime()
    registerNotificationRealtime()

    expect(mocks.onNotificationsCreated).toHaveBeenCalledTimes(1)
  })
})
