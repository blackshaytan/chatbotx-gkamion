import { notFound } from "next/navigation"
import { getTranslations } from "next-intl/server"
import type { SearchParams } from "nuqs/server"
import { Suspense } from "react"
import { AdminUsersTable } from "@/features/admin-users/admin-users-table"
import { CreateAdminUserDialog } from "@/features/admin-users/components/create-admin-user-dialog"
import { listAdminUsers } from "@/features/admin-users/queries"
import { getAdminUsersSearchParamsCache } from "@/features/admin-users/schema/query"
import { getCurrentUser } from "@/lib/auth/utils"

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const [t, search, user] = await Promise.all([
    getTranslations(),
    getAdminUsersSearchParamsCache.parse(await searchParams),
    getCurrentUser(),
  ])
  if (!user) {
    return notFound()
  }

  const promises = Promise.all([listAdminUsers(search)])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h3 className="font-bold text-lg sm:text-xl">
            {t("platformAdmin.users.title")}
          </h3>
          <p className="text-muted-foreground text-sm">
            {t("platformAdmin.users.description")}
          </p>
        </div>
        <CreateAdminUserDialog />
      </div>

      <Suspense>
        <AdminUsersTable currentUserId={user.id} promises={promises} />
      </Suspense>
    </div>
  )
}
