import {
  broadcastAnalyticsService,
  emailTopicAnalyticsService,
} from "@chatbotx.io/analytics"
import {
  buildContext,
  buildUnsubscribeUrl,
  contactService,
  inboxService,
  integrationSmtpService,
  resolveTenantSettings,
  signEmailClickUrl,
  workspaceService,
} from "@chatbotx.io/business"
import { channelTypes } from "@chatbotx.io/database/partials"
import type {
  ContactInboxModel,
  InboxWithIntegrations,
} from "@chatbotx.io/database/types"
import type {
  EmailStepSchema,
  PageElementSchema,
} from "@chatbotx.io/flow-config"
import {
  BROADCAST_PAYLOAD_TYPE,
  UNSUBSCRIBE_PLACEHOLDER,
} from "@chatbotx.io/flow-config"
import {
  integration as integrationSmtp,
  smtpAuthSchema,
} from "@chatbotx.io/integration-smtp"
import type {
  DynamicEmailProps,
  MailElementSchema,
} from "@chatbotx.io/mail/dynamic"
import { renderDynamicEmailHtml } from "@chatbotx.io/mail/dynamic"
import { contactVariableService } from "@chatbotx.io/variables"
import { resolveButtonUrl } from "../../lib/convert-button"
import { logger } from "../../lib/logger"
import type { ExecuteStepProps } from "./flow"

async function resolveElements({
  appUrl,
  rawElements,
  variables,
  inbox,
  flowId,
  unsubscribeUrl,
  token,
  workspaceId,
}: {
  appUrl: string
  rawElements: PageElementSchema[]
  variables: Awaited<ReturnType<typeof contactVariableService.getAll>>
  inbox: InboxWithIntegrations | undefined
  flowId: string | undefined
  unsubscribeUrl: string
  token?: string
  workspaceId: string
}): Promise<MailElementSchema[]> {
  const resolved: MailElementSchema[] = []

  for (const el of rawElements) {
    switch (el.type) {
      case "heading":
      case "text":
      case "code": {
        const resolvedText = await contactVariableService.replaceAll({
          text: el.text,
          variables,
        })
        resolved.push({
          type: el.type,
          text: resolvedText.replaceAll(
            UNSUBSCRIBE_PLACEHOLDER,
            unsubscribeUrl,
          ),
        })
        break
      }
      case "image":
        resolved.push({
          type: "image",
          url: el.url,
        })
        break
      case "line":
      case "spacing":
        resolved.push({ type: el.type })
        break
      case "button": {
        let url = el.buttonType
          ? resolveButtonUrl({
              appUrl,
              button: el,
              inbox,
              flowId,
            })
          : undefined

        if (url && token) {
          // Seal the destination into an authenticated token so the click
          // route cannot be abused as an open redirect (the raw URL is never
          // trusted from the query string). base64url is URL-safe.
          const signedUrl = await signEmailClickUrl(url, workspaceId)
          url = `${appUrl}/email-topic/click?r=${token}&u=${signedUrl}`
        }

        resolved.push({ type: "button", url, label: el.label })
        break
      }
      default:
        break
    }
  }

  if (token) {
    resolved.push({
      type: "image",
      url: `${appUrl}/email-topic/open?r=${token}`,
    })
  }

  return resolved
}

type BroadcastSettleProps = Pick<
  ExecuteStepProps<EmailStepSchema>,
  "conversation" | "contactInbox" | "flowVersion" | "metadata"
>

const buildBroadcastEventContext = ({
  conversation,
  contactInbox,
}: Pick<BroadcastSettleProps, "conversation" | "contactInbox">) => ({
  workspaceId: conversation.workspaceId,
  contactId: conversation.contactId,
  conversationId: conversation.id,
  contactInboxId: contactInbox.id,
  channel: contactInbox.channel,
})

