import { resolveTenantSettings, type TaskView } from "@chatbotx.io/business"

export type TaskViewWithUrl = TaskView & { url: string }

const buildTaskUrl = (appUrl: string, view: TaskView): string =>
  `${appUrl}/space/${view.workspaceId}/tasks/${view.id}`

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
