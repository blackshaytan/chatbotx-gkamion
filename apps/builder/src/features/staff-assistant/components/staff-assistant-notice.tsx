"use client"

import { Alert, AlertDescription } from "@chatbotx.io/ui/components/ui/alert"
import { AlertTriangleIcon } from "lucide-react"
import { useTranslations } from "next-intl"

export const StaffAssistantNotice = () => {
  const t = useTranslations()
  return (
    <Alert variant="warning">
      <AlertTriangleIcon aria-hidden="true" />
      <AlertDescription>
        {t("staffAssistant.fullAccessNotice")}
      </AlertDescription>
    </Alert>
  )
}
