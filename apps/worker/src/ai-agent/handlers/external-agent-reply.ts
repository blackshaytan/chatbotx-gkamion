import {
  type BuildRunInputParams,
  buildRunInput,
  contactService,
  conversationService,
  type ExternalAgentRunInput,
  type ExternalAgentRuntime,
  externalAgentService,
  HermesAuthError,
  HermesRequestError,
  HermesUnavailableError,
  withBlockedOwnerGuard,
} from "@chatbotx.io/business"
import type { MessageWithAttachments } from "@chatbotx.io/database/repositories"
import type { ExternalAgentConversationStateModel } from "@chatbotx.io/database/types"
import { distributedStore } from "@chatbotx.io/redis"
import {
  type ExternalAgentReplyData,
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
  selectHistory,
  selectNewMessages,
  stopRunQuietly,
  toInputMessages,
  withExternalAgentLock,
} from "./external-agent-shared"

const HTTP_NOT_FOUND = 404
const RUN_INPUT_CACHE_TTL_SECONDS = 24 * 60 * 60
const MS_PER_MINUTE = 60_000
const ORPHANED_RUN_GRACE_MS = 5 * MS_PER_MINUTE

type ReplyOptions = { isFinalAttempt: boolean }

type ReplyTurn = {
  data: ExternalAgentReplyData
  context: ExternalAgentConversationContext
  runtime: ExternalAgentRuntime
  state: ExternalAgentConversationStateModel | undefined
  messages: MessageWithAttachments[]
  newMessages: MessageWithAttachments[]
  lastMessage: MessageWithAttachments
}

const isRunInput = (value: unknown): value is ExternalAgentRunInput =>
  typeof value === "object" &&
  value !== null &&
  "input" in value &&
  typeof value.input === "string" &&
  "instructions" in value &&
  typeof value.instructions === "string"

const buildTurnInput = async (
  turn: ReplyTurn,
  history: MessageWithAttachments[],
): Promise<ExternalAgentRunInput> => {
  const { workspaceId, conversationId } = turn.data
  const { conversation, contactInbox } = turn.context
  const contact = await contactService.findById({
    workspaceId,
    id: conversation.contactId,
  })
  const params: BuildRunInputParams = {
    messages: await toInputMessages(workspaceId, turn.newMessages),
    history: await toInputMessages(workspaceId, history),
    contact: { name: contact?.fullName ?? null },
    channel: contactInbox.channel,
    conversationId,
    contactId: conversation.contactId,
    workspaceId,
  }
  return buildRunInput(params)
}

/**
 * The run payload for one idempotency key. Attachment links are signed per
 * call, so a retry would send a different body and Hermes answers 409 to a
 * reused key with a different body; the first payload is kept and reused.
 */
const resolveRunInput = async (
  turn: ReplyTurn,
  idempotencyKey: string,
): Promise<ExternalAgentRunInput> => {
  const cacheKey = `externalAgent:runInput:${idempotencyKey}`
  const cached = await distributedStore.get<unknown>(cacheKey)
  if (isRunInput(cached)) {
    return cached
  }
  const includeHistory = turn.state?.includeHistory ?? true
  const runInput = await buildTurnInput(
    turn,
    includeHistory ? selectHistory(turn.messages, turn.newMessages) : [],
  )
  await distributedStore.put(cacheKey, runInput, RUN_INPUT_CACHE_TTL_SECONDS)
  return runInput
}

const clearRun = async (turn: ReplyTurn, runId: string): Promise<void> => {
  await externalAgentService.patchConversationState({
    workspaceId: turn.data.workspaceId,
    conversationId: turn.data.conversationId,
    values: { runId: null, runStartedAt: null },
    expectedRunId: runId,
  })
}

/** A run no watch job closed in time (the watch chain died) is never steered again. */
const isOrphanedRun = (turn: ReplyTurn): boolean => {
  const startedAt = turn.state?.runStartedAt
  if (!startedAt) {
    return true
  }
  const maxRunMs = turn.runtime.agent.maxRunMinutes * MS_PER_MINUTE
  return Date.now() - startedAt.getTime() > maxRunMs + ORPHANED_RUN_GRACE_MS
}

