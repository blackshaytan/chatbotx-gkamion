// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { expect, test, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  settings: { current: null as null | Record<string, unknown> },
}))
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }))
vi.mock("@/hooks/routing", () => ({ useWorkspaceId: () => "1" }))
vi.mock("@/lib/orpc/query", () => ({
  orpc: {
    staffAssistant: {
      get: { queryOptions: () => ({}) },
      update: { mutationOptions: () => ({}) },
      test: { mutationOptions: () => ({}) },
      key: () => [],
    },
    chatsAPI: { key: () => [] },
  },
}))
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    data: mocks.settings.current,
    isPending: false,
    isError: false,
  }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}))
vi.mock("@chatbotx.io/ui/components/form/input-field", () => ({
  InputField: () => null,
}))
vi.mock("@chatbotx.io/ui/components/form/input-number-field", () => ({
  InputNumberField: () => null,
}))
vi.mock("@chatbotx.io/ui/components/form/select-field", () => ({
  SelectField: () => null,
}))
vi.mock("@chatbotx.io/ui/components/form/switch-field", () => ({
  SwitchField: () => null,
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const { StaffAssistantSettingsForm } = await import(
  "@/features/staff-assistant/components/staff-assistant-settings-form"
)

test("always displays the access warning for configured and unconfigured profiles", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(<StaffAssistantSettingsForm tokenOptions={[]} />)
    await Promise.resolve()
  })
  expect(container.textContent).toContain("staffAssistant.fullAccessNotice")
  mocks.settings.current = {
    enabled: true,
    baseUrl: "https://agent.test",
    hasApiKey: true,
    botName: "Assistant",
    apiTokenId: "1",
    maxRunMinutes: 30,
  }
  await act(async () => {
    root.render(<StaffAssistantSettingsForm tokenOptions={[]} />)
    await Promise.resolve()
  })
  expect(container.textContent).toContain("staffAssistant.fullAccessNotice")
  await act(async () => root.unmount())
  container.remove()
})
