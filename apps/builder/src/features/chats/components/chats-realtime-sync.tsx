"use client"

import { useQueryClient } from "@tanstack/react-query"
import { useMemo } from "react"
import { useWorkspaceRealtimeEvents } from "@/features/realtime/use-workspace-realtime-events"
import { orpc } from "@/lib/orpc/query"

export const ChatsRealtimeSync = () => {
  const queryClient = useQueryClient()
  const handlers = useMemo(
    () => ({
      chatChanged: () => {
        queryClient
          .invalidateQueries({ queryKey: orpc.chatsAPI.key() })
          .catch(() => undefined)
      },
    }),
    [queryClient],
  )
  useWorkspaceRealtimeEvents(handlers)
  return null
}
