"use client"

import { Switch } from "@chatbotx.io/ui/components/ui/switch"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { useAction } from "next-safe-action/hooks"
import { toast } from "sonner"
import { useInvalidateInboxes } from "@/features/inboxes/provider/inbox-hook"
import { setZzapEnabledAction } from "../actions/set-enabled.action"

type ZzapEnabledSwitchProps = {
  workspaceId: string
  connectionId: string
  enabled: boolean
}

export const ZzapEnabledSwitch = ({
  workspaceId,
  connectionId,
  enabled,
}: ZzapEnabledSwitchProps) => {
  const t = useTranslations()
  const router = useRouter()
  const invalidateInboxes = useInvalidateInboxes()
  const { execute, isPending } = useAction(
    setZzapEnabledAction.bind(null, workspaceId),
    {
      onSuccess: ({ data }) => {
        invalidateInboxes()
        toast.success(
          data?.status === "connected"
            ? t("fields.zzap.switchedOn")
            : t("fields.zzap.switchedOff"),
        )
        router.refresh()
      },
      onError: ({ error }) => {
        if (error.serverError) {
          toast.error(error.serverError)
        }
      },
    },
  )

  const handleCheckedChange = (checked: boolean) =>
    execute({ connectionId, enabled: checked })

  return (
    <Switch
      aria-label={t("fields.zzap.enabled")}
      checked={enabled}
      disabled={isPending}
      onCheckedChange={handleCheckedChange}
    />
  )
}
