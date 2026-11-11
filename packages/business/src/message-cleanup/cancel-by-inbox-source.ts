import {
  and,
  type DatabaseClient,
  db,
  eq,
  inArray,
} from "@chatbotx.io/database/client"
import { messageCleanupModel } from "@chatbotx.io/database/schema"

/**
 * Cancels pending cleanups for a contact that was re-created on the same
 * inbox and platform source id, so the returning contact keeps old history.
 * Kept separate from `MessageCleanupService` so ContactInbox inserts do not
 * pull the message, conversation, and analytics graph.
 */
export const cancelMessageCleanupByInboxSource = async (props: {
  inboxId: string
  sourceIds: string[]
  tx?: DatabaseClient
}): Promise<void> => {
  const { inboxId, sourceIds, tx = db } = props
  if (sourceIds.length === 0) {
    return
  }

  await tx
    .delete(messageCleanupModel)
    .where(
      and(
        eq(messageCleanupModel.inboxId, inboxId),
        inArray(messageCleanupModel.sourceId, [...sourceIds].sort()),
      ),
    )
}
