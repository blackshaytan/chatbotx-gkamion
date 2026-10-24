import { zodBigintAsString } from "@chatbotx.io/utils"
import { z } from "zod"
import { notificationPreferencesResource } from "./resource"

export const listNotificationsRequest = z.object({
  workspaceId: zodBigintAsString(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  unreadOnly: z.union([z.boolean(), z.stringbool()]).optional(),
})

export const notificationWorkspaceRequest = z.object({
  workspaceId: zodBigintAsString(),
})

export const markNotificationsReadRequest = notificationWorkspaceRequest.extend(
  {
    ids: z.array(zodBigintAsString()).min(1).max(50),
  },
)

export const updateNotificationPreferencesRequest =
  notificationWorkspaceRequest.extend({
    patch: notificationPreferencesResource.partial(),
  })
