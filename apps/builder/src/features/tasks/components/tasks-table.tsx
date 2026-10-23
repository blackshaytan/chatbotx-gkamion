"use client"

import { DataTable } from "@chatbotx.io/ui/components/data-table/data-table"
import { Button } from "@chatbotx.io/ui/components/ui/button"
import { useDataTable } from "@chatbotx.io/ui/hooks/use-data-table"
import type { ColumnDef } from "@tanstack/react-table"
import { Loader2Icon } from "lucide-react"
import Link from "next/link"
import { useTranslations } from "next-intl"
import { useMemo } from "react"
import type { z } from "zod"
import type { taskPrivateResource } from "../schema/public"
import { TaskAssigneeLabel } from "./task-assignee-label"
import { TaskDueLabel } from "./task-due-label"
import { TaskPriorityBadge } from "./task-priority-badge"
import { TaskStatusSelect } from "./task-status-select"
import { TaskUnreadBadge } from "./task-unread-badge"

type Task = z.infer<typeof taskPrivateResource>

type TasksTableProps = {
  workspaceId: string
  tasks: Task[]
  pageCount: number
  onTaskSelect: (taskId: string) => void
  isPending: boolean
}

export const TasksTable = ({
  workspaceId,
  tasks,
  pageCount,
  onTaskSelect,
  isPending,
}: TasksTableProps) => {
  const t = useTranslations("tasks")
  const commonT = useTranslations()

  const columns = useMemo<ColumnDef<Task>[]>(
    () => [
      {
        id: "status",
        header: commonT("fields.status.label"),
        cell: ({ row }) => (
          <TaskStatusSelect task={row.original} workspaceId={workspaceId} />
        ),
        enableSorting: false,
      },
      {
        id: "title",
        accessorKey: "title",
        header: t("fields.title"),
        cell: ({ row }) => (
          <Button
            className="h-auto justify-start p-0 text-start"
            onClick={() => onTaskSelect(row.original.id)}
            variant="link"
          >
            <span className="flex items-center gap-2">
              {row.original.title}
              <TaskUnreadBadge count={row.original.unreadCount} />
            </span>
          </Button>
        ),
        enableSorting: false,
      },
      {
        id: "assignee",
        header: t("fields.assignee"),
        cell: ({ row }) => (
          <TaskAssigneeLabel
            assigneeTeamId={row.original.assigneeTeamId}
            assigneeUserId={row.original.assigneeUserId}
          />
        ),
        enableSorting: false,
      },
      {
        id: "dueAt",
        header: t("fields.dueAt"),
        cell: ({ row }) => (
          <TaskDueLabel
            dueAt={row.original.dueAt}
            status={row.original.status}
          />
        ),
        enableSorting: false,
      },
      {
        id: "priority",
        header: t("fields.priority"),
        cell: ({ row }) => (
          <TaskPriorityBadge priority={row.original.priority} />
        ),
        enableSorting: false,
      },
      {
        id: "contact",
        header: t("fields.contact"),
        cell: ({ row }) => {
          const contactTarget = row.original.targets.find(
            (target) => target.type === "contact",
          )
          const conversationTarget = row.original.targets.find(
            (target) => target.type === "conversation",
          )

          if (contactTarget?.hidden) {
            return <span className="text-muted-foreground">{t("hidden")}</span>
          }

          if (!contactTarget?.label) {
            return <span>—</span>
          }

          if (conversationTarget?.hidden || !conversationTarget?.id) {
            return <span>{contactTarget.label}</span>
          }

          return (
            <Link
              className="text-primary underline-offset-4 hover:underline"
              href={`/space/${workspaceId}/inbox?conversationId=${conversationTarget.id}`}
            >
              {contactTarget.label}
            </Link>
          )
        },
        enableSorting: false,
      },
    ],
    [commonT, onTaskSelect, t, workspaceId],
  )

  const { table } = useDataTable({
    data: tasks,
    columns,
    pageCount,
    initialState: { pagination: { pageSize: 20, pageIndex: 0 } },
    getRowId: (task) => task.id,
    shallow: true,
    clearOnDefault: true,
  })

  if (isPending) {
    return (
      <div
        aria-label={commonT("actions.loading")}
        className="flex min-h-24 items-center justify-center"
        role="status"
      >
        <Loader2Icon aria-hidden="true" className="animate-spin" />
      </div>
    )
  }

  return <DataTable labels={{ noResults: t("empty") }} table={table} />
}
