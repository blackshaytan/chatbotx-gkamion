import { createHash } from "node:crypto"
import {
  findStaffChatParticipant,
  HermesRequestError,
  loadStaffAssistantTurn,
  logProviderError,
  staffAssistantService,
  withBlockedOwnerGuard,
} from "@chatbotx.io/business"
import { CHAT_LIMITS } from "@chatbotx.io/database/partials"
import {
  enqueueStaffAssistantReply,
  enqueueStaffAssistantWatch,
  type StaffAssistantWatchData,
} from "@chatbotx.io/worker-config"
import { UnrecoverableError } from "bullmq"
import { logger } from "../../lib/logger"
import {
  applyRunEvent,
  checkRunLimit,
  handleRunWatchError,
  processRunWindow,
  type ReadOutcome,
  type RunTracking,
  readOutputText,
  readRunEvents,
  settleRunStatus,
} from "./external-agent-run-follower"
import { stopRunQuietly, withRunLock } from "./external-agent-shared"

type Turn = NonNullable<Awaited<ReturnType<typeof loadStaffAssistantTurn>>>
type Watch = {
  data: StaffAssistantWatchData
  turn: Turn
  tracking: RunTracking
}

const stopAndClear = async (data: StaffAssistantWatchData): Promise<void> => {
  try {
    const client = await staffAssistantService.getClientForWorkspace(
      data.workspaceId,
    )
    if (client) {
      await stopRunQuietly(client, data.runId)
    }
  } catch (err) {
    logger.warn(
      { err, workspaceId: data.workspaceId, threadId: data.threadId },
      "Staff assistant: unable to stop run",
    )
  }
  const closed = await staffAssistantService.patchRunState({
    ...data,
    expectedRunId: data.runId,
    values: { runId: null, runStartedAt: null },
  })
  if (closed) {
    const member = await findStaffChatParticipant(data)
    if (member?.isWorkspaceMember) {
      await staffAssistantService.publishTyping({
        ...data,
        userId: member.userId,
        typing: false,
      })
    }
  }
}

const failRun = async (
  watch: Watch,
  reason: "unavailable" | "timeout",
  error: unknown,
) => {
  const { data, turn, tracking } = watch
  await staffAssistantService.postAssistantMessage({
    ...data,
    userId: turn.userId,
    expectedRunId: data.runId,
    dedupeKey: `staffAssistant:${data.runId}:failed`,
    message: { kind: "system", reason },
  })
  const closed = await staffAssistantService.patchRunState({
    ...data,
    expectedRunId: data.runId,
    values: {
      ...tracking,
      runId: null,
      runStartedAt: null,
      failureCount: (turn.state?.failureCount ?? 0) + 1,
      lastError: error instanceof Error ? error.message : String(error),
    },
  })
  if (closed) {
    await staffAssistantService.publishTyping({
      ...data,
      userId: turn.userId,
      typing: false,
    })
    await logProviderError({
      provider: "hermes",
      workspaceId: data.workspaceId,
      contactId: null,
      error,
    })
    logger.error(
      { err: error, workspaceId: data.workspaceId, threadId: data.threadId },
      "Staff assistant: run failed",
    )
  }
}

const completeRun = async (watch: Watch, output: string) => {
  const { data, turn, tracking } = watch
  const text =
    output ||
    readOutputText((await turn.runtime.client.getRun(data.runId)).output)
  if (text) {
    await staffAssistantService.postAssistantMessage({
      ...data,
      userId: turn.userId,
      expectedRunId: data.runId,
      dedupeKey: `staffAssistant:${data.runId}:final`,
      message: {
        kind: "comment",
        text: text.slice(0, CHAT_LIMITS.maxMessageLength),
      },
    })
  }
  const closed = await staffAssistantService.patchRunState({
    ...data,
    expectedRunId: data.runId,
    values: {
      ...tracking,
      runId: null,
      runStartedAt: null,
      failureCount: 0,
      lastError: null,
      ...(text ? { lastClientSendAt: new Date() } : {}),
    },
  })
  if (!closed) {
    return
  }
  await staffAssistantService.publishTyping({
    ...data,
    userId: turn.userId,
    typing: false,
  })
  const next = await loadStaffAssistantTurn(data)
  const lastMessage = next?.newMessages.at(-1)
  if (lastMessage) {
    await enqueueStaffAssistantReply({
      workspaceId: data.workspaceId,
      threadId: data.threadId,
      messageId: lastMessage.id,
    })
  }
}

