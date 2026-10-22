import { db } from "@chatbotx.io/database/client"
import {
  type ConversationHandoverCategory,
  EXTERNAL_AGENT_ACTIVITY_TYPE,
  EXTERNAL_AGENT_DEFAULT_MAX_RUN_MINUTES,
  EXTERNAL_AGENT_DEFAULT_PROGRESS_MESSAGE,
  EXTERNAL_AGENT_MAX_RUN_MINUTES_LIMIT,
  type ExternalAgentActivityEvent,
  type ExternalAgentProvider,
  externalAgentApiKeySchema,
  externalAgentCheckStatuses,
} from "@chatbotx.io/database/partials"
import {
  createMessageRepository,
  type ExternalAgentConversationStatePatch,
  externalAgentRepository,
  externalAgentStateRepository,
} from "@chatbotx.io/database/repositories"
import type {
  ExternalAgentConversationStateModel,
  ExternalAgentModel,
  MessageModel,
} from "@chatbotx.io/database/types"
import { encryptUtils } from "@chatbotx.io/encryption"
import { RealtimeEventType } from "@chatbotx.io/partysocket-config"
import { distributedStore, withCache } from "@chatbotx.io/redis"
import { createId } from "@chatbotx.io/utils"
import {
  ChatJobAction,
  chatQueue,
  NotificationJobAction,
  notificationQueue,
} from "@chatbotx.io/worker-config"
import type { z } from "zod"
import { BaseService } from "../base.service"
import { contactInboxService } from "../contact-inbox/service"
import {
  conversationService,
  type TriggerContext,
} from "../conversation/service"
import { logProviderError } from "../error-log/service"
import { ChatbotXException, notFoundException } from "../errors"
import { inboxService } from "../inbox/service"
import { logger } from "../logger"
import { publishToWorkspaceParty } from "../platform/realtime-broadcast"
import {
  createHermesClient,
  HermesAuthError,
  type HermesClient,
  HermesRequestError,
  HermesUnavailableError,
} from "./hermes-client"

const EXTERNAL_AGENT_TEST_THROTTLE_SECONDS = 10
const RESUME_AFTER_HOURS_MIN = 1
const RESUME_AFTER_HOURS_MAX = 720
const MAX_RUN_MINUTES_MIN = 1
const REASON_MAX_LENGTH = 500
const BOT_NAME_MAX_LENGTH = 40
const MINUTE_MS = 60_000
const TRAILING_SLASHES = /\/+$/
const ALLOWED_PROTOCOLS = new Set(["http:", "https:"])
const GENERIC_CHECK_ERROR = "External agent check failed"

export const EXTERNAL_AGENT_HANDOVER_CLIENT_TEXT =
  "Передал ваш запрос менеджеру"

const HANDOVER_TRIGGER_CONTEXT: TriggerContext = {
  triggerSource: "system",
  triggerHandler: "externalAgent",
  triggerType: "external_agent_handover",
}

const FAILURE_TRIGGER_CONTEXT: TriggerContext = {
  triggerSource: "system",
  triggerHandler: "externalAgent",
  triggerType: "external_agent_failure",
}

export const externalAgentCacheTag = (workspaceId: string): string =>
  `externalAgent:${workspaceId}`

const settingsCacheKey = (workspaceId: string): string =>
  `externalAgent:settings:${workspaceId}`

const apiKeyAad = (workspaceId: string): string =>
  `external-agent:${workspaceId}`

const testThrottleKey = (workspaceId: string): string =>
  `externalAgent:test:${workspaceId}`

export type ExternalAgentCheckStatus = z.infer<
  typeof externalAgentCheckStatuses
>

export type ExternalAgentSettings = {
  enabled: boolean
  provider: ExternalAgentProvider
  baseUrl: string
  hasApiKey: boolean
  botName: string | null
  signMessages: boolean
  announceManager: boolean
  inboxIds: string[]
  resumeAfterHours: number | null
  maxRunMinutes: number
  progressMessage: string
  lastCheckedAt: Date | null
  lastCheckStatus: ExternalAgentCheckStatus | null
  lastCheckError: string | null
}

export type UpdateExternalAgentInput = {
  enabled?: boolean
  baseUrl?: string
  /** Write-only; blank or omitted keeps the stored key. */
  apiKey?: string
  /** Blank becomes null; used only when signing external-agent replies. */
  botName?: string | null
  signMessages?: boolean
  announceManager?: boolean
  inboxIds?: string[]
  resumeAfterHours?: number | null
  maxRunMinutes?: number
  progressMessage?: string
}

