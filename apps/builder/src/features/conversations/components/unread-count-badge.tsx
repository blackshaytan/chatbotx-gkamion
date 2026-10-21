"use client"

import { cn } from "@chatbotx.io/ui/lib/utils"
import { useTranslations } from "next-intl"
import { formatUnreadBadge } from "../lib/unread-badge"

/**
 * Unread client messages on a conversation row. Red while the bot is off (a
 * manager is needed), gray while the bot answers. Hidden at zero.
 */
export function UnreadCountBadge({
  count,
  isBotActive,
}: {
  count: number
  isBotActive: boolean
}) {
  const t = useTranslations()

  // `!(count > 0)` also hides rows that predate the field (undefined).
  if (!(count > 0)) {
    return null
  }

  const label = formatUnreadBadge(count)

  return (
    <span
      aria-label={t("inboxAttention.unreadCount", { count: label })}
      className={cn(
        "inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 font-semibold text-[10px] text-white leading-none",
        isBotActive ? "bg-zinc-400 dark:bg-zinc-500" : "bg-red-600",
      )}
      role="img"
    >
      {label}
    </span>
  )
}
