"use client"

import { DataTable } from "@chatbotx.io/ui/components/data-table/data-table"
import { DataTableColumnHeader } from "@chatbotx.io/ui/components/data-table/data-table-column-header"
import { DataTableToolbar } from "@chatbotx.io/ui/components/data-table/data-table-toolbar"
import { Badge } from "@chatbotx.io/ui/components/ui/badge"
import { useDataTable } from "@chatbotx.io/ui/hooks/use-data-table"
import type { ColumnDef } from "@tanstack/react-table"
import { format } from "date-fns"
import { useTranslations } from "next-intl"
import { use, useMemo } from "react"
import { ResetAdminUserPasswordButton } from "./components/reset-admin-user-password-button"
import type { ListAdminUsersResponse, listAdminUsers } from "./queries"

type AdminUserRow = ListAdminUsersResponse["data"][number]

type AdminUsersTableProps = {
  promises: Promise<[Awaited<ReturnType<typeof listAdminUsers>>]>
  currentUserId: string
}

export const AdminUsersTable = ({
  promises,
  currentUserId,
}: AdminUsersTableProps) => {
  const [{ data, pageCount }] = use(promises)
  const t = useTranslations()

  const columns = useMemo<ColumnDef<AdminUserRow>[]>(
    () => [
      {
        id: "name",
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={t("fields.name.label")}
          />
        ),
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-medium">{row.original.name ?? "—"}</span>
            <span className="text-muted-foreground text-xs">
              {row.original.email}
            </span>
          </div>
        ),
        meta: {
          label: t("fields.name.label"),
          placeholder: t("platformAdmin.users.searchPlaceholder"),
          variant: "text",
          filterKey: "keyword",
        },
        enableColumnFilter: true,
        enableSorting: false,
        enableHiding: false,
      },
      {
        id: "status",
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={t("fields.status.label")}
          />
        ),
        cell: ({ row }) =>
          row.original.mustChangePassword ? (
            <Badge variant="secondary">
              {t("platformAdmin.users.status.temporaryPassword")}
            </Badge>
          ) : (
            <span className="text-muted-foreground">
              {t("platformAdmin.users.status.active")}
            </span>
          ),
        enableSorting: false,
      },
      {
        id: "createdAt",
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={t("fields.createdAt.label")}
          />
        ),
        cell: ({ row }) => format(row.original.createdAt, "PP"),
        enableSorting: false,
      },
      {
        id: "actions",
        cell: ({ row }) =>
          row.original.id === currentUserId ? null : (
            <ResetAdminUserPasswordButton
              email={row.original.email}
              userId={row.original.id}
            />
          ),
        enableHiding: false,
      },
    ],
    [t, currentUserId],
  )

  const { table } = useDataTable({
    data,
    columns,
    pageCount,
    initialState: {
      columnPinning: { right: ["actions"] },
    },
    getRowId: (originalRow) => originalRow.id,
    shallow: false,
    clearOnDefault: true,
  })

  return (
    <DataTable table={table}>
      <DataTableToolbar table={table} />
    </DataTable>
  )
}
