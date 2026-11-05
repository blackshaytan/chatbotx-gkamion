"use client"

import {
  type SendOrderNotificationStepSchema,
  sendOrderNotificationStepSchema,
} from "@chatbotx.io/flow-config"
import { InputField } from "@chatbotx.io/ui/components/form/input-field"
import { SelectField } from "@chatbotx.io/ui/components/form/select-field"
import { TextareaField } from "@chatbotx.io/ui/components/form/textarea-field"
import { Button } from "@chatbotx.io/ui/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@chatbotx.io/ui/components/ui/dialog"
import { Form } from "@chatbotx.io/ui/components/ui/form"
import { zodResolver } from "@hookform/resolvers/zod"
import { MessagesSquareIcon } from "lucide-react"
import { useTranslations } from "next-intl"
import { useState } from "react"
import { useForm, useFormContext } from "react-hook-form"
import { z } from "zod"
import { BaseStepEditor } from "../base/editor"

const STATUS_ID_SEPARATOR = /[,\s]+/
const WHOLE_NUMBER = /^-?\d+$/

const parseStatusIds = (value: string): number[] | null => {
  const parts = value.split(STATUS_ID_SEPARATOR).filter(Boolean)
  if (parts.length === 0 || parts.length > 50) {
    return null
  }
  const ids: number[] = []
  for (const part of parts) {
    if (!WHOLE_NUMBER.test(part)) {
      return null
    }
    const id = Number(part)
    if (!Number.isSafeInteger(id)) {
      return null
    }
    ids.push(id)
  }
  return ids
}

const SendOrderNotificationStepEditor = ({
  parentName,
}: {
  parentName: string
}) => {
  const t = useTranslations()
  return (
    <BaseStepEditor
      icon={MessagesSquareIcon}
      title={t("flows.actions.sendOrderNotification")}
    >
      <SendOrderNotificationStepDialog parentName={parentName} />
    </BaseStepEditor>
  )
}

const SendOrderNotificationStepDialog = ({
  parentName,
}: {
  parentName: string
}) => {
  const t = useTranslations()
  const [open, setOpen] = useState(false)
  const { setValue, getValues } = useFormContext()
  const formSchema = z.object({
    subject: z.enum(["order", "item"]),
    statusIds: z.string().refine((value) => parseStatusIds(value) !== null, {
      message: t("fields.orderNotification.statusIds.invalid"),
    }),
    messengerText: sendOrderNotificationStepSchema.shape.messengerText,
    emailText: sendOrderNotificationStepSchema.shape.emailText,
    emailSubject: sendOrderNotificationStepSchema.shape.emailSubject,
  })

  const form = useForm<
    z.input<typeof formSchema>,
    unknown,
    z.output<typeof formSchema>
  >({
    resolver: zodResolver(formSchema),
    defaultValues: dialogValues(
      getValues(parentName) as SendOrderNotificationStepSchema,
    ),
    mode: "onChange",
  })

  const onSubmit = (data: z.output<typeof formSchema>) => {
    const statusIds = parseStatusIds(data.statusIds)
    if (!statusIds) {
      return
    }
    setValue(`${parentName}.subject`, data.subject, { shouldDirty: true })
    setValue(`${parentName}.statusIds`, statusIds, { shouldDirty: true })
    setValue(`${parentName}.messengerText`, data.messengerText, {
      shouldDirty: true,
    })
    setValue(`${parentName}.emailText`, data.emailText, { shouldDirty: true })
    setValue(`${parentName}.emailSubject`, data.emailSubject, {
      shouldDirty: true,
    })
    setOpen(false)
  }

  return (
    <Dialog
      onOpenChange={(next) => {
        setOpen(next)
        if (next) {
          form.reset(
            dialogValues(
              getValues(parentName) as SendOrderNotificationStepSchema,
            ),
          )
        }
      }}
      open={open}
    >
      <DialogTrigger
        render={
          <div className="flex justify-center">
            <Button size="sm" type="button" variant="outline">
              {t("actions.edit")}
            </Button>
          </div>
        }
      />
      <DialogContent className="max-h-screen max-w-lg overflow-y-scroll">
        <DialogHeader>
          <DialogTitle>{t("flows.actions.sendOrderNotification")}</DialogTitle>
          <DialogDescription>
            {t("fields.orderNotification.description")}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            className="flex w-full flex-col gap-4"
            onSubmit={form.handleSubmit(onSubmit)}
          >
            <SelectField
              label={t("fields.orderNotification.subject.label")}
              name="subject"
              options={[
                {
                  label: t("fields.orderNotification.subject.order"),
                  value: "order",
                },
                {
                  label: t("fields.orderNotification.subject.item"),
                  value: "item",
                },
              ]}
              required
            />
            <InputField
              description={t("fields.orderNotification.statusIds.description")}
              label={t("fields.orderNotification.statusIds.label")}
              name="statusIds"
              placeholder={t("fields.orderNotification.statusIds.placeholder")}
              required
            />
            <TextareaField
              description={t(
                "fields.orderNotification.messengerText.description",
              )}
              label={t("fields.orderNotification.messengerText.label")}
              name="messengerText"
            />
            <TextareaField
              description={t("fields.orderNotification.emailText.description")}
              label={t("fields.orderNotification.emailText.label")}
              name="emailText"
            />
            <InputField
              description={t(
                "fields.orderNotification.emailSubject.description",
              )}
              label={t("fields.orderNotification.emailSubject.label")}
              name="emailSubject"
            />

            <DialogFooter>
              <DialogClose
                render={
                  <Button size="sm" variant="ghost">
                    {t("actions.cancel")}
                  </Button>
                }
              />
              <Button
                disabled={
                  !form.formState.isValid || form.formState.isSubmitting
                }
                size="sm"
                type="submit"
              >
                {t("actions.save")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

const dialogValues = (step: SendOrderNotificationStepSchema) => ({
  subject: step.subject ?? "order",
  statusIds: (step.statusIds ?? []).join(", "),
  messengerText: step.messengerText ?? "",
  emailText: step.emailText ?? "",
  emailSubject: step.emailSubject ?? "",
})

export default SendOrderNotificationStepEditor
