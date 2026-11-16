import {
  and,
  asc,
  countWithRelationsFilter,
  type DatabaseClient,
  db,
  eq,
  inArray,
  isNotNull,
  isNull,
  lte,
} from "../../client"
import { conversationUnreadWhere } from "../../queries/conversation-unread"
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

/**
 * Conversations the default inbox shows as unread: not archived, contact not
 * blocked, and either a client message or a manager handover is newer than
 * the last time an agent opened the thread. Matches the inbox list predicate.
 */
export async function countInboxUnread(
  params: { workspaceId: string },
  tx: DatabaseClient = db,
): Promise<number> {
  return await countWithRelationsFilter({
    client: tx,
    table: conversationModel,
    tsName: "conversationModel",
    where: {
      workspaceId: params.workspaceId,
      archivedAt: { isNull: true },
      contact: { blockedAt: { isNull: true } },
      OR: conversationUnreadWhere.OR,
    },
  })
}

/**
 * Turns a paused bot back on once `botResumeAt` has passed. The `botEnabled`
 * guard is the claim: only the caller that flips the row gets it back, so a
 * cron sweep and `ensureActive` cannot both emit a transfer.
 */
export async function claimDueBotResumes(
  params: {
    now: Date
    limit: number
    conversationId?: string
    workspaceId?: string
  },
  tx: DatabaseClient = db,
): Promise<Pick<ConversationModel, "id" | "workspaceId" | "contactId">[]> {
  const due = and(
    eq(conversationModel.botEnabled, false),
    isNotNull(conversationModel.botResumeAt),
    lte(conversationModel.botResumeAt, params.now),
    params.workspaceId
      ? eq(conversationModel.workspaceId, params.workspaceId)
      : undefined,
    params.conversationId
      ? eq(conversationModel.id, params.conversationId)
      : undefined,
  )
  const dueIds = tx
    .select({ id: conversationModel.id })
    .from(conversationModel)
    .where(due)
    .orderBy(asc(conversationModel.botResumeAt), asc(conversationModel.id))
    .limit(params.limit)
    .for("update", { skipLocked: true })

  return await tx
    .update(conversationModel)
    .set({
      botEnabled: true,
      botResumeAt: null,
      handoverCategory: null,
      handedOverAt: null,
      managerJoinedAt: null,
    })
    .where(
      and(
        inArray(conversationModel.id, dueIds),
        eq(conversationModel.botEnabled, false),
        isNotNull(conversationModel.botResumeAt),
        lte(conversationModel.botResumeAt, params.now),
      ),
    )
    .returning({
      id: conversationModel.id,
      workspaceId: conversationModel.workspaceId,
      contactId: conversationModel.contactId,
    })
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
