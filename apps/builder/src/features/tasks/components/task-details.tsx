"use client"

import {
  type TaskPriority,
  taskPriorities,
} from "@chatbotx.io/database/partials"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@chatbotx.io/ui/components/ui/alert-dialog"
import { Button } from "@chatbotx.io/ui/components/ui/button"
import { DateTimePicker } from "@chatbotx.io/ui/components/ui/date-picker"
import { Input } from "@chatbotx.io/ui/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@chatbotx.io/ui/components/ui/select"
import { Separator } from "@chatbotx.io/ui/components/ui/separator"
import { Textarea } from "@chatbotx.io/ui/components/ui/textarea"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Loader2Icon, PencilIcon, PlusIcon, XIcon } from "lucide-react"
import Link from "next/link"
import { useFormatter, useTranslations } from "next-intl"
import { type FormEvent, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import {
  useContactAssigneeOptions,
  useWorkspaceMembers,
} from "@/features/users/provider/user-hook"
import { orpc } from "@/lib/orpc/query"
import { useInvalidateTasks } from "../hooks/use-invalidate-tasks"
import { extractApiErrorMessage } from "../lib/extract-api-error-message"
import {
  REMINDER_PRESETS,
  type ReminderPreset,
  remindAtFromPreset,
} from "../lib/reminder-presets"
import { parseTaskAssigneeValue, taskAssigneeValue } from "../lib/task-assignee"
import { TaskFeed } from "./task-feed"
import { TaskPriorityBadge } from "./task-priority-badge"
import { TaskStatusSelect } from "./task-status-select"

type TaskDetailsProps = {
  taskId: string
  workspaceId: string
  onDeleted?: () => void
}

const priorityLabelKeyByPriority = {
  low: "priority.low",
  normal: "priority.normal",
  high: "priority.high",
  urgent: "priority.urgent",
} as const satisfies Record<TaskPriority, string>

const reminderLabelKeyByPreset = {
  min15: "reminder.min15",
  hour1: "reminder.hour1",
  day1: "reminder.day1",
} as const satisfies Record<ReminderPreset, string>

const isNotFoundError = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  (error.code === "NOT_FOUND" || error.code === "notFound")

export const TaskDetails = ({
  taskId,
  workspaceId,
  onDeleted,
}: TaskDetailsProps) => {
  const t = useTranslations("tasks")
  const commonT = useTranslations()
  const formatter = useFormatter()
  const invalidateTasks = useInvalidateTasks()
  const queryClient = useQueryClient()
  const { data: workspaceMembers = [] } = useWorkspaceMembers(workspaceId)
  const assigneeOptions = useContactAssigneeOptions({ autoGroup: false })
  const [isEditingText, setIsEditingText] = useState(false)
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [dueAtDraft, setDueAtDraft] = useState<Date | undefined>()
  const [remindAtDraft, setRemindAtDraft] = useState<Date | undefined>()
  const [watcherUserId, setWatcherUserId] = useState("")
  const handleWatcherSelect = (value: unknown) => {
    setWatcherUserId(typeof value === "string" ? value : "")
  }
  const {
    data: task,
    error,
    isPending,
  } = useQuery(
    orpc.tasksAPI.get.queryOptions({ input: { id: taskId, workspaceId } }),
  )
  const updateTaskMutation = useMutation(
    orpc.tasksAPI.update.mutationOptions({
      onError: (error) => {
        toast.error(
          extractApiErrorMessage(error, commonT("messages.unknownError")),
        )
      },
      onSuccess: async () => {
        toast.success(t("toasts.updated"))
        await invalidateTasks()
      },
    }),
  )
  const takeTaskMutation = useMutation(
    orpc.tasksAPI.take.mutationOptions({
      onError: (error) => {
        toast.error(
          extractApiErrorMessage(error, commonT("messages.unknownError")),
        )
      },
      onSuccess: async () => {
        toast.success(t("toasts.taken"))
        await invalidateTasks()
      },
    }),
  )
  const addWatcherMutation = useMutation(
    orpc.tasksAPI.addWatcher.mutationOptions({
      onError: (error) => {
        toast.error(
          extractApiErrorMessage(error, commonT("messages.unknownError")),
        )
      },
      onSuccess: async () => {
        toast.success(t("toasts.updated"))
        setWatcherUserId("")
        await invalidateTasks()
      },
    }),
  )
  const removeWatcherMutation = useMutation(
    orpc.tasksAPI.removeWatcher.mutationOptions({
      onError: (error) => {
        toast.error(
          extractApiErrorMessage(error, commonT("messages.unknownError")),
        )
      },
      onSuccess: async () => {
        toast.success(t("toasts.updated"))
        await invalidateTasks()
      },
    }),
  )
  const deleteTaskMutation = useMutation(
    orpc.tasksAPI.delete.mutationOptions({
      onError: (error) => {
        toast.error(
          extractApiErrorMessage(error, commonT("messages.unknownError")),
        )
      },
      onSuccess: async () => {
        toast.success(t("toasts.deleted"))
        queryClient.removeQueries({
          queryKey: orpc.tasksAPI.get.key({
            input: { id: taskId, workspaceId },
          }),
        })
        queryClient.removeQueries({
          queryKey: orpc.tasksAPI.comments.list.key({
            input: { id: taskId, page: 1, workspaceId },
          }),
        })
        onDeleted?.()
        await invalidateTasks()
      },
    }),
  )

  useEffect(() => {
    setDueAtDraft(task?.dueAt ?? undefined)
  }, [task?.dueAt])

  useEffect(() => {
    setRemindAtDraft(task?.remindAt ?? undefined)
  }, [task?.remindAt])

  const watcherOptions = useMemo(
    () =>
      assigneeOptions.filter(
        (option) =>
          option.value.startsWith("u_") &&
          !task?.watcherUserIds.includes(option.value.slice(2)),
      ),
    [assigneeOptions, task?.watcherUserIds],
  )
  const priorityItems = taskPriorities.options.map((priority) => ({
    label: t(priorityLabelKeyByPriority[priority]),
    value: priority,
  }))

  if (isPending) {
    return <Loader2Icon className="animate-spin" />
  }

  if (isNotFoundError(error)) {
    return <p className="text-muted-foreground">{t("notFound")}</p>
  }

  if (!task) {
    return (
      <p className="text-muted-foreground">
        {commonT("messages.unknownError")}
      </p>
    )
  }

  const handleTextSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const nextTitle = title.trim()

    if (!nextTitle) {
      return
    }

    updateTaskMutation.mutate({
      description: description.trim() || null,
      id: task.id,
      title: nextTitle,
      workspaceId,
    })
    setIsEditingText(false)
  }

  const handleStartEditing = () => {
    setTitle(task.title)
    setDescription(task.description ?? "")
    setIsEditingText(true)
  }

  const handlePriorityChange = (value: unknown) => {
    if (
      !(
        typeof value === "string" &&
        taskPriorities.options.some((priority) => priority === value)
      ) ||
      value === task.priority
    ) {
      return
    }

    updateTaskMutation.mutate({
      id: task.id,
      priority: value as TaskPriority,
      workspaceId,
    })
  }

  const handleAssigneeChange = (value: unknown) => {
    if (typeof value !== "string" || value === taskAssigneeValue(task)) {
      return
    }

    updateTaskMutation.mutate({
      id: task.id,
      ...parseTaskAssigneeValue(value),
      workspaceId,
    })
  }

  const handleDueAtChange = (dueAt: Date | undefined) => {
    setDueAtDraft(dueAt)
  }

  const handleDueAtSave = () => {
    updateTaskMutation.mutate({
      dueAt: dueAtDraft ?? null,
      id: task.id,
      workspaceId,
    })
  }

  const handleRemindAtChange = (remindAt: Date | undefined) => {
    setRemindAtDraft(remindAt)
  }

  const handleRemindAtSave = () => {
    updateTaskMutation.mutate({
      id: task.id,
      remindAt: remindAtDraft ?? null,
      workspaceId,
    })
  }

  const handleDateMonthChange = (date: Date | undefined) => date

  const handleDueAtClear = () => {
    setDueAtDraft(undefined)
    updateTaskMutation.mutate({
      dueAt: null,
      id: task.id,
      workspaceId,
    })
  }

  const handleRemindAtClear = () => {
    setRemindAtDraft(undefined)
    updateTaskMutation.mutate({
      id: task.id,
      remindAt: null,
      workspaceId,
    })
  }

  const handleReminderPreset = (preset: ReminderPreset) => {
    if (!dueAtDraft) {
      return
    }

    setRemindAtDraft(remindAtFromPreset(dueAtDraft, preset))
  }

  const handleAddWatcher = () => {
    if (!watcherUserId || addWatcherMutation.isPending) {
      return
    }

    addWatcherMutation.mutate({
      id: task.id,
      userId: watcherUserId,
      workspaceId,
    })
  }

  const descriptionContent = task.description ? (
    <p className="whitespace-pre-wrap text-sm">{task.description}</p>
  ) : null

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_1fr]">
      <section className="space-y-5">
        <div className="flex items-start justify-between gap-2">
          <h1 className="font-semibold text-xl">{task.title}</h1>
          <Button
            aria-label={commonT("actions.edit")}
            onClick={handleStartEditing}
            size="icon"
            type="button"
            variant="ghost"
          >
            <PencilIcon aria-hidden="true" />
          </Button>
        </div>
        {isEditingText ? (
          <form className="space-y-3" onSubmit={handleTextSubmit}>
            <Input
              aria-label={t("fields.title")}
              onChange={(event) => setTitle(event.target.value)}
              value={title}
            />
            <Textarea
              aria-label={t("fields.description")}
              onChange={(event) => setDescription(event.target.value)}
              value={description}
            />
            <Button disabled={updateTaskMutation.isPending} type="submit">
              {t("actions.save")}
            </Button>
          </form>
        ) : (
          descriptionContent
        )}

        <Separator />
        <div className="space-y-3">
          <div className="space-y-1">
            <span className="text-muted-foreground text-sm">
              {commonT("fields.status.label")}
            </span>
            <TaskStatusSelect task={task} workspaceId={workspaceId} />
          </div>
          <div className="space-y-1">
            <span className="text-muted-foreground text-sm">
              {t("fields.priority")}
            </span>
            <Select
              items={priorityItems}
              onValueChange={handlePriorityChange}
              value={task.priority}
            >
              <SelectTrigger aria-label={t("fields.priority")}>
                <SelectValue>
                  <TaskPriorityBadge priority={task.priority} />
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {taskPriorities.options.map((priority) => (
                  <SelectItem key={priority} value={priority}>
                    {t(priorityLabelKeyByPriority[priority])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <span className="text-muted-foreground text-sm">
              {t("fields.assignee")}
            </span>
            <Select
              items={assigneeOptions}
              onValueChange={handleAssigneeChange}
              value={taskAssigneeValue(task)}
            >
              <SelectTrigger aria-label={t("fields.assignee")}>
                <SelectValue placeholder={t("fields.assignee")} />
              </SelectTrigger>
              <SelectContent>
                {assigneeOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {task.assigneeTeamId ? (
            <Button
              disabled={takeTaskMutation.isPending}
              onClick={() =>
                takeTaskMutation.mutate({ id: task.id, workspaceId })
              }
              type="button"
              variant="outline"
            >
              {t("actions.take")}
            </Button>
          ) : null}
          <div className="space-y-2">
            <span className="text-muted-foreground text-sm">
              {t("fields.dueAt")}
            </span>
            <DateTimePicker
              onChange={handleDueAtChange}
              onMonthChange={handleDateMonthChange}
              placeholder={t("fields.dueAt")}
              value={dueAtDraft}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={updateTaskMutation.isPending}
                onClick={handleDueAtSave}
                size="sm"
                type="button"
              >
                {t("actions.save")}
              </Button>
              <Button
                disabled={!task.dueAt || updateTaskMutation.isPending}
                onClick={handleDueAtClear}
                size="sm"
                type="button"
                variant="outline"
              >
                {commonT("actions.clear")}
              </Button>
            </div>
          </div>
          {dueAtDraft ? (
            <div className="flex flex-wrap gap-2">
              {REMINDER_PRESETS.map((preset) => (
                <Button
                  key={preset}
                  onClick={() => handleReminderPreset(preset)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {t(reminderLabelKeyByPreset[preset])}
                </Button>
              ))}
            </div>
          ) : null}
          <div className="space-y-2">
            <span className="text-muted-foreground text-sm">
              {t("fields.remindAt")}
            </span>
            <DateTimePicker
              onChange={handleRemindAtChange}
              onMonthChange={handleDateMonthChange}
              placeholder={t("fields.remindAt")}
              value={remindAtDraft}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={updateTaskMutation.isPending}
                onClick={handleRemindAtSave}
                size="sm"
                type="button"
              >
                {t("actions.save")}
              </Button>
              <Button
                disabled={!task.remindAt || updateTaskMutation.isPending}
                onClick={handleRemindAtClear}
                size="sm"
                type="button"
                variant="outline"
              >
                {commonT("actions.clear")}
              </Button>
            </div>
          </div>
        </div>

        <Separator />
        <div className="space-y-2">
          <span className="text-muted-foreground text-sm">
            {t("fields.watchers")}
          </span>
          <div className="flex flex-wrap gap-2">
            {task.watcherUserIds.map((userId) => {
              const label =
                workspaceMembers.find((member) => member.userId === userId)
                  ?.user?.name ?? t("hidden")
              return (
                <Button
                  aria-label={t("actions.removeWatcher", { name: label })}
                  key={userId}
                  onClick={() =>
                    removeWatcherMutation.mutate({
                      id: task.id,
                      userId,
                      workspaceId,
                    })
                  }
                  size="sm"
                  type="button"
                  variant="secondary"
                >
                  {label}
                  <XIcon aria-hidden="true" />
                </Button>
              )
            })}
          </div>
          <div className="flex gap-2">
            <Select
              items={watcherOptions.map((option) => ({
                label: option.label,
                value: option.value.slice(2),
              }))}
              onValueChange={handleWatcherSelect}
              value={watcherUserId}
            >
              <SelectTrigger aria-label={t("actions.addWatcher")}>
                <SelectValue placeholder={t("actions.addWatcher")} />
              </SelectTrigger>
              <SelectContent>
                {watcherOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value.slice(2)}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              aria-label={t("actions.addWatcher")}
              disabled={!watcherUserId}
              onClick={handleAddWatcher}
              size="icon"
              type="button"
              variant="outline"
            >
              <PlusIcon aria-hidden="true" />
            </Button>
          </div>
        </div>

        <Separator />
        <div className="space-y-2 text-sm">
          {task.targets.map((target) => {
            if (target.hidden) {
              return (
                <p key={`${target.type}-${target.id ?? "hidden"}`}>
                  {t("hidden")}
                </p>
              )
            }
            if (target.type === "contact" && target.label) {
              return <p key={`${target.type}-${target.id}`}>{target.label}</p>
            }
            if (target.type === "conversation" && target.id) {
              return (
                <Link
                  className="text-primary underline-offset-4 hover:underline"
                  href={`/space/${workspaceId}/inbox?conversationId=${target.id}`}
                  key={`${target.type}-${target.id}`}
                >
                  {t("actions.openConversation")}
                </Link>
              )
            }
            return null
          })}
          <p className="text-muted-foreground">
            {task.createdByUserId
              ? t("createdByLabel", {
                  name:
                    workspaceMembers.find(
                      (member) => member.userId === task.createdByUserId,
                    )?.user?.name ?? t("hidden"),
                })
              : t("createdByApi", {
                  name: task.createdByLabel ?? t("hidden"),
                })}
          </p>
          <time className="text-muted-foreground">
            {formatter.dateTime(task.createdAt, {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </time>
        </div>

        <AlertDialog>
          <AlertDialogTrigger
            render={
              <Button type="button" variant="destructive">
                {t("actions.delete")}
              </Button>
            }
          />
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("actions.delete")}</AlertDialogTitle>
              <AlertDialogDescription>
                {t("deleteConfirm")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{commonT("actions.cancel")}</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive hover:bg-destructive/90"
                disabled={deleteTaskMutation.isPending}
                onClick={() =>
                  deleteTaskMutation.mutate({ id: task.id, workspaceId })
                }
              >
                {t("actions.delete")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </section>
      <TaskFeed taskId={task.id} workspaceId={workspaceId} />
    </div>
  )
}
