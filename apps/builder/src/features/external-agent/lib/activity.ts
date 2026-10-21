import {
  EXTERNAL_AGENT_ACTIVITY_TYPE,
  type ExternalAgentActivityEvent,
  externalAgentActivityEvents,
} from "@chatbotx.io/database/partials"
import type { useTranslations } from "next-intl"
import { z } from "zod"

/**
 * Client-side reader of the handover notes the external agent service writes
 * (`packages/business/src/external-agent`). Parsed leniently: an unknown shape
 * returns `undefined` and renders as a plain message instead of crashing the list.
 */

const externalAgentActivitySchema = z.object({
  type: z.literal(EXTERNAL_AGENT_ACTIVITY_TYPE),
  event: externalAgentActivityEvents,
  reason: z.string().nullish(),
})
export type ExternalAgentActivity = z.infer<typeof externalAgentActivitySchema>

export const getExternalAgentActivity = (
  contentAttributes: unknown,
): ExternalAgentActivity | undefined =>
  externalAgentActivitySchema.safeParse(contentAttributes).data

const DIVIDER_KEYS = {
  handover: "externalAgent.activity.handover",
  unavailable: "externalAgent.activity.unavailable",
  timeout: "externalAgent.activity.timeout",
} as const satisfies Record<ExternalAgentActivityEvent, string>

/** The localized sentence of an external agent note shown in the timeline. */
export const formatExternalAgentActivity = (
  activity: ExternalAgentActivity,
  t: ReturnType<typeof useTranslations>,
): string => {
  if (activity.event === "handover" && !activity.reason) {
    return t("externalAgent.activity.handoverNoReason")
  }
  return t(DIVIDER_KEYS[activity.event], { reason: activity.reason ?? "" })
}
