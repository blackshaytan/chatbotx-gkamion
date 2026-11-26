"use client"

import { SelectField } from "@chatbotx.io/ui/components/form/select-field"
import { useTranslations } from "next-intl"
import { useMemo } from "react"
import { useFormContext } from "react-hook-form"
import { useWorkspaceMembers } from "@/features/users/provider/user-hook"

const SHARED_OWNER_VALUE = "shared"

type SmtpOwnerFieldProps = {
  readonly workspaceId: string
}

/**
 * Super-admin-only picker for the personal owner of an SMTP mailbox. The form
 * holds `null` for a shared mailbox; the option value is a placeholder that is
 * never submitted.
 */
export const SmtpOwnerField = ({ workspaceId }: SmtpOwnerFieldProps) => {
  const t = useTranslations()
  const form = useFormContext()
  const { data: workspaceMembers = [] } = useWorkspaceMembers(workspaceId)
  const ownerUserId: string | null | undefined = form.watch("ownerUserId")

  const ownerOptions = useMemo(
    () => [
      { value: SHARED_OWNER_VALUE, label: t("smtp.owner.shared") },
      ...workspaceMembers.flatMap((member) =>
        member.user?.id
          ? [{ value: member.user.id, label: member.user.name ?? "--" }]
          : [],
      ),
    ],
    [workspaceMembers, t],
  )

  const handleOwnerChange = (value?: string) => {
    form.setValue(
      "ownerUserId",
      value && value !== SHARED_OWNER_VALUE ? value : null,
    )
  }

  return (
    <SelectField
      description={t("smtp.owner.description")}
      label={t("smtp.owner.label")}
      name="ownerUserId"
      options={ownerOptions}
      triggerValueChange={handleOwnerChange}
      value={ownerUserId ?? SHARED_OWNER_VALUE}
    />
  )
}
