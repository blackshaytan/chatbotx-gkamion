import {
  and,
  asc,
  count,
  type DatabaseClient,
  db,
  desc,
  eq,
  inArray,
  isNull,
  lt,
  sql,
} from "../../client"
import type {
  ChatNotificationPayload,
  ChatNotificationType,
  NotificationEntityType,
  NotificationPayload,
  TaskNotificationType,
} from "../../partials/notification"
import { notificationModel } from "../../schema"
import type { NotificationModel } from "../../types"

export type TaskNotificationInsert = {
  workspaceId: string
  userId: string
  type: TaskNotificationType
  entityType: "task"
  entityId: string
  payload: NotificationPayload
}

export type ChatNotificationInsert = {
  workspaceId: string
  userId: string
  type: ChatNotificationType
  entityType: "chat"
  entityId: string
  payload: ChatNotificationPayload
}

export type NotificationInsert = TaskNotificationInsert | ChatNotificationInsert

class NotificationRepository {
  async insertMany(props: {
    rows: NotificationInsert[]
    tx?: DatabaseClient
  }): Promise<NotificationModel[]> {
    const { rows, tx = db } = props
    if (rows.length === 0) {
      return []
    }
    return await tx.insert(notificationModel).values(rows).returning()
  }

  async upsertChatUnread(props: {
    rows: ChatNotificationInsert[]
    tx?: DatabaseClient
  }): Promise<NotificationModel[]> {
    const { rows, tx = db } = props
    if (rows.length === 0) {
      return []
    }
    const values = sql.join(
      rows.map(
        (row) =>
          sql`(${row.workspaceId}::bigint, ${row.userId}::bigint, ${row.type}, 'chat', ${row.entityId}::bigint, ${JSON.stringify(row.payload)}::jsonb)`,
      ),
      sql`, `,
    )
    const result = await tx.execute<NotificationModel>(sql`
      INSERT INTO "Notification" ("workspaceId", "userId", "type", "entityType", "entityId", "payload")
      VALUES ${values}
      ON CONFLICT ("workspaceId", "userId", "entityId") WHERE "entityType" = 'chat' AND "readAt" IS NULL
      DO UPDATE SET
        "payload" = jsonb_set(
          EXCLUDED."payload",
          '{count}',
          to_jsonb(COALESCE(("Notification"."payload"->>'count')::integer, 0) + 1)
        ),
        "createdAt" = now(),
        "updatedAt" = now()
      RETURNING *
    `)
    return result.rows
  }

  async listForUser(props: {
    workspaceId: string
    userId: string
    limit: number
    unreadOnly?: boolean
    entityType?: NotificationEntityType
    tx?: DatabaseClient
  }): Promise<NotificationModel[]> {
    const {
      workspaceId,
      userId,
      limit,
      unreadOnly,
      entityType,
      tx = db,
    } = props
    const conditions = [
      eq(notificationModel.workspaceId, workspaceId),
      eq(notificationModel.userId, userId),
    ]
    if (entityType !== undefined) {
      conditions.push(eq(notificationModel.entityType, entityType))
    }
    if (unreadOnly) {
      conditions.push(isNull(notificationModel.readAt))
    }
    return await tx
      .select()
      .from(notificationModel)
      .where(and(...conditions))
      .orderBy(desc(notificationModel.createdAt))
      .limit(limit)
  }

  async countUnread(props: {
    workspaceId: string
    userId: string
    tx?: DatabaseClient
  }): Promise<number> {
    const { workspaceId, userId, tx = db } = props
    const [row] = await tx
      .select({ total: count() })
      .from(notificationModel)
      .where(
        and(
          eq(notificationModel.workspaceId, workspaceId),
          eq(notificationModel.userId, userId),
          isNull(notificationModel.readAt),
        ),
      )
    return row?.total ?? 0
  }

  async markRead(props: {
    workspaceId: string
    userId: string
    ids?: string[]
    tx?: DatabaseClient
  }): Promise<void> {
    const { workspaceId, userId, ids, tx = db } = props
    if (ids !== undefined && ids.length === 0) {
      return
    }
    const scope = and(
      eq(notificationModel.workspaceId, workspaceId),
      eq(notificationModel.userId, userId),
      isNull(notificationModel.readAt),
      ids ? inArray(notificationModel.id, ids) : sql`true`,
    )
    await tx.update(notificationModel).set({ readAt: sql`now()` }).where(scope)
  }

  async markReadByEntity(props: {
    workspaceId: string
    userId: string
    entityType: NotificationEntityType
    entityId: string
    upTo: Date
    tx?: DatabaseClient
  }): Promise<void> {
    const { tx = db, ...input } = props
    await tx
      .update(notificationModel)
      .set({ readAt: sql`now()` })
      .where(
        and(
          eq(notificationModel.workspaceId, input.workspaceId),
          eq(notificationModel.userId, input.userId),
          eq(notificationModel.entityType, input.entityType),
          eq(notificationModel.entityId, input.entityId),
          isNull(notificationModel.readAt),
          sql`(${notificationModel.payload}->>'lastMessageAt')::timestamptz <= ${input.upTo}`,
        ),
      )
  }

  async deleteForUser(props: {
    workspaceId: string
    userId: string
    tx?: DatabaseClient
  }): Promise<void> {
    const { workspaceId, userId, tx = db } = props
    await tx
      .delete(notificationModel)
      .where(
        and(
          eq(notificationModel.workspaceId, workspaceId),
          eq(notificationModel.userId, userId),
        ),
      )
  }

  async deleteByEntity(props: {
    workspaceId: string
    entityType: NotificationEntityType
    entityId: string
    tx?: DatabaseClient
  }): Promise<void> {
    const { workspaceId, entityType, entityId, tx = db } = props
    await tx
      .delete(notificationModel)
      .where(
        and(
          eq(notificationModel.workspaceId, workspaceId),
          eq(notificationModel.entityType, entityType),
          eq(notificationModel.entityId, entityId),
        ),
      )
  }

  async deleteOlderThan(props: {
    before: Date
    limit: number
    tx?: DatabaseClient
  }): Promise<number> {
    const { before, limit, tx = db } = props
    const stale = await tx
      .select({ id: notificationModel.id })
      .from(notificationModel)
      .where(lt(notificationModel.createdAt, before))
      .orderBy(asc(notificationModel.createdAt))
      .limit(limit)
    if (stale.length === 0) {
      return 0
    }
    await tx.delete(notificationModel).where(
      inArray(
        notificationModel.id,
        stale.map((row) => row.id),
      ),
    )
    return stale.length
  }
}

export const notificationRepository = new NotificationRepository()
