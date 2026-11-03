"use client"

import { Switch } from "@chatbotx.io/ui/components/ui/switch"
import { useQueryClient } from "@tanstack/react-query"
import { useFormatter, useTranslations } from "next-intl"
import { useAction } from "next-safe-action/hooks"
import { useCallback } from "react"
import { toast } from "sonner"
import { orpc } from "@/lib/orpc/query"
import { clearAiCallOptOutAction } from "../actions/clear-ai-call-opt-out.action"
import { setAiCallOptOutAction } from "../actions/set-ai-call-opt-out.action"

export type ContactAiCallsSectionContact = {
  id: string
  phoneNumber: string | null
  aiCallOptOutAt: Date | null
  aiCallOptOutSource: string | null
  aiCallOptOutReason: string | null
}

type ContactAiCallsSectionProps = {
  workspaceId: string
  contact: ContactAiCallsSectionContact
}

export function ContactAiCallsSection({
  workspaceId,
  contact,
}: ContactAiCallsSectionProps) {
  const t = useTranslations("contactAiCalls")
  const format = useFormatter()
  const queryClient = useQueryClient()

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: orpc.contactsAPIs.key() })
  }, [queryClient])

  const { execute: setOptOut, isPending: isSettingOptOut } = useAction(
    setAiCallOptOutAction.bind(null, workspaceId, contact.id),
    {
      onSuccess: () => {
        refresh()
      },
      onError: ({ error }) => {
        if (error.serverError) {
          toast.error(error.serverError)
        }
      },
    },
  )

  const { execute: clearOptOut, isPending: isClearingOptOut } = useAction(
    clearAiCallOptOutAction.bind(null, workspaceId, contact.id),
    {
      onSuccess: () => {
        refresh()
      },
      onError: ({ error }) => {
        if (error.serverError) {
          toast.error(error.serverError)
        }
      },
    },
  )

  const handleToggle = (checked: boolean) => {
    if (checked) {
      clearOptOut()
    } else {
      setOptOut({})
    }
  }

  return (
    <section className="border-t px-2 py-3">
      <h2 className="font-medium text-sm">{t("title")}</h2>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-sm">{t("toggleLabel")}</span>
        <Switch
          aria-label={t("toggleLabel")}
          checked={!contact.aiCallOptOutAt}
          disabled={isSettingOptOut || isClearingOptOut}
          onCheckedChange={handleToggle}
          size="sm"
        />
      </div>
      {contact.aiCallOptOutAt ? (
        <div className="mt-2 text-muted-foreground text-sm">
          <p>
            {t("optedOutAt", {
              date: format.dateTime(new Date(contact.aiCallOptOutAt), {
                dateStyle: "medium",
                timeStyle: "short",
              }),
              source: contact.aiCallOptOutSource
                ? t(
                    `sources.${contact.aiCallOptOutSource}` as "sources.clientCall",
                  )
                : "",
            })}
          </p>
          {contact.aiCallOptOutReason ? (
            <p className="mt-1">&laquo;{contact.aiCallOptOutReason}&raquo;</p>
          ) : null}
        </div>
      ) : null}
      {contact.aiCallOptOutAt && !contact.phoneNumber ? (
        <p className="mt-2 text-amber-600 text-sm">{t("noPhoneWarning")}</p>
      ) : null}
    </section>
  )
}
