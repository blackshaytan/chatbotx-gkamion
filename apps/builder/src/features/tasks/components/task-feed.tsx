"use client"

import {
  type TaskPriority,
  type TaskStatus,
  type TaskSystemEvent,
  taskPriorities,
  taskStatusValues,
} from "@chatbotx.io/database/partials"
import { Button } from "@chatbotx.io/ui/components/ui/button"
import { Separator } from "@chatbotx.io/ui/components/ui/separator"
import { Textarea } from "@chatbotx.io/ui/components/ui/textarea"
import { useMutation, useQuery } from "@tanstack/react-query"
import { format, isValid } from "date-fns"
import { useTranslations } from "next-intl"
import { type KeyboardEvent, useMemo, useState } from "react"
import { toast } from "sonner"
import {
  useInboxTeams,
  useWorkspaceMembers,
} from "@/features/users/provider/user-hook"
import { orpc } from "@/lib/orpc/query"
import { useInvalidateTasks } from "../hooks/use-invalidate-tasks"

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
  const [comment, setComment] = useState("")
  const invalidateTasks = useInvalidateTasks()
  const { data: workspaceMembers = [] } = useWorkspaceMembers(workspaceId)
  const { data: inboxTeams = [] } = useInboxTeams(workspaceId)
  const { data } = useQuery(
    orpc.tasksAPI.comments.list.queryOptions({
      input: { id: taskId, page: 1, perPage: 100, workspaceId },
    }),
  )
  const createCommentMutation = useMutation(
    orpc.tasksAPI.comments.create.mutationOptions({
      onError: () => {
        toast.error(commonT("messages.unknownError"))
      },
      onSuccess: async () => {
        setComment("")
        toast.success(t("toasts.commented"))
        await invalidateTasks()
      },
    }),
  )

  const comments = useMemo(() => [...(data?.data ?? [])].reverse(), [data])

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
    return isValid(date) ? format(date, "PPp") : value
  }

  const handleCommentSubmit = () => {
    const text = comment.trim()

    if (!text || createCommentMutation.isPending) {
      return
    }

    createCommentMutation.mutate({ id: taskId, text, workspaceId })
  }

  const handleCommentKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!(event.key === "Enter" && (event.ctrlKey || event.metaKey))) {
      return
    }

    event.preventDefault()
    handleCommentSubmit()
  }

  return (
    <section className="flex min-h-0 flex-col gap-3">
      <h2 className="font-semibold">{t("actions.comment")}</h2>
      <div className="max-h-[45dvh] space-y-3 overflow-y-auto pe-1">
        {comments.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("feed.empty")}</p>
        ) : (
          comments.map((item) => {
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
                  <>
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="font-medium">{author}</span>
                      <time className="text-muted-foreground">
                        {format(item.createdAt, "PPp")}
                      </time>
                    </div>
                    <p className="whitespace-pre-wrap text-sm">
                      {item.deleted ? "—" : item.text}
                    </p>
                  </>
                )}
                <Separator />
              </div>
            )
          })
        )}
      </div>
      <div className="space-y-2">
        <Textarea
          aria-label={t("feed.placeholder")}
          onChange={(event) => setComment(event.target.value)}
          onKeyDown={handleCommentKeyDown}
          placeholder={t("feed.placeholder")}
          value={comment}
        />
        <Button
          disabled={!comment.trim() || createCommentMutation.isPending}
          onClick={handleCommentSubmit}
          type="button"
        >
          {t("actions.comment")}
        </Button>
      </div>
    </section>
  )
}
