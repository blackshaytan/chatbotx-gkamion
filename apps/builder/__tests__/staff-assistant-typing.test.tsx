// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, expect, test, vi } from "vitest"

const realtime = vi.hoisted(() => ({
  handler: null as
    | null
    | ((event: {
        data: { threadId: string; typing: boolean; seconds: number }
      }) => void),
}))
vi.mock("@/features/realtime/use-workspace-realtime-events", () => ({
  useWorkspaceRealtimeEvents: (handlers: {
    chatTyping: typeof realtime.handler
  }) => {
    realtime.handler = handlers.chatTyping
  },
}))
const { useStaffAssistantTyping } = await import(
  "@/features/chats/hooks/use-staff-assistant-typing"
)
afterEach(() => vi.useRealTimers())

test("typing is tracked by chat and expires even without a stop event", async () => {
  vi.useFakeTimers()
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const container = document.createElement("div")
  const root = createRoot(container)
  const View = ({
    chatId,
    running = false,
    support = false,
  }: {
    chatId: string
    running?: boolean
    support?: boolean
  }) => {
    const typing = useStaffAssistantTyping({
      selectedChatId: chatId,
      assistantRunning: running,
      isSupportSession: support,
    })
    return (
      <span>
        {String(Boolean(typing[chatId]))}:{String(Boolean(typing["2"]))}
      </span>
    )
  }
  await act(async () => root.render(<View chatId="1" />))
  await act(async () =>
    realtime.handler?.({ data: { threadId: "2", typing: true, seconds: 5 } }),
  )
  expect(container.textContent).toBe("false:true")
  await act(async () =>
    realtime.handler?.({ data: { threadId: "1", typing: true, seconds: 5 } }),
  )
  expect(container.textContent).toBe("true:true")
  await act(async () => vi.advanceTimersByTime(5000))
  expect(container.textContent).toBe("false:false")
  await act(async () => root.render(<View chatId="2" running />))
  expect(container.textContent).toBe("true:true")
  await act(async () => root.render(<View chatId="2" running support />))
  expect(container.textContent).toBe("false:false")
  await act(async () =>
    realtime.handler?.({ data: { threadId: "2", typing: true, seconds: 5 } }),
  )
  expect(container.textContent).toBe("false:false")
  await act(async () => root.unmount())
})
