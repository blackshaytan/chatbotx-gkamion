import {
  and,
  type DatabaseClient,
  db,
  eq,
  inArray,
  isNull,
  sql,
} from "../../client"
import {
  internalMessageModel,
  internalThreadMemberModel,
  internalThreadModel,
} from "../../schema"
import type { InternalMessageModel, InternalThreadModel } from "../../types"

export type InternalMessageInsert = typeof internalMessageModel.$inferInsert

class InternalThreadRepository {
  async insertThread(props: {
    workspaceId: string
    tx?: DatabaseClient
  }): Promise<InternalThreadModel> {
    const { workspaceId, tx = db } = props
    const [thread] = await tx
      .insert(internalThreadModel)
      .values({ workspaceId, type: "task" })
      .returning()
    return thread
  }

  async insertMembers(props: {
    rows: { threadId: string; userId: string }[]
    tx?: DatabaseClient
  }): Promise<void> {
    const { rows, tx = db } = props
    if (rows.length === 0) {
      return
    }
    await tx
      .insert(internalThreadMemberModel)
      .values(rows)
      .onConflictDoNothing()
  }

  async deleteMember(props: {
    threadId: string
    userId: string
    tx?: DatabaseClient
  }): Promise<void> {
    const { threadId, userId, tx = db } = props
    await tx
      .delete(internalThreadMemberModel)
      .where(
        and(
          eq(internalThreadMemberModel.threadId, threadId),
          eq(internalThreadMemberModel.userId, userId),
        ),
      )
  }

  async deleteMembersForUser(props: {
    workspaceId: string
    userId: string
    tx?: DatabaseClient
  }): Promise<void> {
    const { workspaceId, userId, tx = db } = props
    await tx.delete(internalThreadMemberModel).where(
      and(
        eq(internalThreadMemberModel.userId, userId),
        inArray(
          internalThreadMemberModel.threadId,
          tx
            .select({ id: internalThreadModel.id })
            .from(internalThreadModel)
            .where(
              and(
                eq(internalThreadModel.workspaceId, workspaceId),
                eq(internalThreadModel.type, "task"),
              ),
            ),
        ),
      ),
    )
  }

  async insertMessages(props: {
    rows: InternalMessageInsert[]
    tx?: DatabaseClient
  }): Promise<InternalMessageModel[]> {
    const { rows, tx = db } = props
    if (rows.length === 0) {
      return []
    }
    return await tx.insert(internalMessageModel).values(rows).returning()
  }

  async insertDeduplicatedMessage(props: {
    row: InternalMessageInsert & { dedupeKey: string }
    tx: DatabaseClient
  }): Promise<InternalMessageModel | undefined> {
    const [row] = await props.tx
      .insert(internalMessageModel)
      .values(props.row)
      .onConflictDoNothing({
        target: [internalMessageModel.threadId, internalMessageModel.dedupeKey],
        where: sql`${internalMessageModel.dedupeKey} IS NOT NULL`,
      })
      .returning()
    return row
  }

  /** Newest first. */
  async listMessages(props: {
    workspaceId: string
    threadId: string
    limit: number
    offset: number
    tx?: DatabaseClient
  }): Promise<{ rows: InternalMessageModel[]; total: number }> {
    const { workspaceId, threadId, limit, offset, tx = db } = props
    const where = { workspaceId, threadId }
    const [rows, total] = await Promise.all([
      tx.query.internalMessageModel.findMany({
        where,
        orderBy: { createdAt: "desc", id: "desc" },
        limit,
        offset,
      }),
      tx.$count(
        internalMessageModel,
        and(
          eq(internalMessageModel.workspaceId, workspaceId),
          eq(internalMessageModel.threadId, threadId),
        ),
      ),
    ])
    return { rows, total }
  }

  async findMessage(props: {
    workspaceId: string
    threadId?: string
    id: string
    tx?: DatabaseClient
  }): Promise<InternalMessageModel | null> {
    const { workspaceId, threadId, id, tx = db } = props
    return (
      (await tx.query.internalMessageModel.findFirst({
        where: threadId ? { workspaceId, threadId, id } : { workspaceId, id },
      })) ?? null
    )
  }

  async updateMessage(props: {
    workspaceId: string
    id: string
    set: Partial<
      Pick<
        InternalMessageInsert,
        "text" | "mentions" | "attachments" | "editedAt" | "deletedAt"
      >
    >
    tx?: DatabaseClient
  }): Promise<InternalMessageModel | null> {
    const { workspaceId, id, set, tx = db } = props
    const [row] = await tx
      .update(internalMessageModel)
      .set(set)
      .where(
        and(
          eq(internalMessageModel.workspaceId, workspaceId),
          eq(internalMessageModel.id, id),
          isNull(internalMessageModel.deletedAt),
        ),
      )
      .returning()
    return row ?? null
  }

  async markRead(props: {
    threadId: string
    userId: string
    at: Date
    tx?: DatabaseClient
  }): Promise<boolean> {
    const { threadId, userId, at, tx = db } = props
    const rows = await tx
      .update(internalThreadMemberModel)
      .set({ lastReadAt: at })
      .where(
        and(
          eq(internalThreadMemberModel.threadId, threadId),
          eq(internalThreadMemberModel.userId, userId),
        ),
      )
      .returning({ id: internalThreadMemberModel.id })
    return rows.length > 0
  }

  async countUnreadByThreads(props: {
    workspaceId: string
    userId: string
    threadIds: string[]
    tx?: DatabaseClient
  }): Promise<Map<string, number>> {
    const { workspaceId, userId, threadIds, tx = db } = props
    if (threadIds.length === 0) {
      return new Map()
    }
    const rows = await tx
      .select({
        threadId: internalMessageModel.threadId,
        count: sql<number>`count(*)::int`,
      })
      .from(internalMessageModel)
      .innerJoin(
        internalThreadMemberModel,
        and(
          eq(internalThreadMemberModel.threadId, internalMessageModel.threadId),
          eq(internalThreadMemberModel.userId, userId),
        ),
      )
      .where(
        and(
          eq(internalMessageModel.workspaceId, workspaceId),
          inArray(internalMessageModel.threadId, threadIds),
          eq(internalMessageModel.kind, "comment"),
          isNull(internalMessageModel.deletedAt),
          sql`${internalMessageModel.authorUserId} is distinct from ${userId}`,
          sql`${internalMessageModel.createdAt} > coalesce(${internalThreadMemberModel.lastReadAt}, '-infinity'::timestamp)`,
        ),
      )
      .groupBy(internalMessageModel.threadId)

    return new Map(rows.map((row) => [row.threadId, row.count]))
  }
}

export const internalThreadRepository = new InternalThreadRepository()
