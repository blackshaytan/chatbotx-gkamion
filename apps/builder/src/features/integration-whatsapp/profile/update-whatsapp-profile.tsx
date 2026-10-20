"use client"

import { InputField } from "@chatbotx.io/ui/components/form/input-field"
import { Button } from "@chatbotx.io/ui/components/ui/button"
import { Form } from "@chatbotx.io/ui/components/ui/form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useHookFormAction } from "@next-safe-action/adapter-react-hook-form/hooks"
import { useTranslations } from "next-intl"
import { updateWhatsappProfileAction } from "./actions/update-whatsapp-profile.action"
import { updateWhatsappProfileRequest } from "./schema/update-whatsapp-profile.request"

export function UpdateWhatsappProfile({
  workspaceId,
}: {
  workspaceId: string
}) {
  const t = useTranslations()

  const { form, handleSubmitWithAction } = useHookFormAction(
    updateWhatsappProfileAction.bind(null, workspaceId),
    zodResolver(updateWhatsappProfileRequest),
    {
      actionProps: {},
      formProps: {},
      errorMapProps: {},
    },
  )

  return (
    <Form {...form}>
      <form className="flex flex-col gap-2" onSubmit={handleSubmitWithAction}>
        <InputField label={t("whatsapp.profile.about")} name="about" />
        <InputField label={t("fields.description.label")} name="description" />
        <InputField label={t("whatsapp.profile.address")} name="address" />
        <InputField label={t("fields.email.label")} name="email" />
        <InputField
          label={t("whatsapp.profile.websiteUrl")}
          name="websiteUrl"
        />

        <div className="flex w-full justify-center">
          <Button>{t("actions.confirm")}</Button>
        </div>
      </form>
    </Form>
  )
}
