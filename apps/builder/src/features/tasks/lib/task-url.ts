import { resolveTenantSettings, type TaskView } from "@chatbotx.io/business"

export type TaskViewWithUrl = TaskView & { url: string }

export const buildTaskUrl = (
  appUrl: string,
  task: { id: string; workspaceId: string },
): string => `${appUrl}/space/${task.workspaceId}/tasks/${task.id}`

export const withTaskUrl = async (view: TaskView): Promise<TaskViewWithUrl> => {
  const { appUrl } = await resolveTenantSettings({
    workspaceId: view.workspaceId,
  })
  return { ...view, url: buildTaskUrl(appUrl, view) }
}

export const withTaskUrls = async (
  workspaceId: string,
  views: TaskView[],
): Promise<TaskViewWithUrl[]> => {
  const { appUrl } = await resolveTenantSettings({ workspaceId })
  return views.map((view) => ({ ...view, url: buildTaskUrl(appUrl, view) }))
}
