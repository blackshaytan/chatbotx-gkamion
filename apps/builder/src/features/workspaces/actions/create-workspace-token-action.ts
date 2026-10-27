"use server"

import { workspaceApiTokenService } from "@chatbotx.io/business"
import { generateWorkspaceToken } from "@chatbotx.io/business/workspace-api-token/credentials"
import {
  type WorkspaceIdRequestParams,
  workspaceIdrequestParams,
} from "@/features/common/schema"
import { workspaceActionClient } from "@/lib/safe-action"
import { requireWorkspaceTokenSuperAdmin } from "../lib/require-workspace-token-super-admin"
import { orderedWorkspaceApiTokenScopes } from "../lib/workspace-token-scopes"
import {
  type CreateWorkspaceTokenRequest,
  createWorkspaceTokenRequest,
} from "../schema/action"

export const createWorkspaceTokenAction = workspaceActionClient
  .bindArgsSchemas(workspaceIdrequestParams)
  .inputSchema(createWorkspaceTokenRequest)
  .action(
    async ({
      bindArgsParsedInputs: [workspaceId],
      parsedInput,
    }: {
      bindArgsParsedInputs: WorkspaceIdRequestParams
      parsedInput: CreateWorkspaceTokenRequest
    }) => {
      await requireWorkspaceTokenSuperAdmin(workspaceId)

      const { token, tokenHash, tokenPrefix } = await generateWorkspaceToken()
      let scopes: CreateWorkspaceTokenRequest["scopes"] | null =
        parsedInput.scopes
      if (parsedInput.allScopes) {
        // Chats are intentionally never covered by the legacy NULL "all
        // scopes" value. Selecting them converts the token to an explicit
        // list of every current scope, including chats.
        scopes = parsedInput.includeChats
          ? orderedWorkspaceApiTokenScopes
          : null
      }

      await workspaceApiTokenService.createToken({
        workspaceId,
        name: parsedInput.name,
        permission: parsedInput.permission,
        tokenHash,
        tokenPrefix,
        scopes,
      })

      // Plaintext exists only in this return value — never persisted.
      return { token }
    },
  )