const processLocked = async (
  data: StaffAssistantWatchData,
  read: ReadOutcome,
  isFinalAttempt: boolean,
): Promise<void> => {
  const turn = await loadStaffAssistantTurn(data)
  if (!turn) {
    await stopAndClear(data)
    return
  }
  const state = turn.state
  if (state?.runId !== data.runId) {
    await stopAndClear(data)
    return
  }
  const watch: Watch = {
    data,
    turn,
    tracking: {
      lastEventSeq: state.lastEventSeq,
      lastEventAt: state.lastEventAt,
      lastProgressSentAt: state.lastProgressSentAt,
      lastProgressText: state.lastProgressText,
      lastClientSendAt: state.lastClientSendAt,
    },
  }
  const stop = () => stopRunQuietly(turn.runtime.client, data.runId)
  const fail = (error: Error) => failRun(watch, "unavailable", error)
  const complete = (output: string) => completeRun(watch, output)
  const handleError = async (error: unknown) => {
    if (error instanceof HermesRequestError) {
      await failRun(watch, "unavailable", error)
      throw new UnrecoverableError(error.message)
    }
    await handleRunWatchError({
      error,
      isFinalAttempt,
      fail: (failure) => failRun(watch, "unavailable", failure),
    })
  }
  try {
    await processRunWindow(read, {
      lastEventSeq: state.lastEventSeq,
      applyEvent: (event) =>
        applyRunEvent(
          {
            tracking: watch.tracking,
            postInterim: async (text) => {
              const hash = createHash("sha256")
                .update(text)
                .digest("hex")
                .slice(0, 16)
              await staffAssistantService.postAssistantMessage({
                ...data,
                userId: turn.userId,
                expectedRunId: data.runId,
                dedupeKey: `staffAssistant:${data.runId}:interim-${watch.tracking.lastEventSeq}-${hash}`,
                message: {
                  kind: "comment",
                  text: text.slice(0, CHAT_LIMITS.maxMessageLength),
                },
              })
            },
            patchTracking: async (values) =>
              (await staffAssistantService.patchRunState({
                ...data,
                expectedRunId: data.runId,
                values,
              })) > 0,
            complete,
            fail,
            stop,
          },
          event,
        ),
      handleError,
      settleFromRunStatus: async () =>
        settleRunStatus(
          { complete, fail, stop },
          await turn.runtime.client.getRun(data.runId),
        ),
      checkRunProgress: async () => {
        const now = new Date()
        const withinLimit = await checkRunLimit({
          now,
          runStartedAt: state.runStartedAt ?? now,
          lastEventAt: watch.tracking.lastEventAt,
          maxRunMinutes: turn.runtime.agent.maxRunMinutes,
          stop,
          fail: (error) => failRun(watch, "timeout", error),
        })
        if (!withinLimit) {
          return false
        }
        return (
          (await staffAssistantService.patchRunState({
            ...data,
            expectedRunId: data.runId,
            values: watch.tracking,
          })) > 0
        )
      },
      enqueueWatch: async (delay) => {
        await enqueueStaffAssistantWatch(data, delay)
      },
    })
  } catch (error) {
    if (error instanceof UnrecoverableError || read.error === error) {
      throw error
    }
    await handleError(error)
  }
}

const runWatch = async (
  data: StaffAssistantWatchData,
  isFinalAttempt: boolean,
): Promise<void> => {
  const turn = await loadStaffAssistantTurn(data)
  if (!turn || turn.state?.runId !== data.runId) {
    await withRunLock(`staffAssistant:${data.threadId}`, () =>
      stopAndClear(data),
    )
    return
  }
  await staffAssistantService.publishTyping({
    ...data,
    userId: turn.userId,
    typing: true,
  })
  const read = await readRunEvents(
    turn.runtime.client,
    data.runId,
    turn.state.lastEventSeq,
  )
  await withRunLock(`staffAssistant:${data.threadId}`, () =>
    processLocked(data, read, isFinalAttempt),
  )
}

export const processStaffAssistantWatch = async (
  data: StaffAssistantWatchData,
  options: { isFinalAttempt: boolean },
): Promise<void> => {
  await withBlockedOwnerGuard(data.workspaceId, () =>
    runWatch(data, options.isFinalAttempt),
  )
}
