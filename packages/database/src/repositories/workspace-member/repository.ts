import { and, type DatabaseClient, db, eq, inArray, sql } from "../../client"
import type {
  WorkspaceMemberNotificationTypes,
  WorkspaceMemberPermissions,
} from "../../partials/workspace"
import { workspaceMemberModel } from "../../schema"

export type WorkspaceMemberPermissionsRow = {
  userId: string
  permissions: WorkspaceMemberPermissions
}

/**
 * Bounded projections over WorkspaceMember — never the whole cached roster.
 * Used by the ring-target snapshot (permissions for the already-bounded set of
 * online user ids) and by the presence "last came online" mirror.
 */
class WorkspaceMemberRepository {
  /**
   * Permissions for exactly the requested userIds, scoped to workspaceId — an
   * id with no matching row (e.g. a synthetic support-session membership, never
   * persisted) is simply absent from the result. Empty userIds short-circuits
   * to [] with no query.
   */
  async listPermissionsByUserIds(props: {
    workspaceId: string
    userIds: string[]
    tx?: DatabaseClient
  }): Promise<WorkspaceMemberPermissionsRow[]> {
    const { workspaceId, userIds, tx = db } = props
    if (userIds.length === 0) {
      return []
    }
    return await tx
      .select({
        userId: workspaceMemberModel.userId,
        permissions: workspaceMemberModel.permissions,
      })
      .from(workspaceMemberModel)
      .where(
        and(
          eq(workspaceMemberModel.workspaceId, workspaceId),
          inArray(workspaceMemberModel.userId, userIds),
        ),
      )
  }

  /**
   * Stamps onlineSince = now() in one bulk UPDATE for the offline->online
   * subset only; no "mark offline" write since Redis is the source of truth.
   * No existence check, so a synthetic support membership (no real row) is a
   * silent no-op for that id only, not the whole batch.
   */
  async listNotificationTypesByUserIds(props: {
    workspaceId: string
    userIds: string[]
    tx?: DatabaseClient
  }): Promise<
    { userId: string; notificationTypes: WorkspaceMemberNotificationTypes }[]
  > {
    const { workspaceId, userIds, tx = db } = props
    if (userIds.length === 0) {
      return []
    }
    return await tx
      .select({
        userId: workspaceMemberModel.userId,
        notificationTypes: workspaceMemberModel.notificationTypes,
      })
      .from(workspaceMemberModel)
      .where(
        and(
          eq(workspaceMemberModel.workspaceId, workspaceId),
          inArray(workspaceMemberModel.userId, userIds),
        ),
      )
  }

  async findNotificationTypes(props: {
    workspaceId: string
    userId: string
    tx?: DatabaseClient
  }): Promise<WorkspaceMemberNotificationTypes | undefined> {
    const { workspaceId, userId, tx = db } = props
    const [row] = await tx
      .select({ notificationTypes: workspaceMemberModel.notificationTypes })
      .from(workspaceMemberModel)
      .where(
        and(
          eq(workspaceMemberModel.workspaceId, workspaceId),
          eq(workspaceMemberModel.userId, userId),
        ),
      )
      .limit(1)
    return row?.notificationTypes
  }

  async updateNotificationTypes(props: {
    workspaceId: string
    userId: string
    notificationTypes: WorkspaceMemberNotificationTypes
    tx?: DatabaseClient
  }): Promise<void> {
    const { workspaceId, userId, notificationTypes, tx = db } = props
    await tx
      .update(workspaceMemberModel)
      .set({ notificationTypes })
      .where(
        and(
          eq(workspaceMemberModel.workspaceId, workspaceId),
          eq(workspaceMemberModel.userId, userId),
        ),
      )
  }

  async markOnlineBulk(props: {
    workspaceId: string
    userIds: string[]
    tx?: DatabaseClient
  }): Promise<void> {
    const { workspaceId, userIds, tx = db } = props
    if (userIds.length === 0) {
      return
    }
    await tx
      .update(workspaceMemberModel)
      .set({ onlineSince: sql`now()` })
      .where(
        and(
          eq(workspaceMemberModel.workspaceId, workspaceId),
          inArray(workspaceMemberModel.userId, userIds),
        ),
      )
  }
}

export const workspaceMemberRepository = new WorkspaceMemberRepository()
