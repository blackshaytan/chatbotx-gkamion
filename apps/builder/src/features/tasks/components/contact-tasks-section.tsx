"use client"

import { Button } from "@chatbotx.io/ui/components/ui/button"
import { useQuery } from "@tanstack/react-query"
import { Loader2Icon } from "lucide-react"
import Link from "next/link"
import { useTranslations } from "next-intl"
import { orpc } from "@/lib/orpc/query"
import { CreateTaskDialog } from "./create-task-dialog"
import { TaskDueLabel } from "./task-due-label"
import { TaskStatusSelect } from "./task-status-select"

type ContactTasksSectionProps = {
  workspaceId: string
  contactId: string
  conversationId?: string | null
  contactLabel?: string | null
}

export const ContactTasksSection = ({
  workspaceId,
  contactId,
  conversationId,
  contactLabel,
}: ContactTasksSectionProps) => {
  const t = useTranslations("tasks")
  const { data, isPending } = useQuery(
    orpc.tasksAPI.list.queryOptions({
      input: {
        workspaceId,
        contactId,
        status: "open",
        tab: "all",
        perPage: 10,
      },
    }),
  )
  const defaultTargets = conversationId
    ? { conversationId, contactLabel: contactLabel ?? undefined }
    : { contactId, contactLabel: contactLabel ?? undefined }

  return (
    <section className="border-t px-2 py-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-medium text-sm">{t("title")}</h2>
        <CreateTaskDialog
          defaultTargets={defaultTargets}
          trigger={
            <Button size="sm" type="button" variant="outline">
              {t("actions.create")}
            </Button>
          }
          workspaceId={workspaceId}
        />
      </div>

      {isPending ? (
        <div className="flex justify-center py-3">
          <Loader2Icon
            aria-label={t("title")}
            className="size-4 animate-spin"
          />
        </div>
      ) : (
        <div className="mt-2 space-y-2">
          {data?.data.map((task) => (
            <div
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2"
              key={task.id}
            >
              <div className="min-w-0">
                <Button
                  className="h-auto max-w-full justify-start p-0 text-start"
                  render={
                    <Link
                      href={`/space/${workspaceId}/tasks?tab=all&task=${task.id}`}
                    />
                  }
                  variant="link"
                >
                  {task.title}
                </Button>
                <div className="text-muted-foreground text-xs">
                  <TaskDueLabel dueAt={task.dueAt} status={task.status} />
                </div>
              </div>
              <TaskStatusSelect task={task} workspaceId={workspaceId} />
            </div>
          ))}
          {data?.data.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("empty")}</p>
          ) : null}
        </div>
      )}

      <Button
        className="mt-2 h-auto p-0"
        render={
          <Link
            href={`/space/${workspaceId}/tasks?tab=all&contactId=${contactId}`}
          />
        }
        variant="link"
      >
        {t("allTasks")}
      </Button>
    </section>
  )
}
