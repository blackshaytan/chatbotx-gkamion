"use client"

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@chatbotx.io/ui/components/ui/popover"
import {
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@chatbotx.io/ui/components/ui/sidebar"
import { useMutation, useQuery } from "@tanstack/react-query"
import { BellIcon } from "lucide-react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { useState } from "react"
import { toast } from "sonner"
import { orpc } from "@/lib/orpc/query"
import { useInvalidateNotifications } from "../hooks/use-invalidate-notifications"
import type { NotificationItem } from "../schema/resource"
import { NotificationList } from "./notification-list"

const toNavigationTarget = (url: string): string => {
  const parsed = new URL(url, window.location.origin)
  if (parsed.origin !== window.location.origin) {
    return url
  }
  return `${parsed.pathname}${parsed.search}${parsed.hash}`
}

export const NotificationBell = ({ workspaceId }: { workspaceId: string }) => {
  const t = useTranslations("notifications")
  const commonT = useTranslations()
  const router = useRouter()
  const { isMobile } = useSidebar()
  const invalidateNotifications = useInvalidateNotifications()
  const [open, setOpen] = useState(false)
  const { data: unreadCount } = useQuery(
    orpc.notificationsAPI.countUnread.queryOptions({
      input: { workspaceId },
    }),
  )
  const { data: notifications, isPending } = useQuery(
    orpc.notificationsAPI.list.queryOptions({
      input: { workspaceId, limit: 20 },
    }),
  )
  const markReadMutation = useMutation(
    orpc.notificationsAPI.markRead.mutationOptions({
      onSuccess: () => invalidateNotifications(),
    }),
  )
  const markAllReadMutation = useMutation(
    orpc.notificationsAPI.markAllRead.mutationOptions({
      onError: () => toast.error(commonT("messages.unknownError")),
      onSuccess: () => invalidateNotifications(),
    }),
  )
  const total = unreadCount?.total ?? 0
  const badge = total > 99 ? "99+" : String(total)

  const handleSelect = async (item: NotificationItem) => {
    if (!item.readAt) {
      try {
        await markReadMutation.mutateAsync({
          workspaceId,
          ids: [item.id],
        })
      } catch {
        toast.error(commonT("messages.unknownError"))
      }
    }
    setOpen(false)
    router.push(toNavigationTarget(item.url))
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <Popover onOpenChange={setOpen} open={open}>
          <PopoverTrigger
            render={
              <SidebarMenuButton
                aria-label={t("bellAriaLabel", { count: total })}
                className="h-9"
                tooltip={t("title")}
              >
                <BellIcon />
                <span>{t("title")}</span>
              </SidebarMenuButton>
            }
          />
          {total > 0 ? <SidebarMenuBadge>{badge}</SidebarMenuBadge> : null}
          <PopoverContent
            align="start"
            className="w-[min(24rem,calc(100vw-2rem))] p-0"
            side={isMobile ? "top" : "right"}
            sideOffset={8}
          >
            <NotificationList
              items={notifications?.data ?? []}
              loading={isPending}
              onMarkAllRead={() => markAllReadMutation.mutate({ workspaceId })}
              onSelect={handleSelect}
              workspaceId={workspaceId}
            />
          </PopoverContent>
        </Popover>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
