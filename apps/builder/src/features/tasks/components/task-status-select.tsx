"use client"

import {
  type TaskStatus,
  taskStatusValues,
} from "@chatbotx.io/database/partials"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@chatbotx.io/ui/components/ui/select"
import { useMutation } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import type { z } from "zod"
import { orpc } from "@/lib/orpc/query"
import { useInvalidateTasks } from "../hooks/use-invalidate-tasks"
import type { taskPublicResource } from "../schema/public"

type TaskStatusSelectProps = {
  task: z.infer<typeof taskPublicResource>
  workspaceId: string
}

const statusLabelKeyByStatus = {
  todo: "status.todo",
  in_progress: "status.in_progress",
  done: "status.done",
  canceled: "status.canceled",
} as const satisfies Record<TaskStatus, string>

const isTaskStatus = (value: string): value is TaskStatus =>
  taskStatusValues.some((status) => status === value)

export const TaskStatusSelect = ({
  task,
  workspaceId,
}: TaskStatusSelectProps) => {
  const t = useTranslations("tasks")
  const commonT = useTranslations()
  const invalidateTasks = useInvalidateTasks()
  const updateTaskMutation = useMutation(
    orpc.tasksAPI.update.mutationOptions({
      onError: () => {
        toast.error(commonT("messages.unknownError"))
      },
      onSuccess: async () => {
        toast.success(t("toasts.updated"))
        await invalidateTasks()
      },
    }),
  )

  const handleStatusChange = (value: string | null) => {
    if (!(value && isTaskStatus(value)) || value === task.status) {
      return
    }

    updateTaskMutation.mutate({
      id: task.id,
      status: value,
      workspaceId,
    })
  }

  return (
    <Select
      disabled={updateTaskMutation.isPending}
      onValueChange={handleStatusChange}
      value={task.status}
    >
      <SelectTrigger aria-label={t("title")}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {taskStatusValues.map((status) => (
          <SelectItem key={status} value={status}>
            {t(statusLabelKeyByStatus[status])}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
