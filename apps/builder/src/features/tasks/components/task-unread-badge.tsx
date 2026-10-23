import { useTranslations } from "next-intl"

type TaskUnreadBadgeProps = {
  count: number
}

export const TaskUnreadBadge = ({ count }: TaskUnreadBadgeProps) => {
  const t = useTranslations("tasks")

  if (count <= 0) {
    return null
  }

  return (
    <span
      aria-label={t("feed.unread", { count })}
      className="inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 py-0.5 font-medium text-primary-foreground text-xs"
      role="status"
    >
      {count > 99 ? "99+" : count}
    </span>
  )
}
