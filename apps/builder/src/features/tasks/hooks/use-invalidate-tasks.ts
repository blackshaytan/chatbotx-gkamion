"use client"

import { useQueryClient } from "@tanstack/react-query"
import { useCallback } from "react"
import { orpc } from "@/lib/orpc/query"

export const useInvalidateTasks = () => {
  const queryClient = useQueryClient()

  return useCallback(
    () => queryClient.invalidateQueries({ queryKey: orpc.tasksAPI.key() }),
    [queryClient],
  )
}
