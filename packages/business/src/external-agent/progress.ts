export const EXTERNAL_AGENT_INTERIM_MIN_INTERVAL_MS = 30_000
export const EXTERNAL_AGENT_PROGRESS_FALLBACK_MS = 90_000
export const EXTERNAL_AGENT_STALL_MS = 300_000

const MS_PER_MINUTE = 60_000
const MS_PER_HOUR = 3_600_000

export type ExternalAgentInterimDecision = "send" | "skip"

export type ExternalAgentLimitDecision = "ok" | "stalled" | "overLimit"

const normalizeProgressText = (text: string): string =>
  text.trim().toLowerCase()

export const decideInterim = ({
  text,
  now,
  lastProgressSentAt,
  lastProgressText,
}: {
  text: string
  now: Date
  lastProgressSentAt: Date | null
  lastProgressText: string | null
}): ExternalAgentInterimDecision => {
  const normalizedText = normalizeProgressText(text)
  if (normalizedText === "") {
    return "skip"
  }

  const isRepeat =
    lastProgressText !== null &&
    normalizeProgressText(lastProgressText) === normalizedText
  if (isRepeat) {
    return "skip"
  }

  const isTooSoon =
    lastProgressSentAt !== null &&
    now.getTime() - lastProgressSentAt.getTime() <
      EXTERNAL_AGENT_INTERIM_MIN_INTERVAL_MS
  if (isTooSoon) {
    return "skip"
  }

  return "send"
}

export const decideFallback = ({
  now,
  runStartedAt,
  lastClientSendAt,
  progressFallbackSentAt,
  progressMessage,
}: {
  now: Date
  runStartedAt: Date
  lastClientSendAt: Date | null
  progressFallbackSentAt: Date | null
  progressMessage: string | null
}): boolean => {
  const hasMessage = progressMessage !== null && progressMessage.trim() !== ""
  if (!hasMessage || progressFallbackSentAt !== null) {
    return false
  }

  const referenceTime = Math.max(
    runStartedAt.getTime(),
    lastClientSendAt?.getTime() ?? runStartedAt.getTime(),
  )
  return now.getTime() - referenceTime >= EXTERNAL_AGENT_PROGRESS_FALLBACK_MS
}

export const decideLimit = ({
  now,
  runStartedAt,
  lastEventAt,
  maxRunMinutes,
}: {
  now: Date
  runStartedAt: Date
  lastEventAt: Date | null
  maxRunMinutes: number
}): ExternalAgentLimitDecision => {
  const elapsedMs = now.getTime() - runStartedAt.getTime()
  if (elapsedMs >= maxRunMinutes * MS_PER_MINUTE) {
    return "overLimit"
  }

  const idleSince = lastEventAt ?? runStartedAt
  if (now.getTime() - idleSince.getTime() >= EXTERNAL_AGENT_STALL_MS) {
    return "stalled"
  }

  return "ok"
}

export const resolveExternalAgentResumeAt = (
  resumeAfterHours: number | null,
  now: Date,
): Date | null => {
  if (resumeAfterHours === null) {
    return null
  }
  return new Date(now.getTime() + resumeAfterHours * MS_PER_HOUR)
}
