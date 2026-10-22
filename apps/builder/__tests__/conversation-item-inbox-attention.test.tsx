import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import type { ListConversationItemResource } from "@/features/conversations/schema/resource"

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: { count?: string }) =>
    values?.count === undefined ? key : `${key}:${values.count}`,
  useFormatter: () => ({ dateTime: (at: Date) => at.toISOString() }),
}))

vi.mock("@/features/conversations/hooks/use-mark-conversation-read", () => ({
  useMarkConversationRead: () => vi.fn(),
}))

vi.mock("@/features/tenant/tenant-settings-provider", () => ({
  useTenantSettings: () => ({ name: "AhaChat" }),
}))

vi.mock("@/features/contacts/utils", () => ({
  useAvatarUrl: () => undefined,
}))

vi.mock("@/lib/auth/avatar", () => ({
  useUserAvatarUrl: () => undefined,
}))

vi.mock(
  "@/features/conversations/queries/resolve-last-message-preview",
  () => ({
    resolveLastMessagePreview: () => "hello there",
    resolveCallPreviewKind: () => undefined,
  }),
)

vi.mock("@/features/conversations/utils/ad-badge", () => ({
  selectAdBadge: () => null,
  selectGoogleAdsBadge: () => null,
  adBadgeLabelKey: () => "whatsapp.calls.ringingBadge",
  googleAdsBadgeLabelKey: () => "fields.adReferral.googleAds",
}))

vi.mock("@/features/chat/store/chat-store-provider", () => ({
  useChatStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      activeConversationId: null,
      applyAgentLastReadAt: vi.fn(),
      clearManuallyUnread: vi.fn(),
    }),
}))

vi.mock(
  "@/features/integration-whatsapp/calling/voip/whatsapp-voip-call-context",
  () => ({
    useOptionalWhatsappVoipCallContext: () => null,
  }),
)

const { default: ConversationItem } = await import(
  "@/features/conversations/conversation-item"
)

const makeConversation = (
  overrides: Partial<ListConversationItemResource> = {},
): ListConversationItemResource =>
  ({
    id: "conversation-1",
    workspaceId: "workspace-1",
    contact: { fullName: "Ada Lovelace" },
    contactInboxes: [],
    followed: false,
    messages: [],
    botEnabled: true,
    botResumeAt: null,
    handoverCategory: null,
    handedOverAt: null,
    unreadCount: 0,
    agentLastReadAt: null,
    contactLastReadAt: null,
    lastActivityAt: null,
    inboxActivityAt: new Date("2026-01-02T00:00:00Z"),
    assignedUserId: null,
    assignedInboxTeamId: null,
    ...overrides,
  }) as unknown as ListConversationItemResource

const getBadge = (container: HTMLElement) =>
  container.querySelector<HTMLElement>('[role="img"][aria-label]')

describe("ConversationItem inbox attention", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  const render = (conversation: ListConversationItemResource) =>
    act(() => {
      root.render(
        <ConversationItem
          assigneeOptionNameByValue={new Map()}
          conversation={conversation}
          onSelect={vi.fn()}
        />,
      )
    })

  test("hides the unread badge when the count is zero", () => {
    render(makeConversation({ unreadCount: 0 }))

    expect(getBadge(container)).toBeNull()
  })

  test("shows the unread count gray while the bot is active", () => {
    render(makeConversation({ botEnabled: true, unreadCount: 3 }))

    const badge = getBadge(container)
    expect(badge?.textContent).toBe("3")
    expect(badge?.classList.contains("bg-zinc-400")).toBe(true)
    expect(badge?.classList.contains("bg-red-600")).toBe(false)
  })

  test("shows the unread count red when the bot is off", () => {
    render(makeConversation({ botEnabled: false, unreadCount: 2 }))

    const badge = getBadge(container)
    expect(badge?.textContent).toBe("2")
    expect(badge?.classList.contains("bg-red-600")).toBe(true)
    expect(badge?.classList.contains("bg-zinc-400")).toBe(false)
  })

  test("shows 99+ when the count reaches the cap", () => {
    render(makeConversation({ botEnabled: false, unreadCount: 100 }))

    expect(getBadge(container)?.textContent).toBe("99+")
    expect(getBadge(container)?.getAttribute("aria-label")).toBe(
      "inboxAttention.unreadCount:99+",
    )
  })

  test("shows the handover category pill when the bot is off after a handover", () => {
    render(
      makeConversation({
        botEnabled: false,
        handedOverAt: new Date("2026-01-02T00:00:00Z"),
        handoverCategory: "urgent",
      }),
    )

    expect(container.textContent).toContain(
      "🔥 inboxAttention.handoverCategory.urgent",
    )
  })

  test("hides the category pill while the bot is active", () => {
    render(
      makeConversation({
        botEnabled: true,
        handedOverAt: new Date("2026-01-02T00:00:00Z"),
        handoverCategory: "payment",
      }),
    )

    expect(container.textContent).not.toContain(
      "inboxAttention.handoverCategory.payment",
    )
  })

  test("hides the category pill when the handover has no category", () => {
    render(
      makeConversation({
        botEnabled: false,
        handedOverAt: new Date("2026-01-02T00:00:00Z"),
        handoverCategory: null,
      }),
    )

    expect(container.textContent).not.toContain(
      "inboxAttention.handoverCategory",
    )
  })

  test("shows a red waiting-for-manager dot when a handover is unread with no client message to count", () => {
    render(
      makeConversation({
        botEnabled: false,
        handedOverAt: new Date("2026-01-02T00:00:00Z"),
        handoverCategory: "urgent",
        inboxActivityAt: null,
        agentLastReadAt: new Date("2026-01-01T00:00:00Z"),
        unreadCount: 0,
      }),
    )

    const dot = getBadge(container)
    expect(dot?.getAttribute("aria-label")).toBe(
      "inboxAttention.waitingManager",
    )
    expect(dot?.textContent).toBe("")
    expect(dot?.classList.contains("bg-red-600")).toBe(true)
  })

  test("hides the dot once the manager has read after the handover", () => {
    render(
      makeConversation({
        botEnabled: false,
        handedOverAt: new Date("2026-01-02T00:00:00Z"),
        handoverCategory: "urgent",
        inboxActivityAt: null,
        agentLastReadAt: new Date("2026-01-03T00:00:00Z"),
        unreadCount: 0,
      }),
    )

    expect(getBadge(container)).toBeNull()
  })

  test("hides the dot while the bot is active", () => {
    render(
      makeConversation({
        botEnabled: true,
        handedOverAt: new Date("2026-01-02T00:00:00Z"),
        inboxActivityAt: null,
        agentLastReadAt: null,
        unreadCount: 0,
      }),
    )

    expect(getBadge(container)).toBeNull()
  })

  test("prefers the count over the dot when client messages are unread", () => {
    render(
      makeConversation({
        botEnabled: false,
        handedOverAt: new Date("2026-01-02T00:00:00Z"),
        handoverCategory: "urgent",
        unreadCount: 2,
      }),
    )

    const badge = getBadge(container)
    expect(badge?.textContent).toBe("2")
    expect(badge?.getAttribute("aria-label")).toBe(
      "inboxAttention.unreadCount:2",
    )
  })
})
