"use client"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@chatbotx.io/ui/components/ui/alert-dialog"
import { Button } from "@chatbotx.io/ui/components/ui/button"
import { KeyRoundIcon } from "lucide-react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { useAction } from "next-safe-action/hooks"
import { useState } from "react"
import { toast } from "sonner"
import { resetAdminUserPasswordAction } from "../actions/reset-admin-user-password.action"
import {
  TemporaryPasswordDialog,
  type TemporaryPasswordReveal,
} from "./temporary-password-dialog"

type ResetAdminUserPasswordButtonProps = {
  userId: string
  email: string
}

export const ResetAdminUserPasswordButton = ({
  userId,
  email,
}: ResetAdminUserPasswordButtonProps) => {
  const t = useTranslations()
  const router = useRouter()
  const [reveal, setReveal] = useState<TemporaryPasswordReveal | null>(null)

  const { execute, isPending } = useAction(resetAdminUserPasswordAction, {
    onSuccess: ({ data }) => {
      if (data) {
        setReveal({ email, password: data.temporaryPassword })
      }
      router.refresh()
    },
    onError: ({ error }) => {
      if (error.serverError) {
        toast.error(error.serverError)
      }
    },
  })

  const handleConfirm = () => {
    execute({ userId })
  }

  const handleRevealClose = () => {
    setReveal(null)
  }

  return (
    <>
      <AlertDialog>
        <AlertDialogTrigger
          render={
            <Button disabled={isPending} size="sm" variant="outline">
              <KeyRoundIcon />
              {t("platformAdmin.users.resetPassword")}
            </Button>
          }
        />
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("platformAdmin.users.resetConfirmTitle", { email })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("platformAdmin.users.resetConfirmDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm}>
              {t("platformAdmin.users.resetPassword")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <TemporaryPasswordDialog onClose={handleRevealClose} reveal={reveal} />
    </>
  )
}
