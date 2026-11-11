import {
  conversationService,
  decideFallback,
  type ExternalAgentRuntime,
  externalAgentService,
  type HermesSseEvent,
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
  applyRunEvent,
  checkRunLimit,
  handleRunWatchError,
  processRunWindow,
  type ReadOutcome,
  readOutputText,
  readRunEvents,
  settleRunStatus,
} from "./external-agent-run-follower"
import {
  type ExternalAgentConversationContext,
  handOverToHuman,
  listRecentMessages,
  loadConversationContext,
  resolveAgentPhotoReply,
  selectNewMessages,
  sendClientText,
  stopRunQuietly,
  withExternalAgentLock,
} from "./external-agent-shared"

/**
 * The aiAgent worker runs with BullMQ's default 30 s job lock, so one read
 * window stays 15 s below it; events are read outside the conversation lock.
 */
export { EXTERNAL_AGENT_WATCH_WINDOW_MS } from "./external-agent-run-follower"

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
  interimSentRuns.delete(batch.data.runId)
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

/**
 * Замок качества (04.11): перед отправкой финального текста клиенту спрашиваем
 * локальный сервис-замок (`geka-gate.py`) — нет ли брака: служебных фраз,
 * схем-лейблов, картинок при отключённых фото, чисел, которых нет в выводе
 * инструментов прогона.
 *
 * Контракт: fail-open. Замок недоступен, ответил ошибкой или не уложился в
 * таймаут -> ответ уходит клиенту как раньше. Выключается
 * QUALITY_GATE_ENABLED=false без пересборки.
 */
type QualityGateResult = {
  allow: boolean
  reasons: string[]
  holdText: string
  blocked: boolean
}

const QUALITY_GATE_HOLD_FALLBACK = "Уточняю, секунду."

/** Прогоны, в которых клиент уже получил промежуточное сообщение: если финал
 * заблокирован, ответ до клиента уже доехал — «Уточняю» и досыл не нужны. */
const interimSentRuns = new Set<string>()

/** Когда клиент в этом диалоге последний раз получил ЛЮБОЕ сообщение.
 * «Уточняю, секунду» после уже доставленного ответа — парадокс, который ловим здесь. */
const lastDeliveredAt = new Map<string, number>()
const HOLD_SUPPRESS_MS = Number(
  process.env.QUALITY_GATE_HOLD_SUPPRESS_MS ?? 180_000,
)

const runQualityGate = async (input: {
  runId: string
  conversationId: string
  text: string
}): Promise<QualityGateResult> => {
  const url = process.env.QUALITY_GATE_URL
  const allow: QualityGateResult = {
    allow: true,
    reasons: [],
    holdText: QUALITY_GATE_HOLD_FALLBACK,
    blocked: false,
  }
  if (!url || process.env.QUALITY_GATE_ENABLED === "false") {
    return allow
  }
  const timeoutMs = Number(process.env.QUALITY_GATE_TIMEOUT_MS ?? 1200)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      signal: controller.signal,
    })
    if (!response.ok) {
      logger.warn(
        { status: response.status },
        "Quality gate: HTTP error, fail-open",
      )
      return allow
    }
    const data = (await response.json()) as {
      allow?: boolean
      reasons?: string[]
      hold_text?: string
    }
    return {
      allow: data.allow !== false,
      reasons: data.reasons ?? [],
      holdText: data.hold_text || QUALITY_GATE_HOLD_FALLBACK,
      blocked: data.allow === false,
    }
  } catch (err) {
    logger.warn({ err }, "Quality gate: unavailable, fail-open")
    return allow
  } finally {
    clearTimeout(timer)
  }
}