export type ExternalAgentCheckResult = {
  status: ExternalAgentCheckStatus
  error: string | null
  checkedAt: Date
}

export type ExternalAgentRuntime = {
  agent: ExternalAgentModel
  client: HermesClient
}

export type WriteExternalAgentActivityInput = {
  workspaceId: string
  conversationId: string
  contactInboxId: string
  event: ExternalAgentActivityEvent
  reason?: string
  category?: ConversationHandoverCategory
  /** When set, `ContactInbox.lastMessageAt` is moved forward so the note is visible. */
  contactId?: string
}

export type ExternalAgentHandoverInput = {
  workspaceId: string
  conversationId: string
  reason: string
  /** Defaults to `other`. */
  category?: ConversationHandoverCategory
}

export type ExternalAgentHandoverResult = {
  conversationId: string
  botEnabled: false
}

export type ExternalAgentFailToHumanInput = {
  workspaceId: string
  conversationId: string
  contactInboxId: string
  event: Extract<ExternalAgentActivityEvent, "unavailable" | "timeout">
  error: unknown
  sendText: (text: string) => Promise<void>
}

const ACTIVITY_TEXT: Record<
  ExternalAgentActivityEvent,
  (reason: string | undefined) => string
> = {
  handover: (reason) =>
    reason
      ? `AI agent handed the conversation over to a manager: ${reason}`
      : "AI agent handed the conversation over to a manager",
  unavailable: () =>
    "AI agent is unavailable, the conversation was handed over to a manager",
  timeout: () =>
    "AI agent did not finish the reply, the conversation was handed over to a manager",
}

const badRequest = (message: string, code: string): ChatbotXException =>
  new ChatbotXException(message, code, 400)

const normalizeBaseUrl = (raw: string): string => {
  const trimmed = raw.trim()
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw badRequest("Base URL is not a valid URL", "invalidExternalAgentUrl")
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw badRequest(
      "Base URL must use http or https",
      "invalidExternalAgentUrl",
    )
  }
  if (url.username || url.password) {
    throw badRequest(
      "Base URL must not contain credentials",
      "invalidExternalAgentUrl",
    )
  }
  return trimmed.replace(TRAILING_SLASHES, "")
}

const assertIntegerInRange = (
  value: number,
  range: { min: number; max: number },
  message: string,
): void => {
  if (!Number.isInteger(value) || value < range.min || value > range.max) {
    throw badRequest(message, "invalidExternalAgentSettings")
  }
}

const normalizeReason = (reason: string | undefined): string | undefined => {
  const trimmed = reason?.trim()
  return trimmed ? trimmed.slice(0, REASON_MAX_LENGTH) : undefined
}

const normalizeBotName = (value: string | null): string | null => {
  const name = value.trim()
  if (!name) {
    return null
  }
  if (name.length > BOT_NAME_MAX_LENGTH) {
    throw badRequest(
      `botName must be at most ${BOT_NAME_MAX_LENGTH} characters`,
      "invalidExternalAgentSettings",
    )
  }
  return name
}

/** Hermes errors carry no secrets; anything else is reported generically. */
const describeCheckError = (error: unknown): string => {
  if (
    error instanceof HermesAuthError ||
    error instanceof HermesUnavailableError ||
    error instanceof HermesRequestError
  ) {
    return error.message
  }
  return GENERIC_CHECK_ERROR
}

const toSettings = (
  agent: ExternalAgentModel & { inboxIds: string[] },
): ExternalAgentSettings => {
  const lastCheckStatus = externalAgentCheckStatuses.safeParse(
    agent.lastCheckStatus,
  )
  return {
    enabled: agent.enabled,
    provider: agent.provider,
    baseUrl: agent.baseUrl,
    hasApiKey: Boolean(agent.apiKey),
    botName: agent.botName,
    signMessages: agent.signMessages,
    announceManager: agent.announceManager,
    inboxIds: agent.inboxIds,
    resumeAfterHours: agent.resumeAfterHours,
    maxRunMinutes: agent.maxRunMinutes,
    progressMessage: agent.progressMessage,
    lastCheckedAt: agent.lastCheckedAt,
    lastCheckStatus: lastCheckStatus.success ? lastCheckStatus.data : null,
    lastCheckError: agent.lastCheckError,
  }
}

const runBestEffort = async (
  step: string,
  context: Record<string, unknown>,
  fn: () => Promise<unknown>,
): Promise<void> => {
  try {
    await fn()
  } catch (err) {
    logger.error(
      { err, ...context, step },
      "External agent: fail-to-human step failed",
    )
  }
}

