"use client"

import type { DromChannelRow } from "@chatbotx.io/business"
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
import { KeyRoundIcon, PlusCircleIcon } from "lucide-react"
import { useFormatter, useTranslations } from "next-intl"
import { use } from "react"
import { AddChannelButton } from "@/features/inboxes/components/add-channel-button"
import { InboxMarkReadOnOutboundSwitch } from "@/features/inboxes/components/inbox-mark-read-on-outbound-switch"
import { useChannelConnectError } from "@/hooks/use-channel-connect-error"
import { DromConnect } from "./components/drom-connect"
import { DromDisconnect } from "./components/drom-disconnect"
import { DromEnabledSwitch } from "./components/drom-enabled-switch"
import type { listDromChannels } from "./queries"

const statusLabelKey = {
  connected: "fields.drom.status.connected",
  paused: "fields.drom.status.paused",
  needs_reauth: "fields.drom.status.needs_reauth",
  degraded: "fields.drom.status.degraded",
  disconnected: "fields.drom.status.disconnected",
} as const satisfies Record<ConnectionStatus, string>

const ENABLED_STATUSES: readonly ConnectionStatus[] = ["connected", "degraded"]

/** Cookies can only be replaced while ChatbotX is not polling with them. */
const COOKIE_UPDATE_STATUSES: readonly ConnectionStatus[] = [
  "paused",
  "needs_reauth",
]

const EMPTY_VALUE = "—"

type DromManageProps = {
  canCreate?: boolean
  workspaceId: string
  promises: Promise<[Awaited<ReturnType<typeof listDromChannels>>]>
}

type DromEnabledCellProps = {
  workspaceId: string
  connection: NonNullable<DromChannelRow["connection"]>
}

const DromEnabledCell = ({ workspaceId, connection }: DromEnabledCellProps) => {
  const t = useTranslations()
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <DromEnabledSwitch
          connectionId={connection.id}
          enabled={ENABLED_STATUSES.includes(connection.status)}
          workspaceId={workspaceId}
        />
        <span className="text-sm">{t(statusLabelKey[connection.status])}</span>
      </div>
      <p className="max-w-xs text-muted-foreground text-xs">
        {t("fields.drom.enabledHint")}
      </p>
    </div>
  )
}

export const DromManage = ({
  canCreate = true,
  workspaceId,
  promises,
}: DromManageProps) => {
  const [{ data: channels }] = use(promises)
  const t = useTranslations()
  const formatter = useFormatter()

  useChannelConnectError("drom")

  const formatPolledAt = (value: DromChannelRow["lastPolledAt"]) =>
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
          label={t("fields.drom.label")}
          render={
            <DromConnect workspaceId={workspaceId}>
              <Button size="sm" variant="secondary">
                <PlusCircleIcon className="h-4 w-4" />
                {t("actions.addFeature", { feature: t("fields.drom.label") })}
              </Button>
            </DromConnect>
          }
        />
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("fields.name.label")}</TableHead>
              <TableHead>{t("fields.drom.enabled")}</TableHead>
              <TableHead>{t("fields.drom.lastPolledAt")}</TableHead>
              <TableHead>{t("fields.drom.lastError")}</TableHead>
              <TableHead>{t("inboxes.markReadOnOutbound.label")}</TableHead>
              <TableHead className="w-72" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {channels.map((channel) => (
              <TableRow key={channel.id}>
                <TableCell>{channel.name}</TableCell>
                <TableCell>
                  {channel.connection && (
                    <DromEnabledCell
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
                <TableCell className="flex w-72 justify-end gap-2">
                  {channel.connection &&
                    COOKIE_UPDATE_STATUSES.includes(
                      channel.connection.status,
                    ) && (
                      <DromConnect
                        defaultSellerLogin={channel.sellerLogin}
                        mode="updateCookies"
                        workspaceId={workspaceId}
                      >
                        <Button size="sm" variant="outline">
                          <KeyRoundIcon className="h-4 w-4" />
                          {t("fields.drom.updateCookies")}
                        </Button>
                      </DromConnect>
                    )}
                  {channel.connection && (
                    <DromDisconnect
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
