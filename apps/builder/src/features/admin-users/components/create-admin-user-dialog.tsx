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
import { Loader2Icon, PlusIcon } from "lucide-react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { useState } from "react"
import { toast } from "sonner"
import { createAdminUserAction } from "../actions/create-admin-user.action"
import { createAdminUserRequest } from "../schema/mutation"
import {
  TemporaryPasswordDialog,
  type TemporaryPasswordReveal,
} from "./temporary-password-dialog"

export const CreateAdminUserDialog = () => {
  const t = useTranslations()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [reveal, setReveal] = useState<TemporaryPasswordReveal | null>(null)

  const { form, handleSubmitWithAction, resetFormAndAction } =
    useHookFormAction(
      createAdminUserAction,
      zodResolver(createAdminUserRequest),
      {
        actionProps: {
          onSuccess: ({ data, input }) => {
            setOpen(false)
            resetFormAndAction()
            if (data) {
              setReveal({
                email: input.email,
                password: data.temporaryPassword,
              })
            }
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
          defaultValues: { name: "", email: "" },
        },
      },
    )

  const handleRevealClose = () => {
    setReveal(null)
  }

  return (
    <>
      <Dialog onOpenChange={setOpen} open={open}>
        <DialogTrigger
          render={
            <Button size="sm">
              <PlusIcon />
              {t("platformAdmin.users.create")}
            </Button>
          }
        />
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("platformAdmin.users.create")}</DialogTitle>
            <DialogDescription>
              {t("platformAdmin.users.createDescription")}
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form
              className="flex flex-col gap-4"
              onSubmit={handleSubmitWithAction}
            >
              <InputField label={t("fields.name.label")} name="name" required />
              <InputField
                label={t("fields.email.label")}
                name="email"
                required
                type="email"
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
                  {t("actions.create")}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
      <TemporaryPasswordDialog onClose={handleRevealClose} reveal={reveal} />
    </>
  )
}
