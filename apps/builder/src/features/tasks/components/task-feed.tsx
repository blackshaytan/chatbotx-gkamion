"use client"

import {
  type TaskPriority,
  type TaskStatus,
  type TaskSystemEvent,
  taskPriorities,
  taskStatusValues,
} from "@chatbotx.io/database/partials"
import { Separator } from "@chatbotx.io/ui/components/ui/separator"
import { useMutation, useQuery } from "@tanstack/react-query"
import { isValid } from "date-fns"
import { useFormatter, useTranslations } from "next-intl"
import { useEffect, useMemo, useRef } from "react"
import {
  useInboxTeams,
  useWorkspaceMembers,
} from "@/features/users/provider/user-hook"
import { orpc } from "@/lib/orpc/query"
import { PUBLIC_LIST_MAX_PER_PAGE } from "@/lib/public-api/list"
import { useInvalidateTasks } from "../hooks/use-invalidate-tasks"
import { extractApiErrorMessage } from "../lib/extract-api-error-message"
import { CommentComposer } from "./comment-composer"
import { CommentItem } from "./comment-item"

type TaskFeedProps = {
  taskId: string
  workspaceId: string
}

const statusLabelKeyByStatus = {
  todo: "status.todo",
  in_progress: "status.in_progress",
  done: "status.done",
  canceled: "status.canceled",
} as const satisfies Record<TaskStatus, string>

const priorityLabelKeyByPriority = {
  low: "priority.low",
  normal: "priority.normal",
  high: "priority.high",
  urgent: "priority.urgent",
} as const satisfies Record<TaskPriority, string>

const systemEventKeyByType = {
  created: "feed.system.created",
  status: "feed.system.status",
  due: "feed.system.due",
  assignee: "feed.system.assignee",
  priority: "feed.system.priority",
} as const satisfies Record<TaskSystemEvent["type"], string>

const isTaskStatus = (value: string): value is TaskStatus =>
  taskStatusValues.some((status) => status === value)

const isTaskPriority = (value: string): value is TaskPriority =>
  taskPriorities.options.some((priority) => priority === value)

export const TaskFeed = ({ taskId, workspaceId }: TaskFeedProps) => {
  const t = useTranslations("tasks")
  const commonT = useTranslations()
  const formatter = useFormatter()
  const invalidateTasks = useInvalidateTasks()
  const { data: workspaceMembers = [] } = useWorkspaceMembers(workspaceId)
  const { data: inboxTeams = [] } = useInboxTeams(workspaceId)
  const { data, error, isError, isPending } = useQuery(
    orpc.tasksAPI.comments.list.queryOptions({
      input: {
        id: taskId,
        page: 1,
        perPage: PUBLIC_LIST_MAX_PER_PAGE,
        workspaceId,
      },
    }),
  )
  const { mutate: markRead } = useMutation(
    orpc.tasksAPI.markRead.mutationOptions({
      onSuccess: () => invalidateTasks(),
    }),
  )
  const lastMarkedReadAt = useRef(0)
  const lastMarkedReadCommentId = useRef<string | undefined>(undefined)

  const comments = useMemo(() => [...(data?.data ?? [])].reverse(), [data])
  const latestCommentId = data?.data[0]?.id

  const resolveEventValue = (value: string | null) => {
    if (!value) {
      return "—"
    }

    if (isTaskStatus(value)) {
      return t(statusLabelKeyByStatus[value])
    }

    if (isTaskPriority(value)) {
      return t(priorityLabelKeyByPriority[value])
    }

    if (value.startsWith("user:")) {
      const userId = value.slice("user:".length)
      return (
        workspaceMembers.find((member) => member.userId === userId)?.user
          ?.name ?? t("hidden")
      )
    }

    if (value.startsWith("team:")) {
      const teamId = value.slice("team:".length)
      return inboxTeams.find((team) => team.id === teamId)?.name ?? t("hidden")
    }

    const date = new Date(value)
    return isValid(date)
      ? formatter.dateTime(date, { dateStyle: "medium", timeStyle: "short" })
      : value
  }

  useEffect(() => {
    if (
      !latestCommentId ||
      latestCommentId === lastMarkedReadCommentId.current
    ) {
      return
    }
    const now = Date.now()
    const delay = Math.max(0, 2000 - (now - lastMarkedReadAt.current))
    const handleMarkRead = () => {
      lastMarkedReadAt.current = Date.now()
      lastMarkedReadCommentId.current = latestCommentId
      markRead({ id: taskId, workspaceId })
    }
    if (delay === 0) {
      handleMarkRead()
      return
    }
    const timeout = setTimeout(handleMarkRead, delay)
    return () => clearTimeout(timeout)
  }, [latestCommentId, markRead, taskId, workspaceId])

  return (
    <section className="flex min-h-0 flex-col gap-3">
      <h2 className="font-semibold">{t("actions.comment")}</h2>
      <div className="max-h-[45dvh] space-y-3 overflow-y-auto pe-1">
        {isPending ? (
          <p className="text-muted-foreground text-sm">
            {commonT("actions.loading")}
          </p>
        ) : null}
        {isError ? (
          <p className="text-destructive text-sm" role="alert">
            {extractApiErrorMessage(error, commonT("messages.unknownError"))}
          </p>
        ) : null}
        {!(isPending || isError) && comments.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("feed.empty")}</p>
        ) : null}
        {!(isPending || isError) && comments.length > 0
          ? comments.map((item) => {
              const author =
                workspaceMembers.find(
                  (member) => member.userId === item.authorUserId,
                )?.user?.name ??
                item.authorLabel ??
                t("hidden")
              const event = item.systemEvent

              return (
                <div className="space-y-1" key={item.id}>
                  {item.kind === "system" && event ? (
                    <p className="text-muted-foreground text-sm">
                      {t(systemEventKeyByType[event.type], {
                        from: resolveEventValue(event.from),
                        to: resolveEventValue(event.to),
                      })}
                    </p>
                  ) : (
                    <CommentItem
                      comment={{ ...item, authorLabel: author }}
                      taskId={taskId}
                      workspaceId={workspaceId}
                    />
                  )}
                  <Separator />
                </div>
              )
            })
          : null}
      </div>
      <CommentComposer taskId={taskId} workspaceId={workspaceId} />
    </section>
  )
}