export class ExternalAgentService extends BaseService {
  async get(workspaceId: string): Promise<ExternalAgentSettings | null> {
    return await withCache(
      settingsCacheKey(workspaceId),
      async (): Promise<ExternalAgentSettings | null> => {
        const agent = await externalAgentRepository.findByWorkspace(workspaceId)
        return agent ? toSettings(agent) : null
      },
      { tags: [externalAgentCacheTag(workspaceId)] },
    )
  }

  async update(
    workspaceId: string,
    input: UpdateExternalAgentInput,
  ): Promise<ExternalAgentSettings> {
    const existing = await externalAgentRepository.findByWorkspace(workspaceId)

    const baseUrl =
      input.baseUrl === undefined
        ? existing?.baseUrl
        : normalizeBaseUrl(input.baseUrl)
    if (!baseUrl) {
      throw badRequest("Base URL is required", "externalAgentBaseUrlRequired")
    }
    const apiKey = input.apiKey?.trim()
    const botName =
      input.botName === undefined
        ? (existing?.botName ?? null)
        : normalizeBotName(input.botName)
    if (input.maxRunMinutes !== undefined) {
      assertIntegerInRange(
        input.maxRunMinutes,
        {
          min: MAX_RUN_MINUTES_MIN,
          max: EXTERNAL_AGENT_MAX_RUN_MINUTES_LIMIT,
        },
        `maxRunMinutes must be an integer from ${MAX_RUN_MINUTES_MIN} to ${EXTERNAL_AGENT_MAX_RUN_MINUTES_LIMIT}`,
      )
    }
    if (
      input.resumeAfterHours !== undefined &&
      input.resumeAfterHours !== null
    ) {
      assertIntegerInRange(
        input.resumeAfterHours,
        { min: RESUME_AFTER_HOURS_MIN, max: RESUME_AFTER_HOURS_MAX },
        `resumeAfterHours must be null or an integer from ${RESUME_AFTER_HOURS_MIN} to ${RESUME_AFTER_HOURS_MAX}`,
      )
    }
    const inboxIds =
      input.inboxIds === undefined ? undefined : [...new Set(input.inboxIds)]
    if (inboxIds) {
      await this.assertInboxesBelongToWorkspace({ workspaceId, inboxIds })
    }

    const encryptedApiKey = apiKey
      ? await encryptUtils.encryptObject(
          externalAgentApiKeySchema.parse({ apiKey }),
          apiKeyAad(workspaceId),
        )
      : existing?.apiKey
    if (!encryptedApiKey) {
      throw badRequest("API key is required", "externalAgentApiKeyRequired")
    }

    const agent = await db.transaction(
      async (tx) =>
        await externalAgentRepository.upsert(
          {
            workspaceId,
            values: {
              provider: existing?.provider ?? "hermes",
              baseUrl,
              apiKey: encryptedApiKey,
              enabled: input.enabled ?? existing?.enabled ?? false,
              botName,
              signMessages:
                input.signMessages ?? existing?.signMessages ?? false,
              announceManager:
                input.announceManager ?? existing?.announceManager ?? false,
              resumeAfterHours:
                input.resumeAfterHours === undefined
                  ? (existing?.resumeAfterHours ?? null)
                  : input.resumeAfterHours,
              maxRunMinutes:
                input.maxRunMinutes ??
                existing?.maxRunMinutes ??
                EXTERNAL_AGENT_DEFAULT_MAX_RUN_MINUTES,
              progressMessage:
                input.progressMessage === undefined
                  ? (existing?.progressMessage ??
                    EXTERNAL_AGENT_DEFAULT_PROGRESS_MESSAGE)
                  : input.progressMessage.trim(),
            },
            inboxIds,
          },
          tx,
        ),
    )
    await this.invalidateCacheTags(externalAgentCacheTag(workspaceId))

    return toSettings({
      ...agent,
      inboxIds: inboxIds ?? existing?.inboxIds ?? [],
    })
  }

  async test(workspaceId: string): Promise<ExternalAgentCheckResult> {
    const agent = await externalAgentRepository.findByWorkspace(workspaceId)
    if (!agent) {
      throw notFoundException("External agent is not configured")
    }
    const acquired = await distributedStore.setNumberIfNotExists(
      testThrottleKey(workspaceId),
      1,
      EXTERNAL_AGENT_TEST_THROTTLE_SECONDS,
    )
    if (!acquired) {
      throw new ChatbotXException(
        "External agent check was run recently, try again in a few seconds",
        "externalAgentTestThrottled",
        429,
      )
    }

    let result: ExternalAgentCheckResult
    try {
      const client = await this.createClient(agent)
      await client.health()
      result = { status: "ok", error: null, checkedAt: new Date() }
    } catch (err) {
      logger.warn({ err, workspaceId }, "External agent: check failed")
      result = {
        status: "error",
        error: describeCheckError(err),
        checkedAt: new Date(),
      }
    }

    await externalAgentRepository.updateCheck({ workspaceId, ...result })
    await this.invalidateCacheTags(externalAgentCacheTag(workspaceId))
    return result
  }

