import type { ContentType } from "@chatbotx.io/database/partials"
import type {
  NotificationJobData,
  NotificationJobNotifyAgentHandoverData,
} from "@chatbotx.io/worker-config"
import { agentHandoverStrings, HANDOVER_REASON_MAX_LENGTH, t } from "./strings"

const resolveIncomingMessageBody = (
  strings: ReturnType<typeof t>,
  data: {
    messageText?: string
    contentType?: ContentType
    attachmentCount?: number
  },
): string => {
  if (data.messageText) {
    return data.messageText
  }
  if (data.contentType === "location") {
    return strings.sharedLocation
  }
  if (data.contentType === "refLink") {
    return strings.sentLink
  }
  if (data.attachmentCount === 1) {
    return strings.sentAttachment
  }
  if (data.attachmentCount && data.attachmentCount > 1) {
    return strings.sentAttachments(data.attachmentCount)
  }
  return ""
}

const buildAgentHandoverContent = (
  data: NotificationJobNotifyAgentHandoverData,
  contactFullName: string | null | undefined,
): { title: string; body: string } => {
  const contactName =
    contactFullName?.trim() || agentHandoverStrings.unknownContactName
  const categoryLabel = agentHandoverStrings.categoryLabels[data.category]

  return {
    title: `${agentHandoverStrings.titlePrefix}: ${contactName} · ${categoryLabel}`,
    body: Array.from(data.reason).slice(0, HANDOVER_REASON_MAX_LENGTH).join(""),
  }
}

export const buildNotificationContent = (props: {
  job: NotificationJobData
  contactFullName: string | null | undefined
  workspaceLanguage: string | undefined
}): { title: string; body: string } => {
  const { job, contactFullName, workspaceLanguage } = props
  const strings = t(workspaceLanguage)

  if (job.type === "notifyConversationAssigned") {
    return {
      title: contactFullName ?? strings.newMessage,
      body: strings.assignedConversation,
    }
  }

  if (job.type === "notifyAgentHandover") {
    return buildAgentHandoverContent(job.data, contactFullName)
  }

  return {
    title: contactFullName ?? strings.newMessage,
    body: resolveIncomingMessageBody(strings, job.data),
  }
}