/**
 * Email broadcasts have no provider status webhook, so the send result is the
 * only signal. Settling it here stamps `ContactOnBroadcast.deliveredAt` /
 * `failedAt` immediately, instead of leaving `finalizeBroadcasts` to wait out
 * the grace window and report `delivered = 0`.
 */
const settleBroadcastDelivered = async (props: BroadcastSettleProps) => {
  const { metadata } = props
  if (metadata?.type !== BROADCAST_PAYLOAD_TYPE) {
    return
  }
  await broadcastAnalyticsService.onDelivered([
    {
      context: buildBroadcastEventContext(props),
      action: { messageId: "", sourceId: "" },
      metadata,
      occurredAt: new Date(),
    },
  ])
}

const settleBroadcastFailed = async (
  props: BroadcastSettleProps,
  errorMessage: string,
) => {
  const { metadata, flowVersion } = props
  if (metadata?.type !== BROADCAST_PAYLOAD_TYPE) {
    return
  }
  await broadcastAnalyticsService.onFailed([
    {
      context: buildBroadcastEventContext(props),
      action: { messageId: "", flowId: flowVersion.flowId },
      errorData: { message: errorMessage },
      metadata,
      occurredAt: new Date(),
      willRetry: false,
    },
  ])
}

/**
 * Runs one post-send bookkeeping write. A failure is logged and never rethrown:
 * the email has already been sent (or already known to have failed), so the
 * step must not retry and send it again.
 */
const runRecordSafely = async (
  recordName: string,
  logContext: Record<string, unknown>,
  record: () => Promise<unknown>,
): Promise<void> => {
  try {
    await record()
  } catch (settleErr) {
    logger.error(
      { err: settleErr, ...logContext },
      `handleSendEmail: failed to record ${recordName}`,
    )
  }
}

const recordEmailDelivered = async (
  props: BroadcastSettleProps,
  token?: string,
): Promise<void> => {
  const logContext = {
    workspaceId: props.conversation.workspaceId,
    contactInboxId: props.contactInbox.id,
  }
  if (token) {
    await runRecordSafely("email topic delivery", logContext, () =>
      emailTopicAnalyticsService.markDelivered(token),
    )
  }
  await runRecordSafely("broadcast delivery", logContext, () =>
    settleBroadcastDelivered(props),
  )
}

const recordEmailFailed = async (
  props: BroadcastSettleProps,
  errorMessage: string,
  token?: string,
): Promise<void> => {
  const logContext = {
    workspaceId: props.conversation.workspaceId,
    contactInboxId: props.contactInbox.id,
  }
  if (token) {
    await runRecordSafely("email topic failure", logContext, () =>
      emailTopicAnalyticsService.markFailed(token),
    )
  }
  await runRecordSafely("broadcast failure", logContext, () =>
    settleBroadcastFailed(props, errorMessage),
  )
}

/**
 * Email step recipient. Falls back to the inbox `sourceId` for SMTP contacts,
 * whose `sourceId` is their address, when the step's `to` resolves empty.
 */
const resolveRecipientEmail = (
  resolvedTo: string,
  contactInbox: ContactInboxModel,
): string => {
  const trimmedTo = resolvedTo.trim()
  if (trimmedTo) {
    return trimmedTo
  }
  const sourceId = contactInbox.sourceId?.trim() ?? ""
  const isSmtpInbox = contactInbox.channel === channelTypes.enum.smtp
  return isSmtpInbox && sourceId.includes("@") ? sourceId : ""
}

