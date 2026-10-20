"use client"

import { SelectField } from "@chatbotx.io/ui/components/form/select-field"
import { useLocale, useTranslations } from "next-intl"
import { useMemo } from "react"
import { localizeLanguageOptions } from "@/lib/language-names"
import { languageOptions } from "../type"

export function WhatsappMessageTemplateLanguageSelect({
  name,
  label,
  required = false,
}: {
  name: string
  label: string
  required?: boolean
}) {
  const t = useTranslations()
  const locale = useLocale()
  const options = useMemo(
    () => localizeLanguageOptions(languageOptions, locale),
    [locale],
  )

  return (
    <SelectField
      label={label}
      name={name}
      options={options}
      placeholder={t("actions.pleaseSelect")}
      required={required}
    />
  )
}
