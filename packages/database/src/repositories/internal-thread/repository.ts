import { and, type DatabaseClient, db, eq } from "../../client"
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
}

export const internalThreadRepository = new InternalThreadRepository()
