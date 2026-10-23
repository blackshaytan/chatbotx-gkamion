"use client"

import type { TaskPriority } from "@chatbotx.io/database/partials"
import { Badge } from "@chatbotx.io/ui/components/ui/badge"
import { useTranslations } from "next-intl"

type TaskPriorityBadgeProps = {
  priority: TaskPriority
}

const priorityClassNameByPriority = {
  low: "border-slate-300 text-slate-700 dark:border-slate-700 dark:text-slate-300",
  normal:
    "border-blue-300 text-blue-700 dark:border-blue-700 dark:text-blue-300",
  high: "border-orange-300 text-orange-700 dark:border-orange-700 dark:text-orange-300",
  urgent: "border-red-300 text-red-700 dark:border-red-700 dark:text-red-300",
} as const satisfies Record<TaskPriority, string>

const priorityLabelKeyByPriority = {
  low: "priority.low",
  normal: "priority.normal",
  high: "priority.high",
  urgent: "priority.urgent",
} as const satisfies Record<TaskPriority, string>

export const TaskPriorityBadge = ({ priority }: TaskPriorityBadgeProps) => {
  const t = useTranslations("tasks")

  return (
    <Badge className={priorityClassNameByPriority[priority]} variant="outline">
      {t(priorityLabelKeyByPriority[priority])}
    </Badge>
  )
}
