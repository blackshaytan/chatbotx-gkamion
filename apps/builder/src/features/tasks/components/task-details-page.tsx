"use client"

import { Button } from "@chatbotx.io/ui/components/ui/button"
import { ArrowLeftIcon } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { TaskDetails } from "./task-details"

type TaskDetailsPageProps = {
  taskId: string
  workspaceId: string
}

export const TaskDetailsPage = ({
  taskId,
  workspaceId,
}: TaskDetailsPageProps) => {
  const t = useTranslations("tasks")
  const router = useRouter()

  const handleDeleted = () => {
    router.push(`/space/${workspaceId}/tasks`)
  }

  return (
    <div className="space-y-4">
      <Button
        render={<Link href={`/space/${workspaceId}/tasks`} />}
        type="button"
        variant="ghost"
      >
        <ArrowLeftIcon aria-hidden="true" className="rtl:rotate-180" />
        {t("allTasks")}
      </Button>
      <TaskDetails
        onDeleted={handleDeleted}
        taskId={taskId}
        workspaceId={workspaceId}
      />
    </div>
  )
}
