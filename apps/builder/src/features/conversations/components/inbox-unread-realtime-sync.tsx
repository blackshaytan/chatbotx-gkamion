"use client"

import { useQueryClient } from "@tanstack/react-query"
import { useEffect, useMemo, useRef } from "react"
import { useWorkspaceRealtimeEvents } from "@/features/realtime/use-workspace-realtime-events"
import { orpc } from "@/lib/orpc/query"

export const InboxUnreadRealtimeSync = () => {
  const queryClient = useQueryClient()
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handlers = useMemo(() => {
    const scheduleInvalidate = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        queryClient
          .invalidateQueries({
            queryKey: orpc.conversationsAPI.unreadTotal.key(),
          })
          .catch(() => undefined)
      }, 300)
    }

    return {
      messageCreated: scheduleInvalidate,
      conversationUpdated: scheduleInvalidate,
      contactBlocked: scheduleInvalidate,
      contactUnblocked: scheduleInvalidate,
    }
  }, [queryClient])

  useWorkspaceRealtimeEvents(handlers)

  useEffect(
    () => () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }
    },
    [],
  )

  return null
}