  async getRuntime(input: {
    workspaceId: string
    inboxId: string
  }): Promise<ExternalAgentRuntime | null> {
    const agent = await externalAgentRepository.findActiveForInbox(input)
    if (!agent) {
      return null
    }
    return { agent, client: await this.createClient(agent) }
  }

  async getRuntimeForWorkspace(
    workspaceId: string,
  ): Promise<ExternalAgentRuntime | null> {
    const agent = await externalAgentRepository.findByWorkspace(workspaceId)
    if (!agent?.enabled) {
      return null
    }
    return { agent, client: await this.createClient(agent) }
  }

  async findConversationState(input: {
    workspaceId: string
    conversationId: string
  }): Promise<ExternalAgentConversationStateModel | undefined> {
    return await externalAgentStateRepository.find(input)
  }

  async saveConversationState(
    values: ExternalAgentConversationStatePatch & {
      workspaceId: string
      conversationId: string
    },
  ): Promise<void> {
    await externalAgentStateRepository.upsert(values)
  }

  /** Returns the number of updated rows; `0` when `expectedRunId` no longer matches. */
  async patchConversationState(input: {
    workspaceId: string
    conversationId: string
    values: ExternalAgentConversationStatePatch
    expectedRunId?: string
  }): Promise<number> {
    return await externalAgentStateRepository.patch(input)
  }

  /** Writes the inbox note; `true` when new (a repeat within the same minute is not duplicated). */
  async writeActivity(
    input: WriteExternalAgentActivityInput,
  ): Promise<boolean> {
    const { workspaceId, conversationId, contactInboxId, event, contactId } =
      input
    const reason = normalizeReason(input.reason)
    const now = new Date()
    const minuteBucket = Math.floor(now.getTime() / MINUTE_MS)

    const repository = await createMessageRepository()
    const { message, isNew } = await repository.createOrUpdate({
      id: createId(),
      conversationId,
      contactInboxId,
      workspaceId,
      sourceId: `externalAgent:${event}:${conversationId}:${minuteBucket}`,
      senderType: "system",
      senderId: null,
      messageType: "activity",
      text: ACTIVITY_TEXT[event](reason),
      contentType: "text",
      contentAttributes: {
        type: EXTERNAL_AGENT_ACTIVITY_TYPE,
        event,
        ...(reason ? { reason } : {}),
        ...(input.category ? { category: input.category } : {}),
      },
      createdAt: now,
    })
    if (!isNew) {
      return false
    }

    if (contactId) {
      await this.bumpLastMessageAt({
        workspaceId,
        contactId,
        contactInboxId,
        at: now,
      })
    }
    try {
      publishToWorkspaceParty(workspaceId, {
        eventType: RealtimeEventType.messageCreated,
        data: { ...(message as MessageModel), attachments: [] },
      })
    } catch (err) {
      logger.warn(
        { err, conversationId },
        "External agent: unable to publish the activity message",
      )
    }
    return true
  }

