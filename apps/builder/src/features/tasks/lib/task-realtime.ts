import { publishToWorkspaceParty } from "@chatbotx.io/business"
import { RealtimeEventType } from "@chatbotx.io/partysocket-config"

export const publishTaskChanged = (
  workspaceId: string,
  taskId: string,
): void => {
  publishToWorkspaceParty(workspaceId, {
    eventType: RealtimeEventType.taskChanged,
    data: { taskId },
  })
}

export const publishTaskCommentsChanged = (
  workspaceId: string,
  taskId: string,
): void => {
  publishToWorkspaceParty(workspaceId, {
    eventType: RealtimeEventType.taskCommentsChanged,
    data: { taskId },
  })
}

export const publishTaskCommentsAndTaskChanged = (
  workspaceId: string,
  taskId: string,
): void => {
  publishTaskCommentsChanged(workspaceId, taskId)
  publishTaskChanged(workspaceId, taskId)
}
