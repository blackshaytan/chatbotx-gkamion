import type { DatabaseClient } from "@chatbotx.io/database/client"
import {
  externalAgentRepository,
  workspaceApiTokenRepository,
} from "@chatbotx.io/database/repositories"

/** Re-read authorization state; a cached token binding cannot outlive revocation. */
export const isStaffAssistantAvailable = async (
  workspaceId: string,
  tx?: DatabaseClient,
): Promise<boolean> => {
  const agent = await externalAgentRepository.findByWorkspace(
    workspaceId,
    "staff",
    tx,
  )
  if (
    !(
      agent?.enabled &&
      agent.botName &&
      agent.baseUrl &&
      agent.apiKey &&
      agent.apiTokenId
    )
  ) {
    return false
  }
  const token = await workspaceApiTokenRepository.findScopesForWorkspace(
    { workspaceId, id: agent.apiTokenId, lock: Boolean(tx) },
    tx,
  )
  if (token?.scopes?.includes("chats") !== true) {
    return false
  }
  if (!tx) {
    return true
  }
  // Token first, then profile: deleting a token uses the same lock order.
  const locked = await externalAgentRepository.findStaffAvailability(
    workspaceId,
    tx,
  )
  return Boolean(
    locked?.enabled &&
      locked.botName &&
      locked.baseUrl &&
      locked.apiKey &&
      locked.apiTokenId === agent.apiTokenId,
  )
}
