import {
  buildStaffRunInput,
  type ExternalAgentRunInput,
  HermesAuthError,
  HermesRequestError,
  HermesUnavailableError,
  loadStaffAssistantTurn,
  logProviderError,
  staffAssistantService,
  toStaffAssistantInputMessages,
  withBlockedOwnerGuard,
} from "@chatbotx.io/business"
import { distributedStore } from "@chatbotx.io/redis"
import {
  enqueueStaffAssistantReply,
  enqueueStaffAssistantWatch,
  type StaffAssistantReplyData,
} from "@chatbotx.io/worker-config"
import { UnrecoverableError } from "bullmq"
import { logger } from "../../lib/logger"
import { stopRunQuietly, withRunLock } from "./external-agent-shared"

const CACHE_TTL_SECONDS = 24 * 60 * 60
const ORPHAN_GRACE_MS = 5 * 60_000
type Turn = NonNullable<Awaited<ReturnType<typeof loadStaffAssistantTurn>>>

const buildInput = async (
  turn: Turn,
  includeHistory: boolean,
): Promise<ExternalAgentRunInput> => {
  const [messages, history] = await Promise.all([
    toStaffAssistantInputMessages({
      workspaceId: turn.workspaceId,
      userId: turn.userId,
      messages: turn.newMessages,
    }),
    toStaffAssistantInputMessages({
      workspaceId: turn.workspaceId,
      userId: turn.userId,
      messages: includeHistory ? turn.history : [],
    }),
  ])
  return buildStaffRunInput({
    workspaceId: turn.workspaceId,
    threadId: turn.threadId,
    userId: turn.userId,
    name: turn.name,
    role: turn.role,
    permissions: turn.permissions,
    messages,
    history,
  })
}

const cachedInput = async (
  turn: Turn,
  key: string,
): Promise<ExternalAgentRunInput> => {
  const cacheKey = `staffAssistant:runInput:${key}`
  const cached = await distributedStore.get<unknown>(cacheKey)
  if (
    typeof cached === "object" &&
    cached !== null &&
    "input" in cached &&
    typeof cached.input === "string" &&
    "instructions" in cached &&
    typeof cached.instructions === "string"
  ) {
    return { input: cached.input, instructions: cached.instructions }
  }
  const value = await buildInput(turn, turn.state?.includeHistory ?? true)
  await distributedStore.put(cacheKey, value, CACHE_TTL_SECONDS)
  return value
}

