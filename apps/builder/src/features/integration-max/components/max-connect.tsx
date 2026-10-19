"use client"

import { InputField } from "@chatbotx.io/ui/components/form/input-field"
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
import { connectMaxAction } from "../actions/connect.action"
import { connectMaxRequest } from "../schema/request"

const MAX_BUSINESS_URL = "https://business.max.ru/"

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

type MaxConnectProps = {
  workspaceId: string
  children?: ReactElement
  autoOpen?: boolean
}

export const MaxConnect = ({
  workspaceId,
  children,
  autoOpen = false,
}: MaxConnectProps) => {
  const t = useTranslations()
  const router = useRouter()
  const invalidateInboxes = useInvalidateInboxes()
  const [open, setOpen] = useState(autoOpen)

  const { form, handleSubmitWithAction } = useHookFormAction(
    connectMaxAction.bind(null, workspaceId),
    zodResolver(connectMaxRequest),
    {
      actionProps: {
        onSuccess: () => {
          setOpen(false)
          invalidateInboxes()
          router.push(`/space/${workspaceId}/settings/channels/max`)
        },
        onError: ({ error }) => {
          if (error.serverError) {
            toast.error(error.serverError)
          }
        },
      },
      formProps: {
        mode: "onChange",
        defaultValues: { botToken: "" },
      },
    },
  )

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger render={children} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t("actions.addFeature", { feature: t("fields.max.label") })}
          </DialogTitle>
          <DialogDescription
            render={
              <ol className="mt-2 flex list-none flex-col gap-3">
                <ConnectStep index={1}>
                  {t.rich("fields.max.connectInstructions.step1", {
                    link: (chunks) => (
                      <a
                        className="text-primary underline underline-offset-2"
                        href={MAX_BUSINESS_URL}
                        rel="noopener noreferrer"
                        target="_blank"
                      >
                        {chunks}
                      </a>
                    ),
                  })}
                </ConnectStep>
                <ConnectStep index={2}>
                  {t.rich("fields.max.connectInstructions.step2", {
                    strong: (chunks) => (
                      <strong className="font-semibold">{chunks}</strong>
                    ),
                  })}
                </ConnectStep>
                <ConnectStep index={3}>
                  {t("fields.max.connectInstructions.step3")}
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
              label={t("fields.max.botToken")}
              name="botToken"
              required
              type="password"
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
