import { getIdFromParams, isNumericId } from "@chatbotx.io/utils"
import { notFound } from "next/navigation"
import { TaskDetailsPage } from "@/features/tasks/components/task-details-page"

export default async function TaskRoutePage(props: {
  params: Promise<{ taskId: string; workspaceId: string }>
}) {
  const params = await props.params
  const workspaceId = getIdFromParams(params, "workspaceId")
  const taskId = getIdFromParams(params, "taskId")

  if (!(workspaceId && taskId && isNumericId(taskId))) {
    return notFound()
  }

  return <TaskDetailsPage taskId={taskId} workspaceId={workspaceId} />
}
