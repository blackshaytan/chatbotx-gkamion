"use client"

import { InputField } from "@chatbotx.io/ui/components/form/input-field"
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
import { useHookFormAction } from "@next-safe-action/adapter-react-hook-form/hooks"
import { Loader2Icon } from "lucide-react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import type { ReactElement, ReactNode } from "react"
import { useState } from "react"
import { toast } from "sonner"
import { useInvalidateInboxes } from "@/features/inboxes/provider/inbox-hook"
import { connectDromAction } from "../actions/connect.action"
import { connectDromRequest } from "../schema/request"

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

type DromConnectMode = "connect" | "updateCookies"

type DromConnectProps = {
  workspaceId: string
  children?: ReactElement
  autoOpen?: boolean
  /** `updateCookies` reconnects the same seller; the login is fixed. */
  mode?: DromConnectMode
  defaultSellerLogin?: string
}

const CONNECT_STEPS = [1, 2, 3] as const

export const DromConnect = ({
  workspaceId,
  children,
  autoOpen = false,
  mode = "connect",
  defaultSellerLogin = "",
}: DromConnectProps) => {
  const t = useTranslations()
  const router = useRouter()
  const invalidateInboxes = useInvalidateInboxes()
  const [open, setOpen] = useState(autoOpen)
  const isUpdate = mode === "updateCookies"

  const { form, handleSubmitWithAction } = useHookFormAction(
    connectDromAction.bind(null, workspaceId),
    zodResolver(connectDromRequest),
    {
      actionProps: {
        onSuccess: () => {
          setOpen(false)
          form.reset({ secretText: "", sellerLogin: defaultSellerLogin })
          invalidateInboxes()
          router.push(`/space/${workspaceId}/settings/channels/drom`)
          router.refresh()
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
          sellerLogin: defaultSellerLogin,
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
            {isUpdate
              ? t("fields.drom.updateCookies")
              : t("actions.addFeature", { feature: t("fields.drom.label") })}
          </DialogTitle>
          <DialogDescription
            render={
              <ol className="mt-2 flex list-none flex-col gap-3">
                {CONNECT_STEPS.map((step) => (
                  <ConnectStep index={step} key={step}>
                    {t(`fields.drom.connectInstructions.step${step}`)}
                  </ConnectStep>
                ))}
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
              label={t("fields.drom.sellerLogin")}
              name="sellerLogin"
              readOnly={isUpdate}
              required
            />
            <TextareaField
              autoComplete="off"
              className="font-mono text-xs"
              description={t("fields.drom.cookiesHint")}
              label={t("fields.drom.cookies")}
              name="secretText"
              required
              rows={5}
              spellCheck={false}
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
                {isUpdate ? t("actions.save") : t("actions.connect")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
