import {
  contactInboxService,
  externalAgentService,
} from "@chatbotx.io/business"
import type { ConversationModel } from "@chatbotx.io/database/types"
import { logger } from "../lib/logger"

/**
 * Whether the workspace's enabled external agent answers the inbox of this
 * contact inbox. A failed lookup is logged and treated as "no agent" so the
 * already-saved message still gets the regular automation.
 */
export const isExternalAgentInbox = async (input: {
  conversation: Pick<ConversationModel, "workspaceId" | "contactId">
  contactInboxId: string
}): Promise<boolean> => {
  const { conversation, contactInboxId } = input
  try {
    const contactInbox = await contactInboxService.findByUncached({
      where: { id: contactInboxId, contactId: conversation.contactId },
    })
    if (!contactInbox) {
      return false
    }
    const runtime = await externalAgentService.getRuntime({
      workspaceId: conversation.workspaceId,
      inboxId: contactInbox.inboxId,
    })
    return runtime !== null
  } catch (err) {
    logger.error(
      { err, contactInboxId, workspaceId: conversation.workspaceId },
      "External agent: unable to resolve the inbox agent",
    )
    return false
  }
}
