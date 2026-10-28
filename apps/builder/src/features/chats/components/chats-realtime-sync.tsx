"use client"

import { useQueryClient } from "@tanstack/react-query"
import { useEffect, useMemo, useRef } from "react"
import { useWorkspaceRealtimeEvents } from "@/features/realtime/use-workspace-realtime-events"
import { orpc } from "@/lib/orpc/query"

export const ChatsRealtimeSync = () => {
  const queryClient = useQueryClient()
  const invalidateTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handlers = useMemo(
    () => ({
      chatChanged: () => {
        if (invalidateTimer.current) {
          clearTimeout(invalidateTimer.current)
        }
        invalidateTimer.current = setTimeout(() => {
          invalidateTimer.current = null
          queryClient
            .invalidateQueries({ queryKey: orpc.chatsAPI.key() })
            .catch(() => undefined)
        }, 300)
      },
    }),
    [queryClient],
  )
  useEffect(
    () => () => {
      if (invalidateTimer.current) {
        clearTimeout(invalidateTimer.current)
      }
    },
    [],
  )
  useWorkspaceRealtimeEvents(handlers)
  return null
}
