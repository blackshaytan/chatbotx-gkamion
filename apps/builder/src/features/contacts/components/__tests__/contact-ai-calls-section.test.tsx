// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { ContactAiCallsSection } from "../contact-ai-calls-section"

let queryClient: QueryClient

const { noopAction } = vi.hoisted(() => {
  const action = Object.assign(
    () => Promise.resolve({ contactIds: ["a"], alreadySet: false }),
    {
      bind: () => () =>
        Promise.resolve({ contactIds: ["a"], alreadySet: false }),
    },
  )
  return { noopAction: action }
})

vi.mock("next-intl", () => ({
  useFormatter: () => ({
    dateTime: () => "mocked date",
  }),
  useTranslations: () => (key: string, _values?: Record<string, unknown>) =>
    key,
}))

vi.mock("next-safe-action/hooks", () => ({
  useAction: () => ({
    execute: () => Promise.resolve(),
    isPending: false,
  }),
}))

vi.mock("@/lib/orpc/query", () => ({
  orpc: {
    contactsAPIs: {
      key: () => ["contactsAPIs"],
    },
  },
}))

vi.mock("../../actions/set-ai-call-opt-out.action", () => ({
  setAiCallOptOutAction: noopAction,
}))

vi.mock("../../actions/clear-ai-call-opt-out.action", () => ({
  clearAiCallOptOutAction: noopAction,
}))

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  queryClient = new QueryClient()
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const render = (props: Parameters<typeof ContactAiCallsSection>[0]) =>
  act(() =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <ContactAiCallsSection {...props} />
      </QueryClientProvider>,
    ),
  )

describe("ContactAiCallsSection", () => {
  test("shows the quote and turns the switch off when opt-out is set", () => {
    render({
      workspaceId: "1",
      contact: {
        id: "a",
        phoneNumber: "+79990000000",
        aiCallOptOutAt: new Date("2026-11-02T14:32:00Z"),
        aiCallOptOutSource: "clientChat",
        aiCallOptOutReason: "не звоните мне",
      },
    })

    const switchEl = container.querySelector('[role="switch"]')
    expect(switchEl).not.toBeNull()
    expect(switchEl?.getAttribute("aria-checked")).toBe("false")
    expect(container.textContent).toContain("не звоните мне")
  })

  test("warns when the contact has no phone", () => {
    render({
      workspaceId: "1",
      contact: {
        id: "a",
        phoneNumber: null,
        aiCallOptOutAt: new Date(),
        aiCallOptOutSource: "manager",
        aiCallOptOutReason: null,
      },
    })

    expect(container.textContent).toContain("noPhoneWarning")
  })
})
