"use client"

import type { TaskPriority } from "@chatbotx.io/database/partials"
import { ComboboxField } from "@chatbotx.io/ui/components/form/combobox-field"
import { DateTimePickerField } from "@chatbotx.io/ui/components/form/date-picker-field"
import { InputField } from "@chatbotx.io/ui/components/form/input-field"
import { MultiSelectField } from "@chatbotx.io/ui/components/form/multi-select-field"
import { SelectField } from "@chatbotx.io/ui/components/form/select-field"
import { TextareaField } from "@chatbotx.io/ui/components/form/textarea-field"
import { Button } from "@chatbotx.io/ui/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@chatbotx.io/ui/components/ui/dialog"
import { Form } from "@chatbotx.io/ui/components/ui/form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation } from "@tanstack/react-query"
import { Loader2Icon } from "lucide-react"
import { useTranslations } from "next-intl"
import { type ReactElement, useMemo, useState } from "react"
import { useForm, useWatch } from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"
import {
  useContactAssigneeMultiSelectOptions,
  useContactAssigneeOptions,
} from "@/features/users/provider/user-hook"
import { orpc } from "@/lib/orpc/query"
import { useInvalidateTasks } from "../hooks/use-invalidate-tasks"
import { extractApiErrorMessage } from "../lib/extract-api-error-message"
import {
  REMINDER_PRESETS,
  type ReminderPreset,
  remindAtFromPreset,
} from "../lib/reminder-presets"
import { parseTaskAssigneeValue } from "../lib/task-assignee"
import type { taskPublicResource } from "../schema/public"

type CreateTaskDialogProps = {
  workspaceId: string
  defaultTargets?: {
    contactId?: string
    contactLabel?: string
    conversationId?: string
  }
  trigger?: ReactElement
  onCreated?: (task: z.infer<typeof taskPublicResource>) => void
}

type CreateTaskFormValues = {
  title: string
  description: string
  assignee: string
  watcherValues: string[]
  dueAt?: string
  remindAt?: string
  priority: TaskPriority
}

const defaultFormValues: CreateTaskFormValues = {
  title: "",
  description: "",
  assignee: "",
  watcherValues: [],
  dueAt: undefined,
  remindAt: undefined,
  priority: "normal",
}

const priorityLabelKeyByPriority = {
  low: "priority.low",
  normal: "priority.normal",
  high: "priority.high",
  urgent: "priority.urgent",
} as const satisfies Record<TaskPriority, string>

const reminderLabelKeyByPreset = {
  min15: "reminder.min15",
  hour1: "reminder.hour1",
  day1: "reminder.day1",
} as const satisfies Record<ReminderPreset, string>

const taskAssigneePattern = /^[ut]_.+/

const toDate = (value: string | undefined) => {
  if (!value) {
    return
  }

  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}