const processTurn = async (
  data: StaffAssistantReplyData,
  isFinalAttempt: boolean,
): Promise<void> => {
  const turn = await loadStaffAssistantTurn(data)
  const lastMessage = turn?.newMessages.at(-1)
  if (!(turn && lastMessage)) {
    return
  }
  const ref = { workspaceId: data.workspaceId, threadId: data.threadId }
  let activeRunId = turn.state?.runId ?? null
  try {
    const existingRun = activeRunId
    if (existingRun) {
      const started = turn.state?.runStartedAt
      const orphaned =
        !started ||
        Date.now() - started.getTime() >
          turn.runtime.agent.maxRunMinutes * 60_000 + ORPHAN_GRACE_MS
      if (orphaned) {
        await stopRunQuietly(turn.runtime.client, existingRun)
        await staffAssistantService.patchRunState({
          ...ref,
          expectedRunId: existingRun,
          values: { runId: null, runStartedAt: null },
        })
        activeRunId = null
        await staffAssistantService.publishTyping({
          ...ref,
          userId: turn.userId,
          typing: false,
        })
      } else {
        try {
          const result = await turn.runtime.client.steer(
            existingRun,
            (await buildInput(turn, false)).input,
          )
          if (!result.accepted) {
            await enqueueStaffAssistantReply({
              ...data,
              messageId: lastMessage.id,
            })
            return
          }
          await staffAssistantService.patchRunState({
            ...ref,
            expectedRunId: existingRun,
            values: {
              cursorAt: lastMessage.createdAt,
              cursorMessageId: lastMessage.id,
            },
          })
          return
        } catch (error) {
          if (error instanceof HermesRequestError && error.status === 409) {
            await enqueueStaffAssistantReply({
              ...data,
              messageId: lastMessage.id,
            })
            return
          }
          if (!(error instanceof HermesRequestError && error.status === 404)) {
            throw error
          }
          await staffAssistantService.patchRunState({
            ...ref,
            expectedRunId: existingRun,
            values: { runId: null, runStartedAt: null },
          })
          activeRunId = null
          await staffAssistantService.publishTyping({
            ...ref,
            userId: turn.userId,
            typing: false,
          })
        }
      }
    }

    const idempotencyKey = `staff:${data.threadId}:${lastMessage.id}`
    const body = await cachedInput(turn, idempotencyKey)
    const { runId } = await turn.runtime.client.startRun({
      sessionKey: `chatbotx:${data.workspaceId}:staff:${turn.userId}`,
      idempotencyKey,
      ...body,
    })
    await staffAssistantService.saveRunState({
      ...ref,
      values: {
        cursorAt: lastMessage.createdAt,
        cursorMessageId: lastMessage.id,
        includeHistory: false,
        runId,
        runStartedAt: new Date(),
        lastEventAt: null,
        lastEventSeq: -1,
        lastProgressSentAt: null,
        lastProgressText: null,
        lastClientSendAt: null,
      },
    })
    await enqueueStaffAssistantWatch({ ...ref, runId })
    await staffAssistantService.publishTyping({
      ...ref,
      userId: turn.userId,
      typing: true,
    })
  } catch (error) {
    if (error instanceof HermesUnavailableError && !isFinalAttempt) {
      throw error
    }
    if (
      !(
        error instanceof HermesUnavailableError ||
        error instanceof HermesAuthError ||
        error instanceof HermesRequestError
      )
    ) {
      throw error
    }
    if (activeRunId) {
      await stopRunQuietly(turn.runtime.client, activeRunId)
      await staffAssistantService.postAssistantMessage({
        ...ref,
        userId: turn.userId,
        dedupeKey: `staffAssistant:${activeRunId}:failed`,
        expectedRunId: activeRunId,
        message: { kind: "system", reason: "unavailable" },
      })
      await staffAssistantService.patchRunState({
        ...ref,
        expectedRunId: activeRunId,
        values: {
          runId: null,
          runStartedAt: null,
          failureCount: (turn.state?.failureCount ?? 0) + 1,
          lastError: error.message,
        },
      })
      await staffAssistantService.publishTyping({
        ...ref,
        userId: turn.userId,
        typing: false,
      })
    } else {
      await staffAssistantService.saveRunState({
        ...ref,
        values: {
          failureCount: (turn.state?.failureCount ?? 0) + 1,
          lastError: error.message,
        },
      })
      await staffAssistantService.postAssistantMessage({
        ...ref,
        userId: turn.userId,
        dedupeKey: `staffAssistant:${data.threadId}:${lastMessage.id}:failed`,
        message: { kind: "system", reason: "unavailable" },
      })
    }
    await logProviderError({
      provider: "hermes",
      workspaceId: data.workspaceId,
      contactId: null,
      error,
    })
    logger.error({ err: error, ...ref }, "Staff assistant: reply failed")
    if (
      error instanceof HermesAuthError ||
      error instanceof HermesRequestError
    ) {
      throw new UnrecoverableError(error.message)
    }
  }
}

export const processStaffAssistantReply = async (
  data: StaffAssistantReplyData,
  options: { isFinalAttempt: boolean },
): Promise<void> => {
  await withBlockedOwnerGuard(data.workspaceId, () =>
    withRunLock(`staffAssistant:${data.threadId}`, () =>
      processTurn(data, options.isFinalAttempt),
    ),
  )
}
