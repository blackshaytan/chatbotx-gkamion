import {
  and,
  db,
  desc,
  eq,
  ilike,
  inArray,
  or,
  sql,
} from "@chatbotx.io/database/client"
import { ROOT_TENANT_ID } from "@chatbotx.io/database/partials"
import { userModel } from "@chatbotx.io/database/schema"
import type { UserModel } from "@chatbotx.io/database/types"
import {
  getPaginationWithDefaults,
  likeContains,
} from "@chatbotx.io/database/utils"
import { BaseService } from "../base.service"
import { notFoundException } from "../errors"
import type { PaginatedResult } from "../types"

type ListPlatformUsersInput = {
  page?: number | null
  perPage?: number | null
  keyword?: string
}

export type PlatformUserRow = {
  id: string
  name: string | null
  email: string
  mustChangePassword: boolean
  createdAt: Date
}

class UserService extends BaseService {
  /**
   * Clear the forced-password-change gate for a user. Called server-side ONLY
   * after better-auth has verified the current password and applied the change —
   * never expose a standalone "clear the flag" path to clients, or a provisioned
   * account could keep its temporary password.
   */
  async clearMustChangePassword(userId: string): Promise<void> {
    await db
      .update(userModel)
      .set({ mustChangePassword: false })
      .where(eq(userModel.id, userId))
  }

  async findByIdOrFail(userId: string): Promise<UserModel> {
    const user = await db.query.userModel.findFirst({ where: { id: userId } })
    if (!user) {
      throw notFoundException("User not found")
    }
    return user
  }

  async findNameAndEmail(
    userId: string,
  ): Promise<{ name: string | null; email: string | null } | undefined> {
    return await db.query.userModel.findFirst({
      where: { id: userId },
      columns: { name: true, email: true },
    })
  }

  /**
   * Of the given ids, the ones that still have a `User` row. Used to drop ids
   * that outlived their user — a deleted `User` cascades its `UserQuota` row but
   * not the Redis live-counter key, so reconciling such a ghost id would violate
   * the `UserQuota → User` foreign key on every run.
   */
  async listExistingIds(input: { ids: string[] }): Promise<string[]> {
    if (input.ids.length === 0) {
      return []
    }

    const rows = await db
      .select({ id: userModel.id })
      .from(userModel)
      .where(inArray(userModel.id, input.ids))

    return rows.map((row) => row.id)
  }

  /** Root-tenant users for the platform admin console; reseller tenants manage their own. */
  async listPlatformUsers(
    input: ListPlatformUsersInput,
  ): Promise<PaginatedResult<PlatformUserRow>> {
    const pagination = getPaginationWithDefaults(input)
    const where = and(
      eq(userModel.tenantId, ROOT_TENANT_ID),
      input.keyword
        ? or(
            ilike(userModel.email, likeContains(input.keyword)),
            ilike(userModel.name, likeContains(input.keyword)),
          )
        : undefined,
    )

    const [data, [{ count }]] = await Promise.all([
      db
        .select({
          id: userModel.id,
          name: userModel.name,
          email: userModel.email,
          mustChangePassword: userModel.mustChangePassword,
          createdAt: userModel.createdAt,
        })
        .from(userModel)
        .where(where)
        .orderBy(desc(userModel.createdAt))
        .limit(pagination.limit)
        .offset(pagination.offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(userModel)
        .where(where),
    ])

    return { data, pageCount: Math.ceil(count / pagination.limit) }
  }
}

export const userService = new UserService()
