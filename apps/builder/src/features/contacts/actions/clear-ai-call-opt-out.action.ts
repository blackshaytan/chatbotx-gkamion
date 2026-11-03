"use server"

import { voiceAgentService } from "@chatbotx.io/business"
import { zodBigintAsString } from "@chatbotx.io/utils"
import { workspaceActionClient } from "@/lib/safe-action"
import { requireContactPermissionScope } from "../permissions"

export const clearAiCallOptOutAction = workspaceActionClient
  .bindArgsSchemas([zodBigintAsString(), zodBigintAsString()])
  .action(async ({ bindArgsParsedInputs: [workspaceId, id], ctx }) => {
    await requireContactPermissionScope(workspaceId)
    return await voiceAgentService.clearAiCallOptOut({
      workspaceId,
      contactId: id,
      actorUserId: ctx.user.id,
    })
  })
