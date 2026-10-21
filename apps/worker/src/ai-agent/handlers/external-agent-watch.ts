import {
  conversationService,
  decideFallback,
  decideInterim,
  decideLimit,
  type ExternalAgentRuntime,
  externalAgentService,
  HermesAuthError,
  type HermesReadEventsResult,
  HermesRequestError,
  type HermesSseEvent,
  HermesUnavailableError,
  withBlockedOwnerGuard,
} from "@chatbotx.io/business"
import type { ExternalAgentConversationStatePatch } from "@chatbotx.io/database/repositories"
import type { ExternalAgentConversationStateModel } from "@chatbotx.io/database/types"
import {
  type ExternalAgentWatchData,
  enqueueExternalAgentReply,
  enqueueExternalAgentWatch,
} from "@chatbotx.io/worker-config"
import { UnrecoverableError } from "bullmq"
import { logger } from "../../lib/logger"
import {
  type ExternalAgentConversationContext,
  handOverToHuman,
  listRecentMessages,
  loadConversationContext,
  selectNewMessages,
  sendClientText,
  stopRunQuietly,
  withExternalAgentLock,
} from "./external-agent-shared"

/**
 * The aiAgent worker runs with BullMQ's default 30 s job lock, so one read
 * window stays 15 s below it; events are read outside the conversation lock.
 */
export const EXTERNAL_AGENT_WATCH_WINDOW_MS = 15_000
const EARLY_END_REWATCH_DELAY_MS = 5000

const FAILED_RUN_EVENTS = new Set([
  "run.failed",
  "run.cancelled",
  "run.interrupted",
])
const FAILED_RUN_STATUSES = new Set(["failed", "cancelled", "interrupted"])
const APPROVAL_STATUS = "waiting_for_approval"

type WatchOptions = { isFinalAttempt: boolean }

type RunTracking = Pick<
  ExternalAgentConversationStateModel,
  | "lastEventSeq"
  | "lastEventAt"
  | "lastProgressSentAt"
  | "lastProgressText"
  | "lastClientSendAt"
>

type WatchBatch = {
  data: ExternalAgentWatchData
  context: ExternalAgentConversationContext
  runtime: ExternalAgentRuntime
  state: ExternalAgentConversationStateModel
  tracking: RunTracking
}

type ReadOutcome = {
  events: HermesSseEvent[]
  result: HermesReadEventsResult | null
  error: unknown
}

const patchRun = async (
  batch: Pick<WatchBatch, "data">,
  values: ExternalAgentConversationStatePatch,
): Promise<boolean> =>
  (await externalAgentService.patchConversationState({
    workspaceId: batch.data.workspaceId,
    conversationId: batch.data.conversationId,
    values,
    expectedRunId: batch.data.runId,
  })) > 0

const sendJobId = (data: ExternalAgentWatchData, step: string): string =>
  `externalAgentSend-${data.conversationId}-${data.runId}-${step}`

const abandonRun = async (
  data: ExternalAgentWatchData,
  client: ExternalAgentRuntime["client"] | null,
): Promise<void> => {
  if (client) {
    await stopRunQuietly(client, data.runId)
  }
  await patchRun({ data }, { runId: null, runStartedAt: null })
}

const failRun = async (
  batch: WatchBatch,
  event: "unavailable" | "timeout",
  error: unknown,
): Promise<void> => {
  const closed = await patchRun(batch, {
    ...batch.tracking,
    runId: null,
    runStartedAt: null,
    failureCount: batch.state.failureCount + 1,
    lastError: error instanceof Error ? error.message : String(error),
  })
  if (!closed) {
    return
  }
  await handOverToHuman({
    ref: batch.data,
    context: batch.context,
    event,
    error,
  })
}

const readOutputText = (value: unknown): string =>
  typeof value === "string" ? value.trim() : ""

const enqueueNewMessagesReply = async (batch: WatchBatch): Promise<void> => {
  const messages = await listRecentMessages(batch.data)
  const newMessages = selectNewMessages({
    messages,
    cursorAt: batch.state.cursorAt,
    cursorMessageId: batch.state.cursorMessageId,
  })
  const lastMessage = newMessages.at(-1)
  if (!lastMessage) {
    return
  }
  await enqueueExternalAgentReply({
    workspaceId: batch.data.workspaceId,
    conversationId: batch.data.conversationId,
    contactInboxId: batch.data.contactInboxId,
    messageId: lastMessage.id,
  })
}

