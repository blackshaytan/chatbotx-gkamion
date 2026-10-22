import { format } from "date-fns"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, test, vi } from "vitest"
import { MessageItem } from "@/features/messages/components/message-item"
import type { MessageResourceWithRelations } from "@/features/messages/schema/resource"

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}))

// See message-item-avatar.test.tsx: these pull `"use server"` modules into
// the browser preset. Both are irrelevant to the timestamp.
vi.mock("@/features/media-library/components/media-library-trigger", () => ({
  MediaLibraryTrigger: () => null,
}))
vi.mock("@/features/messages/components/whatsapp-call-card", () => ({
  WhatsappCallCard: () => <div data-slot="whatsapp-call-card">audioCall</div>,
}))

let container: HTMLDivElement | null = null
let root: Root | null = null

function renderComponent(ui: React.ReactElement) {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root?.render(ui)
  })
  return container
}

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount()
    })
  }
  container?.remove()
  container = null
  root = null
})

// Far enough in the past that the bubble shows the full date.
const CREATED_AT = new Date("2024-01-01T00:00:00Z")
const EXPECTED_TEXT = format(CREATED_AT, "dd.MM.yyyy HH:mm")

const makeMessage = (overrides: Partial<MessageResourceWithRelations> = {}) =>
  ({
    id: "msg-1",
    workspaceId: "ws-1",
    conversationId: "conv-1",
    createdAt: CREATED_AT,
    messageType: "outgoing",
    type: "message",
    text: "Hello",
    deletedAt: null,
    attributes: null,
    contentAttributes: null,
    attachments: [],
    ...overrides,
  }) as unknown as MessageResourceWithRelations

describe("MessageItem time", () => {
  test.each([
    "incoming",
    "outgoing",
  ] as const)("shows the %s message time inside its text bubble, always visible", (messageType) => {
    const el = renderComponent(
      <MessageItem message={makeMessage({ messageType })} />,
    )

    const time = el.querySelector("time")
    expect(time).not.toBeNull()
    expect(time?.getAttribute("dateTime")).toBe(CREATED_AT.toISOString())
    expect(time?.textContent).toBe(EXPECTED_TEXT)
    // Visible at rest: no hover or focus gating on the time.
    expect(time?.className).not.toContain("opacity-0")
    expect(time?.className).not.toContain("group-hover")
    // Same box as the text, so the time sits inside the bubble.
    expect(time?.parentElement?.querySelector("pre")?.textContent).toBe("Hello")
    expect(el.querySelector("[title]")).toBeNull()
  })

  test("closes a message without a text bubble below its content", () => {
    // An unknown content type renders no card, so the text bubble stays and
    // the time falls back to the end of the message column.
    const el = renderComponent(
      <MessageItem
        message={makeMessage({
          messageType: "incoming",
          contentAttributes: { type: "unknown" },
        })}
      />,
    )

    const time = el.querySelector("time")
    expect(time?.textContent).toBe(EXPECTED_TEXT)
    expect(time?.previousElementSibling?.querySelector("pre")).not.toBeNull()
  })

  test("renders no timestamp on a full-width activity row", () => {
    const el = renderComponent(
      <MessageItem message={makeMessage({ messageType: "activity" })} />,
    )

    expect(el.querySelector("time")).toBeNull()
  })
})
