import { db } from "@chatbotx.io/database/client"
import {
  EXTERNAL_AGENT_DEFAULT_MAX_RUN_MINUTES,
  EXTERNAL_AGENT_DEFAULT_PROGRESS_MESSAGE,
  EXTERNAL_AGENT_MAX_RUN_MINUTES_LIMIT,
  externalAgentApiKeySchema,
  externalAgentCheckStatuses,
} from "@chatbotx.io/database/partials"
import {
  externalAgentRepository,
  workspaceApiTokenRepository,
} from "@chatbotx.io/database/repositories"
import type { ExternalAgentModel } from "@chatbotx.io/database/types"
import { encryptUtils } from "@chatbotx.io/encryption"
import { distributedStore, withCache } from "@chatbotx.io/redis"
import { BaseService } from "../base.service"
import { ChatbotXException, notFoundException } from "../errors"
import { createHermesClient } from "../external-agent/hermes-client"
import {
  describeExternalAgentCheckError,
  type ExternalAgentCheckResult,
  type ExternalAgentRuntime,
  normalizeExternalAgentBaseUrl,
  normalizeExternalAgentBotName,
} from "../external-agent/service"
import { logger } from "../logger"

const staffTag = (workspaceId: string) => `externalAgent:${workspaceId}:staff`
const staffAad = (workspaceId: string) => `external-agent:${workspaceId}:staff`
const badRequest = (message: string) =>
  new ChatbotXException(message, "invalidStaffAssistantSettings", 400)

export type UpdateStaffAssistantInput = {
  enabled?: boolean
  baseUrl?: string
  apiKey?: string
  botName?: string | null
  maxRunMinutes?: number
  apiTokenId?: string | null
}

export type StaffAssistantSettings = {
  enabled: boolean
  baseUrl: string
  hasApiKey: boolean
  botName: string | null
  maxRunMinutes: number
  apiTokenId: string | null
  tokenHasChatsScope: boolean
  available: boolean
  lastCheckedAt: Date | null
  lastCheckStatus: "ok" | "error" | null
  lastCheckError: string | null
}

const toSettings = (agent: ExternalAgentModel) => {
  const status = externalAgentCheckStatuses.safeParse(agent.lastCheckStatus)
  return {
    enabled: agent.enabled,
    baseUrl: agent.baseUrl,
    hasApiKey: Boolean(agent.apiKey),
    botName: agent.botName,
    maxRunMinutes: agent.maxRunMinutes,
    apiTokenId: agent.apiTokenId,
    lastCheckedAt: agent.lastCheckedAt,
    lastCheckStatus: status.success ? status.data : null,
    lastCheckError: agent.lastCheckError,
  }
}

const tokenHasChats = async (workspaceId: string, tokenId: string | null) => {
  if (!tokenId) {
    return false
  }
  const token = await workspaceApiTokenRepository.findScopesForWorkspace({
    workspaceId,
    id: tokenId,
  })
  return token?.scopes?.includes("chats") === true
}

export class StaffAssistantService extends BaseService {
  async get(workspaceId: string): Promise<StaffAssistantSettings | null> {
    const settings = await withCache(
      `externalAgent:settings:${workspaceId}:staff`,
      async () => {
        const agent = await externalAgentRepository.findByWorkspace(
          workspaceId,
          "staff",
        )
        return agent ? toSettings(agent) : null
      },
      { tags: [staffTag(workspaceId)] },
    )
    if (!settings) {
      return null
    }
    const tokenHasChatsScope = await tokenHasChats(
      workspaceId,
      settings.apiTokenId,
    )
    return {
      ...settings,
      tokenHasChatsScope,
      available: Boolean(
        settings.enabled &&
          settings.baseUrl &&
          settings.hasApiKey &&
          settings.botName &&
          tokenHasChatsScope,
      ),
    }
  }

