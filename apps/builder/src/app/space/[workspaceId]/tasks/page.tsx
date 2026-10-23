import { getIdFromParams } from "@chatbotx.io/utils"
import { notFound } from "next/navigation"
import { TasksPage } from "@/features/tasks/components/tasks-page"

export default async function TasksRoutePage(props: {
  params: Promise<{ workspaceId: string }>
}) {
  const workspaceId = getIdFromParams(await props.params, "workspaceId")

  if (!workspaceId) {
    return notFound()
  }

  return <TasksPage workspaceId={workspaceId} />
}
