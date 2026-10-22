import {
  and,
  type DatabaseClient,
  db,
  eq,
  isNotNull,
  isNull,
} from "../../client"
import { conversationModel } from "../../schema"
import type { ConversationModel } from "../../types"

/**
 * Claims the one-time manager-join notice of a handed-over conversation. The
 * `managerJoinedAt IS NULL` guard makes concurrent claims safe: only the caller
 * that wins gets the row back, every other claim returns nothing.
 */
export async function claimManagerJoinedAt(
  params: {
    workspaceId: string
    conversationId: string
    at: Date
  },
  tx: DatabaseClient = db,
): Promise<ConversationModel[]> {
  const { workspaceId, conversationId, at } = params
  return await tx
    .update(conversationModel)
    .set({ managerJoinedAt: at })
    .where(
      and(
        eq(conversationModel.workspaceId, workspaceId),
        eq(conversationModel.id, conversationId),
        isNotNull(conversationModel.handedOverAt),
        isNull(conversationModel.managerJoinedAt),
      ),
    )
    .returning()
}

/**
 * Claims an unassigned conversation for a user — used by the call-answer and
 * outbound-dial auto-assign flows. The `IS NULL` guards on both `assignedUserId`
 * AND `assignedInboxTeamId` ensure a concurrent manual assignment always wins.
 * An empty `.returning()` means the guard didn't match — treat as "did not
 * claim", not retry or error.
 */
export async function assignUserIfUnassigned(
  params: {
    workspaceId: string
    conversationId: string
    userId: string
  },
  tx: DatabaseClient = db,
): Promise<ConversationModel[]> {
  const { workspaceId, conversationId, userId } = params
  return await tx
    .update(conversationModel)
    .set({ assignedUserId: userId })
    .where(
      and(
        eq(conversationModel.workspaceId, workspaceId),
        eq(conversationModel.id, conversationId),
        isNull(conversationModel.assignedUserId),
        isNull(conversationModel.assignedInboxTeamId),
      ),
    )
    .returning()
}

export async function assignTargetIfUnassigned(
  params: {
    assignedInboxTeamId?: string | null
    assignedUserId?: string | null
    conversationId: string
    workspaceId: string
  },
  tx: DatabaseClient = db,
): Promise<ConversationModel[]> {
  return await tx
    .update(conversationModel)
    .set({
      assignedInboxTeamId: params.assignedInboxTeamId ?? null,
      assignedUserId: params.assignedUserId ?? null,
    })
    .where(
      and(
        eq(conversationModel.workspaceId, params.workspaceId),
        eq(conversationModel.id, params.conversationId),
        isNull(conversationModel.assignedUserId),
        isNull(conversationModel.assignedInboxTeamId),
      ),
    )
    .returning()
}
