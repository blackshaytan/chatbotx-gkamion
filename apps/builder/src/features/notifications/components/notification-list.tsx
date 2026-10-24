"use client"

import type {
  TaskNotificationType,
  TaskStatus,
} from "@chatbotx.io/database/partials"
import { Button } from "@chatbotx.io/ui/components/ui/button"
import {
  AlertTriangleIcon,
  AtSignIcon,
  CalendarClockIcon,
  CheckCircle2Icon,
  ClockIcon,
  MessageSquareIcon,
  UserPlusIcon,
} from "lucide-react"
import { useFormatter, useTranslations } from "next-intl"
import { useWorkspaceMembers } from "@/features/users/provider/user-hook"
import type { NotificationItem } from "../schema/resource"

const iconByType = {
  taskAssigned: UserPlusIcon,
  taskMentioned: AtSignIcon,
  taskCommented: MessageSquareIcon,
  taskStatusChanged: CheckCircle2Icon,
  taskDueChanged: CalendarClockIcon,
  taskReminder: ClockIcon,
  taskOverdue: AlertTriangleIcon,
} as const satisfies Record<TaskNotificationType, typeof UserPlusIcon>

const statusLabelKeyByStatus = {
  todo: "status.todo",
  in_progress: "status.in_progress",
  done: "status.done",
  canceled: "status.canceled",
} as const satisfies Record<TaskStatus, string>

const notificationTextKeyByType = {
  taskAssigned: "items.taskAssigned",
  taskMentioned: "items.taskMentioned",
  taskCommented: "items.taskCommented",
  taskStatusChanged: "items.taskStatusChanged",
  taskDueChanged: "items.taskDueChanged",
  taskReminder: "items.taskReminder",
  taskOverdue: "items.taskOverdue",
} as const satisfies Record<TaskNotificationType, string>

const isTaskStatus = (value: string | null | undefined): value is TaskStatus =>
  value !== null &&
  value !== undefined &&
  Object.hasOwn(statusLabelKeyByStatus, value)

type NotificationListProps = {
  items: NotificationItem[]
  loading: boolean
  onMarkAllRead: () => void
  onSelect: (item: NotificationItem) => void
  totalUnread: number
  workspaceId: string
}

export const NotificationList = ({
  items,
  loading,
  onMarkAllRead,
  onSelect,
  totalUnread,
  workspaceId,
}: NotificationListProps) => {
  const t = useTranslations("notifications")
  const tasksT = useTranslations("tasks")
  const commonT = useTranslations()
  const formatter = useFormatter()
  const { data: workspaceMembers = [] } = useWorkspaceMembers(workspaceId)

  const resolveActor = (item: NotificationItem): string => {
    if (item.payload.actorUserId) {
      const member = workspaceMembers.find(
        (candidate) => candidate.userId === item.payload.actorUserId,
      )
      if (member?.user?.name) {
        return member.user.name
      }
    }
    return item.payload.actorLabel ?? t("system")
  }

  const resolveTextParams = (item: NotificationItem) => {
    const from = isTaskStatus(item.payload.from)
      ? tasksT(statusLabelKeyByStatus[item.payload.from])
      : (item.payload.from ?? "")
    const to = isTaskStatus(item.payload.to)
      ? tasksT(statusLabelKeyByStatus[item.payload.to])
      : (item.payload.to ?? "")
    const dueAt = item.payload.to ? new Date(item.payload.to) : null

    return {
      actor: resolveActor(item),
      from,
      task: item.payload.taskTitle,
      to,
      date:
        dueAt && !Number.isNaN(dueAt.getTime())
          ? formatter.dateTime(dueAt, {
              dateStyle: "medium",
              timeStyle: "short",
            })
          : to,
    }
  }

  if (loading) {
    return (
      <p className="p-4 text-center text-muted-foreground text-sm">
        {commonT("actions.loading")}
      </p>
    )
  }

  if (items.length === 0) {
    return (
      <p className="p-6 text-center text-muted-foreground text-sm">
        {t("empty")}
      </p>
    )
  }

  return (
    <>
      <div className="flex items-center justify-between border-b px-2 pb-2">
        <h2 className="font-semibold">{t("title")}</h2>
        <Button
          disabled={totalUnread === 0}
          onClick={onMarkAllRead}
          size="sm"
          variant="ghost"
        >
          {t("markAllRead")}
        </Button>
      </div>
      <div className="max-h-[min(70dvh,32rem)] overflow-y-auto">
        {items.map((item) => {
          const Icon = iconByType[item.type]
          return (
            <Button
              className="h-auto w-full justify-start whitespace-normal rounded-none border-b px-2 py-3 text-start"
              key={item.id}
              onClick={() => onSelect(item)}
              variant="ghost"
            >
              <span
                className={
                  item.readAt
                    ? "mt-0.5 rounded-full bg-muted p-2 text-muted-foreground"
                    : "mt-0.5 rounded-full bg-primary/10 p-2 text-primary"
                }
              >
                <Icon className="size-4" />
              </span>
              <span className="min-w-0 flex-1 space-y-1">
                <span className={item.readAt ? "block" : "block font-medium"}>
                  {t(
                    item.type === "taskDueChanged" && item.payload.to === null
                      ? "items.taskDueRemoved"
                      : notificationTextKeyByType[item.type],
                    resolveTextParams(item),
                  )}
                  {item.readAt === null ? (
                    <span className="sr-only"> {t("unread")}</span>
                  ) : null}
                </span>
                {item.payload.excerpt ? (
                  <span className="line-clamp-2 block text-muted-foreground text-xs">
                    {item.payload.excerpt}
                  </span>
                ) : null}
                <time
                  className="block text-muted-foreground text-xs"
                  dateTime={item.createdAt.toISOString()}
                  suppressHydrationWarning
                >
                  {formatter.relativeTime(item.createdAt, new Date())}
                </time>
              </span>
            </Button>
          )
        })}
      </div>
    </>
  )
}
