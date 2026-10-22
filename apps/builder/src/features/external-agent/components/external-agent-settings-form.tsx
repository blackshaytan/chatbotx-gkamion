"use client"

import {
  EXTERNAL_AGENT_DEFAULT_MAX_RUN_MINUTES,
  EXTERNAL_AGENT_DEFAULT_PROGRESS_MESSAGE,
  EXTERNAL_AGENT_MAX_RUN_MINUTES_LIMIT,
} from "@chatbotx.io/database/partials"
import { InputField } from "@chatbotx.io/ui/components/form/input-field"
import { InputNumberField } from "@chatbotx.io/ui/components/form/input-number-field"
import { MultiSelectField } from "@chatbotx.io/ui/components/form/multi-select-field"
import { SelectField } from "@chatbotx.io/ui/components/form/select-field"
import { SwitchField } from "@chatbotx.io/ui/components/form/switch-field"
import { TextareaField } from "@chatbotx.io/ui/components/form/textarea-field"
import { Button } from "@chatbotx.io/ui/components/ui/button"
import { Form } from "@chatbotx.io/ui/components/ui/form"
import { cn } from "@chatbotx.io/ui/lib/utils"
import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Loader2Icon } from "lucide-react"
import { useFormatter, useTranslations } from "next-intl"
import { useForm, useWatch } from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"
import { useInboxOptionsByChannel } from "@/features/inboxes/provider/inbox-hook"
import { useWorkspaceId } from "@/hooks/routing"
import { orpc } from "@/lib/orpc/query"
import {
  BASE_URL_MAX_LENGTH,
  BOT_NAME_MAX_LENGTH,
  type externalAgentOutputSchema,
  MAX_RUN_MINUTES_MIN,
  PROGRESS_MESSAGE_MAX_LENGTH,
  RESUME_AFTER_HOURS_MAX,
  RESUME_AFTER_HOURS_MIN,
  type updateExternalAgentInputSchema,
} from "../schema"

type ExternalAgentSettings = z.infer<typeof externalAgentOutputSchema>
type ExternalAgentUpdateInput = z.input<typeof updateExternalAgentInputSchema>

const DEFAULT_RESUME_AFTER_HOURS = 24
const resumeModes = ["never", "afterHours"] as const

const externalAgentFormSchema = z
  .object({
    enabled: z.boolean(),
    baseUrl: z.string().trim().min(1).max(BASE_URL_MAX_LENGTH),
    apiKey: z.string().trim(),
    inboxIds: z.array(z.string()),
    resumeMode: z.enum(resumeModes),
    resumeAfterHours: z.number().int().optional(),
    maxRunMinutes: z
      .number()
      .int()
      .min(MAX_RUN_MINUTES_MIN)
      .max(EXTERNAL_AGENT_MAX_RUN_MINUTES_LIMIT),
    progressMessage: z.string().trim().max(PROGRESS_MESSAGE_MAX_LENGTH),
    botName: z.string().trim().max(BOT_NAME_MAX_LENGTH),
    signMessages: z.boolean(),
    announceManager: z.boolean(),
  })
  .superRefine((values, ctx) => {
    if (values.resumeMode !== "afterHours") {
      return
    }
    const hours = values.resumeAfterHours
    const isValidHours =
      hours !== undefined &&
      hours >= RESUME_AFTER_HOURS_MIN &&
      hours <= RESUME_AFTER_HOURS_MAX
    if (isValidHours) {
      return
    }
    ctx.addIssue({ code: "custom", path: ["resumeAfterHours"] })
  })

type ExternalAgentFormValues = z.infer<typeof externalAgentFormSchema>

const toFormValues = (
  settings: ExternalAgentSettings | null,
): ExternalAgentFormValues => ({
  enabled: settings?.enabled ?? false,
  baseUrl: settings?.baseUrl ?? "",
  apiKey: "",
  inboxIds: settings?.inboxIds ?? [],
  resumeMode: settings?.resumeAfterHours == null ? "never" : "afterHours",
  resumeAfterHours: settings?.resumeAfterHours ?? DEFAULT_RESUME_AFTER_HOURS,
  maxRunMinutes:
    settings?.maxRunMinutes ?? EXTERNAL_AGENT_DEFAULT_MAX_RUN_MINUTES,
  progressMessage:
    settings?.progressMessage ?? EXTERNAL_AGENT_DEFAULT_PROGRESS_MESSAGE,
  botName: settings?.botName ?? "",
  signMessages: settings?.signMessages ?? false,
  announceManager: settings?.announceManager ?? false,
})

/** A blank API key keeps the stored one, so it is left out of the request. */
const toUpdateInput = (
  values: ExternalAgentFormValues,
): ExternalAgentUpdateInput => ({
  enabled: values.enabled,
  baseUrl: values.baseUrl,
  apiKey: values.apiKey || undefined,
  inboxIds: values.inboxIds,
  resumeAfterHours:
    values.resumeMode === "afterHours"
      ? (values.resumeAfterHours ?? null)
      : null,
  maxRunMinutes: values.maxRunMinutes,
  progressMessage: values.progressMessage,
  botName: values.botName || null,
  signMessages: values.signMessages,
  announceManager: values.announceManager,
})

const ExternalAgentLastCheck = ({
  settings,
}: {
  settings: ExternalAgentSettings
}) => {
  const t = useTranslations()
  const formatter = useFormatter()

  if (!settings.lastCheckedAt) {
    return null
  }

  const isCheckOk = settings.lastCheckStatus === "ok"
  const checkResultText = isCheckOk
    ? t("externalAgent.testOk")
    : t("externalAgent.testError", { error: settings.lastCheckError ?? "" })

  return (
    <div className="flex flex-col gap-1 text-sm">
      <p className={cn(isCheckOk ? "text-green-600" : "text-destructive")}>
        {checkResultText}
      </p>
      <p className="text-muted-foreground text-xs">
        {t("externalAgent.lastChecked", {
          date: formatter.dateTime(settings.lastCheckedAt, {
            dateStyle: "medium",
            timeStyle: "short",
          }),
        })}
      </p>
    </div>
  )
}

