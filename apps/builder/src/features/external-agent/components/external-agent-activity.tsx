"use client"

import { useTranslations } from "next-intl"
import {
  type ExternalAgentActivity,
  formatExternalAgentActivity,
} from "../lib/activity"

/** Centered, muted activity line for an external agent handover (mirrors `ThreadControlDivider`). */
export const ExternalAgentActivityDivider = ({
  activity,
}: {
  activity: ExternalAgentActivity
}) => {
  const t = useTranslations()

  return (
    <span className="text-muted-foreground text-xs">
      {formatExternalAgentActivity(activity, t)}
    </span>
  )
}
