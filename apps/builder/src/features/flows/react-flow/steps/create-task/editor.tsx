"use client"

import {
  type CreateTaskDueUnit,
  type CreateTaskStepInput,
  type CreateTaskStepSchema,
  createTaskDueUnits,
  createTaskStepSchema,
} from "@chatbotx.io/flow-config"
import { ComboboxField } from "@chatbotx.io/ui/components/form/combobox-field"
import { InputField } from "@chatbotx.io/ui/components/form/input-field"
import { InputNumberField } from "@chatbotx.io/ui/components/form/input-number-field"
import { SelectField } from "@chatbotx.io/ui/components/form/select-field"
import { TextareaField } from "@chatbotx.io/ui/components/form/textarea-field"
import { Button } from "@chatbotx.io/ui/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@chatbotx.io/ui/components/ui/dialog"
import { Form } from "@chatbotx.io/ui/components/ui/form"
import { zodResolver } from "@hookform/resolvers/zod"
import { ListChecksIcon } from "lucide-react"
import { useTranslations } from "next-intl"
import { useCallback, useEffect, useMemo, useState } from "react"
import {
  type Resolver,
  useForm,
  useFormContext,
  useWatch,
} from "react-hook-form"
import { CustomFieldSelect } from "@/features/custom-fields/custom-field-select"
import { useContactAssigneeOptions } from "@/features/users/provider/user-hook"
import { BaseStepEditor } from "../base/editor"
import { useParentStepCommit } from "../base/use-parent-step-commit"
import { assigneeToValue, valueToAssignee } from "./assignee-value"

type AuxiliaryFormValues = {
  assigneeValue: string
  dueMode: "none" | "relative"
}

const priorityLabelKeys = {
  low: "tasks.priority.low",
  normal: "tasks.priority.normal",
  high: "tasks.priority.high",
  urgent: "tasks.priority.urgent",
} as const

const dueUnitLabelKeys = {
  minutes: "tasks.flowStep.units.minutes",
  hours: "tasks.flowStep.units.hours",
  days: "tasks.flowStep.units.days",
} as const satisfies Record<CreateTaskDueUnit, string>

const CreateTaskStepEditor = ({ parentName }: { parentName: string }) => {
  const t = useTranslations()

  return (
    <BaseStepEditor icon={ListChecksIcon} title={t("flows.actions.createTask")}>
      <CreateTaskDialog parentName={parentName} />
    </BaseStepEditor>
  )
}

