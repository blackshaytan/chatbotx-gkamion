import {
  onNotificationsCreated,
  sendToWorkspaceMember,
} from "@chatbotx.io/business"
import { RealtimeEventType } from "@chatbotx.io/partysocket-config"
import { logger } from "./logger"

let registered = false

export const registerNotificationRealtime = (): void => {
  if (registered) {
    return
  }
  registered = true

  onNotificationsCreated(({ workspaceId, notifications }) => {
    for (const notification of notifications) {
      sendToWorkspaceMember(
        { workspaceId, userId: notification.userId },
        {
          eventType: RealtimeEventType.notificationCreated,
          data: { notificationId: notification.id },
        },
      ).catch((err) => {
        logger.warn(
          { err, notificationId: notification.id, userId: notification.userId },
          "Failed to deliver notificationCreated realtime event",
        )
      })
    }
  })
}
