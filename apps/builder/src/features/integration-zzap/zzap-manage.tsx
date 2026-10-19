"use client"

import type { ZzapChannelRow } from "@chatbotx.io/business"
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
import { useFormatter, useTranslations } from "next-intl"
import { use } from "react"
import { AddChannelButton } from "@/features/inboxes/components/add-channel-button"
import { InboxMarkReadOnOutboundSwitch } from "@/features/inboxes/components/inbox-mark-read-on-outbound-switch"
import { useChannelConnectError } from "@/hooks/use-channel-connect-error"
import { ZzapConnect } from "./components/zzap-connect"
import { ZzapDisconnect } from "./components/zzap-disconnect"
import { ZzapEnabledSwitch } from "./components/zzap-enabled-switch"
import type { listZzapChannels } from "./queries"

const statusLabelKey = {
  connected: "fields.zzap.status.connected",
  paused: "fields.zzap.status.paused",
  needs_reauth: "fields.zzap.status.needs_reauth",
  degraded: "fields.zzap.status.degraded",
  disconnected: "fields.zzap.status.disconnected",
} as const satisfies Record<ConnectionStatus, string>

const ENABLED_STATUSES: readonly ConnectionStatus[] = ["connected", "degraded"]

const EMPTY_VALUE = "—"

type ZzapManageProps = {
  canCreate?: boolean
  workspaceId: string
  promises: Promise<[Awaited<ReturnType<typeof listZzapChannels>>]>
}

type ZzapEnabledCellProps = {
  workspaceId: string
  connection: NonNullable<ZzapChannelRow["connection"]>
}

const ZzapEnabledCell = ({ workspaceId, connection }: ZzapEnabledCellProps) => {
  const t = useTranslations()
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <ZzapEnabledSwitch
          connectionId={connection.id}
          enabled={ENABLED_STATUSES.includes(connection.status)}
          workspaceId={workspaceId}
        />
        <span className="text-sm">{t(statusLabelKey[connection.status])}</span>
      </div>
      <p className="max-w-xs text-muted-foreground text-xs">
        {t("fields.zzap.enabledHint")}
      </p>
    </div>
  )
}

export const ZzapManage = ({
  canCreate = true,
  workspaceId,
  promises,
}: ZzapManageProps) => {
  const [{ data: channels }] = use(promises)
  const t = useTranslations()
  const formatter = useFormatter()

  useChannelConnectError("zzap")

  const formatPolledAt = (value: ZzapChannelRow["lastPolledAt"]) =>
    value
      ? formatter.dateTime(new Date(value), {
          dateStyle: "medium",
          timeStyle: "short",
        })
      : EMPTY_VALUE

  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-end gap-2">
        <AddChannelButton
          canCreate={canCreate}
          label={t("fields.zzap.label")}
          render={
            <ZzapConnect workspaceId={workspaceId}>
              <Button size="sm" variant="secondary">
                <PlusCircleIcon className="h-4 w-4" />
                {t("actions.addFeature", { feature: t("fields.zzap.label") })}
              </Button>
            </ZzapConnect>
          }
        />
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("fields.name.label")}</TableHead>
              <TableHead>{t("fields.zzap.enabled")}</TableHead>
              <TableHead>{t("fields.zzap.lastPolledAt")}</TableHead>
              <TableHead>{t("fields.zzap.lastError")}</TableHead>
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
                    <ZzapEnabledCell
                      connection={channel.connection}
                      workspaceId={workspaceId}
                    />
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap text-sm">
                  {formatPolledAt(channel.lastPolledAt)}
                </TableCell>
                <TableCell className="max-w-xs break-words text-muted-foreground text-xs">
                  {channel.connection?.lastError ?? EMPTY_VALUE}
                </TableCell>
                <TableCell>
                  <InboxMarkReadOnOutboundSwitch
                    inboxId={channel.inboxId}
                    workspaceId={workspaceId}
                  />
                </TableCell>
                <TableCell className="flex w-50 justify-end gap-2">
                  {channel.connection && (
                    <ZzapDisconnect
                      connectionId={channel.connection.id}
                      workspaceId={workspaceId}
                    />
                  )}
                </TableCell>
              </TableRow>
            ))}
            {channels.length === 0 && (
              <TableRow>
                <TableCell colSpan={6}>{t("messages.noData")}</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