/** `true` when the new messages were handled by the active run (or re-queued for the next one). */
const steerActiveRun = async (
  turn: ReplyTurn,
  runId: string,
): Promise<boolean> => {
  if (isOrphanedRun(turn)) {
    await stopRunQuietly(turn.runtime.client, runId)
    await clearRun(turn, runId)
    return false
  }

  const { input } = await buildTurnInput(turn, [])
  let steer: { accepted: boolean }
  try {
    steer = await turn.runtime.client.steer(runId, input)
  } catch (error) {
    if (
      error instanceof HermesRequestError &&
      error.status === HTTP_NOT_FOUND
    ) {
      await clearRun(turn, runId)
      return false
    }
    throw error
  }

  if (!steer.accepted) {
    await enqueueExternalAgentReply({
      ...turn.data,
      messageId: turn.lastMessage.id,
    })
    return true
  }

  await externalAgentService.patchConversationState({
    workspaceId: turn.data.workspaceId,
    conversationId: turn.data.conversationId,
    values: {
      cursorAt: turn.lastMessage.createdAt,
      cursorMessageId: turn.lastMessage.id,
    },
    expectedRunId: runId,
  })
  return true
}

const startRun = async (turn: ReplyTurn): Promise<void> => {
  const { workspaceId, conversationId, contactInboxId } = turn.data
  const idempotencyKey = `${conversationId}:${turn.lastMessage.id}`
  const runInput = await resolveRunInput(turn, idempotencyKey)
  const { runId } = await turn.runtime.client.startRun({
    sessionKey: `chatbotx:${workspaceId}:${conversationId}`,
    idempotencyKey,
    input: runInput.input,
    instructions: runInput.instructions,
  })

  await externalAgentService.saveConversationState({
    workspaceId,
    conversationId,
    cursorAt: turn.lastMessage.createdAt,
    cursorMessageId: turn.lastMessage.id,
    includeHistory: false,
    runId,
    runStartedAt: new Date(),
    lastEventAt: null,
    lastEventSeq: -1,
    lastProgressSentAt: null,
    lastProgressText: null,
    progressFallbackSentAt: null,
  })
  await enqueueExternalAgentWatch({
    workspaceId,
    conversationId,
    contactInboxId,
    runId,
  })
}

const recordFailure = async (turn: ReplyTurn, error: Error): Promise<void> => {
  try {
    await externalAgentService.saveConversationState({
      workspaceId: turn.data.workspaceId,
      conversationId: turn.data.conversationId,
      failureCount: (turn.state?.failureCount ?? 0) + 1,
      lastError: error.message,
    })
  } catch (err) {
    logger.error(
      { err, conversationId: turn.data.conversationId },
      "External agent: unable to record the reply failure",
    )
  }
}

const failTurn = async (turn: ReplyTurn, error: Error): Promise<void> => {
  await handOverToHuman({
    ref: turn.data,
    context: turn.context,
    event: "unavailable",
    error,
  })
  await recordFailure(turn, error)
}

const handleReplyError = async (
  turn: ReplyTurn,
  error: unknown,
  options: ReplyOptions,
): Promise<void> => {
  if (error instanceof HermesAuthError || error instanceof HermesRequestError) {
    await failTurn(turn, error)
    throw new UnrecoverableError(error.message)
  }
  if (error instanceof HermesUnavailableError) {
    if (!options.isFinalAttempt) {
      throw error
    }
    await failTurn(turn, error)
    return
  }
  throw error
}

const runReply = async (
  data: ExternalAgentReplyData,
  options: ReplyOptions,
): Promise<void> => {
  const context = await loadConversationContext(data)
  if (!context) {
    return
  }
  if (!(await conversationService.ensureActive(context.conversation))) {
    return
  }
  const runtime = await externalAgentService.getRuntime({
    workspaceId: data.workspaceId,
    inboxId: context.contactInbox.inboxId,
  })
  if (!runtime) {
    return
  }

  const state = await externalAgentService.findConversationState({
    workspaceId: data.workspaceId,
    conversationId: data.conversationId,
  })
  const messages = await listRecentMessages(data)
  const newMessages = selectNewMessages({
    messages,
    cursorAt: state?.cursorAt ?? null,
    cursorMessageId: state?.cursorMessageId ?? null,
    triggerMessageId: data.messageId,
  })
  const lastMessage = newMessages.at(-1)
  if (!lastMessage) {
    return
  }

  const turn: ReplyTurn = {
    data,
    context,
    runtime,
    state,
    messages,
    newMessages,
    lastMessage,
  }
  try {
    if (state?.runId && (await steerActiveRun(turn, state.runId))) {
      return
    }
    await startRun(turn)
  } catch (error) {
    await handleReplyError(turn, error, options)
  }
}

/**
 * Forwards the contact's new messages to Hermes: steers the active run, or
 * starts a new one and hands it to `externalAgentWatch`. One conversation is
 * handled at a time; the cursor moves only after Hermes accepted the messages.
 */
export const processExternalAgentReply = async (
  data: ExternalAgentReplyData,
  options: ReplyOptions,
): Promise<void> => {
  await withBlockedOwnerGuard(data.workspaceId, () =>
    withExternalAgentLock(data.conversationId, () => runReply(data, options)),
  )
}
