"use client"

import {
  OPEN_TASK_STATUSES,
  type TaskStatus,
} from "@chatbotx.io/database/partials"
import { cn } from "@chatbotx.io/ui/lib/utils"
import { isPast } from "date-fns"
import { useFormatter, useTranslations } from "next-intl"

type TaskDueLabelProps = {
  dueAt: Date | null
  status: TaskStatus
}

export const TaskDueLabel = ({ dueAt, status }: TaskDueLabelProps) => {
  const t = useTranslations("tasks")
  const formatter = useFormatter()

  if (!dueAt) {
    return <span className="text-muted-foreground">{t("due.none")}</span>
  }

  const isOverdue = OPEN_TASK_STATUSES.includes(status) && isPast(dueAt)

  return (
    <span className={cn(isOverdue && "font-medium text-destructive")}>
      {formatter.dateTime(dueAt, { dateStyle: "medium", timeStyle: "short" })}
    </span>
  )
}
