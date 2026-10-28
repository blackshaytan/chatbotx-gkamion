import { useCallback, useEffect, useMemo, useRef, useState } from "react"
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
  const [typingChats, setTypingChats] = useState<Record<string, boolean>>({})
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const update = useCallback(
    (threadId: string, typing: boolean, seconds: number) => {
      clearTimeout(timers.current[threadId])
      setTypingChats((current) => ({ ...current, [threadId]: typing }))
      if (typing) {
        timers.current[threadId] = setTimeout(
          () => {
            delete timers.current[threadId]
            setTypingChats((current) => ({ ...current, [threadId]: false }))
          },
          Math.min(Math.max(seconds, 1), 60) * 1000,
        )
      } else {
        delete timers.current[threadId]
      }
    },
    [],
  )
  const handlers = useMemo(
    () => ({
      chatTyping: (event: {
        data: { threadId: string; typing: boolean; seconds: number }
      }) => {
        if (!isSupportSession) {
          update(event.data.threadId, event.data.typing, event.data.seconds)
        }
      },
    }),
    [isSupportSession, update],
  )
  useWorkspaceRealtimeEvents(handlers)
  useEffect(() => {
    if (selectedChatId && assistantRunning && !isSupportSession) {
      update(selectedChatId, true, 20)
    }
  }, [selectedChatId, assistantRunning, isSupportSession, update])
  useEffect(() => {
    if (isSupportSession) {
      for (const [threadId, timer] of Object.entries(timers.current)) {
        clearTimeout(timer)
        delete timers.current[threadId]
      }
      setTypingChats({})
    }
  }, [isSupportSession])
  useEffect(() => {
    const activeTimers = timers.current
    return () => {
      for (const timer of Object.values(activeTimers)) {
        clearTimeout(timer)
      }
    }
  }, [])
  return isSupportSession ? {} : typingChats
}
