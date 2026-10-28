import {
  and,
  count,
  type DatabaseClient,
  db,
  desc,
  eq,
  exists,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
} from "../../client"
import type { ChatThreadType } from "../../partials/task"
import {
  internalMessageModel,
  internalThreadMemberModel,
  internalThreadModel,
  userModel,
  workspaceMemberModel,
} from "../../schema"
import type { InternalMessageModel, InternalThreadModel } from "../../types"

export const chatMessagePageOrder = (props: {
  afterId?: string
  beforeId?: string
}) => (props.beforeId || !props.afterId ? "desc" : "asc")

const chatTypes = ["direct", "agent"] as const

class ChatRepository {
  async getOrCreate(props: {
    workspaceId: string
    type: ChatThreadType
    directKey: string
    title: string | null
    memberUserIds: string[]
    tx?: DatabaseClient
  }): Promise<{ thread: InternalThreadModel; created: boolean }> {
    const {
      workspaceId,
      type,
      directKey,
      title,
      memberUserIds,
      tx = db,
    } = props
    const [thread] = await tx
      .insert(internalThreadModel)
      .values({ workspaceId, type, directKey, title, lastMessageAt: null })
      .onConflictDoNothing({
        target: [
          internalThreadModel.workspaceId,
          internalThreadModel.directKey,
        ],
      })
      .returning()

    if (thread) {
      await tx.insert(internalThreadMemberModel).values(
        memberUserIds.map((userId) => ({
          threadId: thread.id,
          userId,
          lastReadAt: sql`now()`,
        })),
      )
      return { thread, created: true }
    }

    const [existing] = await tx
      .select()
      .from(internalThreadModel)
      .where(
        and(
          eq(internalThreadModel.workspaceId, workspaceId),
          eq(internalThreadModel.directKey, directKey),
        ),
      )
      .limit(1)
    if (!existing) {
      throw new Error("Chat thread conflict did not produce a thread")
    }
    return { thread: existing, created: false }
  }

  async findAccessible(props: {
    workspaceId: string
    threadId: string
    userId: string | null
    tx?: DatabaseClient
  }): Promise<{ thread: InternalThreadModel; isParticipant: boolean } | null> {
    const { workspaceId, threadId, userId, tx = db } = props
    const conditions = [
      eq(internalThreadModel.workspaceId, workspaceId),
      eq(internalThreadModel.id, threadId),
      inArray(internalThreadModel.type, chatTypes),
    ]
    if (userId !== null) {
      conditions.push(
        exists(
          tx
            .select({ id: internalThreadMemberModel.id })
            .from(internalThreadMemberModel)
            .where(
              and(
                eq(internalThreadMemberModel.threadId, internalThreadModel.id),
                eq(internalThreadMemberModel.userId, userId),
              ),
            ),
        ),
      )
    }
    const [thread] = await tx
      .select()
      .from(internalThreadModel)
      .where(and(...conditions))
      .limit(1)
    return thread ? { thread, isParticipant: userId !== null } : null
  }

  async listThreads(props: {
    workspaceId: string
    memberUserId: string | null
    participantUserId?: string
    includeEmpty: boolean
    limit: number
    offset: number
    tx?: DatabaseClient
  }): Promise<{ rows: InternalThreadModel[]; total: number }> {
    const {
      workspaceId,
      memberUserId,
      participantUserId,
      includeEmpty,
      limit,
      offset,
      tx = db,
    } = props
    const conditions = [
      eq(internalThreadModel.workspaceId, workspaceId),
      inArray(internalThreadModel.type, chatTypes),
    ]
    for (const userId of [memberUserId, participantUserId]) {
      if (userId !== null && userId !== undefined) {
        conditions.push(
          exists(
            tx
              .select({ id: internalThreadMemberModel.id })
              .from(internalThreadMemberModel)
              .where(
                and(
                  eq(
                    internalThreadMemberModel.threadId,
                    internalThreadModel.id,
                  ),
                  eq(internalThreadMemberModel.userId, userId),
                ),
              ),
          ),
        )
      }
    }
    if (!includeEmpty) {
      conditions.push(isNotNull(internalThreadModel.lastMessageAt))
    }
    const where = and(...conditions)
    const [rows, total] = await Promise.all([
      tx
        .select()
        .from(internalThreadModel)
        .where(where)
        .orderBy(
          desc(internalThreadModel.lastMessageAt),
          desc(internalThreadModel.id),
        )
        .limit(limit)
        .offset(offset),
      tx.$count(internalThreadModel, where),
    ])
    return { rows, total }
  }

