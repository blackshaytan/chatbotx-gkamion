import { act, type ReactElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import type { ConversationResource } from "@/features/conversations/schema/resource"

const { dialogPropsRef, updateConversationMock, invalidateContactsMock } =
  vi.hoisted(() => ({
    dialogPropsRef: {
      current: null as null | { ids: string[]; onSuccess?: () => void },
    },
    updateConversationMock: vi.fn(),
    invalidateContactsMock: vi.fn(),
  }))

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) =>
    values ? `${key}(${Object.values(values).join("|")})` : key,
  useFormatter: () => ({
    dateTime: (at: Date) =>
      `${String(at.getUTCHours()).padStart(2, "0")}:${String(at.getUTCMinutes()).padStart(2, "0")}`,
  }),
}))

vi.mock("@/features/chat/store/chat-store-provider", () => ({
  useChatStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ updateConversation: updateConversationMock }),
}))

vi.mock("@/features/contacts/hooks/use-contacts", () => ({
  useInvalidateContacts: () => invalidateContactsMock,
}))

vi.mock("@/features/conversations/components/enable-bot-dialog", () => ({
  default: (props: {
    ids: string[]
    onSuccess?: () => void
    trigger: ReactElement
  }) => {
    dialogPropsRef.current = props
    return props.trigger
  },
}))

const { BotStateBar } = await import(
  "@/features/conversations/components/bot-state-bar"
)

const makeConversation = (
  overrides: Partial<ConversationResource> = {},
): ConversationResource =>
  ({
    id: "conversation-1",
    botEnabled: false,
    botResumeAt: null,
    handoverCategory: null,
    handedOverAt: null,
    ...overrides,
  }) as unknown as ConversationResource

describe("BotStateBar", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    vi.clearAllMocks()
    dialogPropsRef.current = null
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  const render = (conversation: ConversationResource) =>
    act(() => {
      root.render(<BotStateBar conversation={conversation} />)
    })

  test("renders nothing while the bot answers", () => {
    render(
      makeConversation({
        botEnabled: true,
        handedOverAt: new Date("2026-01-02T00:00:00Z"),
        handoverCategory: "urgent",
      }),
    )

    expect(container.innerHTML).toBe("")
  })

  test("asks for a manager with the handover category", () => {
    render(
      makeConversation({
        handedOverAt: new Date("2026-01-02T00:00:00Z"),
        handoverCategory: "delivery",
      }),
    )

    expect(container.textContent).toContain(
      "inboxAttention.waitingManagerWithCategory(inboxAttention.handoverCategory.delivery)",
    )
    expect(container.textContent).toContain("inboxAttention.returnToBot")
  })

  test("asks for a manager without a category when none was given", () => {
    render(makeConversation({ handedOverAt: new Date("2026-01-02T00:00:00Z") }))

    expect(container.textContent).toContain("inboxAttention.waitingManager")
    expect(container.textContent).not.toContain("waitingManagerWithCategory")
  })

  test("shows when the paused bot resumes", () => {
    render(
      makeConversation({
        botResumeAt: new Date(Date.now() + 60 * 60 * 1000),
      }),
    )

    expect(container.textContent).toContain("inboxAttention.botPausedUntil(")
    expect(container.textContent).toContain("inboxAttention.returnToBot")
  })

  test("renders nothing for a bot paused in the past", () => {
    render(
      makeConversation({
        botResumeAt: new Date("2020-01-01T00:00:00Z"),
      }),
    )

    expect(container.innerHTML).toBe("")
  })

  test("returning to the bot clears the handover state in the store and refreshes contacts", () => {
    render(
      makeConversation({
        handedOverAt: new Date("2026-01-02T00:00:00Z"),
        handoverCategory: "payment",
      }),
    )

    expect(dialogPropsRef.current?.ids).toEqual(["conversation-1"])
    act(() => {
      dialogPropsRef.current?.onSuccess?.()
    })

    expect(updateConversationMock).toHaveBeenCalledWith("conversation-1", {
      botEnabled: true,
      botResumeAt: null,
      handoverCategory: null,
      handedOverAt: null,
    })
    expect(invalidateContactsMock).toHaveBeenCalledTimes(1)
  })
})
