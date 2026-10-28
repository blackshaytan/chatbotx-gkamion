import { useEffect, useMemo, useRef, useState } from "react"
import { useWorkspaceRealtimeEvents } from "@/features/realtime/use-workspace-realtime-events"

export function useStaffAssistantTyping({
  assistantRunning,
  isSupportSession,
  selectedChatId,
}: {
  assistantRunning: boolean
  isSupportSession: boolean
  selectedChatId?: string
}) {
  const [typing, setTyping] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handlers = useMemo(
    () => ({
      chatTyping: (event: {
        data: { threadId: string; typing: boolean; seconds: number }
      }) => {
        if (event.data.threadId !== selectedChatId || isSupportSession) {
          return
        }
        if (timer.current) {
          clearTimeout(timer.current)
        }
        setTyping(event.data.typing)
        if (event.data.typing) {
          timer.current = setTimeout(
            () => setTyping(false),
            Math.min(Math.max(event.data.seconds, 1), 60) * 1000,
          )
        }
      },
    }),
    [isSupportSession, selectedChatId],
  )
  useWorkspaceRealtimeEvents(handlers)
  useEffect(() => {
    const running = Boolean(
      selectedChatId && assistantRunning && !isSupportSession,
    )
    setTyping(running)
    if (timer.current) {
      clearTimeout(timer.current)
    }
    if (running) {
      timer.current = setTimeout(() => setTyping(false), 20_000)
    }
    return () => {
      if (timer.current) {
        clearTimeout(timer.current)
      }
    }
  }, [selectedChatId, assistantRunning, isSupportSession])
  return typing
}