  async touchLastMessage(props: {
    workspaceId: string
    threadId: string
    messageId: string
    tx?: DatabaseClient
  }): Promise<void> {
    const { workspaceId, threadId, messageId, tx = db } = props
    await tx
      .update(internalThreadModel)
      .set({
        lastMessageAt: sql`GREATEST(coalesce(${internalThreadModel.lastMessageAt}, '-infinity'::timestamptz), (SELECT "createdAt" FROM "InternalMessage" WHERE "id" = ${messageId}::bigint))`,
      })
      .where(
        and(
          eq(internalThreadModel.id, threadId),
          eq(internalThreadModel.workspaceId, workspaceId),
        ),
      )
  }

  async listMembers(props: {
    workspaceId: string
    threadIds: string[]
    tx?: DatabaseClient
  }): Promise<
    Array<{
      threadId: string
      userId: string
      lastReadAt: Date | null
      name: string | null
      isWorkspaceMember: boolean
    }>
  > {
    const { workspaceId, threadIds, tx = db } = props
    if (threadIds.length === 0) {
      return []
    }
    const rows = await tx
      .select({
        threadId: internalThreadMemberModel.threadId,
        userId: internalThreadMemberModel.userId,
        lastReadAt: internalThreadMemberModel.lastReadAt,
        name: userModel.name,
        memberId: workspaceMemberModel.id,
      })
      .from(internalThreadMemberModel)
      .innerJoin(
        internalThreadModel,
        and(
          eq(internalThreadModel.id, internalThreadMemberModel.threadId),
          eq(internalThreadModel.workspaceId, workspaceId),
        ),
      )
      .innerJoin(userModel, eq(userModel.id, internalThreadMemberModel.userId))
      .leftJoin(
        workspaceMemberModel,
        and(
          eq(workspaceMemberModel.workspaceId, workspaceId),
          eq(workspaceMemberModel.userId, internalThreadMemberModel.userId),
        ),
      )
      .where(inArray(internalThreadMemberModel.threadId, threadIds))
    return rows.map(({ memberId, ...row }) => ({
      ...row,
      isWorkspaceMember: memberId !== null,
    }))
  }

  async listWorkspaceMemberUserIds(props: {
    workspaceId: string
    userIds: string[]
    tx?: DatabaseClient
  }): Promise<string[]> {
    const { workspaceId, userIds, tx = db } = props
    if (userIds.length === 0) {
      return []
    }
    const rows = await tx
      .select({ userId: workspaceMemberModel.userId })
      .from(workspaceMemberModel)
      .where(
        and(
          eq(workspaceMemberModel.workspaceId, workspaceId),
          inArray(workspaceMemberModel.userId, userIds),
        ),
      )
    return rows.map((row) => row.userId)
  }

  async listMessagesByIds(props: {
    workspaceId: string
    ids: string[]
    tx?: DatabaseClient
  }): Promise<InternalMessageModel[]> {
    const { workspaceId, ids, tx = db } = props
    if (ids.length === 0) {
      return []
    }
    return await tx
      .select()
      .from(internalMessageModel)
      .where(
        and(
          eq(internalMessageModel.workspaceId, workspaceId),
          inArray(internalMessageModel.id, ids),
        ),
      )
  }

  async listLastMessageIds(props: {
    workspaceId: string
    threadIds: string[]
    tx?: DatabaseClient
  }): Promise<Map<string, string>> {
    const { workspaceId, threadIds, tx = db } = props
    if (threadIds.length === 0) {
      return new Map()
    }
    const result = await tx.execute<{
      threadId: string
      messageId: string
    }>(sql`
      SELECT t."id" AS "threadId", last."id" AS "messageId"
      FROM "InternalThread" t
      CROSS JOIN LATERAL (
        SELECT m."id" FROM "InternalMessage" m
        WHERE m."threadId" = t."id" AND m."kind" = 'comment' AND m."deletedAt" IS NULL
        ORDER BY m."createdAt" DESC, m."id" DESC LIMIT 1
      ) last
      WHERE t."workspaceId" = ${workspaceId}::bigint
        AND t."type" IN ('direct', 'agent')
        AND t."id" IN (${sql.join(
          threadIds.map((id) => sql`${id}::bigint`),
          sql`, `,
        )})
    `)
    return new Map(result.rows.map((row) => [row.threadId, row.messageId]))
  }

