"use server"

import { isSuperAdmin, userService } from "@chatbotx.io/business"
import { notFound } from "next/navigation"
import { getCurrentUser } from "@/lib/auth/utils"
import type { ListAdminUsersRequest } from "../schema/query"

export type ListAdminUsersResponse = Awaited<
  ReturnType<typeof userService.listPlatformUsers>
>

/** Re-checks the platform admin gate: this server function is callable outside the `/admin` layout. */
export async function listAdminUsers(
  input: ListAdminUsersRequest,
): Promise<ListAdminUsersResponse> {
  const user = await getCurrentUser()
  if (!(user && isSuperAdmin(user))) {
    return notFound()
  }

  return await userService.listPlatformUsers({
    ...input,
    keyword: input.keyword ?? undefined,
  })
}