export async function sendEmail({
  conversation,
  flowVersion,
  step,
  contactInbox,
  metadata,
}: ExecuteStepProps<EmailStepSchema>) {
  const broadcastSettleProps: BroadcastSettleProps = {
    conversation,
    contactInbox,
    flowVersion,
    metadata,
  }

  const contact = await contactService.findBy({
    where: { id: conversation.contactId },
  })
  if (!contact?.emailOptIn) {
    logger.info(
      { contactId: conversation.contactId },
      "handleSendEmail: contact has opted out of email, skipping",
    )
    await recordEmailFailed(broadcastSettleProps, "Contact opted out of email")
    return
  }

  const smtpIntegration = await integrationSmtpService.find({
    where: {
      workspaceId: conversation.workspaceId,
      id: step.integrationSmtpId,
    },
  })
  if (!smtpIntegration) {
    logger.warn(
      `handleSendEmail: smtp integration ${step.integrationSmtpId} not found`,
    )
    await recordEmailFailed(broadcastSettleProps, "SMTP integration not found")
    return
  }

  const auth = smtpAuthSchema.parse({
    authType: "custom",
    ...(smtpIntegration.auth as Record<string, unknown>),
  })

  const workspace = await workspaceService.findById({
    id: conversation.workspaceId,
  })

  const inbox = await inboxService.find({
    where: {
      id: contactInbox.inboxId,
      workspaceId: conversation.workspaceId,
    },
  })

  const variables = await contactVariableService.getAll({
    contactId: conversation.contactId,
    contactInbox,
    conversation,
    workspace,
  })
  const { appUrl } = await resolveTenantSettings({
    workspaceId: conversation.workspaceId,
  })

  const [resolvedTo, subject, preheader] = await Promise.all([
    contactVariableService.replaceAll({ text: step.to, variables }),
    contactVariableService.replaceAll({ text: step.subject, variables }),
    contactVariableService.replaceAll({ text: step.preheader, variables }),
  ])

  const to = resolveRecipientEmail(resolvedTo, contactInbox)
  if (!to.includes("@")) {
    logger.warn(
      { contactId: conversation.contactId, contactInboxId: contactInbox.id },
      "handleSendEmail: recipient email address is invalid or empty, skipping",
    )
    await recordEmailFailed(
      broadcastSettleProps,
      "Recipient email address is invalid or empty",
    )
    return
  }

  const unsubscribeUrl = await buildUnsubscribeUrl(
    appUrl,
    conversation.contactId,
    conversation.workspaceId,
  )

  // Create per-recipient tracking row before building URLs so the token is available.
  let token: string | undefined
  if (step.topicId) {
    const result = await emailTopicAnalyticsService.createRecipient({
      topicId: step.topicId,
      workspaceId: conversation.workspaceId,
      contactId: conversation.contactId,
      conversationId: conversation.id,
      contactInboxId: contactInbox.id,
      email: to,
    })
    token = result.token
  }

  const elements = await resolveElements({
    appUrl,
    rawElements: step.elements,
    variables,
    inbox,
    flowId: flowVersion.flowId,
    unsubscribeUrl,
    token,
    workspaceId: conversation.workspaceId,
  })

  const props: DynamicEmailProps = {
    brandName: workspace.name ?? smtpIntegration.name,
    subject,
    preheader,
    elements,
  }

  const botContext = await buildContext({
    workspaceId: workspace.id,
    integrationType: "smtp",
    integration: { ...smtpIntegration, auth },
  })

  let html: string
  try {
    html = await renderDynamicEmailHtml(props)
  } catch (err) {
    logger.error(
      {
        err,
        integrationSmtpId: smtpIntegration.id,
        workspaceId: conversation.workspaceId,
      },
      "handleSendEmail: email render failed",
    )
    await recordEmailFailed(broadcastSettleProps, "Email render failed", token)
    return
  }

  try {
    await integrationSmtp.runAction("sendMail", {
      ctx: botContext,
      from: step.from || smtpIntegration.fromAddress,
      to,
      subject,
      html,
    })
  } catch (err) {
    logger.error(
      {
        err,
        integrationSmtpId: smtpIntegration.id,
        workspaceId: conversation.workspaceId,
      },
      "handleSendEmail: SMTP send failed",
    )
    await recordEmailFailed(
      broadcastSettleProps,
      err instanceof Error ? err.message : "SMTP send failed",
      token,
    )
    return
  }

  await recordEmailDelivered(broadcastSettleProps, token)
}
