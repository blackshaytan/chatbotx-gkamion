"use client"

import type { TypingStepSchema } from "@chatbotx.io/flow-config"
import { useTranslations } from "next-intl"

type TypingStepViewerProps = {
  data: TypingStepSchema
}

export default function TypingStepViewer(props: TypingStepViewerProps) {
  const t = useTranslations()

  return (
    <div className="text-muted-foreground text-sm">
      {t("flows.viewer.typing", { seconds: props.data.seconds })}
    </div>
  )
}