/** Уведомление Джарвису о заблокированном ответе (Hermes webhook, fire-and-forget). */
const notifyGateBlocked = async (input: {
  runId: string
  conversationId: string
  text: string
  reasons: string[]
}): Promise<void> => {
  const url = process.env.QUALITY_GATE_ALERT_URL
  const secret = process.env.QUALITY_GATE_ALERT_SECRET
  if (!url) {
    return
  }
  try {
    const body = JSON.stringify({
      // Адаптер Hermes читает event_type/type (поле event он игнорирует).
      event_type: "gate_blocked",
      type: "gate_blocked",
      ...input,
      at: new Date().toISOString(),
    })
    const signature = secret
      ? (await import("node:crypto"))
          .createHmac("sha256", secret)
          .update(body)
          .digest("hex")
      : undefined
    await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(signature ? { "x-webhook-signature": signature } : {}),
      },
      body,
    })
  } catch (err) {
    logger.warn({ err }, "Quality gate: alert delivery failed")
  }
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
  // Photo-in-bubble: move a markdown image / img-server URL out of the text
  // into the send job's `url` (the bubble renders it as an attachment).
  const photo = resolveAgentPhotoReply(text)
  const photoText = photo.url ? photo.text : text
  const shouldSend =
    (photoText !== "" || Boolean(photo.url)) &&
    Boolean(conversation?.botEnabled)
  // Замок качества: брак не доезжает до клиента (04.11).
  const gate: QualityGateResult = shouldSend
    ? await runQualityGate({
        runId: batch.data.runId,
        conversationId: batch.data.conversationId,
        text: photoText,
      })
    : {
        allow: true,
        reasons: [],
        holdText: QUALITY_GATE_HOLD_FALLBACK,
        blocked: false,
      }
  let sent = false
  if (shouldSend && gate.allow) {
    await sendClientText({
      context: batch.context,
      text: photoText,
      ...(photo.url ? { url: photo.url } : {}),
      jobId: sendJobId(batch.data, "final"),
    })
    sent = true
    lastDeliveredAt.set(batch.data.conversationId, Date.now())
  } else if (
    shouldSend &&
    gate.blocked &&
    (interimSentRuns.has(batch.data.runId) ||
      Date.now() - (lastDeliveredAt.get(batch.data.conversationId) ?? 0) <
        HOLD_SUPPRESS_MS)
  ) {
    logger.warn(
      { runId: batch.data.runId, reasons: gate.reasons },
      "Quality gate: final blocked but interim already delivered to the client",
    )
  } else if (shouldSend && gate.blocked) {
    // Клиент не остаётся в тишине: фраза-задержка, точный ответ доотправляет
    // Джарвис после разбора кейса.
    logger.warn(
      { runId: batch.data.runId, reasons: gate.reasons },
      "Quality gate: reply blocked before delivery",
    )
    await sendClientText({
      context: batch.context,
      text: gate.holdText,
      jobId: sendJobId(batch.data, "hold"),
      signAsExternalAgent: false,
    })
    lastDeliveredAt.set(batch.data.conversationId, Date.now())
    await notifyGateBlocked({
      runId: batch.data.runId,
      conversationId: batch.data.conversationId,
      text: photoText,
      reasons: gate.reasons,
    })
  }

  const closed = await patchRun(batch, {
    ...batch.tracking,
    runId: null,
    runStartedAt: null,
    failureCount: 0,
    lastError: gate.blocked ? "gate_blocked" : null,
    ...(sent ? { lastClientSendAt: new Date() } : {}),
  })
  if (closed && conversation?.botEnabled) {
    await enqueueNewMessagesReply(batch)
  }
}

/** Applies one event; `true` when it ended the run. */
const applyEvent = async (
  batch: WatchBatch,
  event: HermesSseEvent,
): Promise<boolean> =>
  await applyRunEvent(
    {
      tracking: batch.tracking,
      // Промежуточные сообщения тоже проходят замок: именно через них
      // 04.11 ушёл клиенту служебный «отчёт о работе».
      postInterim: async (text, step) => {
        const gate = await runQualityGate({
          runId: batch.data.runId,
          conversationId: batch.data.conversationId,
          text,
        })
        if (!gate.allow) {
          logger.warn(
            { runId: batch.data.runId, step, reasons: gate.reasons },
            "Quality gate: interim message dropped",
          )
          return
        }
        await sendClientText({
          context: batch.context,
          text,
          jobId: sendJobId(batch.data, step),
        })
        interimSentRuns.add(batch.data.runId)
        lastDeliveredAt.set(batch.data.conversationId, Date.now())
      },
      patchTracking: (tracking) => patchRun(batch, tracking),
      complete: (output) => completeRun(batch, output),
      fail: (error) => failRun(batch, "unavailable", error),
      stop: () => stopRunQuietly(batch.runtime.client, batch.data.runId),
    },
    event,
  )

/** The stream ended without a terminal event: the run status decides. `true` when the run ended. */
const settleFromRunStatus = async (batch: WatchBatch): Promise<boolean> => {
  const run = await batch.runtime.client.getRun(batch.data.runId)
  return await settleRunStatus(
    {
      complete: (output) => completeRun(batch, output),
      fail: (error) => failRun(batch, "unavailable", error),
      stop: () => stopRunQuietly(batch.runtime.client, batch.data.runId),
    },
    run,
  )
}

/** Fallback message and run limits once a window passed without a terminal event. */
const checkRunProgress = async (batch: WatchBatch): Promise<boolean> => {
  const now = new Date()
  const runStartedAt = batch.state.runStartedAt ?? now
  const withinLimit = await checkRunLimit({
    now,
    runStartedAt,
    lastEventAt: batch.tracking.lastEventAt,
    maxRunMinutes: batch.runtime.agent.maxRunMinutes,
    stop: () => stopRunQuietly(batch.runtime.client, batch.data.runId),
    fail: (error) => failRun(batch, "timeout", error),
  })
  if (!withinLimit) {
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
  await handleRunWatchError({
    error,
    isFinalAttempt: options.isFinalAttempt,
    fail: (failure) => failRun(batch, "unavailable", failure),
  })
}

const processBatch = async (
  batch: WatchBatch,
  read: ReadOutcome,
  options: WatchOptions,
): Promise<void> => {
  await processRunWindow(read, {
    lastEventSeq: batch.state.lastEventSeq,
    applyEvent: (event) => applyEvent(batch, event),
    handleError: (error) => handleWatchError(batch, error, options),
    settleFromRunStatus: () => settleFromRunStatus(batch),
    checkRunProgress: () => checkRunProgress(batch),
    enqueueWatch: async (delay) => {
      await enqueueExternalAgentWatch(batch.data, delay)
    },
  })
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

  const read = await readRunEvents(
    runtime.client,
    data.runId,
    state.lastEventSeq,
  )
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
