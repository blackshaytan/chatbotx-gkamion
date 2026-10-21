import {
  type ContentType,
  conversationHandoverCategories,
} from "@chatbotx.io/database/partials"
import { Queue } from "bullmq"
import { z } from "zod"
import {
  defaultJobOptions,
  fakeQueue,
  getQueueConnection,
  isNoRedisEnv,
} from "../../lib/connection"
import { queueNames } from "../../lib/types"

export const NotificationJobAction = {
  notifyIncomingMessage: "notifyIncomingMessage",
  notifyConversationAssigned: "notifyConversationAssigned",
  notifyAgentHandover: "notifyAgentHandover",
} as const

export type NotificationJobNotifyIncomingMessage = {
  type: typeof NotificationJobAction.notifyIncomingMessage
  data: {
    workspaceId: string
    conversationId: string
    messageId: string
    /** Preview text built at enqueue time — Message is a hypertable whose
     *  lookup needs createdAt, which this payload deliberately does not carry. */
    messageText?: string
    contentType?: ContentType
    attachmentCount?: number
    /** Recipient to skip, e.g. the agent whose own outbound reply round-tripped
     *  back as an "incoming" message via a channel's echo/coexist sync. Optional
     *  because most channels have no way to identify the sending user. */
    excludeUserId?: string
  }
}

export type NotificationJobNotifyConversationAssigned = {
  type: typeof NotificationJobAction.notifyConversationAssigned
  data: {
    workspaceId: string
    conversationId: string
    assignedUserId: string
  }
}

export const notificationJobNotifyAgentHandoverDataSchema = z.object({
  workspaceId: z.string(),
  conversationId: z.string(),
  category: conversationHandoverCategories,
  reason: z.string(),
})
export type NotificationJobNotifyAgentHandoverData = z.infer<
  typeof notificationJobNotifyAgentHandoverDataSchema
>

export type NotificationJobNotifyAgentHandover = {
  type: typeof NotificationJobAction.notifyAgentHandover
  data: NotificationJobNotifyAgentHandoverData
}

export type NotificationJobData =
  | NotificationJobNotifyIncomingMessage
  | NotificationJobNotifyConversationAssigned
  | NotificationJobNotifyAgentHandover

export const notificationQueue = isNoRedisEnv()
  ? fakeQueue
  : new Queue<NotificationJobData>(queueNames.enum.notification, {
      connection: getQueueConnection(queueNames.enum.notification),
      defaultJobOptions,
    })