const completeRun = async (
  batch: WatchBatch,
  output: string,
): Promise<void> => {
  const text =
    output === ""
      ? readOutputText(
          (await batch.runtime.client.getRun(batch.data.runId)).output,
        )
      : output
  const conversation = await conversationService.findByUncached({
    where: {
      id: batch.data.conversationId,
      workspaceId: batch.data.workspaceId,
    },
  })
  const shouldSend = text !== "" && Boolean(conversation?.botEnabled)
  if (shouldSend) {
    await sendClientText({
      context: batch.context,
      text,
      jobId: sendJobId(batch.data, "final"),
    })
  }

  const closed = await patchRun(batch, {
    ...batch.tracking,
    runId: null,
    runStartedAt: null,
    failureCount: 0,
    lastError: null,
    ...(shouldSend ? { lastClientSendAt: new Date() } : {}),
  })
  if (closed && conversation?.botEnabled) {
    await enqueueNewMessagesReply(batch)
  }
}

/** Applies one event; `true` when it ended the run. */
const applyEvent = async (
  batch: WatchBatch,
  event: HermesSseEvent,
): Promise<boolean> => {
  const now = new Date()
  batch.tracking.lastEventAt = now
  if (event.id !== null) {
    batch.tracking.lastEventSeq = event.id
  }
  const type = event.data.event ?? ""

  if (type === "message.interim") {
    const text = readOutputText(event.data.text)
    const decision = decideInterim({
      text,
      now,
      lastProgressSentAt: batch.tracking.lastProgressSentAt,
      lastProgressText: batch.tracking.lastProgressText,
    })
    if (decision === "send") {
      await sendClientText({
        context: batch.context,
        text,
        jobId: sendJobId(batch.data, `interim-${event.id ?? now.getTime()}`),
      })
      batch.tracking.lastProgressSentAt = now
      batch.tracking.lastProgressText = text
      batch.tracking.lastClientSendAt = now
      if (!(await patchRun(batch, batch.tracking))) {
        return true
      }
    }
    return false
  }
  if (type === "run.completed") {
    await completeRun(batch, readOutputText(event.data.output))
    return true
  }
  if (FAILED_RUN_EVENTS.has(type)) {
    await failRun(
      batch,
      "unavailable",
      new Error(readOutputText(event.data.error) || `Hermes ${type}`),
    )
    return true
  }
  if (type === "approval.request") {
    await stopRunQuietly(batch.runtime.client, batch.data.runId)
    await failRun(
      batch,
      "unavailable",
      new Error("Hermes requested a tool approval"),
    )
    return true
  }
  return false
}

/** The stream ended without a terminal event: the run status decides. `true` when the run ended. */
const settleFromRunStatus = async (batch: WatchBatch): Promise<boolean> => {
  const run = await batch.runtime.client.getRun(batch.data.runId)
  if (run.status === "completed") {
    await completeRun(batch, readOutputText(run.output))
    return true
  }
  if (FAILED_RUN_STATUSES.has(run.status)) {
    await failRun(
      batch,
      "unavailable",
      new Error(run.error ?? `Hermes run ${run.status}`),
    )
    return true
  }
  if (run.status === APPROVAL_STATUS) {
    await stopRunQuietly(batch.runtime.client, batch.data.runId)
    await failRun(
      batch,
      "unavailable",
      new Error("Hermes requested a tool approval"),
    )
    return true
  }
  return false
}

/** Fallback message and run limits once a window passed without a terminal event. */
const checkRunProgress = async (batch: WatchBatch): Promise<boolean> => {
  const now = new Date()
  const runStartedAt = batch.state.runStartedAt ?? now
  const limit = decideLimit({
    now,
    runStartedAt,
    lastEventAt: batch.tracking.lastEventAt,
    maxRunMinutes: batch.runtime.agent.maxRunMinutes,
  })
  if (limit !== "ok") {
    await stopRunQuietly(batch.runtime.client, batch.data.runId)
    await failRun(
      batch,
      "timeout",
      new Error(
        limit === "stalled"
          ? "Hermes run stalled without events"
          : "Hermes run exceeded the time limit",
      ),
    )
    return false
  }

  if (!(await patchRun(batch, batch.tracking))) {
    return false
  }

  const shouldSendFallback = decideFallback({
    now,
    runStartedAt,
    lastClientSendAt: batch.tracking.lastClientSendAt,
    progressFallbackSentAt: batch.state.progressFallbackSentAt,
    progressMessage: batch.runtime.agent.progressMessage,
  })
  if (shouldSendFallback) {
    await sendClientText({
      context: batch.context,
      text: batch.runtime.agent.progressMessage.trim(),
      jobId: sendJobId(batch.data, "fallback"),
    })
    return await patchRun(batch, {
      progressFallbackSentAt: now,
      lastClientSendAt: now,
    })
  }
  return true
}

const handleWatchError = async (
  batch: WatchBatch,
  error: unknown,
  options: WatchOptions,
): Promise<void> => {
  if (error instanceof HermesAuthError) {
    await failRun(batch, "unavailable", error)
    throw new UnrecoverableError(error.message)
  }
  if (error instanceof HermesRequestError) {
    await failRun(batch, "unavailable", error)
    return
  }
  if (error instanceof HermesUnavailableError) {
    if (!options.isFinalAttempt) {
      throw error
    }
    await failRun(batch, "unavailable", error)
    return
  }
  throw error
}

