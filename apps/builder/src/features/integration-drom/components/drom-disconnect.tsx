"use client"

import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { useAction } from "next-safe-action/hooks"
import { useState } from "react"
import { toast } from "sonner"
import { DisconnectIntegrationDialog } from "@/features/common/components/disconnect-integration-dialog"
import { useInvalidateInboxes } from "@/features/inboxes/provider/inbox-hook"
import { disconnectDromAction } from "../actions/disconnect.action"

type DromDisconnectProps = {
  workspaceId: string
  connectionId: string
}

export const DromDisconnect = ({
  workspaceId,
  connectionId,
}: DromDisconnectProps) => {
  const t = useTranslations()
  const router = useRouter()
  const invalidateInboxes = useInvalidateInboxes()
  const [open, setOpen] = useState(false)

  const { executeAsync, isPending } = useAction(
    disconnectDromAction.bind(null, workspaceId, connectionId),
    {
      onSuccess: () => {
        invalidateInboxes()
        router.refresh()
      },
      onError: ({ error }) => {
        if (error.serverError) {
          toast.error(error.serverError)
        }
      },
    },
  )

  const handleConfirm = () => executeAsync()

  return (
    <DisconnectIntegrationDialog
      featureLabel={t("fields.drom.label")}
      isPending={isPending}
      onConfirm={handleConfirm}
      onOpenChange={setOpen}
      open={open}
    />
  )
}
