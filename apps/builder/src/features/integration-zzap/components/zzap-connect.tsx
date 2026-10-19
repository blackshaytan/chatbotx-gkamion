"use client"

import { InputField } from "@chatbotx.io/ui/components/form/input-field"
import { SwitchField } from "@chatbotx.io/ui/components/form/switch-field"
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
import { useHookFormAction } from "@next-safe-action/adapter-react-hook-form/hooks"
import { Loader2Icon } from "lucide-react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import type { ReactElement, ReactNode } from "react"
import { useState } from "react"
import { toast } from "sonner"
import { useInvalidateInboxes } from "@/features/inboxes/provider/inbox-hook"
import { connectZzapAction } from "../actions/connect.action"
import { connectZzapRequest } from "../schema/request"

type ConnectStepProps = {
  index: number
  children: ReactNode
}

const ConnectStep = ({ index, children }: ConnectStepProps) => (
  <li className="flex items-start gap-3">
    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted font-medium text-muted-foreground text-sm">
      {index}
    </span>
    <span className="text-muted-foreground text-sm">{children}</span>
  </li>
)

type ZzapConnectProps = {
  workspaceId: string
  children?: ReactElement
  autoOpen?: boolean
}

export const ZzapConnect = ({
  workspaceId,
  children,
  autoOpen = false,
}: ZzapConnectProps) => {
  const t = useTranslations()
  const router = useRouter()
  const invalidateInboxes = useInvalidateInboxes()
  const [open, setOpen] = useState(autoOpen)

  const { form, handleSubmitWithAction } = useHookFormAction(
    connectZzapAction.bind(null, workspaceId),
    zodResolver(connectZzapRequest),
    {
      actionProps: {
        onSuccess: () => {
          setOpen(false)
          invalidateInboxes()
          router.push(`/space/${workspaceId}/settings/channels/zzap`)
        },
        onError: ({ error }) => {
          if (error.serverError) {
            toast.error(error.serverError)
          }
        },
      },
      formProps: {
        mode: "onChange",
        defaultValues: {
          secretText: "",
          codeObject: "",
          typeObject: "",
          testMode: false,
        },
      },
    },
  )

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger render={children} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t("actions.addFeature", { feature: t("fields.zzap.label") })}
          </DialogTitle>
          <DialogDescription
            render={
              <ol className="mt-2 flex list-none flex-col gap-3">
                <ConnectStep index={1}>
                  {t("fields.zzap.connectInstructions.step1")}
                </ConnectStep>
                <ConnectStep index={2}>
                  {t("fields.zzap.connectInstructions.step2")}
                </ConnectStep>
              </ol>
            }
          />
        </DialogHeader>
        <Form {...form}>
          <form
            className="flex flex-col gap-4"
            onSubmit={handleSubmitWithAction}
          >
            <InputField
              autoComplete="off"
              label={t("fields.zzap.apiKey")}
              name="secretText"
              required
              type="password"
            />
            <InputField
              autoComplete="off"
              label={t("fields.zzap.codeObject")}
              name="codeObject"
              required
            />
            <InputField
              autoComplete="off"
              label={t("fields.zzap.typeObject")}
              name="typeObject"
              required
            />
            <SwitchField
              description={t("fields.zzap.testModeHint")}
              label={t("fields.zzap.testMode")}
              name="testMode"
            />
            <DialogFooter>
              <DialogClose
                render={
                  <Button type="button" variant="secondary">
                    {t("actions.cancel")}
                  </Button>
                }
              />
              <Button
                disabled={
                  !form.formState.isValid || form.formState.isSubmitting
                }
                type="submit"
              >
                {form.formState.isSubmitting && (
                  <Loader2Icon className="animate-spin" />
                )}
                {t("actions.connect")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
