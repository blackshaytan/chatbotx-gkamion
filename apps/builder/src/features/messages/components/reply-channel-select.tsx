"use client"

import type { ChannelType } from "@chatbotx.io/database/partials"
import { Button } from "@chatbotx.io/ui/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@chatbotx.io/ui/components/ui/dropdown-menu"
import { useQuery } from "@tanstack/react-query"
import { ChevronDownIcon } from "lucide-react"
import { useTranslations } from "next-intl"
import { InboxIcon } from "@/features/inboxes/components/inbox-icon"
import { orpc } from "@/lib/orpc/query"

export type ReplyChannelOption = {
  inboxId: string
  channel: ChannelType
  name: string
  needsBootstrap: boolean
}

export const useReplyChannelsQuery = (props: {
  workspaceId: string
  conversationId: string
  enabled: boolean
}) =>
  useQuery({
    ...orpc.conversationsAPI.replyChannels.queryOptions({
      input: {
        workspaceId: props.workspaceId,
        id: props.conversationId,
      },
    }),
    enabled: props.enabled,
  })

type ReplyChannelSelectProps = {
  options: ReplyChannelOption[]
  selectedInboxId: string
  onSelect: (inboxId: string) => void
}

export const ReplyChannelSelect = ({
  options,
  selectedInboxId,
  onSelect,
}: ReplyChannelSelectProps) => {
  const t = useTranslations("messages.input")
  const selected =
    options.find((option) => option.inboxId === selectedInboxId) ?? options[0]

  if (!selected) {
    return null
  }

  const resolveLabel = (option: ReplyChannelOption) =>
    option.channel === "smtp"
      ? t("replyChannelEmail")
      : (option.name ?? option.channel)

  const selectedLabel = resolveLabel(selected)

  if (options.length === 1) {
    return (
      <InboxIcon
        channel={selected.channel}
        label={selectedLabel}
        size="small"
      />
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            aria-label={t("replyChannel")}
            className="h-auto gap-1 px-1.5 py-1"
            type="button"
            variant="ghost"
          >
            <InboxIcon
              channel={selected.channel}
              label={selectedLabel}
              size="small"
            />
            <ChevronDownIcon aria-hidden="true" className="size-3.5 shrink-0" />
          </Button>
        }
      />
      <DropdownMenuContent align="start">
        {options.map((option) => (
          <DropdownMenuItem
            key={option.inboxId}
            onClick={() => onSelect(option.inboxId)}
          >
            <InboxIcon
              channel={option.channel}
              label={resolveLabel(option)}
              size="small"
            />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
