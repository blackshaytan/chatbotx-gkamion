"use client"

import {
  EXTERNAL_AGENT_DEFAULT_MAX_RUN_MINUTES,
  EXTERNAL_AGENT_MAX_RUN_MINUTES_LIMIT,
} from "@chatbotx.io/database/partials"
import { InputField } from "@chatbotx.io/ui/components/form/input-field"
import { InputNumberField } from "@chatbotx.io/ui/components/form/input-number-field"
import {
  SelectField,
  type SelectOption,
} from "@chatbotx.io/ui/components/form/select-field"
import { SwitchField } from "@chatbotx.io/ui/components/form/switch-field"
import { Button } from "@chatbotx.io/ui/components/ui/button"
import { Form } from "@chatbotx.io/ui/components/ui/form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Loader2Icon } from "lucide-react"
import { useTranslations } from "next-intl"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"
import { useWorkspaceId } from "@/hooks/routing"
import { orpc } from "@/lib/orpc/query"
import type { staffAssistantSettingsSchema } from "../schema"
import { StaffAssistantNotice } from "./staff-assistant-notice"

const formSchema = z.object({
  enabled: z.boolean(),
  baseUrl: z.string().trim().min(1).max(2048),
  apiKey: z.string().trim(),
  botName: z.string().trim().max(40),
  apiTokenId: z.string().optional(),
  maxRunMinutes: z
    .number()
    .int()
    .min(1)
    .max(EXTERNAL_AGENT_MAX_RUN_MINUTES_LIMIT),
})
type Values = z.infer<typeof formSchema>
type Settings = z.infer<typeof staffAssistantSettingsSchema>

const Editor = ({
  settings,
  tokenOptions,
}: {
  settings: Settings | null
  tokenOptions: SelectOption[]
}) => {
  const t = useTranslations()
  const workspaceId = useWorkspaceId()
  const queryClient = useQueryClient()
  const form = useForm<Values>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      enabled: settings?.enabled ?? false,
      baseUrl: settings?.baseUrl ?? "",
      apiKey: "",
      botName: settings?.botName ?? "",
      apiTokenId: settings?.apiTokenId ?? "",
      maxRunMinutes:
        settings?.maxRunMinutes ?? EXTERNAL_AGENT_DEFAULT_MAX_RUN_MINUTES,
    },
  })
  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: orpc.staffAssistant.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.chatsAPI.key() }),
    ])
  }
  const save = useMutation(
    orpc.staffAssistant.update.mutationOptions({
      onSuccess: async () => {
        form.resetField("apiKey")
        toast.success(t("externalAgent.saved"))
        await invalidate()
      },
      onError: () => toast.error(t("messages.unknownError")),
    }),
  )
  const test = useMutation(
    orpc.staffAssistant.test.mutationOptions({
      onSuccess: async (result) => {
        if (result.status === "ok") {
          toast.success(t("externalAgent.testOk"))
        } else {
          toast.error(
            t("externalAgent.testError", { error: result.error ?? "" }),
          )
        }
        await invalidate()
      },
      onError: () => toast.error(t("messages.unknownError")),
    }),
  )
  return (
    <Form {...form}>
      <form
        className="flex flex-col gap-4"
        onSubmit={form.handleSubmit((values) =>
          save.mutate({
            workspaceId,
            enabled: values.enabled,
            baseUrl: values.baseUrl,
            apiKey: values.apiKey || undefined,
            botName: values.botName || null,
            apiTokenId: values.apiTokenId || null,
            maxRunMinutes: values.maxRunMinutes,
          }),
        )}
      >
        <StaffAssistantNotice />
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
        <InputField
          label={t("externalAgent.botName")}
          maxLength={40}
          name="botName"
        />
        <SelectField
          allowClear
          clearLabel={t("actions.cancel")}
          description={
            tokenOptions.length
              ? t("staffAssistant.tokenHint")
              : t("staffAssistant.noTokens")
          }
          label={t("staffAssistant.token")}
          name="apiTokenId"
          options={tokenOptions}
        />
        <InputNumberField
          label={t("externalAgent.maxRunMinutes")}
          max={EXTERNAL_AGENT_MAX_RUN_MINUTES_LIMIT}
          min={1}
          name="maxRunMinutes"
          required
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            disabled={!settings || test.isPending}
            onClick={() => test.mutate({ workspaceId })}
            type="button"
            variant="outline"
          >
            {test.isPending ? <Loader2Icon className="animate-spin" /> : null}
            {t("externalAgent.test")}
          </Button>
          <Button disabled={save.isPending} type="submit">
            {save.isPending ? <Loader2Icon className="animate-spin" /> : null}
            {t("actions.save")}
          </Button>
        </div>
      </form>
    </Form>
  )
}

export const StaffAssistantSettingsForm = ({
  tokenOptions,
}: {
  tokenOptions: SelectOption[]
}) => {
  const workspaceId = useWorkspaceId()
  const t = useTranslations()
  const { data, isPending, isError } = useQuery(
    orpc.staffAssistant.get.queryOptions({ input: { workspaceId } }),
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
  return <Editor settings={data} tokenOptions={tokenOptions} />
}
