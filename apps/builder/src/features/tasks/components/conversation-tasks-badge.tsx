"use client"

import { Button } from "@chatbotx.io/ui/components/ui/button"
import { useQuery } from "@tanstack/react-query"
import { ListChecksIcon } from "lucide-react"
import Link from "next/link"
import { useTranslations } from "next-intl"
import { orpc } from "@/lib/orpc/query"

type ConversationTasksBadgeProps = {
  workspaceId: string
  conversationId: string
}

export const ConversationTasksBadge = ({
  workspaceId,
  conversationId,
}: ConversationTasksBadgeProps) => {
  const t = useTranslations("tasks")
  const { data } = useQuery(
    orpc.tasksAPI.count.queryOptions({
      input: {
        workspaceId,
        conversationId,
        status: "open",
        tab: "all",
      },
    }),
  )
  const total = data?.total ?? 0

  if (total === 0) {
    return null
  }

  return (
    <Button
      aria-label={t("openCount", { count: total })}
      nativeButton={false}
      render={
        <Link
          href={`/space/${workspaceId}/tasks?tab=all&conversationId=${conversationId}`}
        />
      }
      size="sm"
      variant="ghost"
    >
      <ListChecksIcon aria-hidden="true" />
      {total}
    </Button>
  )
}
