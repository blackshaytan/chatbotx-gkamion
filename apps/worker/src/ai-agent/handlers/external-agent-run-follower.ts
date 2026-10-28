import {
  decideInterim,
  decideLimit,
  type ExternalAgentRuntime,
  type HermesReadEventsResult,
  type HermesSseEvent,
} from "@chatbotx.io/business"

export type RunTracking = {
  lastEventSeq: number
  lastEventAt: Date | null
  lastProgressSentAt: Date | null
  lastProgressText: string | null
  lastClientSendAt: Date | null
}

export type RunEventPort = {
  tracking: RunTracking
  postInterim: (text: string, step: string) => Promise<void>
  patchTracking: (tracking: RunTracking) => Promise<boolean>
  complete: (output: string) => Promise<void>
  fail: (error: Error) => Promise<void>
  stop: () => Promise<void>
}

const FAILED_RUN_EVENTS = new Set([
  "run.failed",
  "run.cancelled",
  "run.interrupted",
])
const FAILED_RUN_STATUSES = new Set(["failed", "cancelled", "interrupted"])

export const readOutputText = (value: unknown): string =>
  typeof value === "string" ? value.trim() : ""

export const applyRunEvent = async (
  port: RunEventPort,
  event: HermesSseEvent,
): Promise<boolean> => {
  const now = new Date()
  port.tracking.lastEventAt = now
  if (event.id !== null) {
    port.tracking.lastEventSeq = event.id
  }
  const type = event.data.event ?? ""
  if (type === "message.interim") {
    const text = readOutputText(event.data.text)
    if (decideInterim({
      text,
      now,
      lastProgressSentAt: port.tracking.lastProgressSentAt,
      lastProgressText: port.tracking.lastProgressText,
    }) === "send") {
      await port.postInterim(text, `interim-${event.id ?? now.getTime()}`)
      port.tracking.lastProgressSentAt = now
      port.tracking.lastProgressText = text
      port.tracking.lastClientSendAt = now
      if (!(await port.patchTracking(port.tracking))) {
        return true
      }
    }
    return false
  }
  if (type === "run.completed") {
    await port.complete(readOutputText(event.data.output))
    return true
  }
  if (FAILED_RUN_EVENTS.has(type)) {
    await port.fail(new Error(readOutputText(event.data.error) || `Hermes ${type}`))
    return true
  }
  if (type === "approval.request") {
    await port.stop()
    await port.fail(new Error("Hermes requested a tool approval"))
    return true
  }
  return false
}

export const settleRunStatus = async (
  port: Pick<RunEventPort, "complete" | "fail" | "stop">,
  run: { status: string; output?: unknown; error?: string | null },
): Promise<boolean> => {
  if (run.status === "completed") {
    await port.complete(readOutputText(run.output))
    return true
  }
  if (FAILED_RUN_STATUSES.has(run.status)) {
    await port.fail(new Error(run.error ?? `Hermes run ${run.status}`))
    return true
  }
  if (run.status === "waiting_for_approval") {
    await port.stop()
    await port.fail(new Error("Hermes requested a tool approval"))
    return true
  }
  return false
}

export const checkRunLimit = async (input: {
  now: Date
  runStartedAt: Date
  lastEventAt: Date | null
  maxRunMinutes: number
  stop: () => Promise<void>
  fail: (error: Error) => Promise<void>
}): Promise<boolean> => {
  const limit = decideLimit(input)
  if (limit === "ok") {
    return true
  }
  await input.stop()
  await input.fail(
    new Error(
      limit === "stalled"
        ? "Hermes run stalled without events"
        : "Hermes run exceeded the time limit",
    ),
  )
  return false
}

/** Keep the read window shorter than BullMQ's default 30-second job lock. */
export const EXTERNAL_AGENT_WATCH_WINDOW_MS = 15_000

export type ReadOutcome = {
  events: HermesSseEvent[]
  result: HermesReadEventsResult | null
  error: unknown
}

const EARLY_END_REWATCH_DELAY_MS = 5000

/** Callbacks run under the entity lock and own all domain-specific effects. */
export type RunFollowerPort = {
  lastEventSeq: number
  applyEvent: (event: HermesSseEvent) => Promise<boolean>
  handleError: (error: unknown) => Promise<void>
  settleFromRunStatus: () => Promise<boolean>
  checkRunProgress: () => Promise<boolean>
  enqueueWatch: (delay: number) => Promise<void>
}

export const processRunWindow = async (
  read: ReadOutcome,
  port: RunFollowerPort,
): Promise<void> => {
  for (const event of read.events) {
    if (event.id !== null && event.id <= port.lastEventSeq) {
      continue
    }
    if (await port.applyEvent(event)) {
      return
    }
  }

  if (read.error !== null) {
    await port.handleError(read.error)
    return
  }
  const endedEarly = Boolean(read.result?.closed || read.result?.notFound)
  if (endedEarly && (await port.settleFromRunStatus())) {
    return
  }
  if (!(await port.checkRunProgress())) {
    return
  }
  await port.enqueueWatch(endedEarly ? EARLY_END_REWATCH_DELAY_MS : 0)
}

/** Buffer events outside the entity lock, including events received before an error. */
export const readRunEvents = async (
  client: ExternalAgentRuntime["client"],
  runId: string,
  lastSeq: number,
): Promise<ReadOutcome> => {
  const events: HermesSseEvent[] = []
  try {
    const result = await client.readEvents({
      runId,
      lastSeq,
      windowMs: EXTERNAL_AGENT_WATCH_WINDOW_MS,
      onEvent: (event) => {
        events.push(event)
      },
    })
    return { events, result, error: null }
  } catch (error) {
    return { events, result: null, error }
  }
}
