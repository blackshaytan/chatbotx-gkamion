"use client"

import { useQueryClient } from "@tanstack/react-query"
import { useEffect, useMemo, useRef } from "react"
import { useWorkspaceRealtimeEvents } from "@/features/realtime/use-workspace-realtime-events"
import { orpc } from "@/lib/orpc/query"

export const TasksRealtimeSync = () => {
  const queryClient = useQueryClient()
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handlers = useMemo(
    () => ({
      taskChanged: () => {
        if (timerRef.current) {
          clearTimeout(timerRef.current)
        }
        timerRef.current = setTimeout(() => {
          timerRef.current = null
          queryClient
            .invalidateQueries({ queryKey: orpc.tasksAPI.key() })
            .catch(() => undefined)
        }, 300)
      },
      taskCommentsChanged: () => {
        if (timerRef.current) {
          clearTimeout(timerRef.current)
        }
        timerRef.current = setTimeout(() => {
          timerRef.current = null
          queryClient
            .invalidateQueries({ queryKey: orpc.tasksAPI.key() })
            .catch(() => undefined)
        }, 300)
      },
    }),
    [queryClient],
  )

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
