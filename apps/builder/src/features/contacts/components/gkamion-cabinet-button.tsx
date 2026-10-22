"use client"

import { Button } from "@chatbotx.io/ui/components/ui/button"
import { ExternalLinkIcon, Loader2Icon } from "lucide-react"
import { useTranslations } from "next-intl"
import { useState } from "react"
import { toast } from "sonner"
import { client } from "@/lib/orpc/orpc"

type GkamionCabinetButtonProps = {
  workspaceId: string
  contactId: string
  phoneNumber?: string | null
  email?: string | null
}

const NON_DIGIT_RE = /\D/g

const hasLookupIdentifier = (
  phoneNumber?: string | null,
  email?: string | null,
): boolean => {
  const digits = (phoneNumber ?? "").replace(NON_DIGIT_RE, "")
  return Boolean(email?.trim()) || digits.length >= 10
}

export const GkamionCabinetButton = ({
  workspaceId,
  contactId,
  phoneNumber,
  email,
}: GkamionCabinetButtonProps) => {
  const t = useTranslations()
  const [isPending, setIsPending] = useState(false)
  const canLookup = hasLookupIdentifier(phoneNumber, email)

  const handleOpenCabinet = async () => {
    setIsPending(true)
    try {
      const result =
        await client.contactsAPIs.getGkamionCabinetLinkAuthenticatedAPI({
          workspaceId,
          contactId,
        })
      if (result.status === "ok") {
        window.open(result.url, "_blank", "noopener,noreferrer")
        return
      }
      if (result.status === "not_found") {
        toast.error(t("contacts.gkamionCabinet.notFound"))
        return
      }
      if (result.reason === "missing_identifiers") {
        toast.error(t("contacts.gkamionCabinet.missingIdentifiers"))
        return
      }
      toast.error(t("contacts.gkamionCabinet.notConfigured"))
    } catch {
      toast.error(t("contacts.gkamionCabinet.error"))
    } finally {
      setIsPending(false)
    }
  }

  if (!canLookup) {
    return null
  }

  return (
    <Button
      aria-label={t("contacts.gkamionCabinet.open")}
      className="gap-2"
      disabled={isPending}
      onClick={() => {
        handleOpenCabinet().catch(() => undefined)
      }}
      size="sm"
      type="button"
      variant="outline"
    >
      {isPending ? (
        <Loader2Icon aria-hidden className="size-4 animate-spin" />
      ) : (
        <ExternalLinkIcon aria-hidden className="size-4" />
      )}
      {t("contacts.gkamionCabinet.open")}
    </Button>
  )
}
