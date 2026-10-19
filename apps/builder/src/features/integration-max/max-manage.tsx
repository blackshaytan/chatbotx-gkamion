"use client"

import type { MaxChannelRow } from "@chatbotx.io/business"
import { Button } from "@chatbotx.io/ui/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@chatbotx.io/ui/components/ui/table"
import type { ConnectionStatus } from "@chatbotx.io/utils/connection"
import { PlusCircleIcon } from "lucide-react"
import { useTranslations } from "next-intl"
import { use } from "react"
import { AddChannelButton } from "@/features/inboxes/components/add-channel-button"
import { InboxMarkReadOnOutboundSwitch } from "@/features/inboxes/components/inbox-mark-read-on-outbound-switch"
import { useChannelConnectError } from "@/hooks/use-channel-connect-error"
import { MaxConnect } from "./components/max-connect"
import { MaxDisconnect } from "./components/max-disconnect"
import { MaxEnabledSwitch } from "./components/max-enabled-switch"
import type { listMaxChannels } from "./queries"

const statusLabelKey = {
  connected: "fields.max.status.connected",
  paused: "fields.max.status.paused",
  needs_reauth: "fields.max.status.needs_reauth",
  degraded: "fields.max.status.degraded",
  disconnected: "fields.max.status.disconnected",
} as const satisfies Record<ConnectionStatus, string>

const ENABLED_STATUSES: readonly ConnectionStatus[] = ["connected", "degraded"]

type MaxManageProps = {
  canCreate?: boolean
  workspaceId: string
  promises: Promise<[Awaited<ReturnType<typeof listMaxChannels>>]>
}

type MaxEnabledCellProps = {
  workspaceId: string
  connection: NonNullable<MaxChannelRow["connection"]>
}

const MaxEnabledCell = ({ workspaceId, connection }: MaxEnabledCellProps) => {
  const t = useTranslations()
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <MaxEnabledSwitch
          connectionId={connection.id}
          enabled={ENABLED_STATUSES.includes(connection.status)}
          workspaceId={workspaceId}
        />
        <span className="text-sm">{t(statusLabelKey[connection.status])}</span>
      </div>
      <p className="max-w-xs text-muted-foreground text-xs">
        {t("fields.max.enabledHint")}
      </p>
    </div>
  )
}

export const MaxManage = ({
  canCreate = true,
  workspaceId,
  promises,
}: MaxManageProps) => {
  const [{ data: channels }] = use(promises)
  const t = useTranslations()

  useChannelConnectError("max")

  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-end gap-2">
        <AddChannelButton
          canCreate={canCreate}
          label={t("fields.max.label")}
          render={
            <MaxConnect workspaceId={workspaceId}>
              <Button size="sm" variant="secondary">
                <PlusCircleIcon className="h-4 w-4" />
                {t("actions.addFeature", { feature: t("fields.max.label") })}
              </Button>
            </MaxConnect>
          }
        />
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("fields.name.label")}</TableHead>
              <TableHead>{t("fields.max.enabled")}</TableHead>
              <TableHead>{t("inboxes.markReadOnOutbound.label")}</TableHead>
              <TableHead className="w-50" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {channels.map((channel) => (
              <TableRow key={channel.id}>
                <TableCell>{channel.name}</TableCell>
                <TableCell>
                  {channel.connection && (
                    <MaxEnabledCell
                      connection={channel.connection}
                      workspaceId={workspaceId}
                    />
                  )}
                </TableCell>
                <TableCell>
                  <InboxMarkReadOnOutboundSwitch
                    inboxId={channel.inboxId}
                    workspaceId={workspaceId}
                  />
                </TableCell>
                <TableCell className="flex w-50 justify-end gap-2">
                  {channel.connection && (
                    <MaxDisconnect
                      connectionId={channel.connection.id}
                      workspaceId={workspaceId}
                    />
                  )}
                </TableCell>
              </TableRow>
            ))}
            {channels.length === 0 && (
              <TableRow>
                <TableCell colSpan={4}>{t("messages.noData")}</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
