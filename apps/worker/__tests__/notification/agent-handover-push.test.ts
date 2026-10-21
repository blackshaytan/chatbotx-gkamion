// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from "vitest"
import { buildNotificationContent } from "../../src/notification/lib/build-notification-content"

const sendPushNotificationsAsync = vi.fn()

vi.mock("expo-server-sdk", () => ({
  Expo: class {
    static isExpoPushToken(token: string) {
      return token.startsWith("Expo[")
    }
    chunkPushNotifications<T>(messages: T[]) {
      return [messages]
    }
    sendPushNotificationsAsync = sendPushNotificationsAsync
  },
}))

vi.mock("../../src/env", () => ({
  env: { EXPO_PUSH_ENABLED: true, EXPO_ACCESS_TOKEN: undefined },
}))

const findByOrFail = vi.fn()
const listUserIdsByWorkspaceId = vi.fn()
const findByUserIds = vi.fn()
const deleteByTokens = vi.fn()
const contactFindById = vi.fn()
const workspaceFind = vi.fn()

vi.mock("@chatbotx.io/business", () => ({
  conversationService: { findByOrFail },
  workspaceMemberService: { listUserIdsByWorkspaceId },
  deviceTokenService: { findByUserIds, deleteByTokens },
  contactService: { findById: contactFindById },
  workspaceService: { find: workspaceFind },
}))

vi.mock("../../src/lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn() },
}))

const { sendPushForNotificationJob } = await import(
  "../../src/notification/handlers/send-push"
)

const handoverJob = (data: Record<string, unknown> = {}) =>
  ({
    type: "notifyAgentHandover",
    data: {
      workspaceId: "ws-1",
      conversationId: "conv-1",
      category: "urgent",
      reason: "Клиент просит срочный возврат",
      ...data,
    },
  }) as never

beforeEach(() => {
  vi.clearAllMocks()
  findByOrFail.mockResolvedValue({
    id: "conv-1",
    assignedUserId: "user-1",
    contactId: "contact-1",
  })
  listUserIdsByWorkspaceId.mockResolvedValue(["user-1", "user-2"])
  contactFindById.mockResolvedValue({ fullName: "Jane Doe" })
  workspaceFind.mockResolvedValue({ language: "en" })
  deleteByTokens.mockResolvedValue(undefined)
  sendPushNotificationsAsync.mockResolvedValue([{ status: "ok", id: "r1" }])
})

describe("buildNotificationContent for notifyAgentHandover", () => {
  test("titles the push with the contact name and the Russian category label", () => {
    const result = buildNotificationContent({
      job: handoverJob(),
      contactFullName: "Jane Doe",
      workspaceLanguage: "en",
    })

    expect(result.title).toBe("ИИ-агент передал диалог: Jane Doe · Срочно")
  })

  test("falls back to the generic client name when the contact has no name", () => {
    const result = buildNotificationContent({
      job: handoverJob(),
      contactFullName: null,
      workspaceLanguage: "en",
    })

    expect(result.title).toBe("ИИ-агент передал диалог: Клиент · Срочно")
  })

  test("uses the reason as the body", () => {
    const result = buildNotificationContent({
      job: handoverJob(),
      contactFullName: "Jane Doe",
      workspaceLanguage: "en",
    })

    expect(result.body).toBe("Клиент просит срочный возврат")
  })

  test("cuts the reason to 150 characters", () => {
    const result = buildNotificationContent({
      job: handoverJob({ reason: "а".repeat(400) }),
      contactFullName: "Jane Doe",
      workspaceLanguage: "en",
    })

    expect(result.body).toHaveLength(150)
  })

  test("maps every handover category to its Russian label", () => {
    const expectedLabels: Record<string, string> = {
      urgent: "Срочно",
      return: "Возврат",
      payment: "Оплата",
      orderStatus: "Статус заказа",
      delivery: "Доставка",
      priceAndTerm: "Цена и срок",
      other: "Прочее",
    }

    for (const [category, label] of Object.entries(expectedLabels)) {
      const result = buildNotificationContent({
        job: handoverJob({ category }),
        contactFullName: "Jane Doe",
        workspaceLanguage: "en",
      })

      expect(result.title).toBe(`ИИ-агент передал диалог: Jane Doe · ${label}`)
    }
  })
})

describe("sendPushForNotificationJob for notifyAgentHandover", () => {
  test("sends the handover push to the assigned user only", async () => {
    findByUserIds.mockResolvedValue([{ token: "Expo[token-1]" }])

    await sendPushForNotificationJob(handoverJob())

    expect(listUserIdsByWorkspaceId).not.toHaveBeenCalled()
    expect(findByUserIds).toHaveBeenCalledWith({ userIds: ["user-1"] })
    const sentMessages = sendPushNotificationsAsync.mock.calls[0][0]
    expect(sentMessages[0].title).toBe(
      "ИИ-агент передал диалог: Jane Doe · Срочно",
    )
    expect(sentMessages[0].body).toBe("Клиент просит срочный возврат")
    expect(sentMessages[0].data).toEqual({
      workspaceId: "ws-1",
      conversationId: "conv-1",
      messageId: "",
    })
  })

  test("fans the handover push out to every workspace member when unassigned", async () => {
    findByOrFail.mockResolvedValue({
      id: "conv-1",
      assignedUserId: null,
      contactId: "contact-1",
    })
    findByUserIds.mockResolvedValue([{ token: "Expo[token-1]" }])

    await sendPushForNotificationJob(handoverJob())

    expect(listUserIdsByWorkspaceId).toHaveBeenCalledWith({
      workspaceId: "ws-1",
    })
    expect(findByUserIds).toHaveBeenCalledWith({
      userIds: ["user-1", "user-2"],
    })
  })

  test("ignores excludeUserId, which only applies to incoming-message jobs", async () => {
    findByOrFail.mockResolvedValue({
      id: "conv-1",
      assignedUserId: null,
      contactId: "contact-1",
    })
    findByUserIds.mockResolvedValue([{ token: "Expo[token-1]" }])

    await sendPushForNotificationJob(handoverJob({ excludeUserId: "user-1" }))

    expect(findByUserIds).toHaveBeenCalledWith({
      userIds: ["user-1", "user-2"],
    })
  })
})