const CreateTaskDialog = ({ parentName }: { parentName: string }) => {
  const t = useTranslations()
  const [open, setOpen] = useState(false)
  const { getValues } = useFormContext()
  const commitStep = useParentStepCommit<CreateTaskStepSchema>(parentName)
  const assigneeOptions = useContactAssigneeOptions({ enabled: open })

  const resolver = useCallback<
    Resolver<CreateTaskStepInput, unknown, CreateTaskStepSchema>
  >(
    async (values, context, options) => {
      const base = zodResolver(createTaskStepSchema) as Resolver<
        CreateTaskStepInput,
        unknown,
        CreateTaskStepSchema
      >
      const result = await base(values, context, options)
      const reminderError = result.errors.remindBeforeMinutes

      if (reminderError?.type === "custom") {
        result.errors.remindBeforeMinutes = {
          type: "manual",
          message:
            values.dueIn === null
              ? t("tasks.flowStep.validation.remindNeedsDue")
              : t("tasks.flowStep.validation.remindAfterDue"),
        }
      }

      return result
    },
    [t],
  )

  const form = useForm<CreateTaskStepInput, unknown, CreateTaskStepSchema>({
    resolver,
    defaultValues: {
      ...getValues(parentName),
    },
    mode: "onChange",
  })

  const assignee = useWatch({ control: form.control, name: "assignee" })
  const dueIn = useWatch({ control: form.control, name: "dueIn" })
  const auxiliaryForm = useForm<AuxiliaryFormValues>({
    defaultValues: {
      assigneeValue: assigneeToValue(assignee),
      dueMode: dueIn ? "relative" : "none",
    },
  })

  useEffect(() => {
    if (!open) {
      return
    }

    const current = getValues(parentName) as CreateTaskStepSchema
    form.reset(current)
    auxiliaryForm.reset({
      assigneeValue: assigneeToValue(current.assignee),
      dueMode: current.dueIn ? "relative" : "none",
    })
  }, [auxiliaryForm, form, getValues, open, parentName])

  const handleAssigneeChange = (value: string) => {
    form.setValue("assignee", valueToAssignee(value), {
      shouldDirty: true,
      shouldValidate: true,
    })
  }

  const handleDueModeChange = (value?: string) => {
    if (value === "relative") {
      form.setValue(
        "dueIn",
        { amount: 1, unit: createTaskDueUnits.enum.hours },
        { shouldDirty: true, shouldValidate: true },
      )
      return
    }

    form.setValue("dueIn", null, {
      shouldDirty: true,
      shouldValidate: true,
    })
    form.setValue("remindBeforeMinutes", null, {
      shouldDirty: true,
      shouldValidate: true,
    })
  }

  const handleClearReminder = () => {
    form.setValue("remindBeforeMinutes", null, {
      shouldDirty: true,
      shouldValidate: true,
    })
  }

  const handleSubmit = (data: CreateTaskStepSchema) => {
    commitStep({
      title: data.title,
      description: data.description,
      assignee: data.assignee,
      dueIn: data.dueIn,
      remindBeforeMinutes: data.remindBeforeMinutes,
      priority: data.priority,
      outputFieldId: data.outputFieldId ?? "",
    })
    setOpen(false)
  }

  const dueUnitOptions = createTaskDueUnits.options.map((value) => ({
    value,
    label: t(dueUnitLabelKeys[value]),
  }))
  const priorityOptions = Object.entries(priorityLabelKeys).map(
    ([value, labelKey]) => ({
      value,
      label: t(labelKey),
    }),
  )
  const combinedAssigneeOptions = useMemo(
    () => [
      {
        label: t("tasks.flowStep.assigneeConversation"),
        value: "conversation",
      },
      ...assigneeOptions,
    ],
    [assigneeOptions, t],
  )

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger
        render={
          <div className="flex justify-center">
            <Button size="sm" type="button" variant="outline">
              {t("actions.edit")}
            </Button>
          </div>
        }
      />
      <DialogContent className="max-h-[85dvh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("flows.actions.createTask")}</DialogTitle>
          <DialogDescription />
        </DialogHeader>

        <Form {...form}>
          <form
            className="flex w-full flex-col gap-4"
            onSubmit={form.handleSubmit(handleSubmit)}
          >
            <InputField
              description={t("tasks.flowStep.variablesHint")}
              label={t("tasks.fields.title")}
              name="title"
              required
            />
            <TextareaField
              description={t("tasks.flowStep.variablesHint")}
              label={t("tasks.fields.description")}
              name="description"
            />

            <Form {...auxiliaryForm}>
              <ComboboxField
                description={t("tasks.flowStep.assigneeHint")}
                label={t("tasks.fields.assignee")}
                name="assigneeValue"
                options={combinedAssigneeOptions}
                triggerValueChange={handleAssigneeChange}
              />
              <SelectField
                label={t("tasks.flowStep.dueMode")}
                name="dueMode"
                options={[
                  {
                    label: t("tasks.flowStep.dueNone"),
                    value: "none",
                  },
                  {
                    label: t("tasks.flowStep.dueIn"),
                    value: "relative",
                  },
                ]}
                triggerValueChange={handleDueModeChange}
              />
            </Form>

            {dueIn ? (
              <div className="grid grid-cols-2 gap-3">
                <InputNumberField
                  label={t("tasks.flowStep.dueIn")}
                  min={1}
                  name="dueIn.amount"
                  required
                />
                <SelectField
                  label={t("tasks.flowStep.dueMode")}
                  name="dueIn.unit"
                  options={dueUnitOptions}
                  required
                />
              </div>
            ) : null}

            <InputNumberField
              disabled={!dueIn}
              label={t("tasks.flowStep.remindBefore")}
              min={1}
              name="remindBeforeMinutes"
            />
            <Button
              disabled={!dueIn}
              onClick={handleClearReminder}
              size="sm"
              type="button"
              variant="outline"
            >
              {t("actions.clear")}
            </Button>

            <SelectField
              label={t("tasks.fields.priority")}
              name="priority"
              options={priorityOptions}
              required
            />

            <CustomFieldSelect
              allowCreate
              clearable
              includeBotFields
              label={t("tasks.flowStep.outputField")}
              name="outputFieldId"
            />
            <p className="text-muted-foreground text-sm">
              {t("tasks.flowStep.outputFieldHint")}
            </p>
            <p className="text-muted-foreground text-sm">
              {t("tasks.flowStep.errorsHint")}
            </p>

            <DialogFooter>
              <DialogClose
                render={
                  <Button size="sm" variant="ghost">
                    {t("actions.cancel")}
                  </Button>
                }
              />
              <Button
                disabled={
                  !form.formState.isValid || form.formState.isSubmitting
                }
                size="sm"
                type="submit"
              >
                {t("actions.save")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

export default CreateTaskStepEditor