  async handover(
    input: ExternalAgentHandoverInput,
  ): Promise<ExternalAgentHandoverResult> {
    const { workspaceId, conversationId, category = "other" } = input
    const conversation = await conversationService.findByUncached({
      where: { id: conversationId, workspaceId },
    })
    if (!conversation) {
      throw notFoundException("Conversation not found")
    }

    const wasBotEnabled = conversation.botEnabled
    if (wasBotEnabled) {
      await conversationService.disableBotState({
        workspaceId,
        conversations: [
          { id: conversation.id, contactId: conversation.contactId },
        ],
        triggerContext: HANDOVER_TRIGGER_CONTEXT,
        noAutoResume: true,
        handoverCategory: category,
      })
    }

    try {
      const contactInbox = await contactInboxService.findRecentByContactId({
        workspaceId,
        contactId: conversation.contactId,
      })
      // The agent's own run is stopped once the bot is off, so its reply
      // never reaches the client; the platform confirms the handover instead.
      if (contactInbox && wasBotEnabled) {
        await chatQueue
          .add(ChatJobAction.sendChatMessage, {
            type: ChatJobAction.sendChatMessage,
            data: {
              conversation,
              contactInbox,
              text: EXTERNAL_AGENT_HANDOVER_CLIENT_TEXT,
            },
          })
          .catch((err: unknown) => {
            logger.error(
              { err, conversationId },
              "External agent: unable to send the handover confirmation",
            )
          })
      }
      if (contactInbox) {
        await this.writeActivity({
          workspaceId,
          conversationId,
          contactInboxId: contactInbox.id,
          contactId: conversation.contactId,
          event: "handover",
          reason: input.reason,
          category,
        })
      } else {
        logger.warn(
          { conversationId },
          "External agent: no contact inbox for the handover note",
        )
      }
    } catch (err) {
      logger.error(
        { err, conversationId },
        "External agent: unable to write the handover note",
      )
    }

    if (wasBotEnabled) {
      await notificationQueue
        .add(NotificationJobAction.notifyAgentHandover, {
          type: NotificationJobAction.notifyAgentHandover,
          data: {
            workspaceId,
            conversationId,
            category,
            reason: normalizeReason(input.reason) ?? "",
          },
        })
        .catch((err: unknown) => {
          logger.error(
            { err, conversationId },
            "External agent: unable to enqueue the handover notification",
          )
        })
    }

    return { conversationId, botEnabled: false }
  }

  /** Every step is best-effort, so one failure does not skip the rest. */
  async failToHuman(input: ExternalAgentFailToHumanInput): Promise<void> {
    const { workspaceId, conversationId, contactInboxId, event, error } = input
    const context = { workspaceId, conversationId, event }

    const found = await conversationService
      .findByUncached({ where: { id: conversationId, workspaceId } })
      .catch((err: unknown) => {
        logger.error(
          { err, ...context, step: "loadConversation" },
          "External agent: fail-to-human step failed",
        )
        return
      })

    if (found?.botEnabled) {
      await runBestEffort("sendText", context, () =>
        input.sendText(EXTERNAL_AGENT_HANDOVER_CLIENT_TEXT),
      )
      await runBestEffort("disableBotState", context, () =>
        conversationService.disableBotState({
          workspaceId,
          conversations: [{ id: found.id, contactId: found.contactId }],
          triggerContext: FAILURE_TRIGGER_CONTEXT,
        }),
      )
    }
    if (found) {
      await runBestEffort("writeActivity", context, () =>
        this.writeActivity({
          workspaceId,
          conversationId,
          contactInboxId,
          contactId: found.contactId,
          event,
        }),
      )
    }
    await runBestEffort("logProviderError", context, () =>
      logProviderError({
        provider: "hermes",
        workspaceId,
        contactId: found?.contactId ?? null,
        error,
      }),
    )
  }

  private async createClient(agent: ExternalAgentModel): Promise<HermesClient> {
    const { apiKey } = await encryptUtils.decryptObject(
      agent.apiKey,
      externalAgentApiKeySchema,
      apiKeyAad(agent.workspaceId),
    )
    return createHermesClient({ baseUrl: agent.baseUrl, apiKey })
  }

  private async assertInboxesBelongToWorkspace(input: {
    workspaceId: string
    inboxIds: string[]
  }): Promise<void> {
    if (input.inboxIds.length === 0) {
      return
    }
    const found = await inboxService.listLabelsByIds({
      workspaceId: input.workspaceId,
      ids: input.inboxIds,
    })
    const foundIds = new Set(found.map((inbox) => inbox.id))
    if (input.inboxIds.some((id) => !foundIds.has(id))) {
      throw badRequest(
        "Some inboxes do not belong to this workspace",
        "invalidExternalAgentInbox",
      )
    }
  }

  /** The message list pages from `ContactInbox.lastMessageAt`; a failed bump only delays visibility. */
  private async bumpLastMessageAt(input: {
    workspaceId: string
    contactId: string
    contactInboxId: string
    at: Date
  }): Promise<void> {
    try {
      await contactInboxService.bulkUpdateTracking({
        rows: [
          {
            contactInboxId: input.contactInboxId,
            contactId: input.contactId,
            workspaceId: input.workspaceId,
            firstInteractionAt: input.at,
            lastMessageAt: input.at,
            lastIncomingMessageAt: null,
          },
        ],
      })
    } catch (err) {
      logger.warn(
        { err, contactInboxId: input.contactInboxId },
        "External agent: unable to bump the contact inbox lastMessageAt",
      )
    }
  }
}

export const externalAgentService = new ExternalAgentService()
