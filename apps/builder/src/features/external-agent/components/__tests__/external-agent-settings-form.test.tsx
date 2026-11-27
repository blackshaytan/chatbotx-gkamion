// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { ExternalAgentSettingsForm } from "../external-agent-settings-form"

const { useInboxOptionsByChannel } = vi.hoisted(() => ({
  useInboxOptionsByChannel: vi.fn(() => []),
}))

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useFormatter: () => ({ dateTime: () => "" }),
}))

vi.mock("@/hooks/routing", () => ({
  useWorkspaceId: () => "workspace-1",
}))

vi.mock("@/features/inboxes/provider/inbox-hook", () => ({
  useInboxOptionsByChannel,
}))

vi.mock("@/lib/orpc/query", () => ({
  orpc: {
    externalAgent: {
      get: {
        queryOptions: () => ({}),
        key: () => ["externalAgent", "get"],
      },
      update: {
        mutationOptions: () => ({}),
      },
      test: {
        mutationOptions: () => ({}),
      },
    },
  },
}))

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: null, isPending: false, isError: false }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}))

describe("ExternalAgentSettingsForm inbox picker", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
    useInboxOptionsByChannel.mockClear()
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
  })

  test("includes email inboxes instead of the shared picker default that hides them", () => {
    act(() => {
      root.render(<ExternalAgentSettingsForm />)
    })

    expect(useInboxOptionsByChannel).toHaveBeenCalledWith(undefined, [])
  })
})
