"use client"

import { Button } from "@chatbotx.io/ui/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@chatbotx.io/ui/components/ui/dialog"
import { Input } from "@chatbotx.io/ui/components/ui/input"
import { CopyIcon } from "lucide-react"
import { useTranslations } from "next-intl"
import { useClipboard } from "@/hooks/use-clipboard"

export type TemporaryPasswordReveal = {
  email: string
  password: string
}

type TemporaryPasswordDialogProps = {
  reveal: TemporaryPasswordReveal | null
  onClose: () => void
}

/** Shows a temporary password exactly once — only its hash is stored. */
export const TemporaryPasswordDialog = ({
  reveal,
  onClose,
}: TemporaryPasswordDialogProps) => {
  const t = useTranslations()
  const { handleCopy } = useClipboard()

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      onClose()
    }
  }

  const handleCopyClick = () => {
    if (reveal) {
      handleCopy(reveal.password)
    }
  }

  return (
    <Dialog onOpenChange={handleOpenChange} open={reveal !== null}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {t("platformAdmin.users.passwordReveal.title")}
          </DialogTitle>
          <DialogDescription>
            {t("platformAdmin.users.passwordReveal.description", {
              email: reveal?.email ?? "",
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <Input
            aria-label={t("platformAdmin.users.passwordReveal.title")}
            className="font-mono text-sm"
            readOnly
            value={reveal?.password ?? ""}
          />
          <Button
            aria-label={t("actions.copy")}
            onClick={handleCopyClick}
            size="icon"
            type="button"
            variant="outline"
          >
            <CopyIcon className="h-4 w-4" />
          </Button>
        </div>

        <DialogFooter>
          <Button onClick={onClose} type="button">
            {t("platformAdmin.users.passwordReveal.done")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