  async update(
    workspaceId: string,
    input: UpdateStaffAssistantInput,
  ): Promise<StaffAssistantSettings> {
    if ("inboxIds" in input) {
      throw badRequest("Staff assistant does not support inboxes")
    }
    const existing = await externalAgentRepository.findByWorkspace(
      workspaceId,
      "staff",
    )
    const baseUrl =
      input.baseUrl === undefined
        ? existing?.baseUrl
        : normalizeExternalAgentBaseUrl(input.baseUrl)
    const botName =
      input.botName === undefined
        ? (existing?.botName ?? null)
        : normalizeExternalAgentBotName(input.botName)
    const maxRunMinutes =
      input.maxRunMinutes ??
      existing?.maxRunMinutes ??
      EXTERNAL_AGENT_DEFAULT_MAX_RUN_MINUTES
    if (
      !Number.isInteger(maxRunMinutes) ||
      maxRunMinutes < 1 ||
      maxRunMinutes > EXTERNAL_AGENT_MAX_RUN_MINUTES_LIMIT
    ) {
      throw badRequest("Invalid maximum run time")
    }
    const apiKey = input.apiKey?.trim()
    const encryptedApiKey = apiKey
      ? await encryptUtils.encryptObject(
          externalAgentApiKeySchema.parse({ apiKey }),
          staffAad(workspaceId),
        )
      : existing?.apiKey
    const apiTokenId =
      input.apiTokenId === undefined
        ? (existing?.apiTokenId ?? null)
        : input.apiTokenId
    const enabled = input.enabled ?? existing?.enabled ?? false
    if (
      !(baseUrl && encryptedApiKey) ||
      (enabled && !(botName && apiTokenId))
    ) {
      throw badRequest(
        "Base URL and key are required; enabling also requires a name and token",
      )
    }
    await db.transaction(async (tx) => {
      if (apiTokenId && (enabled || input.apiTokenId !== undefined)) {
        const token = await workspaceApiTokenRepository.findScopesForWorkspace(
          { workspaceId, id: apiTokenId, lock: true },
          tx,
        )
        if (token?.scopes?.includes("chats") !== true) {
          throw badRequest(
            "Token must belong to this workspace and explicitly include chats",
          )
        }
      }
      await externalAgentRepository.upsert(
        {
          workspaceId,
          purpose: "staff",
          values: {
            provider: "hermes",
            baseUrl,
            apiKey: encryptedApiKey,
            enabled,
            botName,
            apiTokenId,
            maxRunMinutes,
            progressMessage: EXTERNAL_AGENT_DEFAULT_PROGRESS_MESSAGE,
            signMessages: false,
            announceManager: false,
            resumeAfterHours: null,
          },
        },
        tx,
      )
    })
    await this.invalidateCacheTags(staffTag(workspaceId))
    const settings = await this.get(workspaceId)
    if (!settings) {
      throw new Error("Staff assistant settings were not found after update")
    }
    return settings
  }

  async getRuntime(workspaceId: string): Promise<ExternalAgentRuntime | null> {
    const agent = await externalAgentRepository.findByWorkspace(
      workspaceId,
      "staff",
    )
    if (!(agent?.enabled && agent.botName)) {
      return null
    }
    if (!(await tokenHasChats(workspaceId, agent.apiTokenId))) {
      return null
    }
    const { apiKey } = await encryptUtils.decryptObject(
      agent.apiKey,
      externalAgentApiKeySchema,
      staffAad(workspaceId),
    )
    return {
      agent,
      client: createHermesClient({ baseUrl: agent.baseUrl, apiKey }),
    }
  }

  async test(workspaceId: string): Promise<ExternalAgentCheckResult> {
    const agent = await externalAgentRepository.findByWorkspace(
      workspaceId,
      "staff",
    )
    if (!agent) {
      throw notFoundException("Staff assistant is not configured")
    }
    const acquired = await distributedStore.setNumberIfNotExists(
      `externalAgent:test:${workspaceId}:staff`,
      1,
      10,
    )
    if (!acquired) {
      throw new ChatbotXException(
        "Staff assistant check was run recently",
        "staffAssistantTestThrottled",
        429,
      )
    }
    let result: ExternalAgentCheckResult
    try {
      const { apiKey } = await encryptUtils.decryptObject(
        agent.apiKey,
        externalAgentApiKeySchema,
        staffAad(workspaceId),
      )
      await createHermesClient({ baseUrl: agent.baseUrl, apiKey }).health()
      result = { status: "ok", error: null, checkedAt: new Date() }
    } catch (err) {
      logger.warn({ err, workspaceId }, "Staff assistant: check failed")
      result = {
        status: "error",
        error: describeExternalAgentCheckError(err),
        checkedAt: new Date(),
      }
    }
    await externalAgentRepository.updateCheck({
      workspaceId,
      purpose: "staff",
      ...result,
    })
    await this.invalidateCacheTags(staffTag(workspaceId))
    return result
  }
}

export const staffAssistantService = new StaffAssistantService()
