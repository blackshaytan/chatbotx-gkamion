"use client"

import {
  type TaskPriority,
  taskDueFilters,
  taskPriorities,
} from "@chatbotx.io/database/partials"
import { Button } from "@chatbotx.io/ui/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@chatbotx.io/ui/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@chatbotx.io/ui/components/ui/tabs"
import { useQuery } from "@tanstack/react-query"
import { XIcon } from "lucide-react"
import { useTranslations } from "next-intl"
import { orpc } from "@/lib/orpc/query"
import {
  taskStatusFilters,
  taskTabs,
  useTaskSearchParams,
} from "../hooks/use-task-search-params"
import { CreateTaskDialog } from "./create-task-dialog"
import { TaskSheet } from "./task-sheet"
import { TasksTable } from "./tasks-table"

type TasksPageProps = {
  workspaceId: string
}

type TaskTab = (typeof taskTabs)[number]

const tabLabelKeyByTab = {
  mine: "tabs.mine",
  createdByMe: "tabs.createdByMe",
  watching: "tabs.watching",
  myTeams: "tabs.myTeams",
  all: "tabs.all",
} as const satisfies Record<TaskTab, string>

const statusLabelKeyByStatus = {
  open: "tabs.all",
  todo: "status.todo",
  in_progress: "status.in_progress",
  done: "status.done",
  canceled: "status.canceled",
} as const satisfies Record<(typeof taskStatusFilters)[number], string>

const priorityLabelKeyByPriority = {
  low: "priority.low",
  normal: "priority.normal",
  high: "priority.high",
  urgent: "priority.urgent",
} as const satisfies Record<TaskPriority, string>

const dueLabelKeyByDue = {
  overdue: "due.overdue",
  today: "due.today",
  week: "due.week",
  none: "due.none",
} as const satisfies Record<(typeof taskDueFilters.options)[number], string>

const isTaskTab = (value: string): value is TaskTab =>
  taskTabs.some((tab) => tab === value)

const isTaskStatusFilter = (
  value: string,
): value is (typeof taskStatusFilters)[number] =>
  taskStatusFilters.some((status) => status === value)

const isTaskPriority = (value: string): value is TaskPriority =>
  taskPriorities.options.some((priority) => priority === value)

const isTaskDueFilter = (
  value: string,
): value is (typeof taskDueFilters.options)[number] =>
  taskDueFilters.options.some((due) => due === value)

export const TasksPage = ({ workspaceId }: TasksPageProps) => {
  const t = useTranslations("tasks")
  const commonT = useTranslations()
  const [
    { tab, status, priority, due, contactId, conversationId, page },
    setSearchParams,
  ] = useTaskSearchParams()

  const { data } = useQuery(
    orpc.tasksAPI.list.queryOptions({
      input: {
        workspaceId,
        tab,
        status,
        priority: priority ?? undefined,
        due: due ?? undefined,
        contactId: contactId ?? undefined,
        conversationId: conversationId ?? undefined,
        page,
        perPage: 20,
      },
    }),
  )

  const handleTabChange = async (value: string) => {
    if (!isTaskTab(value)) {
      return
    }

    await setSearchParams({ tab: value, page: 1 })
  }

  const handleStatusChange = async (value: string | null) => {
    if (!(value && isTaskStatusFilter(value))) {
      return
    }

    await setSearchParams({ status: value, page: 1 })
  }

  const handlePriorityChange = async (value: string | null) => {
    if (!(value && isTaskPriority(value))) {
      return
    }

    await setSearchParams({ priority: value, page: 1 })
  }

  const handleDueChange = async (value: string | null) => {
    if (!(value && isTaskDueFilter(value))) {
      return
    }

    await setSearchParams({ due: value, page: 1 })
  }

  const handleClearTarget = async () => {
    await setSearchParams({
      contactId: null,
      conversationId: null,
      page: 1,
    })
  }

  const handleTaskSelect = async (taskId: string) => {
    await setSearchParams({ task: taskId })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-bold text-xl">{t("title")}</h1>
        <CreateTaskDialog workspaceId={workspaceId} />
      </div>

      <Tabs onValueChange={handleTabChange} value={tab}>
        <TabsList className="h-auto flex-wrap">
          {taskTabs.map((taskTab) => (
            <TabsTrigger key={taskTab} value={taskTab}>
              {t(tabLabelKeyByTab[taskTab])}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="flex flex-wrap items-center gap-2">
        <Select onValueChange={handleStatusChange} value={status}>
          <SelectTrigger aria-label={commonT("fields.status.label")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {taskStatusFilters.map((statusFilter) => (
              <SelectItem key={statusFilter} value={statusFilter}>
                {t(statusLabelKeyByStatus[statusFilter])}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select onValueChange={handlePriorityChange} value={priority}>
          <SelectTrigger aria-label={t("fields.priority")}>
            <SelectValue placeholder={t("fields.priority")} />
          </SelectTrigger>
          <SelectContent>
            {taskPriorities.options.map((taskPriority) => (
              <SelectItem key={taskPriority} value={taskPriority}>
                {t(priorityLabelKeyByPriority[taskPriority])}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select onValueChange={handleDueChange} value={due}>
          <SelectTrigger aria-label={t("fields.dueAt")}>
            <SelectValue placeholder={t("fields.dueAt")} />
          </SelectTrigger>
          <SelectContent>
            {taskDueFilters.options.map((dueFilter) => (
              <SelectItem key={dueFilter} value={dueFilter}>
                {t(dueLabelKeyByDue[dueFilter])}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {conversationId || contactId ? (
          <Button
            aria-label={
              conversationId ? t("fields.conversation") : t("fields.contact")
            }
            onClick={handleClearTarget}
            size="sm"
            variant="outline"
          >
            {conversationId ? t("fields.conversation") : t("fields.contact")}
            <XIcon aria-hidden="true" />
          </Button>
        ) : null}
      </div>

      <TasksTable
        onTaskSelect={handleTaskSelect}
        pageCount={data?.pageCount ?? 0}
        tasks={data?.data ?? []}
        workspaceId={workspaceId}
      />
      <TaskSheet workspaceId={workspaceId} />
    </div>
  )
}