export const CreateTaskDialog = ({
  workspaceId,
  defaultTargets,
  trigger,
  onCreated,
}: CreateTaskDialogProps) => {
  const t = useTranslations("tasks")
  const commonT = useTranslations()
  const [open, setOpen] = useState(false)
  const assigneeOptions = useContactAssigneeOptions({ enabled: open })
  const assigneeMultiSelectOptions = useContactAssigneeMultiSelectOptions()
  const invalidateTasks = useInvalidateTasks()
  const createTaskFormSchema = useMemo(
    () =>
      z.object({
        title: z.string().trim().min(1, t("validation.titleRequired")),
        description: z.string().trim(),
        assignee: z
          .string()
          .regex(taskAssigneePattern, t("validation.assigneeRequired")),
        watcherValues: z.array(z.string()),
        dueAt: z.string().optional(),
        remindAt: z.string().optional(),
        priority: z.enum(["low", "normal", "high", "urgent"]),
      }),
    [t],
  )
  const form = useForm<CreateTaskFormValues>({
    defaultValues: defaultFormValues,
    resolver: zodResolver(createTaskFormSchema),
  })
  const dueAt = useWatch({ control: form.control, name: "dueAt" })

  const watcherOptions = useMemo(
    () =>
      assigneeMultiSelectOptions
        .map((group) => ({
          ...group,
          options: group.options.filter((option) =>
            option.value.startsWith("u_"),
          ),
        }))
        .filter((group) => group.options.length > 0),
    [assigneeMultiSelectOptions],
  )

  const createTaskMutation = useMutation(
    orpc.tasksAPI.create.mutationOptions({
      onError: (error) => {
        toast.error(
          extractApiErrorMessage(error, commonT("messages.unknownError")),
        )
      },
      onSuccess: async (task) => {
        toast.success(t("toasts.created"))
        await invalidateTasks()
        onCreated?.(task)
        form.reset(defaultFormValues)
        setOpen(false)
      },
    }),
  )

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)

    if (!nextOpen) {
      form.reset(defaultFormValues)
    }
  }

  const handleReminderPreset = (preset: ReminderPreset) => {
    const dueDate = toDate(form.getValues("dueAt"))

    if (!dueDate) {
      return
    }

    form.setValue(
      "remindAt",
      remindAtFromPreset(dueDate, preset).toISOString(),
      {
        shouldDirty: true,
        shouldValidate: true,
      },
    )
  }

  const handleClearDueAt = () => {
    form.setValue("dueAt", undefined, {
      shouldDirty: true,
      shouldValidate: true,
    })
  }

  const handleClearRemindAt = () => {
    form.setValue("remindAt", undefined, {
      shouldDirty: true,
      shouldValidate: true,
    })
  }

  const handleSubmit = (values: CreateTaskFormValues) => {
    const dueAt = toDate(values.dueAt)
    const remindAt = toDate(values.remindAt)

    createTaskMutation.mutate({
      ...parseTaskAssigneeValue(values.assignee),
      contactId: defaultTargets?.contactId,
      conversationId: defaultTargets?.conversationId,
      description: values.description || null,
      dueAt,
      priority: values.priority,
      remindAt,
      title: values.title,
      watcherUserIds: values.watcherValues
        .filter((value) => value.startsWith("u_"))
        .map((value) => value.slice(2)),
      workspaceId,
    })
  }

  const dueDate = toDate(dueAt)

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogTrigger
        render={trigger ?? <Button type="button">{t("actions.create")}</Button>}
      />
      <DialogContent className="max-h-[85dvh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("actions.create")}</DialogTitle>
          <DialogDescription className="sr-only">
            {t("actions.create")}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            className="flex flex-col gap-4"
            onSubmit={form.handleSubmit(handleSubmit)}
          >
            {defaultTargets?.contactLabel ? (
              <p className="text-muted-foreground text-sm">
                {t("contactLabel", { name: defaultTargets.contactLabel })}
              </p>
            ) : null}
            <InputField label={t("fields.title")} name="title" required />
            <TextareaField label={t("fields.description")} name="description" />
            <ComboboxField
              emptyText={t("empty")}
              label={t("fields.assignee")}
              name="assignee"
              options={assigneeOptions}
              placeholder={t("fields.assignee")}
              required
            />
            <MultiSelectField
              label={t("fields.watchers")}
              name="watcherValues"
              options={watcherOptions}
              placeholder={t("fields.watchers")}
            />
            <DateTimePickerField
              label={t("fields.dueAt")}
              name="dueAt"
              saveFormat="iso"
            />
            <Button
              onClick={handleClearDueAt}
              size="sm"
              type="button"
              variant="outline"
            >
              {commonT("actions.clear")}
            </Button>
            {dueDate ? (
              <div className="flex flex-wrap gap-2">
                {REMINDER_PRESETS.map((preset) => (
                  <Button
                    key={preset}
                    onClick={() => handleReminderPreset(preset)}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {t(reminderLabelKeyByPreset[preset])}
                  </Button>
                ))}
              </div>
            ) : null}
            <DateTimePickerField
              label={t("fields.remindAt")}
              name="remindAt"
              saveFormat="iso"
            />
            <Button
              onClick={handleClearRemindAt}
              size="sm"
              type="button"
              variant="outline"
            >
              {commonT("actions.clear")}
            </Button>
            <SelectField
              label={t("fields.priority")}
              name="priority"
              options={[
                { label: t(priorityLabelKeyByPriority.low), value: "low" },
                {
                  label: t(priorityLabelKeyByPriority.normal),
                  value: "normal",
                },
                { label: t(priorityLabelKeyByPriority.high), value: "high" },
                {
                  label: t(priorityLabelKeyByPriority.urgent),
                  value: "urgent",
                },
              ]}
              required
            />
            <DialogFooter>
              <Button disabled={createTaskMutation.isPending} type="submit">
                {createTaskMutation.isPending ? (
                  <Loader2Icon className="animate-spin" />
                ) : null}
                {t("actions.create")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
