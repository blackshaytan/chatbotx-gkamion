"use client"

import type { TaskNotificationType } from "@chatbotx.io/database/partials"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@chatbotx.io/ui/components/ui/dialog"
import { Switch } from "@chatbotx.io/ui/components/ui/switch"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { orpc } from "@/lib/orpc/query"
import type { NotificationPreferences } from "../schema/resource"

const preferenceTypes = [
  "taskAssigned",
  "taskMentioned",
  "taskCommented",
  "taskStatusChanged",
  "taskDueChanged",
  "taskReminder",
  "taskOverdue",
] as const satisfies readonly TaskNotificationType[]

const preferenceLabelKeyByType = {
  taskAssigned: "taskAssigned.label",
  taskMentioned: "taskMentioned.label",
  taskCommented: "taskCommented.label",
  taskStatusChanged: "taskStatusChanged.label",
  taskDueChanged: "taskDueChanged.label",
  taskReminder: "taskReminder.label",
  taskOverdue: "taskOverdue.label",
} as const satisfies Record<TaskNotificationType, string>

const preferenceDescriptionKeyByType = {
  taskAssigned: "taskAssigned.description",
  taskMentioned: "taskMentioned.description",
  taskCommented: "taskCommented.description",
  taskStatusChanged: "taskStatusChanged.description",
  taskDueChanged: "taskDueChanged.description",
  taskReminder: "taskReminder.description",
  taskOverdue: "taskOverdue.description",
} as const satisfies Record<TaskNotificationType, string>

type NotificationSettingsDialogProps = {
  onOpenChange: (open: boolean) => void
  open: boolean
  workspaceId: string
}

export const NotificationSettingsDialog = ({
  onOpenChange,
  open,
  workspaceId,
}: NotificationSettingsDialogProps) => {
  const t = useTranslations("notifications.settings")
  const commonT = useTranslations()
  const queryClient = useQueryClient()
  const preferencesQuery = orpc.notificationsAPI.getPreferences.queryOptions({
    input: { workspaceId },
    enabled: open,
  })
  const { data: preferences } = useQuery(preferencesQuery)
  const updateMutation = useMutation(
    orpc.notificationsAPI.updatePreferences.mutationOptions({
      onError: (_error, _variables, context) => {
        if (context?.previous) {
          queryClient.setQueryData(preferencesQuery.queryKey, context.previous)
        }
        toast.error(t("saveFailed"))
      },
      onMutate: async (variables) => {
        await queryClient.cancelQueries({ queryKey: preferencesQuery.queryKey })
        const previous = queryClient.getQueryData<NotificationPreferences>(
          preferencesQuery.queryKey,
        )
        queryClient.setQueryData<NotificationPreferences>(
          preferencesQuery.queryKey,
          (current) =>
            ({
              ...(current ?? previous),
              ...variables.patch,
            }) as NotificationPreferences,
        )
        return { previous }
      },
      onSettled: async () => {
        await queryClient.invalidateQueries({
          queryKey: orpc.notificationsAPI.key(),
        })
      },
    }),
  )

  const handleToggle = (type: TaskNotificationType, checked: boolean) => {
    updateMutation.mutate({
      workspaceId,
      patch: { [type]: checked },
    })
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <div className="divide-y">
          {preferenceTypes.map((type) => (
            <div className="flex items-center gap-4 py-3" key={type}>
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {t(preferenceLabelKeyByType[type])}
                </p>
                <p className="text-muted-foreground text-sm">
                  {t(preferenceDescriptionKeyByType[type])}
                </p>
              </div>
              <Switch
                aria-label={t(preferenceLabelKeyByType[type])}
                checked={preferences?.[type] ?? true}
                disabled={!preferences}
                onCheckedChange={(checked) => handleToggle(type, checked)}
              />
            </div>
          ))}
        </div>
        <p className="rounded-md bg-muted p-3 text-muted-foreground text-sm">
          {t("channelNotice")}
        </p>
        {preferences ? null : (
          <span className="sr-only">{commonT("actions.loading")}</span>
        )}
      </DialogContent>
    </Dialog>
  )
}