const processBatch = async (
  batch: WatchBatch,
  read: ReadOutcome,
  options: WatchOptions,
): Promise<void> => {
  for (const event of read.events) {
    if (event.id !== null && event.id <= batch.state.lastEventSeq) {
      continue
    }
    if (await applyEvent(batch, event)) {
      return
    }
  }

  if (read.error !== null) {
    await handleWatchError(batch, read.error, options)
    return
  }
  const endedEarly = Boolean(read.result?.closed || read.result?.notFound)
  if (endedEarly && (await settleFromRunStatus(batch))) {
    return
  }
  if (!(await checkRunProgress(batch))) {
    return
  }
  await enqueueExternalAgentWatch(
    batch.data,
    endedEarly ? EARLY_END_REWATCH_DELAY_MS : 0,
  )
}

const processUnderLock = async (
  data: ExternalAgentWatchData,
  context: ExternalAgentConversationContext,
  runtime: ExternalAgentRuntime,
  read: ReadOutcome,
  options: WatchOptions,
): Promise<void> => {
  const state = await externalAgentService.findConversationState({
    workspaceId: data.workspaceId,
    conversationId: data.conversationId,
  })
  if (state?.runId !== data.runId) {
    return
  }
  const conversation = await conversationService.findByUncached({
    where: { id: data.conversationId, workspaceId: data.workspaceId },
  })
  if (!conversation?.botEnabled) {
    await abandonRun(data, runtime.client)
    return
  }

  const batch: WatchBatch = {
    data,
    context: { ...context, conversation },
    runtime,
    state,
    tracking: {
      lastEventSeq: state.lastEventSeq,
      lastEventAt: state.lastEventAt,
      lastProgressSentAt: state.lastProgressSentAt,
      lastProgressText: state.lastProgressText,
      lastClientSendAt: state.lastClientSendAt,
    },
  }
  try {
    await processBatch(batch, read, options)
  } catch (error) {
    if (error instanceof UnrecoverableError || read.error === error) {
      throw error
    }
    await handleWatchError(batch, error, options)
  }
}

const readRunEvents = async (
  runtime: ExternalAgentRuntime,
  data: ExternalAgentWatchData,
  lastSeq: number,
): Promise<ReadOutcome> => {
  const events: HermesSseEvent[] = []
  try {
    const result = await runtime.client.readEvents({
      runId: data.runId,
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

/**
 * The conversation no longer points at this run: it was closed here, or a bot
 * resume reset the state while it was still running. Stopping is a no-op for
 * a finished run and keeps a forgotten one from acting on the conversation.
 */
const stopDetachedRun = async (data: ExternalAgentWatchData): Promise<void> => {
  try {
    const runtime = await externalAgentService.getRuntimeForWorkspace(
      data.workspaceId,
    )
    if (runtime) {
      await stopRunQuietly(runtime.client, data.runId)
    }
  } catch (err) {
    logger.warn(
      { err, conversationId: data.conversationId, runId: data.runId },
      "External agent: unable to stop a detached run",
    )
  }
}

const runWatch = async (
  data: ExternalAgentWatchData,
  options: WatchOptions,
): Promise<void> => {
  const state = await externalAgentService.findConversationState({
    workspaceId: data.workspaceId,
    conversationId: data.conversationId,
  })
  if (state?.runId !== data.runId) {
    await stopDetachedRun(data)
    return
  }

  const context = await loadConversationContext(data)
  const runtime = context
    ? await externalAgentService.getRuntime({
        workspaceId: data.workspaceId,
        inboxId: context.contactInbox.inboxId,
      })
    : null
  if (!(context && runtime)) {
    const fallback = await externalAgentService.getRuntimeForWorkspace(
      data.workspaceId,
    )
    await withExternalAgentLock(data.conversationId, () =>
      abandonRun(data, fallback?.client ?? null),
    )
    return
  }
  if (!context.conversation.botEnabled) {
    await withExternalAgentLock(data.conversationId, () =>
      abandonRun(data, runtime.client),
    )
    return
  }

  const read = await readRunEvents(runtime, data, state.lastEventSeq)
  await withExternalAgentLock(data.conversationId, () =>
    processUnderLock(data, context, runtime, read, options),
  )
}

/**
 * Follows one Hermes run for a read window: relays interim and final replies,
 * sends the fallback progress message, enforces the run limits, and re-queues
 * itself until the run ends. Events are buffered outside the conversation lock
 * and applied under it; every write is guarded by the run id, so a replaced or
 * closed run is left alone, and sends carry deterministic job ids.
 */
export const processExternalAgentWatch = async (
  data: ExternalAgentWatchData,
  options: WatchOptions,
): Promise<void> => {
  await withBlockedOwnerGuard(data.workspaceId, () => runWatch(data, options))
}