  async listMessages(props: {
    workspaceId: string
    threadId: string
    beforeId?: string
    afterId?: string
    limit: number
    tx?: DatabaseClient
  }): Promise<{ rows: InternalMessageModel[]; hasMore: boolean }> {
    const { workspaceId, threadId, beforeId, afterId, limit, tx = db } = props
    const cursor = beforeId ?? afterId
    const comparison = beforeId ? sql`<` : sql`>`
    // The initial page must open at the newest message.  Pages requested with
    // `beforeId` also scan backwards; both are reversed below so callers
    // always receive messages in chronological order for bottom-anchored UIs.
    const direction =
      chatMessagePageOrder({ afterId, beforeId }) === "desc"
        ? sql`DESC`
        : sql`ASC`
    const cursorClause = cursor
      ? sql`AND (m."createdAt", m."id") ${comparison} (SELECT "createdAt", "id" FROM "InternalMessage" WHERE "id" = ${cursor}::bigint AND "threadId" = ${threadId}::bigint AND "workspaceId" = ${workspaceId}::bigint)`
      : sql``
    const result = await tx.execute<InternalMessageModel>(sql`
      SELECT m.* FROM "InternalMessage" m
      WHERE m."workspaceId" = ${workspaceId}::bigint AND m."threadId" = ${threadId}::bigint ${cursorClause}
      ORDER BY m."createdAt" ${direction}, m."id" ${direction}
      LIMIT ${limit + 1}
    `)
    const rows = result.rows.slice(0, limit)
    return {
      rows: rows.reverse(),
      hasMore: result.rows.length > limit,
    }
  }

  async markReadMonotonic(props: {
    workspaceId: string
    threadId: string
    userId: string
    upToMessageId: string | null
    tx?: DatabaseClient
  }): Promise<Date | null> {
    const { workspaceId, threadId, userId, upToMessageId, tx = db } = props
    const target =
      upToMessageId === null
        ? sql`now()`
        : sql`(SELECT "createdAt" FROM "InternalMessage" WHERE "id" = ${upToMessageId}::bigint AND "threadId" = ${threadId}::bigint)`
    const rows = await tx
      .update(internalThreadMemberModel)
      .set({ lastReadAt: target })
      .where(
        and(
          eq(internalThreadMemberModel.threadId, threadId),
          inArray(
            internalThreadMemberModel.threadId,
            tx
              .select({ id: internalThreadModel.id })
              .from(internalThreadModel)
              .where(
                and(
                  eq(internalThreadModel.workspaceId, workspaceId),
                  inArray(internalThreadModel.type, chatTypes),
                ),
              ),
          ),
          eq(internalThreadMemberModel.userId, userId),
          or(
            isNull(internalThreadMemberModel.lastReadAt),
            sql`${internalThreadMemberModel.lastReadAt} < ${target}`,
          ),
        ),
      )
      .returning({ lastReadAt: internalThreadMemberModel.lastReadAt })
    return rows[0]?.lastReadAt ?? null
  }

  async countUnreadTotal(props: {
    workspaceId: string
    userId: string
    tx?: DatabaseClient
  }): Promise<number> {
    const { workspaceId, userId, tx = db } = props
    const [row] = await tx
      .select({ total: count() })
      .from(internalMessageModel)
      .innerJoin(
        internalThreadMemberModel,
        and(
          eq(internalThreadMemberModel.threadId, internalMessageModel.threadId),
          eq(internalThreadMemberModel.userId, userId),
        ),
      )
      .innerJoin(
        internalThreadModel,
        eq(internalThreadModel.id, internalMessageModel.threadId),
      )
      .where(
        and(
          eq(internalMessageModel.workspaceId, workspaceId),
          eq(internalThreadModel.workspaceId, workspaceId),
          inArray(internalThreadModel.type, chatTypes),
          eq(internalMessageModel.kind, "comment"),
          isNull(internalMessageModel.deletedAt),
          sql`${internalMessageModel.authorUserId} is distinct from ${userId}`,
          sql`${internalMessageModel.createdAt} > coalesce(${internalThreadMemberModel.lastReadAt}, '-infinity'::timestamptz)`,
        ),
      )
    return row?.total ?? 0
  }

  async findAttachmentMessage(props: {
    workspaceId: string
    messageId: string
    tx?: DatabaseClient
  }): Promise<InternalMessageModel | null> {
    const { workspaceId, messageId, tx = db } = props
    const [message] = await tx
      .select({ message: internalMessageModel })
      .from(internalMessageModel)
      .innerJoin(
        internalThreadModel,
        eq(internalThreadModel.id, internalMessageModel.threadId),
      )
      .where(
        and(
          eq(internalMessageModel.workspaceId, workspaceId),
          eq(internalMessageModel.id, messageId),
          eq(internalThreadModel.workspaceId, workspaceId),
          inArray(internalThreadModel.type, chatTypes),
        ),
      )
      .limit(1)
    return message?.message ?? null
  }
}

export const chatRepository = new ChatRepository()
