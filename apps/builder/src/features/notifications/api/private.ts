import "@/features/notifications/lib/notification-realtime"
import {
  type ChatNotificationPayload,
  type NotificationPayload,
  type TaskNotificationType,
  notificationService,
  resolveTenantSettings,
} from "@chatbotx.io/business"
import { z } from "zod"
import { buildTaskUrl } from "@/features/tasks/lib/task-url"
import { workspaceAuthorizedMidddleware } from "@/middlewares/auth"
import { authorizedAPI } from "@/orpc"
import {
  listNotificationsRequest,
  markNotificationsReadRequest,
  notificationWorkspaceRequest,
  updateNotificationPreferencesRequest,
} from "../schema/query"
import {
  anyNotificationItemResource,
  notificationPreferencesResource,
} from "../schema/resource"

const tags = ["Notifications"]

export const notificationsAuthenticatedAPI = {
  list: authorizedAPI
    .route({
      method: "GET",
      path: "/workspaces/{workspaceId}/notifications",
      summary: "List notifications",
      tags,
    })
    .input(listNotificationsRequest)
    .use(workspaceAuthorizedMidddleware, (input) => input.workspaceId)
    .output(z.object({ data: z.array(anyNotificationItemResource) }))
    .handler(async ({ context, input }) => {
      const notifications = await notificationService.listForUser({
        workspaceId: input.workspaceId,
        userId: context.user.id,
        limit: input.limit,
        unreadOnly: input.unreadOnly,
      })
      const { appUrl } = await resolveTenantSettings({
        workspaceId: input.workspaceId,
      })
      return {
        data: notifications.map((notification) => {
          if (notification.entityType === "chat") {
            return {
              id: notification.id,
              type: "chatMessage" as const,
              threadId: notification.entityId,
              payload: notification.payload as ChatNotificationPayload,
              readAt: notification.readAt,
              createdAt: notification.createdAt,
              url: `${appUrl}/space/${input.workspaceId}/chats/${notification.entityId}`,
            }
          }
          return {
            id: notification.id,
            type: notification.type as TaskNotificationType,
            taskId: notification.entityId,
            payload: notification.payload as NotificationPayload,
            readAt: notification.readAt,
            createdAt: notification.createdAt,
            url: buildTaskUrl(appUrl, {
              id: notification.entityId,
              workspaceId: input.workspaceId,
            }),
          }
        }),
      }
    }),

  countUnread: authorizedAPI
    .route({
      method: "GET",
      path: "/workspaces/{workspaceId}/notifications/unread-count",
      summary: "Count unread notifications",
      tags,
    })
    .input(notificationWorkspaceRequest)
    .use(workspaceAuthorizedMidddleware, (input) => input.workspaceId)
    .output(z.object({ total: z.number().int() }))
    .handler(
      async ({ context, input }) =>
        await notificationService.countUnread({
          workspaceId: input.workspaceId,
          userId: context.user.id,
        }),
    ),

  markRead: authorizedAPI
    .route({
      method: "POST",
      path: "/workspaces/{workspaceId}/notifications/read",
      summary: "Mark notifications read",
      successStatus: 204,
      tags,
    })
    .input(markNotificationsReadRequest)
    .use(workspaceAuthorizedMidddleware, (input) => input.workspaceId)
    .handler(async ({ context, input }) => {
      await notificationService.markRead({
        workspaceId: input.workspaceId,
        userId: context.user.id,
        ids: input.ids,
      })
    }),

  markAllRead: authorizedAPI
    .route({
      method: "POST",
      path: "/workspaces/{workspaceId}/notifications/read-all",
      summary: "Mark all notifications read",
      successStatus: 204,
      tags,
    })
    .input(notificationWorkspaceRequest)
    .use(workspaceAuthorizedMidddleware, (input) => input.workspaceId)
    .handler(async ({ context, input }) => {
      await notificationService.markAllRead({
        workspaceId: input.workspaceId,
        userId: context.user.id,
      })
    }),

  getPreferences: authorizedAPI
    .route({
      method: "GET",
      path: "/workspaces/{workspaceId}/notifications/preferences",
      summary: "Get notification preferences",
      tags,
    })
    .input(notificationWorkspaceRequest)
    .use(workspaceAuthorizedMidddleware, (input) => input.workspaceId)
    .output(notificationPreferencesResource)
    .handler(
      async ({ context, input }) =>
        await notificationService.getPreferences({
          workspaceId: input.workspaceId,
          userId: context.user.id,
        }),
    ),

  updatePreferences: authorizedAPI
    .route({
      method: "PATCH",
      path: "/workspaces/{workspaceId}/notifications/preferences",
      summary: "Update notification preferences",
      tags,
    })
    .input(updateNotificationPreferencesRequest)
    .use(workspaceAuthorizedMidddleware, (input) => input.workspaceId)
    .output(notificationPreferencesResource)
    .handler(
      async ({ context, input }) =>
        await notificationService.updatePreferences({
          workspaceId: input.workspaceId,
          userId: context.user.id,
          patch: input.patch,
        }),
    ),
}