const ExternalAgentSettingsEditor = ({
  settings,
}: {
  settings: ExternalAgentSettings | null
}) => {
  const workspaceId = useWorkspaceId()
  const t = useTranslations()
  const queryClient = useQueryClient()
  const inboxOptions = useInboxOptionsByChannel()
  const form = useForm<ExternalAgentFormValues>({
    defaultValues: toFormValues(settings),
    resolver: zodResolver(externalAgentFormSchema),
  })
  const resumeMode = useWatch({ control: form.control, name: "resumeMode" })

  const invalidateSettings = () =>
    queryClient.invalidateQueries({
      queryKey: orpc.externalAgent.get.key(),
    })

  const saveMutation = useMutation(
    orpc.externalAgent.update.mutationOptions({
      onSuccess: async () => {
        toast.success(t("externalAgent.saved"))
        await invalidateSettings()
      },
      onError: () => {
        toast.error(t("messages.unknownError"))
      },
    }),
  )

  const testMutation = useMutation(
    orpc.externalAgent.test.mutationOptions({
      onSuccess: async (result) => {
        if (result.status === "ok") {
          toast.success(t("externalAgent.testOk"))
        } else {
          toast.error(
            t("externalAgent.testError", { error: result.error ?? "" }),
          )
        }
        await invalidateSettings()
      },
      onError: () => {
        toast.error(t("messages.unknownError"))
      },
    }),
  )

  const resumeModeOptions = [
    { label: t("externalAgent.resumeNever"), value: "never" },
    { label: t("externalAgent.resumeHours"), value: "afterHours" },
  ]

  const handleSave = (values: ExternalAgentFormValues) => {
    saveMutation.mutate(
      { ...toUpdateInput(values), workspaceId },
      { onSuccess: () => form.resetField("apiKey") },
    )
  }

  const handleTest = () => {
    testMutation.mutate({ workspaceId })
  }

  return (
    <Form {...form}>
      <form
        className="flex flex-col gap-4"
        onSubmit={form.handleSubmit(handleSave)}
      >
        <p className="text-muted-foreground text-sm">
          {t("externalAgent.description")}
        </p>
        <SwitchField label={t("externalAgent.enabled")} name="enabled" />
        <InputField
          description={t("externalAgent.baseUrlHint")}
          label={t("externalAgent.baseUrl")}
          name="baseUrl"
          required
          type="url"
        />
        <InputField
          autoComplete="off"
          label={t("externalAgent.apiKey")}
          name="apiKey"
          placeholder={
            settings?.hasApiKey ? t("externalAgent.apiKeySaved") : undefined
          }
          type="password"
        />
        <MultiSelectField
          label={t("externalAgent.inboxes")}
          name="inboxIds"
          options={inboxOptions}
          placeholder={t("actions.pleaseSelect")}
        />
        <SelectField
          label={t("externalAgent.resumeAfter")}
          name="resumeMode"
          options={resumeModeOptions}
          required
        />
        {resumeMode === "afterHours" && (
          <InputNumberField
            aria-label={t("externalAgent.resumeHours")}
            max={RESUME_AFTER_HOURS_MAX}
            min={RESUME_AFTER_HOURS_MIN}
            name="resumeAfterHours"
          />
        )}
        <InputNumberField
          label={t("externalAgent.maxRunMinutes")}
          max={EXTERNAL_AGENT_MAX_RUN_MINUTES_LIMIT}
          min={MAX_RUN_MINUTES_MIN}
          name="maxRunMinutes"
          required
        />
        <TextareaField
          description={t("externalAgent.progressMessageHint")}
          label={t("externalAgent.progressMessage")}
          name="progressMessage"
          rows={3}
        />
        <InputField
          description={t("externalAgent.botNameHint")}
          label={t("externalAgent.botName")}
          maxLength={BOT_NAME_MAX_LENGTH}
          name="botName"
        />
        <SwitchField
          description={t("externalAgent.signMessagesHint")}
          label={t("externalAgent.signMessages")}
          name="signMessages"
        />
        <SwitchField
          description={t("externalAgent.announceManagerHint")}
          label={t("externalAgent.announceManager")}
          name="announceManager"
        />

        <div className="flex flex-wrap items-center gap-2">
          <Button
            disabled={!settings || testMutation.isPending}
            onClick={handleTest}
            type="button"
            variant="outline"
          >
            {testMutation.isPending && <Loader2Icon className="animate-spin" />}
            {t("externalAgent.test")}
          </Button>
          <Button disabled={saveMutation.isPending} type="submit">
            {saveMutation.isPending && <Loader2Icon className="animate-spin" />}
            {t("actions.save")}
          </Button>
        </div>
        {settings && <ExternalAgentLastCheck settings={settings} />}
      </form>
    </Form>
  )
}

export const ExternalAgentSettingsForm = () => {
  const workspaceId = useWorkspaceId()
  const t = useTranslations()
  const { data, isPending, isError } = useQuery(
    orpc.externalAgent.get.queryOptions({ input: { workspaceId } }),
  )

  if (isPending) {
    return (
      <p className="text-muted-foreground text-sm">
        {t("messages.loadingData")}
      </p>
    )
  }

  if (isError) {
    return (
      <p className="text-destructive text-sm">
        {t("messages.errorLoadingData")}
      </p>
    )
  }

  return <ExternalAgentSettingsEditor settings={data} />
}
