"use client"

import type { ConversationHandoverCategory } from "@chatbotx.io/database/partials"
import { useTranslations } from "next-intl"
import { HANDOVER_CATEGORY_META } from "../lib/handover-category"

/** Compact "emoji + label" tag of why the agent handed a conversation to a manager. */
export function HandoverCategoryPill({
  category,
}: {
  category: ConversationHandoverCategory
}) {
  const t = useTranslations()
  const { emoji, labelKey } = HANDOVER_CATEGORY_META[category]

  return (
    <span className="shrink-0 rounded-full border bg-muted px-1.5 text-[10px] text-muted-foreground leading-4">
      {emoji} {t(labelKey)}
    </span>
  )
}
