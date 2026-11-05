"use client"

import { canReceiveSmtp } from "@chatbotx.io/integration-smtp/schema"
import { InputField } from "@chatbotx.io/ui/components/form/input-field"
import { SwitchField } from "@chatbotx.io/ui/components/form/switch-field"
import { useTranslations } from "next-intl"
import { useWatch } from "react-hook-form"

type SmtpReceiveFieldsProps = {
  readonly provider: string
}

export const SmtpReceiveFields = ({ provider }: SmtpReceiveFieldsProps) => {
  const t = useTranslations()
  const canReceive = canReceiveSmtp(provider)
  const receiveEnabled = useWatch({ name: "receiveEnabled" })

  return (
    <>
      <SwitchField
        description={
          canReceive
            ? t("smtp.receive.description")
            : t("smtp.receive.unavailable")
        }
        disabled={!canReceive}
        label={t("smtp.receive.label")}
        name="receiveEnabled"
      />
      {canReceive && provider === "other" && receiveEnabled ? (
        <>
          <InputField
            hideOptionalLabel
            label={t("smtp.receive.imapHost")}
            name="imapHost"
            placeholder={t("smtp.receive.imapHostPlaceholder")}
          />
          <InputField
            hideOptionalLabel
            label={t("smtp.receive.imapPort")}
            name="imapPort"
            placeholder={t("smtp.receive.imapPortPlaceholder")}
            type="number"
          />
        </>
      ) : null}
    </>
  )
}
